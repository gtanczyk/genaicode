//! Fetching transcripts from the local `genaicode ui` server, copying them to the clipboard,
//! and parsing native save requests printed by the server on stderr.
//!
//! Pure protocol and loopback HTTP helpers live here so they can be unit-tested without a window.

use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    process::{Command, Stdio},
    time::Duration,
};

use serde::Deserialize;

/// Loopback address and per-launch access token of the running `genaicode ui` server.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoint {
    pub port: u16,
    pub token: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Md,
    Json,
}

impl Format {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Md => "md",
            Self::Json => "json",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Md => "Markdown",
            Self::Json => "JSON",
        }
    }

    pub fn default_filename(self) -> &'static str {
        match self {
            Self::Md => "genaicode-transcript.md",
            Self::Json => "genaicode-transcript.json",
        }
    }
}

/// A request from the web UI (via stderr) or Developer menu to save a transcript via native dialog.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SaveRequest {
    pub format: Format,
    /// Percent-encoded `(source, id)` for a stored session; `None` for the active chat.
    pub session: Option<(String, String)>,
}

impl SaveRequest {
    pub fn api_path(&self) -> String {
        match &self.session {
            Some((source, id)) => {
                format!(
                    "/api/sessions/{source}/{id}/transcript?format={}",
                    self.format.as_str()
                )
            }
            None => format!("/api/transcript?format={}", self.format.as_str()),
        }
    }
}

/// Metadata returned by `GET /api/transcript?format=meta`.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct Meta {
    pub agent: String,
    pub session_id: Option<String>,
    pub session_path: Option<String>,
    pub turns: usize,
    pub filename_md: String,
    pub filename_json: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub filename: Option<String>,
    pub body: Vec<u8>,
}

const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
const SAVE_PREFIX: &str = "Save transcript ";
const SAVE_SESSION_PREFIX: &str = "Save session-transcript ";

/// Parse `http://127.0.0.1:<port>/?token=<token>` printed by `genaicode ui`.
pub fn parse_endpoint(address: &str) -> Option<Endpoint> {
    let rest = address.trim().strip_prefix("http://127.0.0.1:")?;
    let (port_str, path_and_query) = rest.split_once('/')?;
    let port: u16 = port_str.parse().ok()?;
    let query = path_and_query.split_once('?')?.1;
    let token = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("token="))?
        .trim();
    if token.is_empty() || token.bytes().any(|b| b <= b' ' || b == b'\r' || b == b'\n') {
        return None;
    }
    Some(Endpoint {
        port,
        token: token.to_string(),
    })
}

fn parse_format(word: &str) -> Option<Format> {
    match word {
        "md" => Some(Format::Md),
        "json" => Some(Format::Json),
        _ => None,
    }
}

fn valid_encoded_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= 600
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b'%'))
}

/// Parse a stderr command line asking the desktop shell to open a native Save dialog.
pub fn parse_save_line(line: &str) -> Option<SaveRequest> {
    let trimmed = line.trim();
    if let Some(rest) = trimmed.strip_prefix(SAVE_PREFIX) {
        return Some(SaveRequest {
            format: parse_format(rest)?,
            session: None,
        });
    }
    if let Some(rest) = trimmed.strip_prefix(SAVE_SESSION_PREFIX) {
        let mut parts = rest.split(' ');
        let format = parse_format(parts.next()?)?;
        let source = parts.next()?;
        let id = parts.next()?;
        if parts.next().is_some() || !valid_encoded_segment(source) || !valid_encoded_segment(id) {
            return None;
        }
        return Some(SaveRequest {
            format,
            session: Some((source.to_string(), id.to_string())),
        });
    }
    None
}

/// Format a `toast <message>` line for `genaicode ui`'s stdin (stripped of control chars).
pub fn format_toast_line(text: &str) -> String {
    let clean: String = text
        .chars()
        .filter(|&c| !c.is_control())
        .take(150)
        .collect();
    format!("toast {}\n", clean.trim())
}

/// Perform an authenticated loopback `GET` request against the running `genaicode ui` server.
pub fn fetch(endpoint: &Endpoint, path: &str) -> Result<Response, String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], endpoint.port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2))
        .map_err(|error| format!("Could not reach genaicode: {error}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nx-genaicode-token: {}\r\nConnection: close\r\n\r\n",
        endpoint.port, endpoint.token
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Could not ask genaicode: {error}"))?;

    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        let read = stream
            .read(&mut buf)
            .map_err(|error| format!("Could not read from genaicode: {error}"))?;
        if read == 0 {
            break;
        }
        if raw.len() + read > MAX_RESPONSE_BYTES {
            return Err("Transcript is larger than 64 MB.".into());
        }
        raw.extend_from_slice(&buf[..read]);
    }

    parse_http_response(&raw)
}

fn parse_http_response(raw: &[u8]) -> Result<Response, String> {
    let split = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "Malformed response from genaicode.".to_string())?;
    let head = String::from_utf8_lossy(&raw[..split]);
    let mut lines = head.split("\r\n");
    let status_line = lines
        .next()
        .ok_or_else(|| "Empty response from genaicode.".to_string())?;
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .ok_or_else(|| "Invalid HTTP status from genaicode.".to_string())?;

    let mut filename = None;
    let mut chunked = false;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let value = value.trim();
            if name.eq_ignore_ascii_case("x-genaicode-filename") && !value.is_empty() {
                filename = Some(sanitize_filename(value));
            } else if name.eq_ignore_ascii_case("transfer-encoding")
                && value.to_ascii_lowercase().contains("chunked")
            {
                chunked = true;
            }
        }
    }

    let body_bytes = &raw[split + 4..];
    let body = if chunked {
        decode_chunked(body_bytes)?
    } else {
        body_bytes.to_vec()
    };

    Ok(Response {
        status,
        filename,
        body,
    })
}

fn sanitize_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let clean: String = base
        .chars()
        .filter(|&c| !c.is_control() && c != '/' && c != '\\')
        .collect();
    if clean.is_empty() || clean == "." || clean == ".." {
        "genaicode-transcript.txt".into()
    } else {
        clean
    }
}

fn decode_chunked(mut input: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    loop {
        let crlf = input
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or_else(|| "Malformed chunked response.".to_string())?;
        let size_str = std::str::from_utf8(&input[..crlf])
            .map_err(|_| "Malformed chunk size.".to_string())?
            .split(';')
            .next()
            .unwrap_or("")
            .trim();
        let size =
            usize::from_str_radix(size_str, 16).map_err(|_| "Invalid chunk size.".to_string())?;
        input = &input[crlf + 2..];
        if size == 0 {
            break;
        }
        if input.len() < size + 2 {
            return Err("Truncated chunked response.".into());
        }
        out.extend_from_slice(&input[..size]);
        input = &input[size + 2..];
    }
    Ok(out)
}

/// Write UTF-8 text to the system clipboard without extra crates.
pub fn copy_to_clipboard(text: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        pipe_to_command("/usr/bin/pbcopy", &[], text)
    }
    #[cfg(target_os = "linux")]
    {
        let candidates: &[(&str, &[&str])] = &[
            ("wl-copy", &[]),
            ("xclip", &["-selection", "clipboard"]),
            ("xsel", &["--clipboard", "--input"]),
        ];
        for (cmd, args) in candidates {
            if pipe_to_command(cmd, args, text).is_ok() {
                return Ok(());
            }
        }
        Err("No clipboard utility found (tried wl-copy, xclip, xsel).".into())
    }
    #[cfg(target_os = "windows")]
    {
        pipe_to_command("clip", &[], text)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = text;
        Err("Clipboard copy is not supported on this platform.".into())
    }
}

fn pipe_to_command(program: &str, args: &[&str], text: &str) -> Result<(), String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "macos")]
    {
        // Ensure pbcopy interprets UTF-8 (e.g. Polish/Unicode text) when launched under launchd.
        command
            .env("LANG", "en_US.UTF-8")
            .env("LC_ALL", "en_US.UTF-8");
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start {program}: {error}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|error| format!("Could not write to {program}: {error}"))?;
    }
    let status = child
        .wait()
        .map_err(|error| format!("{program} failed: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{program} exited with {status}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn parses_loopback_endpoint_and_rejects_other_hosts() {
        assert_eq!(
            parse_endpoint("http://127.0.0.1:45123/?token=abc123def"),
            Some(Endpoint {
                port: 45123,
                token: "abc123def".into(),
            })
        );
        assert_eq!(parse_endpoint("http://evil.example:45123/?token=abc"), None);
        assert_eq!(parse_endpoint("http://127.0.0.1:45123/"), None);
        assert_eq!(parse_endpoint("http://127.0.0.1:45123/?token="), None);
    }

    #[test]
    fn parses_save_transcript_lines_strictly() {
        assert_eq!(
            parse_save_line("Save transcript md"),
            Some(SaveRequest {
                format: Format::Md,
                session: None,
            })
        );
        assert_eq!(
            parse_save_line("Save transcript json"),
            Some(SaveRequest {
                format: Format::Json,
                session: None,
            })
        );
        assert_eq!(
            parse_save_line("Save session-transcript md claude ses_0195%2Fabc"),
            Some(SaveRequest {
                format: Format::Md,
                session: Some(("claude".into(), "ses_0195%2Fabc".into())),
            })
        );
        assert_eq!(parse_save_line("Save transcript html"), None);
        assert_eq!(
            parse_save_line("Save session-transcript md claude ../bad?x=1"),
            None
        );
        assert_eq!(
            parse_save_line("Save session-transcript md claude id extra"),
            None
        );
    }

    #[test]
    fn builds_expected_api_paths_and_sanitizes_toast_lines() {
        let active = SaveRequest {
            format: Format::Md,
            session: None,
        };
        assert_eq!(active.api_path(), "/api/transcript?format=md");

        let stored = SaveRequest {
            format: Format::Json,
            session: Some(("claude".into(), "abc-123".into())),
        };
        assert_eq!(
            stored.api_path(),
            "/api/sessions/claude/abc-123/transcript?format=json"
        );

        assert_eq!(
            format_toast_line("Copied\nsecret\r\0"),
            "toast Copiedsecret\n"
        );
    }

    #[test]
    fn fetches_plain_and_chunked_responses_over_loopback() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            for response in [
                "HTTP/1.1 200 OK\r\nContent-Type: text/markdown\r\nX-Genaicode-Filename: ../genaicode-claude-1234.md\r\nContent-Length: 11\r\n\r\n# Hello MD\n",
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n7\r\n{\"ok\":1\r\n1\r\n}\r\n0\r\n\r\n",
            ] {
                let (mut sock, _) = listener.accept().unwrap();
                let mut req = [0u8; 1024];
                let n = sock.read(&mut req).unwrap();
                let text = String::from_utf8_lossy(&req[..n]);
                assert!(text.contains("x-genaicode-token: tok123\r\n"));
                sock.write_all(response.as_bytes()).unwrap();
            }
        });

        let endpoint = Endpoint {
            port,
            token: "tok123".into(),
        };
        let first = fetch(&endpoint, "/api/transcript?format=md").unwrap();
        assert_eq!(first.status, 200);
        assert_eq!(first.filename.as_deref(), Some("genaicode-claude-1234.md"));
        assert_eq!(first.body, b"# Hello MD\n");

        let second = fetch(&endpoint, "/api/transcript?format=json").unwrap();
        assert_eq!(second.status, 200);
        assert_eq!(second.body, b"{\"ok\":1}");
        server.join().unwrap();
    }
}
