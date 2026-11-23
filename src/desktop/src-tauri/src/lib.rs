//! The genaicode desktop shell.
//!
//! It owns no chat logic. It starts the bundled Node.js on the bundled `genaicode ui`, waits for
//! the address that server prints, and shows that page in the window. The app has no project
//! folder: its chat is about the sessions of every agent, each of which has its own, so the server
//! runs in a directory of the app's own and its page names none. The page gets no Tauri
//! commands: there are no capabilities, so it is the same page a browser would load.
//!
//! Beside the window it keeps an icon in the menu bar: the sessions of every agent that wait for
//! the user, read from `genaicode sessions --waiting --json --watch`, with Approve and Deny for the
//! questions that can be answered from outside their agent.

mod tower;
mod update;

use std::{
    collections::BTreeMap,
    env, fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::Duration,
};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, Url, WindowEvent, Wry,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const CHECK_UPDATES: &str = "check-updates";
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

#[derive(Default)]
struct Shell {
    server: Option<Server>,
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

/// Where the app's own chat runs: a directory of its own under the user's `~/.genaicode`, outside
/// every project. `GENAICODE_DESKTOP_CWD` names another one, for development.
fn home_folder(app: &AppHandle) -> Result<PathBuf, String> {
    let folder = match env::var_os("GENAICODE_DESKTOP_CWD") {
        Some(folder) => PathBuf::from(folder),
        None => app
            .path()
            .home_dir()
            .map_err(|error| error.to_string())?
            .join(".genaicode")
            .join("home"),
    };
    fs::create_dir_all(&folder)
        .map_err(|error| format!("Could not create {}: {error}", folder.display()))?;
    Ok(folder)
}

fn fail(app: &AppHandle, message: String) {
    app.dialog()
        .message(message)
        .title("Genaicode")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

/// How long `genaicode ui` gets to stop its agents and `!command`s before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(5);

/// Close the server's stdin, so `--exit-with-stdin` shuts it down the way Ctrl-C would: its agents
/// and shell commands run in their own process groups, and a SIGKILL of Node alone would leave
/// them running. Kill it only if it has not exited within `STOP_GRACE`.
fn stop(shell: &mut Shell) {
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
    let folder = home_folder(app)?;
    let state = app.state::<ShellState>();
    let mut shell = state.lock().map_err(|_| "the shell state is poisoned")?;
    let mut command = genaicode(app, &mut shell)?;
    stop(&mut shell);
    shell.generation += 1;
    let generation = shell.generation;
    command
        .args([
            "ui",
            "--sessions",
            "--delegate",
            "--no-project",
            "--no-open",
            "--exit-with-stdin",
            // A restart, for an update or not, comes back to the conversation it left.
            "--restore",
            "--cwd",
        ])
        .arg(&folder)
        .current_dir(&folder)
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
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let state = handle.state::<ShellState>();
                    let current = state.lock().map(|shell| shell.generation).ok();
                    if current != Some(generation) {
                        return;
                    }
                    if let (Some(window), Ok(url)) =
                        (handle.get_webview_window("main"), Url::parse(&address))
                    {
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
            } else if !opened {
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
            Some(count) => format!("Genaicode: {count} waiting for you"),
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

fn on_menu(app: &AppHandle, id: &str) {
    if id == SHOW || id.starts_with("open:") {
        show(app);
    } else if id == RELAUNCH {
        update::relaunch(app);
    } else if id == CHECK_UPDATES {
        update::check(app, true);
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
            let updates = MenuItem::with_id(
                handle,
                CHECK_UPDATES,
                "Check for Updates…",
                true,
                None::<&str>,
            )?;
            let menu = Menu::default(handle)?;
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
    use super::format_env_line;
    use std::collections::BTreeMap;

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
}
