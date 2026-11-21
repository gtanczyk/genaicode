import { useState } from 'react';
import type { TowerDecision, TowerView } from '../../agents/sessions/tower.js';
import { towerAction, towerChoices, towerText } from '../tower-format.js';

export function TowerInboxPanel({
  view,
  connected,
  decide,
}: {
  view: TowerView;
  connected: boolean;
  decide(id: string, decision: TowerDecision): Promise<boolean>;
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
