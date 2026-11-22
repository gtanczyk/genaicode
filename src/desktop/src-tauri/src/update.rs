//! Updates of the app itself.
//!
//! The release workflow adds a signed archive of the app and a `latest.json` to every GitHub
//! Release. The app asks for that file at start, every few hours while it runs, and when the user
//! picks "Check for Updates…". A newer version is offered, never installed unasked: installing it
//! restarts the app, which stops the agents it runs.

use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use tauri::{async_runtime, AppHandle};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

/// How often a running app looks again: it can stay in the menu bar for days.
const EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// Where a version the app cannot install itself is downloaded from.
const RELEASES: &str = "https://github.com/gtanczyk/genaicode/releases/latest";

/// An offer is on screen or an update is downloading: a second look would only ask twice.
static BUSY: AtomicBool = AtomicBool::new(false);
/// The user said "Later": the looks the app makes on its own stay quiet until it starts again.
static LATER: AtomicBool = AtomicBool::new(false);

fn say(app: &AppHandle, kind: MessageDialogKind, message: String) {
    app.dialog()
        .message(message)
        .title("Genaicode")
        .kind(kind)
        .show(|_| {});
}

/// Look for a newer version. `asked` is the user's own "Check for Updates…": only then does the
/// app also say that there is nothing newer, or that it could not look.
pub fn check(app: &AppHandle, asked: bool) {
    if !asked && LATER.load(Ordering::Relaxed) {
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
            Ok(Some(update)) => return offer(app, update),
            Ok(None) if asked => say(
                &app,
                MessageDialogKind::Info,
                format!(
                    "Genaicode {} is the newest version.",
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

fn offer(app: AppHandle, update: Update) {
    if !replaces_itself() {
        // Said once per run: the looks the app makes on its own stay quiet afterwards.
        LATER.store(true, Ordering::Relaxed);
        BUSY.store(false, Ordering::SeqCst);
        return say(
            &app,
            MessageDialogKind::Info,
            format!(
                "Genaicode {} is available. You have {}.\n\nGet it from {RELEASES}",
                update.version, update.current_version
            ),
        );
    }
    let message = format!(
        "Genaicode {} is available. You have {}.\n\nInstalling it restarts the app and stops the agents it runs.",
        update.version, update.current_version
    );
    let handle = app.clone();
    app.dialog()
        .message(message)
        .title("Genaicode")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install and Restart".into(),
            "Later".into(),
        ))
        .show(move |install| {
            if !install {
                LATER.store(true, Ordering::Relaxed);
                BUSY.store(false, Ordering::SeqCst);
                return;
            }
            async_runtime::spawn(async move {
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => handle.restart(),
                    Err(error) => {
                        BUSY.store(false, Ordering::SeqCst);
                        say(
                            &handle,
                            MessageDialogKind::Error,
                            format!("The update was not installed: {error}"),
                        );
                    }
                }
            });
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
