import { useState } from 'react';
import type { ApprovalDecision, ApprovalRequest, QuestionAnswers } from '../agents/types.js';

/** What a finished question shows: each question's label and what was chosen. */
export function answerSummary(request: ApprovalRequest, answers: QuestionAnswers | undefined): string {
  return (request.questions ?? [])
    .map((question) => {
      const picked = answers?.[question.id];
      return picked?.length ? `${question.header ?? question.question}: ${picked.join(', ')}` : undefined;
    })
    .filter(Boolean)
    .join(' · ');
}

/**
 * An agent's question as a card: its options as buttons, a field for an answer of one's own
 * where the agent allows it, and Skip. One question with one choice answers at a click;
 * anything more waits for Send.
 */
export function QuestionCard({
  agent,
  request,
  onAnswer,
  onApprove,
}: {
  agent: string;
  request: ApprovalRequest;
  /** Without it the card only shows the question, as waiting. */
  onAnswer?(id: string, answers: QuestionAnswers): void;
  onApprove?(id: string, decision: ApprovalDecision): void;
}) {
  const questions = request.questions ?? [];
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const quick = questions.length === 1 && !questions[0]!.multiple;

  const answers = (): QuestionAnswers => {
    const out: QuestionAnswers = {};
    for (const question of questions) {
      const own = typed[question.id]?.trim();
      const chosen = picked[question.id] ?? [];
      // One choice: what was typed wins over a picked option.
      const all = question.multiple ? [...chosen, ...(own ? [own] : [])] : own ? [own] : chosen;
      if (all.length) out[question.id] = all;
    }
    return out;
  };
  const complete = questions.every((question) => answers()[question.id]?.length);

  const choose = (id: string, label: string, multiple: boolean) => {
    if (quick && onAnswer) return onAnswer(request.id, { [id]: [label] });
    setPicked((now) => {
      const had = now[id] ?? [];
      const next = multiple ? (had.includes(label) ? had.filter((item) => item !== label) : [...had, label]) : [label];
      return { ...now, [id]: next };
    });
    if (!multiple) setTyped((now) => ({ ...now, [id]: '' }));
  };

  return (
    <div className="gc-approval gc-question">
      <div>
        <strong>{agent}</strong> asks:
      </div>
      {questions.map((question) => (
        <fieldset key={question.id} className="gc-question-item" disabled={!onAnswer}>
          <legend>
            {question.header ? <span className="gc-question-header">{question.header}</span> : null}
            {question.question}
            {question.multiple ? <span className="gc-waiting"> (choose any)</span> : null}
          </legend>
          <div className="gc-question-options">
            {question.options.map((option) => {
              const on =
                (picked[question.id] ?? []).includes(option.label) && !(typed[question.id] && !question.multiple);
              return (
                <button
                  key={option.label}
                  type="button"
                  className={on ? 'gc-option gc-on' : 'gc-option'}
                  aria-pressed={on}
                  onClick={() => choose(question.id, option.label, !!question.multiple)}
                >
                  <span className="gc-option-label">{option.label}</span>
                  {option.description ? <span className="gc-option-description">{option.description}</span> : null}
                </button>
              );
            })}
          </div>
          {question.freeText ? (
            <input
              className="gc-question-own"
              type={question.secret ? 'password' : 'text'}
              autoComplete="off"
              placeholder={question.options.length ? 'Something else…' : 'Your answer…'}
              aria-label={`Your own answer: ${question.question}`}
              value={typed[question.id] ?? ''}
              onChange={(event) => setTyped((now) => ({ ...now, [question.id]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if (complete && onAnswer) onAnswer(request.id, answers());
              }}
            />
          ) : null}
        </fieldset>
      ))}
      {onAnswer ? (
        <div className="gc-buttons">
          <button
            type="button"
            className="gc-btn gc-primary"
            disabled={!complete}
            onClick={() => onAnswer(request.id, answers())}
          >
            Send {questions.length > 1 ? 'answers' : 'answer'}
          </button>
          {onApprove ? (
            <button
              type="button"
              className="gc-btn"
              title="Leave the question unanswered: the agent goes on without it"
              onClick={() => onApprove(request.id, 'deny')}
            >
              Skip
            </button>
          ) : null}
        </div>
      ) : (
        <div className="gc-waiting">Waiting for an answer…</div>
      )}
    </div>
  );
}
