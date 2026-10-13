import { useEffect, useRef } from 'react';
import { nextPollDecision } from '../director/polling';

// Automatic bounded job polling (VIDEO-003B §4). Drives the pure decision core
// with real timers: starts a loop per pending job, backs off, dedupes (one loop
// per key), stops on completion/terminal phase/too-many-errors/budget, and tears
// everything down when the workspace unmounts or the project changes. Manual
// "Check status" remains available and simply calls pollOnce directly.

export interface AutoPollDeps {
  /** Take ids with a pending provider job (resumable). Resuming after reopen is
   * automatic because these are recomputed from persisted state. */
  pendingKeys: string[];
  /** Poll one key once (persisting the phase) and return the resulting phase. */
  pollOnce: (key: string) => Promise<string>;
  /** Changes when the project changes — tears down all loops. */
  projectToken: string;
  enabled: boolean;
}

export function useAutoPoll({ pendingKeys, pollOnce, projectToken, enabled }: AutoPollDeps) {
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const running = useRef<Set<string>>(new Set());
  const attempts = useRef<Map<string, number>>(new Map());
  const errors = useRef<Map<string, number>>(new Map());
  const pollRef = useRef(pollOnce);
  pollRef.current = pollOnce;
  const key = pendingKeys.join(',');

  useEffect(() => {
    if (!enabled) return;
    const timersMap = timers.current;

    const loop = async (k: string) => {
      if (!running.current.has(k)) return;
      const a = attempts.current.get(k) ?? 0;
      let phase = 'running';
      try { phase = await pollRef.current(k); errors.current.set(k, 0); }
      catch { errors.current.set(k, (errors.current.get(k) ?? 0) + 1); phase = 'error'; }
      const nextAttempts = a + 1;
      attempts.current.set(k, nextAttempts);
      const decision = nextPollDecision(phase, nextAttempts, errors.current.get(k) ?? 0);
      if (decision.action === 'poll' && running.current.has(k)) {
        timersMap.set(k, setTimeout(() => loop(k), decision.delayMs));
      } else {
        running.current.delete(k);
        timersMap.delete(k);
      }
    };

    // Start loops for newly-pending keys (dedupe via the running set).
    for (const k of pendingKeys) {
      if (running.current.has(k)) continue;
      running.current.add(k);
      attempts.current.set(k, 0);
      errors.current.set(k, 0);
      timersMap.set(k, setTimeout(() => loop(k), 1500));
    }
    // Stop loops whose key is no longer pending (completed / removed).
    for (const k of Array.from(running.current)) {
      if (!pendingKeys.includes(k)) {
        const t = timersMap.get(k); if (t) clearTimeout(t);
        timersMap.delete(k); running.current.delete(k);
      }
    }

    return () => { for (const t of timersMap.values()) clearTimeout(t); timersMap.clear(); running.current.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, projectToken, enabled]);
}
