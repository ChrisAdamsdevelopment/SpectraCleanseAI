// A small, safe set of font families. `css` drives the live preview; `files` are
// candidate .ttf paths the Rust side checks (first existing wins) for the export.
export interface FontFamily {
  id: string;
  label: string;
  css: string;
  files: string[];
}

export const FONT_FAMILIES: FontFamily[] = [
  {
    id: 'sans', label: 'Sans (Arial)',
    css: 'Arial, "Helvetica Neue", system-ui, sans-serif',
    files: ['C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf',
      '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  },
  {
    id: 'impact', label: 'Impact (bold)',
    css: 'Impact, "Arial Black", system-ui, sans-serif',
    files: ['C:/Windows/Fonts/impact.ttf', 'C:/Windows/Fonts/ariblk.ttf',
      '/System/Library/Fonts/Supplemental/Impact.ttf'],
  },
  {
    id: 'serif', label: 'Serif (Georgia)',
    css: 'Georgia, "Times New Roman", serif',
    files: ['C:/Windows/Fonts/georgiab.ttf', 'C:/Windows/Fonts/georgia.ttf', 'C:/Windows/Fonts/timesbd.ttf',
      '/System/Library/Fonts/Supplemental/Georgia.ttf'],
  },
  {
    id: 'mono', label: 'Mono (Courier)',
    css: '"Courier New", ui-monospace, monospace',
    files: ['C:/Windows/Fonts/courbd.ttf', 'C:/Windows/Fonts/cour.ttf',
      '/System/Library/Fonts/Supplemental/Courier New Bold.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'],
  },
];

export function getFontFamily(id: string): FontFamily {
  return FONT_FAMILIES.find((f) => f.id === id) ?? FONT_FAMILIES[0];
}
