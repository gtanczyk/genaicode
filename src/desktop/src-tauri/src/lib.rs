//! The genaicode desktop shell.
//!
//! It owns no chat logic. It starts the bundled Node.js on the bundled `genaicode ui --home`, waits
//! for the address that server prints, and shows that page in the window. The app has no project
//! folder: each conversation resolves its own working directory from context (starting in the
//! neutral home `~/.genaicode/home`), and its page names no folder. The page gets no Tauri
//! commands: there are no capabilities, so it is the same page a browser would load.
//!
//! Beside the window it keeps an icon in the menu bar: the sessions of every agent that wait for
//! the user, read from `genaicode sessions --waiting --json --watch`, with Approve and Deny for the
//! questions that can be answered from outside their agent.

mod nav;
mod tower;
mod transcript;
mod update;

use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    env, fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID},
    tray::TrayIconBuilder,
    webview::{DownloadEvent, NewWindowResponse},
    AppHandle, Manager, RunEvent, Url, WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

const CHECK_UPDATES: &str = "check-updates";
const DEV_COPY_ID: &str = "dev:copy-id";
const DEV_COPY_PATH: &str = "dev:copy-path";
const DEV_COPY_MD: &str = "dev:copy-md";
const DEV_COPY_JSON: &str = "dev:copy-json";
const DEV_SAVE_MD: &str = "dev:save-md";
const DEV_SAVE_JSON: &str = "dev:save-json";
const SUPPORT_URL: &str = "https://github.com/gtanczyk/genaicode/blob/master/docs/SUPPORT.md";
const LEGAL_URL: &str = "https://github.com/gtanczyk/genaicode/blob/master/docs/legal.md";
const BUG_REPORT_URL: &str =
    "https://github.com/gtanczyk/genaicode/issues/new?template=bug_report.md";
/// The ids of the menu bar's own items. Its other ids carry what they act on: `approve:<question>`,
/// `deny:<question>` and `open:<index of the session in the last snapshot>`, which shows the window.
const TRAY: &str = "tower";
const SHOW: &str = "show";
const QUIT: &str = "quit";
const RELAUNCH: &str = "relaunch";
/// What `genaicode ui` prints when its page asks for the relaunch that installs an update.
const RELAUNCH_LINE: &str = "Relaunch to update";
/// What `genaicode ui` prints when Check again asks to re-read the login shell environment.
const REFRESH_ENV_LINE: &str = "Refresh env";
/// The line `genaicode ui` prints once it listens: `Open http://127.0.0.1:<port>/?token=...`.
const OPEN_PREFIX: &str = "Open http://127.0.0.1:";

/// The running `genaicode ui`. Closing its stdin stops it (`--exit-with-stdin`): that is how the
/// shell stops it, and why it cannot outlive the app even when the app is killed.
struct Server {
    child: Child,
    stdin: Option<ChildStdin>,
}

/// In-flight webview downloads staged in the temp dir until the user picks a save path.
type PendingDownloads = Arc<Mutex<HashMap<String, VecDeque<(PathBuf, String)>>>>;

#[derive(Default)]
struct Shell {
    server: Option<Server>,
    /// Address and token of the running `genaicode ui` server, for native Session menu actions.
    server_endpoint: Option<transcript::Endpoint>,
    /// Exact origin (`http://127.0.0.1:<port>`) of the active `genaicode ui` server.
    server_origin: Arc<Mutex<Option<nav::ServerOrigin>>>,
    /// Staged downloads waiting to finish so a non-blocking Save dialog can place them.
    pending_downloads: PendingDownloads,
    /// Bumped on every start, so the reader of a replaced server stays quiet.
    generation: u64,
    /// The user's login shell environment, read at start and refreshed on Check again.
    login: Option<Vec<(String, String)>>,
    /// Prevents overlapping login-shell probes when Check again is clicked repeatedly.
    refreshing_env: bool,
    /// `genaicode sessions --waiting --json --watch`, which feeds the menu bar.
    watcher: Option<Server>,
    /// What it last said waits: the menu bar's items point into it.
    waiting: Vec<tower::Waiting>,
    limits: Vec<tower::Limit>,
    topics: Vec<tower::Topic>,
    /// The app is on its way out: nothing is started again.
    quitting: bool,
}

type ShellState = Mutex<Shell>;

/// A GUI app starts with launchd's environment, without what the shell profile adds: PATH entries
/// (Homebrew, nvm, `~/.local/bin`) and exported API keys, so `claude` or `codex` would not be found
/// and providers would see no keys. Ask the login shell once and pass its whole environment on.
fn login_env() -> Option<Vec<(String, String)>> {
    if cfg!(windows) {
        return None;
    }
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let output = Command::new(shell)
            .args(["-ilc", "printf '__GENAICODE_ENV__'; env -0"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output();
        let _ = tx.send(output);
    });
    // A profile that waits for input must not hold the app: go on with the environment we have.
    let output = rx.recv_timeout(Duration::from_secs(5)).ok()?.ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let start = text.find("__GENAICODE_ENV__")? + "__GENAICODE_ENV__".len();
    let vars: Vec<(String, String)> = text[start..]
        .split('\0')
        .filter_map(|entry| entry.split_once('='))
        // What belongs to that shell process, not to the user's setup.
        .filter(|(name, _)| !matches!(*name, "PWD" | "OLDPWD" | "SHLVL" | "_"))
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect();
    vars.iter().any(|(name, _)| name == "PATH").then_some(vars)
}

/// Node.js ships beside the app's executable. On Linux that directory is `/usr/bin` in a
/// package, where a `node` of ours would replace the system's, so there it lives in the runtime.
fn node_binary(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("GENAICODE_DESKTOP_NODE") {
        return Ok(path.into());
    }
    let path = if cfg!(target_os = "linux") {
        app.path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("runtime/bin/node")
    } else {
        let exe = env::current_exe().map_err(|error| error.to_string())?;
        let name = if cfg!(windows) { "node.exe" } else { "node" };
        exe.parent().ok_or("the app has no directory")?.join(name)
    };
    path.exists()
        .then_some(path.clone())
        .ok_or_else(|| format!("Node.js is missing from the app ({}).", path.display()))
}

fn genaicode_cli(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("GENAICODE_DESKTOP_CLI") {
        return Ok(path.into());
    }
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let path = resources.join("runtime/node_modules/genaicode/dist/cli.js");
    path.exists()
        .then_some(path.clone())
        .ok_or_else(|| format!("genaicode is missing from the app ({}).", path.display()))
}

/// The bundled Node.js on the bundled genaicode, with the user's environment.
fn genaicode(app: &AppHandle, shell: &mut Shell) -> Result<Command, String> {
    let node = node_binary(app)?;
    let cli = genaicode_cli(app)?;
    if shell.login.is_none() {
        shell.login = login_env();
    }
    let mut command = Command::new(node);
    command.arg(cli);
    if let Some(vars) = &shell.login {
        command.envs(vars.iter().map(|(name, value)| (name, value)));
    }
    // After the login environment, so a profile cannot turn it back on: the app updates itself
    // as a whole, and the copy inside it must not look for newer ones.
    command.env("GENAICODE_NO_AUTO_UPDATE", "1");
    // Tells `genaicode ui` that this shell handles `Refresh env` requests over stderr/stdin.
    command.env("GENAICODE_DESKTOP_SHELL", "1");
    Ok(command)
}

/// Delete the saved folder file left behind by earlier versions of the desktop app, if present.
fn remove_legacy_saved_folder(config_dir: &Path) {
    let _ = fs::remove_file(config_dir.join("folder"));
}

/// Format an `open-session <id>` stdin command for the server, rejecting malformed session ids.
fn open_session_command(id: &str) -> Option<String> {
    if id.is_empty()
        || id.len() > 200
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b':' | b'-'))
    {
        return None;
    }
    Some(format!("open-session {id}"))
}

/// Where desktop settings (`desktop.json`) live, beside `~/.genaicode/home`.
fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(root) = env::var_os("GENAICODE_HOME") {
        return Ok(PathBuf::from(root).join("desktop.json"));
    }
    Ok(app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join(".genaicode")
        .join("desktop.json"))
}

fn fail(app: &AppHandle, message: String) {
    app.dialog()
        .message(dialog_text(message))
        .title("Genaicode")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

/// The GTK dialog on Linux reads its message as a `printf` format: a `%` in a link must not be one.
fn dialog_text(message: String) -> String {
    if cfg!(target_os = "linux") {
        message.replace('%', "%%")
    } else {
        message
    }
}

fn open_link(app: &AppHandle, url: &str) {
    #[cfg(target_os = "linux")]
    {
        // The opener counts a launcher still running after 250 ms as success, so a later failure would
        // go unseen. `open::that` waits for each launcher (xdg-open, gio, ...) to exit, off the UI thread.
        let app = app.clone();
        let url = url.to_string();
        std::thread::spawn(move || {
            if let Err(error) = open::that(&url) {
                let message = format!("Could not open this link:\n{url}\n\n{error}");
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || fail(&handle, message));
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    if let Err(error) = app.opener().open_url(url, None::<&str>) {
        fail(app, format!("Could not open this link:\n{url}\n\n{error}"));
    }
}

fn native_opener() -> impl tauri::plugin::Plugin<Wry> {
    // The chat has no opener IPC permission. Let its links reach the native navigation handlers.
    tauri_plugin_opener::Builder::new()
        .open_js_links_on_click(false)
        .build()
}

/// How long `genaicode ui` gets to stop its agents and `!command`s before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(5);

/// Close the server's stdin, so `--exit-with-stdin` shuts it down the way Ctrl-C would: its agents
/// and shell commands run in their own process groups, and a SIGKILL of Node alone would leave
/// them running. Kill it only if it has not exited within `STOP_GRACE`.
fn stop(shell: &mut Shell) {
    shell.server_endpoint = None;
    let Some(Server { mut child, stdin }) = shell.server.take() else {
        return;
    };
    drop(stdin);
    let deadline = std::time::Instant::now() + STOP_GRACE;
    while std::time::Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Start `genaicode ui` and show it once it says where it listens.
fn start(app: &AppHandle) {
    if let Err(message) = try_start(app) {
        fail(app, message);
    }
}

fn try_start(app: &AppHandle) -> Result<(), String> {
    let settings_path = settings_file(app)?;
    let settings = nav::load_settings(&settings_path);
    let state = app.state::<ShellState>();
    let mut shell = state.lock().map_err(|_| "the shell state is poisoned")?;
    let mut command = genaicode(app, &mut shell)?;
    stop(&mut shell);
    if let Ok(mut origin) = shell.server_origin.lock() {
        *origin = None;
    }
    let origin_slot = Arc::clone(&shell.server_origin);
    shell.generation += 1;
    let generation = shell.generation;
    command.args([
        "ui",
        "--sessions",
        "--delegate",
        "--home",
        "--no-open",
        "--exit-with-stdin",
        // A restart, for an update or not, comes back to the conversation it left.
        "--restore",
    ]);
    command.env(
        "GENAICODE_DESKTOP_VERSION",
        app.package_info().version.to_string(),
    );
    let cdn_hosts: Vec<&str> = settings
        .artifact_cdn
        .iter()
        .map(String::as_str)
        .filter(|host| nav::is_safe_cdn_host(host))
        .collect();
    if !cdn_hosts.is_empty() {
        command.arg("--artifact-cdn").arg(cdn_hosts.join(","));
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start genaicode: {error}"))?;
    let stderr = child.stderr.take().ok_or("genaicode has no stderr")?;
    let stdin = child.stdin.take();
    shell.server = Some(Server { child, stdin });
    drop(shell);

    let app = app.clone();
    thread::spawn(move || {
        let mut opened = false;
        // What it said before it stopped, without the address: that line carries the access token.
        let mut said: Vec<String> = Vec::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if !opened && line.starts_with(OPEN_PREFIX) {
                opened = true;
                let address = line["Open ".len()..].trim().to_string();
                let endpoint = transcript::parse_endpoint(&address);
                let handle = app.clone();
                let slot = Arc::clone(&origin_slot);
                let _ = app.run_on_main_thread(move || {
                    let state = handle.state::<ShellState>();
                    let Ok(mut shell) = state.lock() else { return };
                    if shell.generation != generation {
                        return;
                    }
                    shell.server_endpoint = endpoint;
                    drop(shell);
                    if let (Some(window), Ok(url)) =
                        (handle.get_webview_window("main"), Url::parse(&address))
                    {
                        if let Ok(mut origin) = slot.lock() {
                            *origin = nav::ServerOrigin::from_url(&url);
                        }
                        let _ = window.navigate(url);
                    }
                    // A chat that starts after an update was downloaded hears of it now.
                    update_ready(&handle);
                });
            } else if opened && line == RELAUNCH_LINE {
                // The page's "Relaunch to update": only an update this app downloaded installs.
                update::relaunch(&app);
            } else if opened && line == REFRESH_ENV_LINE {
                // Check again: re-read the login shell environment without restarting the server.
                refresh_env(&app, generation);
            } else if opened && line.starts_with(nav::REVEAL_PREFIX) {
                if let Some(path) = nav::parse_reveal_line(&line) {
                    if path.exists() {
                        let _ = app.opener().reveal_item_in_dir(&path);
                    }
                }
            } else if opened && line.starts_with(nav::SETTINGS_PREFIX) {
                if let Some(updated) = nav::parse_settings_line(&line) {
                    let _ = nav::save_settings(&settings_path, &updated);
                }
            } else if opened {
                if let Some(request) = transcript::parse_save_line(&line) {
                    save_transcript(&app, request);
                }
            } else {
                said.push(line);
                if said.len() > 12 {
                    said.remove(0);
                }
            }
        }
        // stderr closed: the server is gone. Say so unless a newer one replaced it or the app quit.
        let state = app.state::<ShellState>();
        let Ok(mut shell) = state.lock() else { return };
        if shell.generation != generation || shell.server.is_none() {
            return;
        }
        stop(&mut shell);
        drop(shell);
        let detail = if said.is_empty() {
            String::new()
        } else {
            format!("\n\n{}", said.join("\n"))
        };
        if !opened {
            return fail(&app, format!("genaicode did not start.{detail}"));
        }
        let handle = app.clone();
        app.dialog()
            .message("genaicode stopped.")
            .title("Genaicode")
            .kind(MessageDialogKind::Error)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Start Again".into(),
                "Close".into(),
            ))
            .show(move |again| {
                if again {
                    start(&handle);
                }
            });
    });
    Ok(())
}

/// Encode environment variables as one `env <json>` line for `genaicode ui`'s stdin.
fn format_env_line(vars: Option<&[(String, String)]>) -> String {
    let mut map: BTreeMap<&str, &str> = BTreeMap::new();
    if let Some(vars) = vars {
        for (name, value) in vars {
            if name == "GENAICODE_NO_AUTO_UPDATE" {
                continue;
            }
            map.insert(name.as_str(), value.as_str());
        }
    }
    let json = serde_json::to_string(&map).unwrap_or_else(|_| "{}".to_string());
    format!("env {json}")
}

/// Re-read the user's login shell environment on a background thread (with the existing 5 s limit)
/// and send it to the running `genaicode ui` over stdin so newly installed CLIs are picked up
/// without restarting the app.
fn refresh_env(app: &AppHandle, generation: u64) {
    {
        let state = app.state::<ShellState>();
        let Ok(mut shell) = state.lock() else { return };
        if shell.quitting || shell.generation != generation || shell.refreshing_env {
            return;
        }
        shell.refreshing_env = true;
    }
    let app = app.clone();
    thread::spawn(move || {
        let fresh = login_env();
        let state = app.state::<ShellState>();
        let Ok(mut shell) = state.lock() else { return };
        shell.refreshing_env = false;
        if let Some(vars) = fresh {
            shell.login = Some(vars);
        }
        if shell.quitting || shell.generation != generation {
            return;
        }
        let line = format_env_line(shell.login.as_deref());
        if let Some(stdin) = shell
            .server
            .as_mut()
            .and_then(|server| server.stdin.as_mut())
        {
            let _ = writeln!(stdin, "{line}");
            let _ = stdin.flush();
        }
    });
}

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// An update is being downloaded, waits, is being installed, or stopped being any of these: tell the chat's page, which then offers
/// "Relaunch to update", and put the same into the menu bar.
pub(crate) fn update_ready(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let state = handle.state::<ShellState>();
        let Ok(mut shell) = state.lock() else { return };
        if let Some(stdin) = shell
            .server
            .as_mut()
            .and_then(|server| server.stdin.as_mut())
        {
            let _ = match update::stage() {
                Some((version, update::Stage::Downloading)) => {
                    writeln!(stdin, "update-downloading {version}")
                }
                Some((version, update::Stage::Ready)) => writeln!(stdin, "update-ready {version}"),
                Some((version, update::Stage::Installing)) => {
                    writeln!(stdin, "update-installing {version}")
                }
                None => writeln!(stdin, "update-none"),
            };
            let _ = stdin.flush();
        }
        if let (Some(tray), Ok(menu)) = (
            handle.tray_by_id(TRAY),
            tower_menu(&handle, &shell.waiting, &shell.limits, &shell.topics),
        ) {
            let _ = tray.set_menu(Some(menu));
        }
    });
}

/// The menu bar's menu: what waits, then the app's own items.
fn tower_menu(
    app: &AppHandle,
    sessions: &[tower::Waiting],
    limits: &[tower::Limit],
    topics: &[tower::Topic],
) -> tauri::Result<Menu<Wry>> {
    let none = None::<&str>;
    let menu = Menu::new(app)?;
    if let Some((version, stage)) = update::stage() {
        let (label, can) = match stage {
            update::Stage::Downloading => (format!("Downloading Update ({version})…"), false),
            update::Stage::Ready => (format!("Relaunch to Update ({version})"), true),
            update::Stage::Installing => (format!("Installing Update ({version})…"), false),
        };
        menu.append(&MenuItem::with_id(app, RELAUNCH, label, can, none)?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    // The quota comes first: it decides which agent gets the next task.
    let quota = tower::quota(limits);
    for line in &quota {
        menu.append(&MenuItem::new(app, line, false, none)?)?;
    }
    if !quota.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    for entry in tower::entries(sessions) {
        match entry {
            tower::Entry::Note(text) => menu.append(&MenuItem::new(app, text, false, none)?)?,
            tower::Entry::Session { session, label } => menu.append(&MenuItem::with_id(
                app,
                format!("open:{session}"),
                label,
                true,
                none,
            )?)?,
            tower::Entry::Question {
                session,
                ask,
                label,
            } => {
                let approve =
                    MenuItem::with_id(app, format!("approve:{ask}"), "Approve", true, none)?;
                let deny = MenuItem::with_id(app, format!("deny:{ask}"), "Deny", true, none)?;
                let _ = session;
                menu.append(&Submenu::with_items(app, label, true, &[&approve, &deny])?)?
            }
        }
    }
    // Then the topics agents work on now: nothing to do there, but good to know before starting more.
    let working = tower::working(topics);
    if !working.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    for line in &working {
        menu.append(&MenuItem::new(app, line, false, none)?)?;
    }
    // What was left on an offer or an old question: folded, and not in the count by the icon.
    if let Some((heading, lines)) = tower::stalled(topics) {
        if working.is_empty() {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        let items = lines
            .iter()
            .enumerate()
            .map(|(index, line)| {
                MenuItem::with_id(app, format!("open:stalled:{index}"), line, true, none)
            })
            .collect::<tauri::Result<Vec<_>>>()?;
        let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = items
            .iter()
            .map(|item| item as &dyn tauri::menu::IsMenuItem<Wry>)
            .collect();
        menu.append(&Submenu::with_items(app, heading, true, &refs)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, SHOW, "Show Genaicode", true, none)?)?;
    menu.append(&MenuItem::with_id(app, QUIT, "Quit Genaicode", true, none)?)?;
    Ok(menu)
}

/// A new snapshot from the watch: remember it and show it in the menu bar.
fn show_waiting(app: &AppHandle, snapshot: tower::Snapshot) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let state = handle.state::<ShellState>();
        let Ok(mut shell) = state.lock() else { return };
        shell.waiting = snapshot.sessions;
        shell.limits = snapshot.limits;
        shell.topics = snapshot.topics;
        let Some(tray) = handle.tray_by_id(TRAY) else {
            return;
        };
        if let Ok(menu) = tower_menu(&handle, &shell.waiting, &shell.limits, &shell.topics) {
            let _ = tray.set_menu(Some(menu));
        }
        let count = tower::count(&shell.waiting);
        let _ = tray.set_title(count.as_deref());
        let _ = tray.set_tooltip(Some(match &count {
            Some(count) => format!("Genaicode: {count} need you now"),
            None => "Genaicode".to_string(),
        }));
    });
}

/// How long after the watch ends it is started again.
const WATCH_AGAIN: Duration = Duration::from_secs(5);

/// Keep `genaicode sessions --waiting --json --watch` running for as long as the app does. It
/// ends with its stdin, so it cannot outlive the app either.
fn watch(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || loop {
        let state = app.state::<ShellState>();
        let stdout = {
            let Ok(mut shell) = state.lock() else { return };
            if shell.quitting {
                return;
            }
            // Without Node.js or genaicode in the app there is nothing to try again.
            let Ok(mut command) = genaicode(&app, &mut shell) else {
                return;
            };
            command
                .args([
                    "sessions",
                    "--waiting",
                    "--json",
                    "--watch",
                    "--exit-with-stdin",
                ])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            command.spawn().ok().and_then(|mut child| {
                let stdout = child.stdout.take();
                let stdin = child.stdin.take();
                shell.watcher = Some(Server { child, stdin });
                stdout
            })
        };
        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(snapshot) = tower::parse_snapshot(&line) {
                    show_waiting(&app, snapshot);
                }
            }
        }
        {
            let Ok(mut shell) = state.lock() else { return };
            if let Some(mut watcher) = shell.watcher.take() {
                let _ = watcher.child.kill();
                let _ = watcher.child.wait();
            }
            if shell.quitting {
                return;
            }
        }
        thread::sleep(WATCH_AGAIN);
    });
}

/// Approve or deny a question from the menu bar: `genaicode sessions approve|deny <question>`.
fn answer(app: &AppHandle, ask: &str, allow: bool) {
    let app = app.clone();
    let ask = ask.to_string();
    thread::spawn(move || {
        let command = {
            let state = app.state::<ShellState>();
            let Ok(mut shell) = state.lock() else { return };
            genaicode(&app, &mut shell)
        };
        let result = command.and_then(|mut command| {
            command
                .args(["sessions", if allow { "approve" } else { "deny" }, &ask])
                .stdin(Stdio::null())
                .output()
                .map_err(|error| error.to_string())
        });
        match result {
            Ok(output) if output.status.success() => {}
            Ok(output) => fail(
                &app,
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ),
            Err(message) => fail(&app, message),
        }
    });
}

fn info(app: &AppHandle, message: String) {
    app.dialog()
        .message(message)
        .title("Genaicode")
        .kind(MessageDialogKind::Info)
        .show(|_| {});
}

fn current_endpoint(app: &AppHandle) -> Result<transcript::Endpoint, String> {
    let state = app.state::<ShellState>();
    let shell = state.lock().map_err(|_| "the shell state is poisoned")?;
    shell
        .server_endpoint
        .clone()
        .ok_or_else(|| "Genaicode is still starting.".to_string())
}

fn send_toast(app: &AppHandle, text: &str) {
    let line = transcript::format_toast_line(text);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let state = handle.state::<ShellState>();
        let Ok(mut shell) = state.lock() else { return };
        if let Some(stdin) = shell
            .server
            .as_mut()
            .and_then(|server| server.stdin.as_mut())
        {
            let _ = stdin.write_all(line.as_bytes());
            let _ = stdin.flush();
        }
    });
}

#[derive(Clone, Copy)]
enum CopyKind {
    SessionId,
    SessionPath,
    Markdown,
    Json,
}

fn copy_transcript_item(app: &AppHandle, kind: CopyKind) {
    let app = app.clone();
    thread::spawn(move || {
        let endpoint = match current_endpoint(&app) {
            Ok(endpoint) => endpoint,
            Err(message) => return info(&app, message),
        };
        let path = match kind {
            CopyKind::SessionId | CopyKind::SessionPath => "/api/transcript?format=meta",
            CopyKind::Markdown => "/api/transcript?format=md",
            CopyKind::Json => "/api/transcript?format=json",
        };
        let response = match transcript::fetch(&endpoint, path) {
            Ok(response) if response.status == 200 => response,
            Ok(response) => {
                return fail(
                    &app,
                    format!(
                        "Could not read conversation transcript (HTTP {}).",
                        response.status
                    ),
                );
            }
            Err(message) => return fail(&app, message),
        };
        let (text, toast) = match kind {
            CopyKind::SessionId => {
                let meta: transcript::Meta = match serde_json::from_slice(&response.body) {
                    Ok(meta) => meta,
                    Err(error) => {
                        return fail(&app, format!("Could not read session info: {error}"))
                    }
                };
                match meta.session_id.filter(|id| !id.is_empty()) {
                    Some(id) => (id, "Copied session ID"),
                    None => {
                        return info(
                            &app,
                            "This conversation has no session ID yet. Send a message first.".into(),
                        );
                    }
                }
            }
            CopyKind::SessionPath => {
                let meta: transcript::Meta = match serde_json::from_slice(&response.body) {
                    Ok(meta) => meta,
                    Err(error) => {
                        return fail(&app, format!("Could not read session info: {error}"))
                    }
                };
                match meta.session_path.filter(|path| !path.is_empty()) {
                    Some(path) => (path, "Copied session file path"),
                    None => {
                        return info(
                            &app,
                            "No session file was found on disk for this conversation yet.".into(),
                        );
                    }
                }
            }
            CopyKind::Markdown => (
                String::from_utf8_lossy(&response.body).into_owned(),
                "Copied transcript (Markdown)",
            ),
            CopyKind::Json => (
                String::from_utf8_lossy(&response.body).into_owned(),
                "Copied raw state (JSON)",
            ),
        };
        match transcript::copy_to_clipboard(&text) {
            Ok(()) => send_toast(&app, toast),
            Err(message) => fail(&app, format!("Could not copy to clipboard: {message}")),
        }
    });
}

fn save_transcript(app: &AppHandle, request: transcript::SaveRequest) {
    let app = app.clone();
    thread::spawn(move || {
        let endpoint = match current_endpoint(&app) {
            Ok(endpoint) => endpoint,
            Err(message) => return info(&app, message),
        };
        let response = match transcript::fetch(&endpoint, &request.api_path()) {
            Ok(response) if response.status == 200 => response,
            Ok(response) if response.status == 404 => {
                return fail(&app, "That session could not be found.".into());
            }
            Ok(response) => {
                return fail(
                    &app,
                    format!("Could not read transcript (HTTP {}).", response.status),
                );
            }
            Err(message) => return fail(&app, message),
        };
        let filename = response
            .filename
            .unwrap_or_else(|| request.format.default_filename().to_string());
        let bytes = response.body;
        let handle = app.clone();
        app.dialog()
            .file()
            .set_file_name(&filename)
            .add_filter(request.format.label(), &[request.format.as_str()])
            .save_file(move |picked| {
                let Some(path) = picked.and_then(|file| file.into_path().ok()) else {
                    return;
                };
                match fs::write(&path, &bytes) {
                    Ok(()) => {
                        let name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or(&filename);
                        send_toast(&handle, &format!("Saved {name}"));
                    }
                    Err(error) => fail(&handle, format!("Could not save transcript: {error}")),
                }
            });
    });
}

/// Tell the running `genaicode ui --home` server to open the session clicked in the menu bar.
fn open_session(app: &AppHandle, index: usize) {
    let state = app.state::<ShellState>();
    let Ok(mut shell) = state.lock() else { return };
    let Some(line) = shell
        .waiting
        .get(index)
        .and_then(|session| open_session_command(&session.id))
    else {
        return;
    };
    if let Some(stdin) = shell
        .server
        .as_mut()
        .and_then(|server| server.stdin.as_mut())
    {
        let _ = writeln!(stdin, "{line}");
        let _ = stdin.flush();
    }
}

fn on_menu(app: &AppHandle, id: &str) {
    if id == SHOW {
        show(app);
    } else if let Some(index) = id.strip_prefix("open:") {
        if let Ok(index) = index.parse::<usize>() {
            open_session(app, index);
        }
        show(app);
    } else if id == RELAUNCH {
        update::relaunch(app);
    } else if id == CHECK_UPDATES {
        update::check(app, true);
    } else if id == DEV_COPY_ID {
        copy_transcript_item(app, CopyKind::SessionId);
    } else if id == DEV_COPY_PATH {
        copy_transcript_item(app, CopyKind::SessionPath);
    } else if id == DEV_COPY_MD {
        copy_transcript_item(app, CopyKind::Markdown);
    } else if id == DEV_COPY_JSON {
        copy_transcript_item(app, CopyKind::Json);
    } else if id == DEV_SAVE_MD {
        save_transcript(
            app,
            transcript::SaveRequest {
                format: transcript::Format::Md,
                session: None,
            },
        );
    } else if id == DEV_SAVE_JSON {
        save_transcript(
            app,
            transcript::SaveRequest {
                format: transcript::Format::Json,
                session: None,
            },
        );
    } else if matches!(id, SUPPORT_URL | BUG_REPORT_URL | LEGAL_URL) {
        open_link(app, id);
    } else if id == QUIT {
        app.exit(0);
    } else if let Some(ask) = id.strip_prefix("approve:") {
        answer(app, ask, true);
    } else if let Some(ask) = id.strip_prefix("deny:") {
        answer(app, ask, false);
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        // A second launch (another copy of the app, a second click) shows the one that runs.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(native_opener())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ShellState::default())
        .on_window_event(|window, event| {
            // On macOS the app lives on in the menu bar: closing the window hides it, and the
            // Dock icon or "Show Genaicode" brings it back. Quit ends it.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if cfg!(target_os = "macos") {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle();
            let (origin_slot, pending_downloads) = {
                let state = handle.state::<ShellState>();
                let shell = state.lock().map_err(|_| "the shell state is poisoned")?;
                (
                    Arc::clone(&shell.server_origin),
                    Arc::clone(&shell.pending_downloads),
                )
            };
            let download_origin = Arc::clone(&origin_slot);
            let download_seq = Arc::new(AtomicU64::new(1));
            let window_config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .ok_or("main window missing from tauri.conf.json")?;
            let nav_handle = handle.clone();
            let new_window_handle = handle.clone();
            let download_handle = handle.clone();
            WebviewWindowBuilder::from_config(handle, &window_config)?
                .on_navigation(move |url| {
                    let server = origin_slot.lock().ok().and_then(|slot| *slot);
                    match nav::main_navigation(url, server) {
                        nav::MainNav::Allow => true,
                        nav::MainNav::OpenExternal(target) => {
                            open_link(&nav_handle, &target);
                            false
                        }
                        nav::MainNav::Deny => false,
                    }
                })
                .on_new_window(move |url, _features| {
                    if let Some(target) = nav::external_url(&url) {
                        open_link(&new_window_handle, &target);
                    }
                    NewWindowResponse::Deny
                })
                .on_download(move |_webview, event| match event {
                    DownloadEvent::Requested { url, destination } => {
                        let server = download_origin.lock().ok().and_then(|slot| *slot);
                        if !nav::is_download_allowed(&url, server) {
                            return false;
                        }
                        // `on_download` runs on the main thread, so showing a blocking dialog here
                        // would deadlock. Stage in a unique temp file first, then prompt with the
                        // non-blocking Save dialog once the download completes.
                        let name = nav::suggested_filename(&url, destination);
                        let seq = download_seq.fetch_add(1, Ordering::Relaxed);
                        let staged = env::temp_dir()
                            .join(format!("genaicode-dl-{}-{seq}-{name}", std::process::id()));
                        let _ = fs::remove_file(&staged);
                        if let Ok(mut pending) = pending_downloads.lock() {
                            pending
                                .entry(url.as_str().to_string())
                                .or_default()
                                .push_back((staged.clone(), name));
                        }
                        *destination = staged;
                        true
                    }
                    DownloadEvent::Finished { url, path, success } => {
                        let tracked = pending_downloads.lock().ok().and_then(|mut pending| {
                            let key = url.as_str();
                            let entry = pending.get_mut(key)?.pop_front();
                            if pending.get(key).is_some_and(VecDeque::is_empty) {
                                pending.remove(key);
                            }
                            entry
                        });
                        // WKWebView reports `path: None` on finish; fall back to our staged path.
                        let (source, name) = match (path, tracked) {
                            (Some(p), Some((_, name))) => (p, name),
                            (None, Some((p, name))) => (p, name),
                            (Some(p), None) => {
                                let name = nav::suggested_filename(&url, &p);
                                (p, name)
                            }
                            (None, None) => {
                                if !success {
                                    fail(&download_handle, "The download did not complete.".into());
                                }
                                return true;
                            }
                        };
                        if !success {
                            let _ = fs::remove_file(&source);
                            fail(&download_handle, "The download did not complete.".into());
                            return true;
                        }
                        let mut save = download_handle.dialog().file().set_file_name(&name);
                        if let Ok(downloads) = download_handle.path().download_dir() {
                            save = save.set_directory(downloads);
                        }
                        let app_handle = download_handle.clone();
                        save.save_file(move |chosen| {
                            let Some(dest) = chosen.and_then(|fp| fp.into_path().ok()) else {
                                let _ = fs::remove_file(&source);
                                return;
                            };
                            if let Err(error) = nav::move_file(&source, &dest) {
                                let _ = fs::remove_file(&source);
                                fail(&app_handle, format!("Could not save {name}: {error}"));
                                return;
                            }
                            let final_name = dest
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or(&name)
                                .to_string();
                            let reveal_btn = if cfg!(target_os = "macos") {
                                "Show in Finder"
                            } else {
                                "Show in File Manager"
                            };
                            let opener_app = app_handle.clone();
                            app_handle
                                .dialog()
                                .message(format!("Saved {final_name}."))
                                .title("Genaicode")
                                .kind(MessageDialogKind::Info)
                                .buttons(MessageDialogButtons::OkCancelCustom(
                                    reveal_btn.into(),
                                    "OK".into(),
                                ))
                                .show(move |reveal| {
                                    if reveal {
                                        let _ = opener_app.opener().reveal_item_in_dir(&dest);
                                    }
                                });
                        });
                        true
                    }
                    _ => true,
                })
                .build()?;
            let updates = MenuItem::with_id(
                handle,
                CHECK_UPDATES,
                "Check for Updates…",
                true,
                None::<&str>,
            )?;
            let menu = Menu::default(handle)?;
            if let Some(help) = menu
                .get(HELP_SUBMENU_ID)
                .as_ref()
                .and_then(|item| item.as_submenu())
            {
                for (label, url) in [
                    ("Get Help", SUPPORT_URL),
                    ("Report a Bug…", BUG_REPORT_URL),
                    ("Terms and Privacy", LEGAL_URL),
                ] {
                    help.append(&MenuItem::with_id(handle, url, label, true, None::<&str>)?)?;
                }
            }
            // Under the app's own menu on macOS, where such an item is looked for; elsewhere under
            // the last one, Help.
            let menus = menu.items()?;
            let own = if cfg!(target_os = "macos") {
                menus.first()
            } else {
                menus.last()
            };
            match own.and_then(|item| item.as_submenu()) {
                Some(own) if cfg!(target_os = "macos") => own.insert(&updates, 1)?,
                Some(own) => own.append(&updates)?,
                None => menu.append(&updates)?,
            }
            let session = Submenu::with_items(
                handle,
                "Session",
                true,
                &[
                    &MenuItem::with_id(handle, DEV_COPY_ID, "Copy Session ID", true, None::<&str>)?,
                    &MenuItem::with_id(
                        handle,
                        DEV_COPY_PATH,
                        "Copy Session File Path",
                        true,
                        None::<&str>,
                    )?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(
                        handle,
                        DEV_COPY_MD,
                        "Copy Transcript (Markdown)",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(
                        handle,
                        DEV_COPY_JSON,
                        "Copy Raw State (JSON)",
                        true,
                        None::<&str>,
                    )?,
                    &PredefinedMenuItem::separator(handle)?,
                    &MenuItem::with_id(
                        handle,
                        DEV_SAVE_MD,
                        "Save Transcript as Markdown…",
                        true,
                        None::<&str>,
                    )?,
                    &MenuItem::with_id(
                        handle,
                        DEV_SAVE_JSON,
                        "Save Transcript as JSON…",
                        true,
                        None::<&str>,
                    )?,
                ],
            )?;
            // Tauri's default File submenu has no stable ID and is absent on Linux.
            if let Some(file) = menus
                .iter()
                .filter_map(|item| item.as_submenu())
                .find(|submenu| submenu.text().is_ok_and(|title| title == "File"))
            {
                file.prepend_items(&[&session, &PredefinedMenuItem::separator(handle)?])?;
            } else {
                let file = Submenu::with_items(handle, "File", true, &[&session])?;
                menu.insert(&file, usize::from(cfg!(target_os = "macos")))?;
            }
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| on_menu(app, event.id().as_ref()));
            let mut tray = TrayIconBuilder::with_id(TRAY)
                .tooltip("Genaicode")
                .menu(&tower_menu(handle, &[], &[], &[])?)
                .show_menu_on_left_click(true);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            // A desktop without a place for it still gets the window.
            if tray.build(app).is_ok() {
                watch(handle);
            }
            if let Ok(config_dir) = handle.path().app_config_dir() {
                remove_legacy_saved_folder(&config_dir);
            }
            start(handle);
            update::watch(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the genaicode desktop app failed to start");

    app.run(|app, event| match event {
        RunEvent::Exit => {
            if let Ok(mut shell) = app.state::<ShellState>().lock() {
                shell.quitting = true;
                if let Ok(mut pending) = shell.pending_downloads.lock() {
                    for (_, queue) in pending.drain() {
                        for (staged, _) in queue {
                            let _ = fs::remove_file(staged);
                        }
                    }
                }
                if let Some(mut watcher) = shell.watcher.take() {
                    let _ = watcher.child.kill();
                    let _ = watcher.child.wait();
                }
                // Clearing `server` first tells the reader thread this stop was asked for.
                stop(&mut shell);
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show(app),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn dialog_text_keeps_percent_signs_literal_where_gtk_formats_them() {
        let text = dialog_text("https://example.com/a%20b%s".to_string());
        if cfg!(target_os = "linux") {
            assert_eq!(text, "https://example.com/a%%20b%%s");
        } else {
            assert_eq!(text, "https://example.com/a%20b%s");
        }
    }

    #[test]
    fn opener_leaves_plain_link_clicks_to_the_webview() {
        use tauri::plugin::Plugin;
        assert!(native_opener().initialization_script().is_none());
    }

    #[test]
    fn formats_env_as_a_single_json_line_without_auto_update_override() {
        assert_eq!(format_env_line(None), "env {}");
        let vars = vec![
            ("PATH".to_string(), "/opt/homebrew/bin:/usr/bin".to_string()),
            ("MULTILINE".to_string(), "a\nb".to_string()),
            ("GENAICODE_NO_AUTO_UPDATE".to_string(), "0".to_string()),
        ];
        let line = format_env_line(Some(&vars));
        assert!(line.starts_with("env "));
        assert!(!line.contains('\n'));
        let parsed: BTreeMap<String, String> =
            serde_json::from_str(&line["env ".len()..]).expect("valid json");
        assert_eq!(
            parsed.get("PATH").map(String::as_str),
            Some("/opt/homebrew/bin:/usr/bin")
        );
        assert_eq!(parsed.get("MULTILINE").map(String::as_str), Some("a\nb"));
        assert!(!parsed.contains_key("GENAICODE_NO_AUTO_UPDATE"));
    }

    #[test]
    fn removes_legacy_saved_folder_on_upgrade() {
        let dir = env::temp_dir().join(format!("genaicode-desktop-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let saved = dir.join("folder");
        fs::write(&saved, "/Users/me/src/knights").unwrap();
        assert!(saved.exists());
        remove_legacy_saved_folder(&dir);
        assert!(!saved.exists());
        // Second call when missing is a no-op.
        remove_legacy_saved_folder(&dir);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validates_open_session_stdin_command() {
        assert_eq!(
            open_session_command("abc-123_def.456:789").as_deref(),
            Some("open-session abc-123_def.456:789")
        );
        assert_eq!(open_session_command(""), None);
        assert_eq!(open_session_command("id\nupdate-ready 1.0.0"), None);
        assert_eq!(open_session_command("bad id"), None);
    }
}
