//! The genaicode desktop shell.
//!
//! It owns no chat logic. It starts the bundled Node.js on the bundled `genaicode ui`, waits for
//! the address that server prints, and shows that page in the window. The page gets no Tauri
//! commands: there are no capabilities, so it is the same page a browser would load.

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
    menu::{Menu, MenuItem, Submenu},
    AppHandle, Manager, RunEvent, Url,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const OPEN_FOLDER: &str = "open-folder";
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
        .title("genaicode")
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
    let node = node_binary()?;
    let cli = genaicode_cli(app)?;
    let state = app.state::<ShellState>();
    let mut shell = state.lock().map_err(|_| "the shell state is poisoned")?;
    stop(&mut shell);
    shell.generation += 1;
    let generation = shell.generation;
    if shell.login.is_none() {
        shell.login = login_env();
    }

    let mut command = Command::new(node);
    command
        .arg(cli)
        .args(["ui", "--no-open", "--exit-with-stdin", "--cwd"])
        .arg(folder)
        .current_dir(folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if let Some(vars) = &shell.login {
        command.envs(vars.iter().map(|(name, value)| (name, value)));
    }
    // After the login environment, so a profile cannot turn it back on: the app updates itself
    // as a whole, and the copy inside it must not look for newer ones.
    command.env("GENAICODE_NO_AUTO_UPDATE", "1");
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start genaicode: {error}"))?;
    let stderr = child.stderr.take().ok_or("genaicode has no stderr")?;
    let stdin = child.stdin.take();
    shell.server = Some(Server {
        child,
        _stdin: stdin,
    });
    drop(shell);

    if let Some(window) = app.get_webview_window("main") {
        let name = folder
            .file_name()
            .unwrap_or(folder.as_os_str())
            .to_string_lossy();
        let _ = window.set_title(&format!("genaicode — {name}"));
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

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_folder])
        .manage(ShellState::default())
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
            let menu = Menu::default(handle)?;
            menu.append(&project)?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == OPEN_FOLDER {
                    choose_folder(app);
                }
            });
            match saved_folder(handle) {
                Some(folder) => start(handle, folder),
                None => choose_folder(handle),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the genaicode desktop app failed to start");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Ok(mut shell) = app.state::<ShellState>().lock() {
                // Clearing `server` first tells the reader thread this stop was asked for.
                stop(&mut shell);
            }
        }
    });
}
