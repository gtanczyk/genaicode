//! The genaicode desktop shell.
//!
//! It owns no chat logic. It starts the bundled Node.js on the bundled `genaicode ui`, waits for
//! the address that server prints, and shows that page in the window. The page gets no Tauri
//! commands: there are no capabilities, so it is the same page a browser would load.
//!
//! Beside the window it keeps an icon in the menu bar: the sessions of every agent that wait for
//! the user, read from `genaicode sessions --waiting --json --watch`, with Approve and Deny for the
//! questions that can be answered from outside their agent.

mod tower;
mod update;

use std::{
    env, fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
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

const OPEN_FOLDER: &str = "open-folder";
const CHECK_UPDATES: &str = "check-updates";
/// The ids of the menu bar's own items. Its other ids carry what they act on: `approve:<question>`,
/// `deny:<question>` and `open:<index of the session in the last snapshot>`.
const TRAY: &str = "tower";
const TRAY_OPEN_FOLDER: &str = "tray-open-folder";
const SHOW: &str = "show";
const QUIT: &str = "quit";
/// The line `genaicode ui` prints once it listens: `Open http://127.0.0.1:<port>/?token=...`.
const OPEN_PREFIX: &str = "Open http://127.0.0.1:";

/// The running `genaicode ui`. Closing its stdin stops it (`--exit-with-stdin`): that is how the
/// shell stops it, and why it cannot outlive the app even when the app is killed.
struct Server {
    child: Child,
    _stdin: Option<ChildStdin>,
}

#[derive(Default)]
struct Shell {
    server: Option<Server>,
    /// Bumped on every start, so the reader of a replaced server stays quiet.
    generation: u64,
    /// The user's login shell environment, read once: where their agent CLIs live, their keys.
    login: Option<Vec<(String, String)>>,
    /// The project the server runs in.
    folder: Option<PathBuf>,
    /// `genaicode sessions --waiting --json --watch`, which feeds the menu bar.
    watcher: Option<Server>,
    /// What it last said waits: the menu bar's items point into it.
    waiting: Vec<tower::Waiting>,
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

/// Node.js ships as an external binary beside the app's executable.
fn node_binary() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("GENAICODE_DESKTOP_NODE") {
        return Ok(path.into());
    }
    let exe = env::current_exe().map_err(|error| error.to_string())?;
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    let path = exe.parent().ok_or("the app has no directory")?.join(name);
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
    let node = node_binary()?;
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
    Ok(command)
}

fn folder_file(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("folder"))
}

fn saved_folder(app: &AppHandle) -> Option<PathBuf> {
    if let Some(folder) = env::var_os("GENAICODE_DESKTOP_CWD") {
        return Some(folder.into());
    }
    let folder = PathBuf::from(fs::read_to_string(folder_file(app)?).ok()?.trim());
    folder.is_dir().then_some(folder)
}

fn save_folder(app: &AppHandle, folder: &Path) {
    let Some(file) = folder_file(app) else { return };
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(file, folder.to_string_lossy().as_bytes());
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
/// them working on the old project. Kill it only if it has not exited within `STOP_GRACE`.
fn stop(shell: &mut Shell) {
    let Some(Server {
        mut child,
        _stdin: stdin,
    }) = shell.server.take()
    else {
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

/// Start `genaicode ui` in `folder` and show it once it says where it listens.
fn start(app: &AppHandle, folder: PathBuf) {
    if let Err(message) = try_start(app, &folder) {
        fail(app, message);
    }
}

fn try_start(app: &AppHandle, folder: &Path) -> Result<(), String> {
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
            "--no-open",
            "--exit-with-stdin",
            "--cwd",
        ])
        .arg(folder)
        .current_dir(folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start genaicode: {error}"))?;
    let stderr = child.stderr.take().ok_or("genaicode has no stderr")?;
    let stdin = child.stdin.take();
    shell.server = Some(Server {
        child,
        _stdin: stdin,
    });
    shell.folder = Some(folder.to_path_buf());
    drop(shell);

    if let Some(window) = app.get_webview_window("main") {
        let name = folder
            .file_name()
            .unwrap_or(folder.as_os_str())
            .to_string_lossy();
        let _ = window.set_title(&format!("Genaicode — {name}"));
    }

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
                });
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
        let message = if opened {
            "genaicode stopped. Choose Project → Open Folder… to start it again.".to_string()
        } else {
            format!("genaicode did not start.{detail}")
        };
        fail(&app, message);
    });
    Ok(())
}

fn choose_folder(app: &AppHandle) {
    let handle = app.clone();
    app.dialog()
        .file()
        .set_title("Choose a project folder")
        .pick_folder(move |picked| {
            let Some(folder) = picked.and_then(|path| path.into_path().ok()) else {
                return;
            };
            save_folder(&handle, &folder);
            start(&handle, folder);
        });
}

/// The start page's button. Only that bundled page can call it: the capability that allows it
/// covers local content, not the `genaicode ui` page on 127.0.0.1.
#[tauri::command]
fn open_folder(app: AppHandle) {
    choose_folder(&app);
}

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
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
                let open = MenuItem::with_id(
                    app,
                    format!("open:{session}:{ask}"),
                    "Open Project",
                    true,
                    none,
                )?;
                menu.append(&Submenu::with_items(
                    app,
                    label,
                    true,
                    &[&approve, &deny, &PredefinedMenuItem::separator(app)?, &open],
                )?)?
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
    menu.append(&MenuItem::with_id(
        app,
        TRAY_OPEN_FOLDER,
        "Open Folder…",
        true,
        none,
    )?)?;
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
        let Some(tray) = handle.tray_by_id(TRAY) else {
            return;
        };
        if let Ok(menu) = tower_menu(&handle, &shell.waiting, &snapshot.limits, &snapshot.topics) {
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
                shell.watcher = Some(Server {
                    child,
                    _stdin: stdin,
                });
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

/// Show the project of a waiting session. Another project replaces the one in the window, which
/// stops what runs there, so that is asked first.
fn open_session(app: &AppHandle, index: usize) {
    let (folder, current) = {
        let state = app.state::<ShellState>();
        let Ok(shell) = state.lock() else { return };
        let folder = shell
            .waiting
            .get(index)
            .and_then(|session| session.cwd.as_ref())
            .map(PathBuf::from);
        (folder, shell.folder.clone())
    };
    show(app);
    let Some(folder) = folder.filter(|folder| folder.is_dir()) else {
        return;
    };
    if current.as_deref() == Some(folder.as_path()) {
        return;
    }
    let Some(current) = current else {
        save_folder(app, &folder);
        start(app, folder);
        return;
    };
    let handle = app.clone();
    app.dialog()
        .message(format!(
            "Open {}?\n\ngenaicode in {} stops, with the agents it runs.",
            folder.display(),
            current.display()
        ))
        .title("Genaicode")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Open".into(),
            "Cancel".into(),
        ))
        .show(move |open| {
            if open {
                save_folder(&handle, &folder);
                start(&handle, folder);
            }
        });
}

fn on_menu(app: &AppHandle, id: &str) {
    if id == OPEN_FOLDER || id == TRAY_OPEN_FOLDER {
        show(app);
        choose_folder(app);
    } else if id == SHOW {
        show(app);
    } else if id == CHECK_UPDATES {
        update::check(app, true);
    } else if id == QUIT {
        app.exit(0);
    } else if let Some(ask) = id.strip_prefix("approve:") {
        answer(app, ask, true);
    } else if let Some(ask) = id.strip_prefix("deny:") {
        answer(app, ask, false);
    } else if let Some(index) = id
        .strip_prefix("open:")
        .and_then(|rest| rest.split(':').next())
        .and_then(|index| index.parse().ok())
    {
        open_session(app, index);
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
        .invoke_handler(tauri::generate_handler![open_folder])
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
            let open = MenuItem::with_id(
                handle,
                OPEN_FOLDER,
                "Open Folder…",
                true,
                Some("CmdOrCtrl+O"),
            )?;
            let project = Submenu::with_items(handle, "Project", true, &[&open])?;
            let updates = MenuItem::with_id(
                handle,
                CHECK_UPDATES,
                "Check for Updates…",
                true,
                None::<&str>,
            )?;
            let menu = Menu::default(handle)?;
            menu.append(&project)?;
            // Under the app's own menu on macOS, where such an item is looked for.
            match menu.items()?.first().and_then(|item| item.as_submenu()) {
                Some(first) if cfg!(target_os = "macos") => first.insert(&updates, 1)?,
                _ => project.append(&updates)?,
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
            match saved_folder(handle) {
                Some(folder) => start(handle, folder),
                None => choose_folder(handle),
            }
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
