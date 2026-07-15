// REDACTED DIAGNOSTICS (ALPHA-001 §11). "Help us fix a problem" produces a
// support package a tester can read before sending.
//
// DEFAULT = SAFE. Nothing personal or secret leaves unless the creator ticks an
// explicit, unchecked-by-default box:
//   never by default: API keys, song audio, reference images, generated video,
//   lyrics, full prompts, project title, private local paths.
// Paths are reduced to file names. Every string passes the secret redactor.

import { redactSecret } from './secureStore';
import type { AppSettings } from './appSettings';
import type { DirectorState } from '../director/model';

// ── Path redaction ──────────────────────────────────────────────────────────

/** Reduce an absolute path to just its file name. `C:\Users\jane\My Song.mp3`
 * becomes `My Song.mp3`; the user's name and folder layout never leave. */
export function redactPath(p: string): string {
  if (!p) return '';
  const name = p.split(/[\\/]/).filter(Boolean).pop() ?? '';
  return name || '(path)';
}

/** Redact paths ANYWHERE inside free text (log lines, error messages). */
export function redactPathsInText(text: string): string {
  return text
    // Windows absolute paths
    .replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, (m) => `…\\${redactPath(m)}`)
    // POSIX absolute paths (keep short root-ish tokens from being mangled)
    .replace(/\/(?:[^\s/:*?"<>|]+\/)+[^\s/:*?"<>|]*/g, (m) => `…/${redactPath(m)}`);
}

/** The full sanitizer applied to every free-text field in the package. */
export function sanitize(text: string): string {
  return redactPathsInText(redactSecret(text));
}

// ── Package shape ───────────────────────────────────────────────────────────

export interface DiagnosticsOptions {
  /** All OFF by default (§11). */
  includeSceneSummary: boolean;
  includeCompiledPacket: boolean;
  includeMediaFiles: boolean;
}

export function defaultDiagnosticsOptions(): DiagnosticsOptions {
  return { includeSceneSummary: false, includeCompiledPacket: false, includeMediaFiles: false };
}

export interface DiagnosticsInput {
  appVersion: string;
  buildSha: string | null;
  os: string;
  arch: string;
  installedBuild: boolean;
  ffmpeg: { found: boolean; source: string };
  updater: { status: string; currentVersion: string; availableVersion: string | null };
  settings: AppSettings;
  director: DirectorState | null;
  projectSchemaVersion: number | null;
  /** Recent app log lines (already collected locally). */
  logLines: string[];
  /** Optional extras — only read when the matching option is ticked. */
  sceneSummary?: string;
  compiledPacket?: string;
  mediaPaths?: string[];
}

export interface DiagnosticsFile { relPath: string; content: string }

export interface DiagnosticsPackage {
  files: DiagnosticsFile[];
  /** Human-readable preview shown BEFORE export (§11). */
  preview: string;
}

/** Build the redacted diagnostics package. Pure: the host writes the files/ZIP. */
export function buildDiagnostics(input: DiagnosticsInput, opts: DiagnosticsOptions): DiagnosticsPackage {
  const d = input.director;

  // Provider metadata: ids and modes only. Credential METADATA is safe; the
  // secret itself never exists in this structure at all.
  const providers = Object.entries(input.settings.providers.credentials).map(([id, meta]) => ({
    provider: id,
    configured: meta.configured,
    storage: meta.storage,          // 'secure' | 'session' | 'none'
    lastSuccessAt: meta.lastSuccessAt,
    lastTestCategory: meta.lastTestCategory,
  }));

  // Take/job state: ids + phases + sanitized error categories. No prompts.
  const takes = (d?.takes ?? []).map((t) => ({
    takeId: t.id,
    provider: t.provider,
    model: t.model,
    status: t.status,
    jobPhase: t.providerJob.phase,
    jobId: t.providerJob.jobId,     // a provider job id is not a secret
    hasResult: Boolean(t.assetId),
    accepted: t.accepted,
    lipSync: t.lipSync,
    isRepair: Boolean(t.parentTakeId),
    error: t.error ? sanitize(t.error) : null,
  }));

  const report = {
    generatedBy: 'Song Studio diagnostics',
    note: 'Redacted by default. No API keys, media, lyrics, prompts, project title, or full paths are included unless explicitly opted in.',
    application: {
      version: input.appVersion,
      buildSha: input.buildSha,
      installedBuild: input.installedBuild,
      os: input.os,
      arch: input.arch,
    },
    runtime: {
      ffmpegFound: input.ffmpeg.found,
      ffmpegSource: input.ffmpeg.source,   // 'bundled-sidecar' | 'dev-node-modules' | …
      updaterStatus: input.updater.status,
      currentVersion: input.updater.currentVersion,
      availableVersion: input.updater.availableVersion,
    },
    settings: {
      // Preferences only — no credentials.
      updateChannel: input.settings.update.channel,
      autoCheck: input.settings.update.autoCheck,
      onboardingCompleted: input.settings.onboarding.completedVersion !== null,
      developerMode: input.settings.ui.developerMode,
      appSettingsSchemaVersion: input.settings.schemaVersion,
    },
    providers,
    project: {
      schemaVersion: input.projectSchemaVersion,
      // COUNTS ONLY — never the title, never the content.
      entities: d?.entities.length ?? 0,
      scenes: d?.scenes.length ?? 0,
      takes: d?.takes.length ?? 0,
      lyricEvents: d?.lyrics.length ?? 0,
      tools: d?.tools.length ?? 0,
      referenceRequests: d?.referenceRequests.length ?? 0,
      acceptedScenes: (d?.scenes ?? []).filter((s) => s.acceptedTakeId).length,
      workprintStale: d?.workprint.stale ?? null,
    },
    takes,
    optedIn: {
      sceneSummary: opts.includeSceneSummary,
      compiledPacket: opts.includeCompiledPacket,
      mediaFiles: opts.includeMediaFiles,
    },
  };

  const files: DiagnosticsFile[] = [
    { relPath: 'report.json', content: JSON.stringify(report, null, 2) },
    { relPath: 'README.txt', content: [
      'Song Studio diagnostics package',
      '',
      'This folder was created by you from Song Studio → Settings → Help us fix a problem.',
      'It is redacted by default: it contains no API keys, no audio, no images, no video,',
      'no lyrics, no prompts, no project title, and no full folder paths.',
      '',
      'Files:',
      '  report.json  — app version, runtime health, provider status, project counts',
      '  logs.txt     — recent app log lines, with secrets and paths removed',
      opts.includeSceneSummary ? '  scene-summary.txt — INCLUDED because you ticked it' : '',
      opts.includeCompiledPacket ? '  compiled-packet.txt — INCLUDED because you ticked it' : '',
      opts.includeMediaFiles ? '  media-list.txt — file names you chose to include' : '',
    ].filter(Boolean).join('\n') },
    { relPath: 'logs.txt', content: input.logLines.map(sanitize).join('\n') },
  ];

  // Opt-in extras — only when explicitly ticked.
  if (opts.includeSceneSummary && input.sceneSummary) {
    files.push({ relPath: 'scene-summary.txt', content: sanitize(input.sceneSummary) });
  }
  if (opts.includeCompiledPacket && input.compiledPacket) {
    files.push({ relPath: 'compiled-packet.txt', content: sanitize(input.compiledPacket) });
  }
  if (opts.includeMediaFiles && input.mediaPaths?.length) {
    files.push({ relPath: 'media-list.txt', content: input.mediaPaths.map(redactPath).join('\n') });
  }

  return { files, preview: buildPreview(report, files, opts) };
}

function buildPreview(report: Record<string, unknown>, files: DiagnosticsFile[], opts: DiagnosticsOptions): string {
  const app = report.application as Record<string, unknown>;
  const proj = report.project as Record<string, unknown>;
  const rt = report.runtime as Record<string, unknown>;
  return [
    'This is exactly what will be exported:',
    '',
    `• Song Studio ${app.version} (${app.installedBuild ? 'installed' : 'development'}) on ${app.os} ${app.arch}`,
    `• Video engine: ${rt.ffmpegFound ? 'found' : 'MISSING'} (${rt.ffmpegSource})`,
    `• Update status: ${rt.updaterStatus}`,
    `• Providers: ${(report.providers as unknown[]).length} configured (status only — no keys)`,
    `• Project: ${proj.entities} characters/objects, ${proj.scenes} scenes, ${proj.takes} takes (counts only — no title, no media)`,
    `• Recent logs: secrets and folder paths removed`,
    '',
    'NOT included:  API keys · your song · reference images · generated video · lyrics · prompts · project title · folder paths',
    '',
    opts.includeSceneSummary || opts.includeCompiledPacket || opts.includeMediaFiles
      ? `You chose to also include: ${[opts.includeSceneSummary && 'scene summary', opts.includeCompiledPacket && 'compiled packet', opts.includeMediaFiles && 'media file names'].filter(Boolean).join(', ')}`
      : 'Optional extras: none selected.',
    '',
    `Files: ${files.map((f) => f.relPath).join(', ')}`,
  ].join('\n');
}
