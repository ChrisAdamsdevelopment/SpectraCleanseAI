// UX-006 — Context Engine / Mode System v1. A minimal interaction layer over
// the existing UI: given the current view + active output, decide which
// ContextMode the app is conceptually in. This is intentionally NOT a router
// in the navigation sense — it changes nothing about which screen renders.
// Today exactly one thing reacts to it (the canvas-edit bottom summary in
// App.tsx); everything else keeps its existing behavior. The point of this
// slice is proving the UI *can* react to intent, not fully wiring intent
// through the app.
export type ContextMode = 'home' | 'canvas-edit' | 'promo-edit' | 'loop-design' | 'export-review';

export interface ContextDecision {
  mode: ContextMode;
  // Informed by LoopCore, per UX-006 task 5 — LoopCore is referenced here
  // only to signal readiness for a future 'loop-design' mode switch. Nothing
  // consumes this to change rendering; it is not itself a mode you can be in
  // yet, since no loop-design view exists.
  loopDesignReady: boolean;
}

export interface ContextModeInput {
  view: 'start' | 'home' | 'editor' | 'canvas-test-drive' | 'director';
  activeOutputFunctionId: string | null;
  hasLoopCore: boolean;
  hasExportResult: boolean;
}

/**
 * Context Router: given { view, active output, export state }, resolve the
 * current ContextMode. Pure and synchronous — no side effects, no state of
 * its own. 'start' and 'canvas-test-drive' are not modeled yet (they fall
 * back to 'home') since this slice only maps Project Home and the per-output
 * Editor, per the UX-006 brief.
 */
export function resolveContextMode(input: ContextModeInput): ContextDecision {
  const loopDesignReady = input.hasLoopCore;
  if (input.view === 'home') return { mode: 'home', loopDesignReady };
  if (input.view === 'editor') {
    if (input.hasExportResult) return { mode: 'export-review', loopDesignReady };
    if (input.activeOutputFunctionId === 'make_canvas') return { mode: 'canvas-edit', loopDesignReady };
    return { mode: 'promo-edit', loopDesignReady };
  }
  return { mode: 'home', loopDesignReady };
}
