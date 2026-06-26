// Friendly named colors for the UI. Values are #rrggbb; the renderer maps them
// to FFmpeg colors. "Custom" lets the user pick any color.
export interface NamedColor { name: string; value: string }

export const COLOR_PRESETS: NamedColor[] = [
  { name: 'White', value: '#ffffff' },
  { name: 'Black', value: '#000000' },
  { name: 'Red', value: '#ff3b3b' },
  { name: 'Cyan', value: '#4fd1ff' },
  { name: 'Gold', value: '#ffcc55' },
  { name: 'Green', value: '#3ecf8e' },
  { name: 'Purple', value: '#a78bfa' },
];

export function colorName(value: string): string {
  const hit = COLOR_PRESETS.find((c) => c.value.toLowerCase() === (value || '').toLowerCase());
  return hit ? hit.name : 'Custom';
}
