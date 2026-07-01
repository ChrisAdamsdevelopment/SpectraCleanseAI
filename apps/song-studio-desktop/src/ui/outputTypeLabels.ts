// Single source of truth for how the 3 current output types are named in the
// UI (Start Screen, Editor, Project Home, output cards). Keeping this in one
// place is what stops "Make a Release Card" / "Spotify Canvas" / etc. from
// drifting into a different phrase on every screen — the exact "overlapping
// naming systems" problem UX-CLARITY-001 removes. Pure strings only; no
// change to render/recipes.ts ids, so rendered file names are unaffected.
export function outputTypeNoun(functionId: string, fallback: string): string {
  if (functionId === 'make_canvas') return 'Spotify Canvas';
  if (functionId === 'make_hook_promo') return 'Short promo';
  if (functionId === 'make_visualizer') return 'Visualizer';
  return fallback;
}

export function outputTypeAction(functionId: string, fallback: string): string {
  if (functionId === 'make_canvas') return 'Make a Spotify Canvas';
  if (functionId === 'make_hook_promo') return 'Make a short promo';
  if (functionId === 'make_visualizer') return 'Make a visualizer';
  return `Make ${fallback}`;
}
