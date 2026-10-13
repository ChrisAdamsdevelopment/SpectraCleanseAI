// Automatic job-polling decision core (VIDEO-003B §4). PURE and deterministic so
// it is testable with a fake scheduler: given the last phase, attempts so far,
// and consecutive errors, decide whether to poll again (with a bounded backoff
// delay), stop, or treat as done. The React hook (director-ui/useAutoPoll) drives
// timers off these decisions; persistence of each phase is handled by the
// applyProviderPoll/applyProviderResult actions, not here.

export const POLL_BASE_MS = 4000;
export const POLL_MAX_MS = 30000;
export const POLL_MAX_ATTEMPTS = 40;   // hard bound — never poll forever
export const POLL_MAX_ERRORS = 3;      // stop (pause) after repeated errors

export type PollAction = 'poll' | 'stop' | 'done';

export interface PollDecision {
  action: PollAction;
  delayMs: number;
  reason: string;
}

/** Decide the next polling step. `phase` is the last observed provider phase. */
export function nextPollDecision(phase: string, attempts: number, consecutiveErrors: number): PollDecision {
  if (phase === 'succeeded') return { action: 'done', delayMs: 0, reason: 'completed' };
  if (phase === 'failed' || phase === 'cancelled') return { action: 'stop', delayMs: 0, reason: 'terminal provider phase' };
  if (consecutiveErrors >= POLL_MAX_ERRORS) return { action: 'stop', delayMs: 0, reason: 'too many consecutive errors — paused (retry manually)' };
  if (attempts >= POLL_MAX_ATTEMPTS) return { action: 'stop', delayMs: 0, reason: 'poll budget exhausted — paused (retry manually)' };
  // Exponential backoff capped at POLL_MAX_MS.
  const delay = Math.min(POLL_MAX_MS, POLL_BASE_MS * Math.pow(1.5, Math.min(attempts, 8)));
  return { action: 'poll', delayMs: Math.round(delay), reason: 'still running' };
}

/** A take/job phase that should be auto-polled (pending, has an id, no result). */
export function isPendingPhase(phase: string): boolean {
  return phase === 'submitted' || phase === 'running';
}
