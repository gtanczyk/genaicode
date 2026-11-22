//! What the menu bar shows: the sessions that wait for the user, as `genaicode sessions --waiting
//! --json --watch` reports them. Only the model lives here, so it can be tested without a window.

use serde::Deserialize;

/// A question a session holds open for an answer from outside (`hooks install --answer`).
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct Ask {
    pub id: String,
    pub tool: Option<String>,
    pub preview: Option<String>,
}

/// One waiting session: the fields of genaicode's `SessionInfo` the menu uses.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Waiting {
    pub id: String,
    pub agent: String,
    pub cwd: Option<String>,
    pub title: Option<String>,
    pub last_prompt: Option<String>,
    pub last_reply: Option<String>,
    pub waiting_for: Option<String>,
    pub waiting_tool: Option<String>,
    /// What the end of its last message asks: `question`, `command`, `offer`, `unreported`.
    pub ending: Option<String>,
    /// The name of the topic it belongs to (`genaicode topics`), when it has one.
    pub topic: Option<String>,
    pub asks: Vec<Ask>,
}

/// A topic of the watched sessions: a piece of work, whichever agents and directories it is in.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct Topic {
    pub id: String,
    pub name: String,
    pub sessions: usize,
    pub asking: usize,
    pub active: usize,
}

/// How much of one window of an agent's plan is used, as genaicode last saw it.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Limit {
    pub agent: String,
    pub window: String,
    pub status: String,
    pub used_percent: Option<f64>,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq)]
pub struct Snapshot {
    pub sessions: Vec<Waiting>,
    #[serde(default)]
    pub limits: Vec<Limit>,
    #[serde(default)]
    pub topics: Vec<Topic>,
}

/// One line of the watch: `{"sessions":[...],"limits":[...]}`. Anything else is not a snapshot.
pub fn parse_snapshot(line: &str) -> Option<Snapshot> {
    serde_json::from_str::<Snapshot>(line).ok()
}

/// One line per agent, in the plan's own measure: `claude: 5h 62% · 7d 41%`.
pub fn quota(limits: &[Limit]) -> Vec<String> {
    let mut lines: Vec<(&str, Vec<String>)> = Vec::new();
    for limit in limits {
        let window = match &limit.name {
            Some(name) => format!("{name} {}", limit.window),
            None => limit.window.clone(),
        };
        let used = match limit.used_percent {
            Some(percent) => format!("{window} {}%", percent.round()),
            None if limit.status == "exceeded" => format!("{window} used up"),
            None => format!("{window} {}", limit.status),
        };
        match lines.last_mut() {
            Some((agent, windows)) if *agent == limit.agent => windows.push(used),
            _ => lines.push((&limit.agent, vec![used])),
        }
    }
    lines
        .into_iter()
        .map(|(agent, windows)| format!("{agent}: {}", windows.join(" · ")))
        .collect()
}

/// More topics at work than this are counted, not named.
const MOST_WORKING: usize = 6;

/// The topics an agent works on now, one line each: `▶ Pack mode · 2 working`.
pub fn working(topics: &[Topic]) -> Vec<String> {
    let at_work: Vec<&Topic> = topics.iter().filter(|topic| topic.active > 0).collect();
    let mut lines: Vec<String> = at_work
        .iter()
        .take(MOST_WORKING)
        .map(|topic| {
            one_line(
                &format!("▶ {} · {} working", topic.name, topic.active),
                LABEL,
            )
        })
        .collect();
    if at_work.len() > MOST_WORKING {
        lines.push(format!(
            "…and {} more at work",
            at_work.len() - MOST_WORKING
        ));
    }
    lines
}

/// A line of the menu. `session` is the index in the snapshot the menu was built from.
#[derive(Debug, PartialEq)]
pub enum Entry {
    /// Text only: nothing waits, or how many more do than fit.
    Note(String),
    /// A session that waits for a reply: choosing it shows the window.
    Session { session: usize, label: String },
    /// A question that can be answered from here.
    Question {
        session: usize,
        ask: String,
        label: String,
    },
}

/// More lines than this make a menu nobody reads.
const MOST: usize = 12;
const LABEL: usize = 64;

fn one_line(text: &str, most: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= most {
        return flat;
    }
    let mut cut: String = flat.chars().take(most - 1).collect();
    cut.push('…');
    cut
}

/// How a session's last words are introduced, by what they ask.
fn ending_says(ending: &str) -> Option<&'static str> {
    match ending {
        "question" => Some("asks"),
        "command" => Some("wants you to run"),
        "offer" => Some("offers"),
        "unreported" => Some("could not report back"),
        _ => None,
    }
}

/// The end of `text` on one line, at most `most` characters.
fn last_words(text: &str, most: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let flat = flat.trim_start_matches('…').trim_start();
    let count = flat.chars().count();
    if count <= most {
        return flat.to_string();
    }
    let mut cut = String::from("…");
    cut.extend(flat.chars().skip(count - (most - 1)));
    cut
}

/// What a session's line opens with: its topic, or else the directory it works in.
fn project(session: &Waiting) -> &str {
    if let Some(topic) = session.topic.as_deref().filter(|name| !name.is_empty()) {
        return topic;
    }
    session
        .cwd
        .as_deref()
        .and_then(|cwd| cwd.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next())
        .filter(|name| !name.is_empty())
        .unwrap_or("(no project)")
}

/// The menu for a snapshot: questions and approvals come first in it already.
pub fn entries(sessions: &[Waiting]) -> Vec<Entry> {
    let mut all = Vec::new();
    for (index, session) in sessions.iter().enumerate() {
        let name = project(session);
        if session.asks.is_empty() {
            let what = if session.waiting_for.as_deref() == Some("approval") {
                match &session.waiting_tool {
                    Some(tool) => format!("{} asks to use {tool}", session.agent),
                    None => format!("{} asks for approval", session.agent),
                }
            } else if let (Some(says), Some(reply)) = (
                session.ending.as_deref().and_then(ending_says),
                &session.last_reply,
            ) {
                // What it asks stands at the end of the message, so the end is what shows.
                let room = LABEL
                    .saturating_sub(name.chars().count() + session.agent.len() + says.len() + 6);
                format!(
                    "{} {says}: {}",
                    session.agent,
                    last_words(reply, room.max(12))
                )
            } else {
                let text = [&session.title, &session.last_prompt, &session.last_reply]
                    .into_iter()
                    .flatten()
                    .next()
                    .map(String::as_str)
                    .unwrap_or("(no prompt)");
                format!("{}: {text}", session.agent)
            };
            all.push(Entry::Session {
                session: index,
                label: one_line(&format!("{name} · {what}"), LABEL),
            });
            continue;
        }
        for ask in &session.asks {
            let tool = ask.tool.as_deref().unwrap_or("a tool");
            let what = match &ask.preview {
                Some(preview) => format!("{tool}: {preview}"),
                None => format!("{} asks to use {tool}", session.agent),
            };
            all.push(Entry::Question {
                session: index,
                ask: ask.id.clone(),
                label: one_line(&format!("{name} · {what}"), LABEL),
            });
        }
    }
    if all.is_empty() {
        return vec![Entry::Note("Nothing waits for you".into())];
    }
    if all.len() > MOST {
        let more = all.len() - MOST;
        all.truncate(MOST);
        all.push(Entry::Note(format!("…and {more} more")));
    }
    all
}

/// The number beside the icon: the lines that wait, none when nothing does.
pub fn count(sessions: &[Waiting]) -> Option<String> {
    let waiting: usize = sessions
        .iter()
        .map(|session| session.asks.len().max(1))
        .sum();
    (waiting > 0).then(|| waiting.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_snapshot_and_ignores_other_lines() {
        let line = r#"{"sessions":[{"id":"a","agent":"claude","cwd":"/work/app","lastReply":"Done.\nPush it?","state":"waiting","updatedAt":1},{"id":"b","agent":"claude","cwd":"/work/api/","waitingFor":"approval","waitingTool":"Bash","asks":[{"id":"0123","tool":"Bash","preview":"npm run deploy","at":2}]}]}"#;
        let snapshot = parse_snapshot(line).expect("a snapshot");
        assert!(snapshot.limits.is_empty());
        let sessions = snapshot.sessions;
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].last_reply.as_deref(), Some("Done.\nPush it?"));
        assert_eq!(sessions[1].asks[0].id, "0123");
        assert_eq!(parse_snapshot("claude: store unreadable"), None);
        assert_eq!(parse_snapshot(r#"{"id":"a"}"#), None);
    }

    #[test]
    fn lists_questions_and_sessions_with_their_project() {
        let sessions = vec![
            Waiting {
                id: "b".into(),
                agent: "claude".into(),
                cwd: Some("/work/api/".into()),
                asks: vec![Ask {
                    id: "0123".into(),
                    tool: Some("Bash".into()),
                    preview: Some("npm run\n  deploy".into()),
                }],
                ..Default::default()
            },
            Waiting {
                id: "c".into(),
                agent: "copilot".into(),
                cwd: Some("/work/web".into()),
                waiting_for: Some("approval".into()),
                waiting_tool: Some("shell".into()),
                ..Default::default()
            },
            Waiting {
                id: "a".into(),
                agent: "codex".into(),
                last_reply: Some("x".repeat(200)),
                ..Default::default()
            },
        ];
        let menu = entries(&sessions);
        assert_eq!(
            menu[0],
            Entry::Question {
                session: 0,
                ask: "0123".into(),
                label: "api · Bash: npm run deploy".into()
            }
        );
        assert_eq!(
            menu[1],
            Entry::Session {
                session: 1,
                label: "web · copilot asks to use shell".into()
            }
        );
        let Entry::Session { label, .. } = &menu[2] else {
            panic!("a session")
        };
        assert!(label.starts_with("(no project) · codex: xxx"));
        assert_eq!(label.chars().count(), LABEL);
        assert!(label.ends_with('…'));
        assert_eq!(count(&sessions).as_deref(), Some("3"));
    }

    #[test]
    fn shows_the_quota_of_each_agent_on_one_line() {
        let line = r#"{"sessions":[],"limits":[{"agent":"claude","window":"5h","status":"ok","usedPercent":61.6,"resetsAt":9,"at":1},{"agent":"claude","window":"7d","status":"warning","usedPercent":85,"at":1},{"agent":"codex","window":"5h","status":"exceeded","at":1},{"agent":"codex","window":"7d","status":"ok","name":"spark","usedPercent":3,"at":1}]}"#;
        let snapshot = parse_snapshot(line).expect("a snapshot");
        assert_eq!(
            quota(&snapshot.limits),
            vec![
                "claude: 5h 62% · 7d 85%".to_string(),
                "codex: 5h used up · spark 7d 3%".to_string()
            ]
        );
        assert!(quota(&[]).is_empty());
    }

    #[test]
    fn shows_what_a_session_asks_from_the_end_of_its_message() {
        let sessions = vec![Waiting {
            id: "q".into(),
            agent: "claude".into(),
            cwd: Some("/work/app".into()),
            title: Some("CSV export".into()),
            last_reply: Some(format!("…{} Mam wysłać to jako preview?", "x".repeat(150))),
            ending: Some("question".into()),
            ..Default::default()
        }];
        let Entry::Session { label, .. } = &entries(&sessions)[0] else {
            panic!("a session")
        };
        assert!(label.starts_with("app · claude asks: …"));
        assert!(label.ends_with("Mam wysłać to jako preview?"));
        assert!(label.chars().count() <= LABEL);
        assert_eq!(last_words("… Done.  Push it?", 40), "Done. Push it?");
    }

    #[test]
    fn names_a_session_by_its_topic_and_lists_the_topics_at_work() {
        let line = r#"{"sessions":[{"id":"a","agent":"claude","cwd":"/work/src","topic":"Trenchline Command","waitingFor":"approval","waitingTool":"Bash"}],"topics":[{"id":"t2","name":"Trenchline Command","sessions":4,"asking":1,"active":0},{"id":"t5","name":"Pack mode","sessions":9,"asking":0,"active":2}]}"#;
        let snapshot = parse_snapshot(line).expect("a snapshot");
        assert_eq!(
            entries(&snapshot.sessions)[0],
            Entry::Session {
                session: 0,
                label: "Trenchline Command · claude asks to use Bash".into()
            }
        );
        assert_eq!(working(&snapshot.topics), vec!["▶ Pack mode · 2 working"]);
        let many: Vec<Topic> = (0..8)
            .map(|index| Topic {
                name: format!("Topic {index}"),
                active: 1,
                ..Default::default()
            })
            .collect();
        let lines = working(&many);
        assert_eq!(lines.len(), MOST_WORKING + 1);
        assert_eq!(lines[MOST_WORKING], "…and 2 more at work");
        assert!(working(&[]).is_empty());
    }

    #[test]
    fn says_when_nothing_waits_and_when_more_do_than_fit() {
        assert_eq!(
            entries(&[]),
            vec![Entry::Note("Nothing waits for you".into())]
        );
        assert_eq!(count(&[]), None);
        let many: Vec<Waiting> = (0..15)
            .map(|index| Waiting {
                id: index.to_string(),
                agent: "claude".into(),
                ..Default::default()
            })
            .collect();
        let menu = entries(&many);
        assert_eq!(menu.len(), MOST + 1);
        assert_eq!(menu[MOST], Entry::Note("…and 3 more".into()));
    }
}
