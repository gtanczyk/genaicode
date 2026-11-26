//! Navigation policy, scheme filtering, download naming, and host-protocol parsing for the
//! desktop shell. Kept independent of Tauri windows so every rule is unit-tested directly.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::Url;

/// Exact loopback origin of the running local `genaicode ui` server (`http://127.0.0.1:<port>`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ServerOrigin {
    pub port: u16,
}

impl ServerOrigin {
    pub fn from_url(url: &Url) -> Option<Self> {
        if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
            return None;
        }
        url.port().map(|port| Self { port })
    }

    pub fn matches(&self, url: &Url) -> bool {
        url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(self.port)
    }
}

/// Whether `url` points at a loopback host.
fn is_loopback(url: &Url) -> bool {
    matches!(
        url.host_str().map(str::to_ascii_lowercase).as_deref(),
        Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
    )
}

/// Whether a URL carries a `token` query parameter (the chat session token must never leave the shell).
fn carries_token(url: &Url) -> bool {
    url.query_pairs()
        .any(|(key, _)| key.eq_ignore_ascii_case("token"))
}

/// Filter URLs that may reach the OS default handler (`on_new_window` and external navigations).
///
/// Only `http:`, `https:` and `mailto:` ever reach the OS; `file:`, `javascript:`, `data:` and
/// custom schemes are dropped. Loopback URLs carrying a `token` query parameter are also refused
/// so the session token never leaves the app; `/artifacts/<id>` and `/files/<id>` carry none.
pub fn external_url(url: &Url) -> Option<String> {
    match url.scheme() {
        "http" | "https" => {
            if is_loopback(url) && carries_token(url) {
                return None;
            }
            Some(url.as_str().to_string())
        }
        "mailto" => Some(url.as_str().to_string()),
        _ => None,
    }
}

/// Decision for a main-frame navigation attempt (`on_navigation`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MainNav {
    /// Load inside the main webview (the bundled start page or the running local server).
    Allow,
    /// Cancel in the webview and hand the URL to the system default handler.
    OpenExternal(String),
    /// Cancel silently; never pass to the OS.
    Deny,
}

fn is_bundled_start_page(url: &Url) -> bool {
    url.as_str() == "about:blank"
        || matches!(
            (url.scheme(), url.host_str()),
            ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
        )
}

/// Decide whether the main webview may navigate to `url`.
pub fn main_navigation(url: &Url, server: Option<ServerOrigin>) -> MainNav {
    if is_bundled_start_page(url) {
        return MainNav::Allow;
    }
    if server.is_some_and(|origin| origin.matches(url)) {
        return MainNav::Allow;
    }
    match external_url(url) {
        Some(target) => MainNav::OpenExternal(target),
        None => MainNav::Deny,
    }
}

/// Whether the webview may initiate a file download from `url`.
/// Only the running local server and in-page `blob:`/`data:` exports are allowed.
pub fn is_download_allowed(url: &Url, server: Option<ServerOrigin>) -> bool {
    if matches!(url.scheme(), "blob" | "data") {
        return true;
    }
    server.is_some_and(|origin| origin.matches(url))
}

/// Move a downloaded file from its staging path to the user-selected destination, falling back to
/// copy + remove when source and destination live on different filesystems.
pub fn move_file(src: &Path, dst: &Path) -> io::Result<()> {
    if src == dst {
        return Ok(());
    }
    match fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(src, dst)?;
            let _ = fs::remove_file(src);
            Ok(())
        }
    }
}

/// Sanitize a suggested download filename for the Save dialog.
pub fn suggested_filename(url: &Url, destination: &Path) -> String {
    let from_dest = destination
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty());
    let from_url = url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .map(str::trim)
        .filter(|name| !name.is_empty());
    let raw = from_dest.or(from_url).unwrap_or("download");
    let cleaned: String = raw
        .chars()
        .filter(|ch| !ch.is_control() && !matches!(ch, '/' | '\\' | '\0'))
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.');
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        "download".to_string()
    } else {
        trimmed.chars().take(180).collect()
    }
}

pub const REVEAL_PREFIX: &str = "Reveal ";
pub const SETTINGS_PREFIX: &str = "Settings ";

/// Parse a `Reveal "<path>"` stderr line emitted by `POST /api/reveal`.
pub fn parse_reveal_line(line: &str) -> Option<PathBuf> {
    let raw = line.strip_prefix(REVEAL_PREFIX)?;
    let decoded: String = serde_json::from_str(raw).ok()?;
    if decoded.is_empty() || decoded.chars().any(|c| c.is_control()) {
        return None;
    }
    let path = PathBuf::from(decoded);
    path.is_absolute().then_some(path)
}

/// Persisted desktop app settings (`~/.genaicode/desktop.json`).
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct DesktopSettings {
    /// Opt-in CDN hosts HTML artifacts may load scripts, styles and fonts from. Empty by default.
    pub artifact_cdn: Vec<String>,
    pub max_chats: Option<u8>,
}

/// Defence-in-depth validation of a CDN host before passing it to `--artifact-cdn`.
pub fn is_safe_cdn_host(host: &str) -> bool {
    let trimmed = host.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 253
        && !trimmed.starts_with('-')
        && !trimmed.chars().any(|c| {
            c.is_whitespace() || c.is_control() || matches!(c, '*' | ';' | ',' | '\'' | '"' | '\\')
        })
}

/// Parse a `Settings {"artifactCdn":[...]}` stderr line emitted by `POST /api/settings`.
pub fn parse_settings_line(line: &str) -> Option<DesktopSettings> {
    let raw = line.strip_prefix(SETTINGS_PREFIX)?;
    let mut parsed: DesktopSettings = serde_json::from_str(raw).ok()?;
    parsed.artifact_cdn.retain(|host| is_safe_cdn_host(host));
    Some(parsed)
}

pub fn load_settings(path: &Path) -> DesktopSettings {
    let Ok(text) = fs::read_to_string(path) else {
        return DesktopSettings::default();
    };
    let mut parsed: DesktopSettings = serde_json::from_str(&text).unwrap_or_default();
    parsed.artifact_cdn.retain(|host| is_safe_cdn_host(host));
    parsed
}

pub fn save_settings(path: &Path, settings: &DesktopSettings) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(settings)
        .map_err(|error| io::Error::other(error.to_string()))?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, format!("{body}\n"))?;
    fs::rename(&temp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(raw: &str) -> Url {
        Url::parse(raw).expect("valid test URL")
    }

    #[test]
    fn allows_only_http_https_and_mailto_externally() {
        assert_eq!(
            external_url(&url("https://example.com/docs?a=1")),
            Some("https://example.com/docs?a=1".into())
        );
        assert_eq!(
            external_url(&url("http://example.com/page")),
            Some("http://example.com/page".into())
        );
        assert_eq!(
            external_url(&url("mailto:user@example.com?subject=hi")),
            Some("mailto:user@example.com?subject=hi".into())
        );
        // Loopback artifact and capability URLs have no token and open in the default browser.
        assert_eq!(
            external_url(&url("http://127.0.0.1:4321/artifacts/deadbeef?v=2")),
            Some("http://127.0.0.1:4321/artifacts/deadbeef?v=2".into())
        );
        assert_eq!(
            external_url(&url("http://127.0.0.1:4321/files/0123456789abcdef")),
            Some("http://127.0.0.1:4321/files/0123456789abcdef".into())
        );
        // Loopback URLs carrying a session token must never reach the OS browser.
        assert_eq!(
            external_url(&url("http://127.0.0.1:4321/?token=secret")),
            None
        );
        assert_eq!(
            external_url(&url("http://localhost:4321/?TOKEN=secret")),
            None
        );

        // Dangerous and non-web schemes are always dropped.
        for blocked in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<h1>hi</h1>",
            "blob:http://127.0.0.1:4321/abc",
            "ssh://evil.example",
            "smb://fileserver/share",
            "tel:+1234567890",
            "tauri://localhost/index.html",
            "vscode://file/etc/passwd",
        ] {
            assert_eq!(external_url(&url(blocked)), None, "must deny {blocked}");
        }
    }

    #[test]
    fn restricts_main_frame_navigation_to_start_page_and_local_server() {
        let server = Some(ServerOrigin { port: 4321 });

        // Bundled start page and exact local server origin stay in the webview.
        assert_eq!(
            main_navigation(&url("tauri://localhost/index.html"), server),
            MainNav::Allow
        );
        assert_eq!(
            main_navigation(&url("http://tauri.localhost/index.html"), server),
            MainNav::Allow
        );
        assert_eq!(main_navigation(&url("about:blank"), server), MainNav::Allow);
        assert_eq!(
            main_navigation(&url("http://127.0.0.1:4321/?token=abc"), server),
            MainNav::Allow
        );
        assert_eq!(
            main_navigation(&url("http://127.0.0.1:4321/artifacts/id"), server),
            MainNav::Allow
        );

        // External links without target="_blank" are cancelled in-frame and opened externally.
        assert_eq!(
            main_navigation(&url("https://github.com/gtanczyk/genaicode"), server),
            MainNav::OpenExternal("https://github.com/gtanczyk/genaicode".into())
        );
        assert_eq!(
            main_navigation(&url("mailto:hi@example.com"), server),
            MainNav::OpenExternal("mailto:hi@example.com".into())
        );

        // Different loopback port with token is denied completely; without token opens externally.
        assert_eq!(
            main_navigation(&url("http://127.0.0.1:9999/?token=leaked"), server),
            MainNav::Deny
        );
        assert_eq!(
            main_navigation(&url("http://127.0.0.1:9999/other"), server),
            MainNav::OpenExternal("http://127.0.0.1:9999/other".into())
        );

        // Non-web schemes are denied completely.
        assert_eq!(
            main_navigation(&url("file:///Users/test/a.txt"), server),
            MainNav::Deny
        );
        assert_eq!(
            main_navigation(&url("javascript:alert(1)"), server),
            MainNav::Deny
        );
    }

    #[test]
    fn sanitizes_download_filenames() {
        let base = url("http://127.0.0.1:4321/artifacts/abc?download=1");
        assert_eq!(
            suggested_filename(&base, Path::new("/tmp/report.html")),
            "report.html"
        );
        assert_eq!(
            suggested_filename(&base, Path::new("../../../.bashrc")),
            "bashrc"
        );
        assert_eq!(suggested_filename(&base, Path::new("..")), "abc");
        assert_eq!(
            suggested_filename(&url("http://127.0.0.1:4321/"), Path::new("")),
            "download"
        );
    }

    #[test]
    fn allows_only_local_server_and_blob_downloads() {
        let server = Some(ServerOrigin { port: 4321 });
        assert!(is_download_allowed(
            &url("http://127.0.0.1:4321/artifacts/abc?download=1"),
            server
        ));
        assert!(is_download_allowed(
            &url("blob:http://127.0.0.1:4321/1234"),
            server
        ));
        assert!(is_download_allowed(&url("data:text/csv,a,b"), server));
        assert!(!is_download_allowed(
            &url("https://example.com/payload.bin"),
            server
        ));
        assert!(!is_download_allowed(
            &url("http://127.0.0.1:9999/other"),
            server
        ));
        assert!(!is_download_allowed(&url("file:///etc/passwd"), server));
    }

    #[test]
    fn moves_downloaded_file_to_destination() {
        let dir =
            std::env::temp_dir().join(format!("genaicode-desktop-move-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        let src = dir.join("staged.bin");
        let dst = dir.join("saved.bin");
        fs::write(&src, b"hello world").expect("write");
        move_file(&src, &dst).expect("move");
        assert!(!src.exists());
        assert_eq!(fs::read(&dst).expect("read"), b"hello world");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_reveal_and_settings_protocol_lines() {
        assert_eq!(
            parse_reveal_line(r#"Reveal "/Users/test/my file.png""#),
            Some(PathBuf::from("/Users/test/my file.png"))
        );
        assert_eq!(parse_reveal_line(r#"Reveal "relative/file.txt""#), None);
        assert_eq!(parse_reveal_line(r#"Reveal "/tmp/bad\nline""#), None);
        assert_eq!(parse_reveal_line("Other /tmp/x"), None);

        let settings = parse_settings_line(
            r#"Settings {"artifactCdn":["https://cdn.jsdelivr.net","--bad","*","https://unpkg.com"]}"#,
        )
        .expect("settings");
        assert_eq!(
            settings.artifact_cdn,
            vec![
                "https://cdn.jsdelivr.net".to_string(),
                "https://unpkg.com".to_string()
            ]
        );
        assert_eq!(parse_settings_line("Settings not-json"), None);
    }

    #[test]
    fn loads_and_saves_desktop_settings_roundtrip() {
        let dir =
            std::env::temp_dir().join(format!("genaicode-desktop-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let file = dir.join("desktop.json");
        assert_eq!(load_settings(&file), DesktopSettings::default());
        let saved = DesktopSettings {
            artifact_cdn: vec!["https://cdn.jsdelivr.net".into()],
            max_chats: Some(4),
        };
        save_settings(&file, &saved).expect("save");
        assert_eq!(load_settings(&file), saved);
        let _ = fs::remove_dir_all(&dir);
    }
}
