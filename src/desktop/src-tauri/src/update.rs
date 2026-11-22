//! Updates of the app itself.
//!
//! The release workflow adds a signed archive of the app and a `latest.json` to every GitHub
//! Release. The app asks for that file at start, every few hours while it runs, and when the user
//! picks "Check for Updates…". A newer version is downloaded quietly and then offered as
//! "Relaunch to Update" in the window and the menu bar, never installed unasked: installing it
//! restarts the app, which stops the agents it runs.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};

use tauri::{async_runtime, AppHandle};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

/// How often a running app looks again: it can stay in the menu bar for days.
const EVERY: Duration = Duration::from_secs(30 * 60);

/// Where a version the app cannot install itself is downloaded from.
const RELEASES: &str = "https://github.com/gtanczyk/genaicode/releases/latest";

/// A look or a download is under way: a second one would only do the same twice.
static BUSY: AtomicBool = AtomicBool::new(false);
/// A version the app cannot install itself was named once: the looks the app makes on its own
/// stay quiet until it starts again.
static TOLD: AtomicBool = AtomicBool::new(false);
/// A newer version, downloaded and checked against the key: a relaunch installs it.
static READY: Mutex<Option<(Update, Vec<u8>)>> = Mutex::new(None);
/// The version that is on its way: being downloaded, or being installed after a relaunch was chosen.
static UNDERWAY: Mutex<Option<(String, Stage)>> = Mutex::new(None);

/// Where a newer version is on its way into the app.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stage {
    Downloading,
    Ready,
    Installing,
}

fn underway(now: Option<(String, Stage)>) {
    if let Ok(mut underway) = UNDERWAY.lock() {
        *underway = now;
    }
}

/// The newer version and how far it is, for the page and the menu bar to say.
pub fn stage() -> Option<(String, Stage)> {
    if let Some(found) = UNDERWAY.lock().ok().and_then(|underway| underway.clone()) {
        return Some(found);
    }
    ready().map(|version| (version, Stage::Ready))
}

fn say(app: &AppHandle, kind: MessageDialogKind, message: String) {
    app.dialog()
        .message(message)
        .title("Genaicode")
        .kind(kind)
        .show(|_| {});
}

/// The version that waits for a relaunch, once it is downloaded.
pub fn ready() -> Option<String> {
    let ready = READY.lock().ok()?;
    ready.as_ref().map(|(update, _)| update.version.clone())
}

/// Look for a newer version and download it quietly: the window and the menu bar then offer
/// "Relaunch to Update", and nothing is installed before that is chosen, because installing
/// restarts the app, which stops the agents it runs. `asked` is the user's own
/// "Check for Updates…": only then does the app answer in a dialog.
pub fn check(app: &AppHandle, asked: bool) {
    if let Some(version) = ready() {
        // Said again: a chat that started since has not heard it.
        crate::update_ready(app);
        if asked {
            ask(app, &version);
        }
        return;
    }
    if !asked && TOLD.load(Ordering::Relaxed) {
        return;
    }
    // The app is replacing itself: there is nothing to look for until it starts again.
    if matches!(stage(), Some((_, Stage::Installing))) {
        return;
    }
    if BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    async_runtime::spawn(async move {
        let found = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(error) => Err(error),
        };
        match found {
            Ok(Some(update)) => fetch(&app, update, asked).await,
            Ok(None) if asked => say(
                &app,
                MessageDialogKind::Info,
                format!(
                    "Genaicode {} is the newest version.",
                    app.package_info().version
                ),
            ),
            // The newest release has no update for this app yet: its builds are added some
            // minutes after the release itself appears.
            Err(tauri_plugin_updater::Error::ReleaseNotFound) if asked => say(
                &app,
                MessageDialogKind::Info,
                format!(
                    "No update is ready for Genaicode {} right now. If a new version just came out, it is still being built: look again in a few minutes.",
                    app.package_info().version
                ),
            ),
            Err(error) if asked => say(
                &app,
                MessageDialogKind::Error,
                format!("Could not look for updates: {error}"),
            ),
            _ => {}
        }
        BUSY.store(false, Ordering::SeqCst);
    });
}

/// A package the system installed (.deb, .rpm) is the package manager's to replace: on Linux
/// only an AppImage can install its own update.
fn replaces_itself() -> bool {
    !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
}

/// Download `update` and say that it waits, or name it where the app cannot install it.
async fn fetch(app: &AppHandle, update: Update, asked: bool) {
    if !replaces_itself() {
        TOLD.store(true, Ordering::Relaxed);
        return say(
            app,
            MessageDialogKind::Info,
            format!(
                "Genaicode {} is available. You have {}.\n\nGet it from {RELEASES}",
                update.version, update.current_version
            ),
        );
    }
    // Said while it runs: a download can take a minute, and silence looks like nothing happened.
    underway(Some((update.version.clone(), Stage::Downloading)));
    crate::update_ready(app);
    let downloaded = update.download(|_, _| {}, || {}).await;
    underway(None);
    if downloaded.is_err() {
        crate::update_ready(app);
    }
    match downloaded {
        Ok(bytes) => {
            let version = update.version.clone();
            if let Ok(mut ready) = READY.lock() {
                *ready = Some((update, bytes));
            }
            crate::update_ready(app);
            if asked {
                ask(app, &version);
            }
        }
        Err(error) if asked => say(
            app,
            MessageDialogKind::Error,
            format!("The update was not downloaded: {error}"),
        ),
        Err(_) => {}
    }
}

/// The answer to "Check for Updates…" when a version waits.
fn ask(app: &AppHandle, version: &str) {
    let handle = app.clone();
    app.dialog()
        .message(format!(
            "Genaicode {version} is ready. You have {}.\n\nRelaunching installs it and stops the agents the app runs.",
            app.package_info().version
        ))
        .title("Genaicode")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Relaunch to Update".into(),
            "Later".into(),
        ))
        .show(move |now| {
            if now {
                relaunch(&handle);
            }
        });
}

/// Install the version that waits and start the app again.
pub fn relaunch(app: &AppHandle) {
    let Some((update, bytes)) = READY.lock().ok().and_then(|mut ready| ready.take()) else {
        return;
    };
    let app = app.clone();
    underway(Some((update.version.clone(), Stage::Installing)));
    crate::update_ready(&app);
    // Off the main thread: replacing the app takes a moment.
    std::thread::spawn(move || match update.install(&bytes) {
        Ok(()) => restart(&app),
        Err(error) => {
            // It still waits: the page and the menu bar keep offering it, and it can be tried again.
            if let Ok(mut ready) = READY.lock() {
                *ready = Some((update, bytes));
            }
            underway(None);
            crate::update_ready(&app);
            say(
                &app,
                MessageDialogKind::Error,
                format!("The update was not installed: {error}"),
            );
        }
    });
}

/// Start the installed version once this one has quit.
///
/// Tauri's own restart runs `open -n` on the bundle while this process still runs, so for a
/// moment two instances of the app exist. The Dock gives the second instance a tile of its own,
/// and once the first one quits that tile stays beside the pinned one, which is left without its
/// running dot: two "Genaicode" icons for one app. Here a small shell, detached from this
/// process, waits until it has exited and only then asks LaunchServices to open the bundle, so the
/// new version starts as the only instance and the Dock gives it the pinned tile.
#[cfg(target_os = "macos")]
fn restart(app: &AppHandle) {
    match bundle().and_then(|bundle| open_after_exit(&bundle)) {
        Ok(()) => app.exit(0),
        Err(error) => {
            eprintln!("Could not wait for the app to quit before opening it again: {error}");
            app.restart()
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn restart(app: &AppHandle) {
    app.restart()
}

/// The `.app` this process runs from: `<bundle>/Contents/MacOS/<binary>`.
#[cfg(target_os = "macos")]
fn bundle() -> std::io::Result<std::path::PathBuf> {
    let binary = tauri::utils::platform::current_exe()?;
    binary
        .parent()
        .filter(|macos| macos.ends_with("Contents/MacOS"))
        .and_then(|macos| macos.parent()?.parent())
        .filter(|bundle| {
            bundle
                .extension()
                .is_some_and(|extension| extension == "app")
        })
        .map(std::path::Path::to_path_buf)
        .ok_or_else(|| {
            std::io::Error::other(format!("{} is not inside an app bundle", binary.display()))
        })
}

/// How long the shell waits for this process to exit before it opens the bundle anyway.
#[cfg(target_os = "macos")]
const QUIT_WAIT_TENTHS: u32 = 600;

/// The shell that waits for process `$1` to exit and then opens bundle `$2` with LaunchServices.
#[cfg(target_os = "macos")]
const OPEN_AFTER_EXIT: &str = r#"tries=0
while /bin/kill -0 "$1" 2>/dev/null && [ "$tries" -lt "$3" ]; do
  /bin/sleep 0.1
  tries=$((tries + 1))
done
exec /usr/bin/open "$2""#;

/// Start the shell that opens `bundle` once this process has exited. It gets its own process
/// group and no stdio of ours, so it outlives the app and nothing it prints goes anywhere.
#[cfg(target_os = "macos")]
fn open_after_exit(bundle: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    Command::new("/bin/sh")
        .arg("-c")
        .arg(OPEN_AFTER_EXIT)
        .arg("genaicode-relaunch")
        .arg(std::process::id().to_string())
        .arg(bundle)
        .arg(QUIT_WAIT_TENTHS.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map(drop)
}

/// Look at start and then every few hours, for as long as the app runs.
pub fn watch(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        check(&app, false);
        std::thread::sleep(EVERY);
    });
}
