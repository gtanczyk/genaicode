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
const EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// Where a version the app cannot install itself is downloaded from.
const RELEASES: &str = "https://github.com/gtanczyk/genaicode/releases/latest";

/// A look or a download is under way: a second one would only do the same twice.
static BUSY: AtomicBool = AtomicBool::new(false);
/// A version the app cannot install itself was named once: the looks the app makes on its own
/// stay quiet until it starts again.
static TOLD: AtomicBool = AtomicBool::new(false);
/// A newer version, downloaded and checked against the key: a relaunch installs it.
static READY: Mutex<Option<(Update, Vec<u8>)>> = Mutex::new(None);

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
    match update.download(|_, _| {}, || {}).await {
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
    // Off the main thread: replacing the app takes a moment.
    std::thread::spawn(move || match update.install(bytes) {
        Ok(()) => app.restart(),
        Err(error) => {
            // The next look downloads it again.
            crate::update_ready(&app);
            say(
                &app,
                MessageDialogKind::Error,
                format!("The update was not installed: {error}"),
            );
        }
    });
}

/// Look at start and then every few hours, for as long as the app runs.
pub fn watch(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        check(&app, false);
        std::thread::sleep(EVERY);
    });
}
