import type { CanvasValidationIssue, CanvasValidationResult, CanvasValidationRule, CanvasVideoSpec } from './types';

const aspect = (spec: CanvasVideoSpec) => spec.width / spec.height;
const near = (actual: number, expected: number, tolerance = 0.04) => Math.abs(actual - expected) <= tolerance;

export const defaultCanvasValidationRules: CanvasValidationRule[] = [
  { id: 'file-mp4', label: 'MP4 preferred', severity: 'warning', message: 'MP4 is preferred for Canvas-style exports.', validate: (s) => (s.fileType ?? s.filePath.split('.').pop() ?? '').toLowerCase() === 'mp4' },
  { id: 'duration-min', label: 'Minimum duration', severity: 'error', message: 'Video must be at least 3 seconds for the local loop MVP.', validate: (s) => s.durationSec >= 3 },
  { id: 'duration-max', label: 'Maximum duration', severity: 'warning', message: 'Canvas-style loops are expected to be 8 seconds or shorter.', validate: (s) => s.durationSec <= 8 },
  { id: 'portrait-916', label: 'Portrait 9:16', severity: 'warning', message: 'Portrait 9:16 media is preferred; other ratios may need crop/scale.', validate: (s) => s.height > s.width && near(aspect(s), 9 / 16) },
  { id: 'height-range', label: 'Canvas height range', severity: 'warning', message: '720–1080px height is preferred for CPU-friendly Canvas-style processing.', validate: (s) => s.height >= 720 && s.height <= 1080 },
  { id: 'fps-range', label: 'FPS range', severity: 'warning', message: '24, 25, or 30 FPS is preferred for predictable loop exports.', validate: (s) => [24, 25, 30].some((fps) => near(s.fps, fps, 0.2)) },
];

export function validateCanvasVideoSpec(spec: CanvasVideoSpec, rules = defaultCanvasValidationRules): CanvasValidationResult {
  const issues = rules.reduce<CanvasValidationIssue[]>((acc, rule) => {
    if (!rule.validate(spec)) acc.push({ ruleId: rule.id, severity: rule.severity, message: rule.message });
    return acc;
  }, []);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings, spec };
}
