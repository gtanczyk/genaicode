import { useEffect, useRef, useState } from 'react';
import type { ProjectTeam } from '../../agents/pack-profile.js';

export function ProjectTeamDialog({
  token,
  cwd,
  chooseProject,
  sessions,
  onClose,
}: {
  token: string;
  cwd?: string;
  chooseProject: boolean;
  sessions: boolean;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [folder, setFolder] = useState(cwd ?? '');
  const [directory, setDirectory] = useState<string | undefined>(cwd);
  const [folders, setFolders] = useState<string[]>([]);
  const [profile, setProfile] = useState<ProjectTeam>();
  const [lead, setLead] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [saved, setSaved] = useState(false);
  const url = (project: string) => '/api/pack-profile?project=' + encodeURIComponent(project);

  useEffect(() => {
    dialog.current?.showModal();
    if (!chooseProject || !sessions) return;
    const controller = new AbortController();
    void fetch('/api/sessions', { headers: { 'x-genaicode-token': token }, signal: controller.signal })
      .then((res) => res.json())
      .then((result: { sessions?: { cwd?: string }[] }) => {
        setFolders([...new Set(result.sessions?.flatMap((s) => (s.cwd ? [s.cwd] : [])) ?? [])].sort());
      })
      .catch(() => {});
    return () => controller.abort();
  }, [chooseProject, sessions, token]);

  useEffect(() => {
    if (!directory) return;
    const controller = new AbortController();
    setProfile(undefined);
    setBusy(true);
    setSaved(false);
    setProblem('');
    void (async () => {
      try {
        const response = await fetch(url(directory), {
          headers: { 'x-genaicode-token': token },
          signal: controller.signal,
        });
        const data = (await response.json()) as ProjectTeam & { error?: string };
        if (!response.ok) throw new Error(data.error ?? 'Could not read the project team.');
        if (controller.signal.aborted) return;
        const choices = data.choices.filter((c) => c.installed);
        setProfile(data);
        setLead(
          choices.find((c) => c.name === data.team?.lead && c.canLead)?.name ??
            choices.find((c) => c.canLead)?.name ??
            '',
        );
        setMembers(data.team?.members.filter((name) => choices.some((c) => c.name === name)) ?? []);
        setProblem(data.problem ?? '');
      } catch (error) {
        if (!controller.signal.aborted)
          setProblem(error instanceof Error ? error.message : 'Could not open the project.');
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [directory, token]);

  const save = async () => {
    if (!profile || !directory) return;
    setBusy(true);
    setSaved(false);
    setProblem('');
    try {
      const response = await fetch(url(directory), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-genaicode-token': token },
        body: JSON.stringify({ lead, members }),
      });
      if (!response.ok)
        throw new Error(((await response.json()) as { error?: string }).error ?? 'Could not save the team.');
      setSaved(true);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save the team.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="project-team" aria-labelledby="pack-title" onClose={onClose}>
      <header>
        <h2 id="pack-title">Project team</h2>
        <button type="button" aria-label="Close project team" onClick={() => dialog.current?.close()}>
          ×
        </button>
      </header>
      {chooseProject && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setDirectory(folder.trim());
          }}
        >
          <label htmlFor="pack-folder">Project folder</label>
          <div className="pack-folder">
            <input
              id="pack-folder"
              list="pack-folders"
              placeholder="/path/to/project"
              value={folder}
              disabled={busy}
              onChange={(event) => {
                setFolder(event.target.value);
                setDirectory(undefined);
                setProfile(undefined);
                setSaved(false);
                setProblem('');
              }}
            />
            <button disabled={busy || !folder.trim()}>Open</button>
          </div>
          <datalist id="pack-folders">
            {folders.map((dir) => (
              <option key={dir} value={dir} />
            ))}
          </datalist>
        </form>
      )}
      {profile && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p className="pack-dir">{profile.project}</p>
          <label htmlFor="pack-lead">Lead</label>
          <select
            id="pack-lead"
            disabled={busy}
            value={lead}
            onChange={(event) => {
              setLead(event.target.value);
              setSaved(false);
            }}
          >
            {profile.choices
              .filter((c) => c.installed && c.canLead)
              .map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
          </select>
          <fieldset disabled={busy}>
            <legend>Workers</legend>
            {profile.choices
              .filter((c) => c.installed)
              .map((c) => (
                <label key={c.name}>
                  <input
                    type="checkbox"
                    checked={members.includes(c.name)}
                    onChange={(event) => {
                      setMembers(
                        event.target.checked ? [...members, c.name] : members.filter((name) => name !== c.name),
                      );
                      setSaved(false);
                    }}
                  />{' '}
                  {c.name}
                </label>
              ))}
          </fieldset>
          <button className="pack-save" disabled={busy || !lead || !members.length}>
            Remember this team for the project
          </button>
        </form>
      )}
      {problem && <p role="alert">{problem}</p>}
      {saved && <p role="status">Team saved in .genaicode/pack.json for the next project pack.</p>}
    </dialog>
  );
}
