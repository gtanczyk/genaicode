import type { CSSProperties } from 'react';
import type { SessionState } from '../agents/session.js';
import type { ApprovalDecision } from '../agents/types.js';
import { askVerb, leadNow, leadNowText, missionActive, missionCounts, taskAsks } from './live.js';
import { GROUP_TONE, Glyph } from './work-panel.js';
import { askSubject, WORK_GROUP_LABEL, workTasks, type PullRequestStatus, type WorkGroup } from './work.js';

export interface MissionStripProps {
  /** The session whose delegated tasks are counted, as `<AgentChat>` and `<WorkPanel>` get it. */
  state: SessionState | null | undefined;
  /** As `<WorkPanel>` gets them, so both count a task in the same group. */
  pullRequests?: Readonly<Record<string, PullRequestStatus | undefined>>;
  /** Answer the approval a task waits for. Without it the request shows with no buttons. */
  onApprove?(id: string, decision: ApprovalDecision): void;
  /** A state's count was clicked: show the tasks of that group. Without it the counts are text. */
  onOpenGroup?(group: WorkGroup): void;
  /** A task id was clicked (`WorkTask.key`): show that task. Without it the id is text. */
  onOpenTask?(key: string): void;
  /** Keep the person from acting (the host is disconnected). */
  disabled?: boolean;
  /** Outside an `<AgentChat>`, which hands its own theme down. 'auto' follows prefers-color-scheme. */
  theme?: 'auto' | 'light' | 'dark';
  className?: string;
  style?: CSSProperties;
}

/**
 * The mission strip: the team at a glance and the next decision in reach, above the message box
 * while delegated work runs. One count per state, in the order of what to do next; what the lead
 * does now; and the head of this chat's approvals with Approve and Deny. It renders nothing when no
 * delegated work runs, changes in place and never takes the keyboard focus.
 *
 * `<AgentChat missionStrip={...}>` places it; use it directly beside a composer of your own.
 */
export function MissionStrip(props: MissionStripProps) {
  const tasks = workTasks(props.state, props.pullRequests);
  if (!missionActive(props.state, tasks)) return null;
  const counts = missionCounts(tasks);
  const now = leadNow(props.state);
  const asks = taskAsks(tasks);
  const head = asks[0];
  const { onOpenGroup, onOpenTask } = props;
  const approve = props.disabled ? undefined : props.onApprove;
  const theme = props.theme && props.theme !== 'auto' ? props.theme : undefined;
  return (
    <div
      className={['gc-strip', props.className].filter(Boolean).join(' ')}
      role="group"
      aria-label="Team status"
      data-theme={theme}
      style={props.style}
    >
      <div className="gc-strip-row">
        {counts.map(({ group, count }) => {
          const label = WORK_GROUP_LABEL[group];
          const content = (
            <>
              <Glyph tone={GROUP_TONE[group]} />
              {count}
              <span>{label}</span>
            </>
          );
          return onOpenGroup ? (
            <button
              key={group}
              type="button"
              className="gc-strip-stat"
              data-group={group}
              aria-label={`${count} ${label.toLowerCase()}`}
              title={`${count} ${label.toLowerCase()}: open Tasks on them`}
              onClick={() => onOpenGroup(group)}
            >
              {content}
            </button>
          ) : (
            <span key={group} className="gc-strip-stat" data-group={group} title={`${count} ${label.toLowerCase()}`}>
              {content}
            </span>
          );
        })}
        {now ? (
          <span className="gc-strip-lead" title={`What ${now.lead} does now: ${leadNowText(now)}`}>
            {leadNowText(now)}
          </span>
        ) : null}
      </div>
      {head ? (
        <div className="gc-strip-ask" data-ask={head.request.id}>
          <Glyph tone="ask" />
          <span className="gc-strip-what">
            <b>{head.item.task.agent}</b> ·{' '}
            {onOpenTask ? (
              <button
                type="button"
                className="gc-strip-ref"
                aria-label={`Open task ${head.item.task.id}`}
                onClick={() => onOpenTask(head.item.key)}
              >
                {head.item.task.id}
              </button>
            ) : (
              <span className="gc-strip-ref">{head.item.task.id}</span>
            )}{' '}
            {askVerb(head.request)}
          </span>
          <code title={askSubject(head.request)}>{askSubject(head.request)}</code>
          <span className="gc-strip-grow" />
          {approve ? (
            <>
              <button
                type="button"
                className="gc-strip-btn gc-strip-primary"
                aria-label={`Approve for ${head.item.task.id}`}
                title={head.request.scope === 'turn' ? 'Approves it for the rest of this turn' : undefined}
                onClick={() => approve(head.request.id, 'approve')}
              >
                Approve
              </button>
              <button
                type="button"
                className="gc-strip-btn"
                aria-label={`Deny for ${head.item.task.id}`}
                onClick={() => approve(head.request.id, 'deny')}
              >
                Deny
              </button>
            </>
          ) : null}
          {asks.length > 1 && onOpenGroup ? (
            <button type="button" className="gc-strip-btn gc-strip-ghost" onClick={() => onOpenGroup('ask')}>
              1 of {asks.length} in this chat ›
            </button>
          ) : (
            <span className="gc-strip-of">{asks.length > 1 ? `1 of ${asks.length}` : '1'} in this chat</span>
          )}
        </div>
      ) : null}
      {/* A new approval is said once; the buttons are not inside a live region. */}
      <span className="gc-strip-sr" role="status">
        {head
          ? `${head.item.task.agent}, task ${head.item.task.id}, ${askVerb(head.request)}: ${askSubject(head.request)}`
          : ''}
      </span>
    </div>
  );
}
