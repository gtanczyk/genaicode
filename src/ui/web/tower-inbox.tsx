import { useState } from 'react';
import type { TowerDecision, TowerView } from '../../agents/sessions/tower.js';
import { towerAction, towerChoices, towerText } from '../tower-format.js';

export function TowerInboxPanel({
  view,
  connected,
  decide,
  asking,
}: {
  view: TowerView;
  connected: boolean;
  decide(id: string, decision: TowerDecision): Promise<boolean>;
  /** The sessions that ask now and are not items here, and the way to their list. Absent: no session index. */
  asking?: { count: number; onOpen(): void };
}) {
  const [feedback, setFeedback] = useState('');
  const act = async (id: string, decision: TowerDecision) => {
    try {
      setFeedback((await decide(id, decision)) ? '' : 'This item is no longer open.');
    } catch {
      setFeedback('Could not apply this decision.');
    }
  };
  return (
    <main className="sessions tower-inbox">
      <h1>Tower inbox</h1>
      {view.unavailable.length > 0 && (
        <p className="errors">Unavailable stores · {view.unavailable.map((s) => towerText(s)).join(', ')}</p>
      )}
      <p role="status">{feedback || towerText(view.status ?? '')}</p>
      {!view.items.length && <p>No pending items.</p>}
      {asking ? (
        <p>
          <button
            type="button"
            className="chip waits"
            title="Sessions of every agent that ask a question or wait on an answer now"
            onClick={asking.onOpen}
          >
            {asking.count
              ? `${asking.count} more ${asking.count === 1 ? 'session asks' : 'sessions ask'} for you`
              : 'Sessions that ask for you'}
          </button>
        </p>
      ) : null}
      {view.items.map((item) => (
        <article className="project" key={item.id}>
          <h2>{towerAction(item)}</h2>
          <div>
            <strong>{towerText(item.agent)}</strong> · {towerText(item.cwd ?? '(unknown project)')}
          </div>
          <div className="recipient">{towerText(item.origin)}</div>
          <pre>{towerText(item.text, true)}</pre>
          <div className="act">
            {towerChoices(item).map((choice) => (
              <button key={choice.decision} disabled={!connected} onClick={() => void act(item.id, choice.decision)}>
                {choice.label}
              </button>
            ))}
          </div>
        </article>
      ))}
    </main>
  );
}
