// SAFE DECLARATIVE TOOL SYSTEM (DEC-003 §5). AI-generated directing tools are
// pure DATA validated against an allowlist. There is no path from a tool
// definition to executable code: unknown primitives are rejected (not coerced),
// suspicious keys are rejected, and only validated definitions can be
// installed. The same validator guards AI responses, manual imports, and
// shared packages.

import { TOOL_FIELD_KINDS, type DirectorTool, type ToolField, type EntityType } from './model';
import { makeOutputId } from '../project/types';

export interface ToolValidation {
  ok: boolean;
  tool: DirectorTool | null;
  errors: string[];
}

const FORBIDDEN_KEYS = /^(script|code|html|eval|handler|callback|component|render|on[A-Z].*)$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;              // field ids (safe slugs)
const OUTPUT_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/; // output labels (camelCase ok)
const APPLIES = new Set(['scene', 'person', 'character', 'object', 'prop', 'wardrobe', 'jewelry', 'tattoo', 'vehicle', 'building', 'location', 'environment', 'creature', 'style']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function scanForbiddenKeys(v: unknown, path: string, errors: string[]): void {
  if (Array.isArray(v)) { v.forEach((x, i) => scanForbiddenKeys(x, `${path}[${i}]`, errors)); return; }
  if (!isRecord(v)) return;
  for (const [k, val] of Object.entries(v)) {
    if (FORBIDDEN_KEYS.test(k)) errors.push(`forbidden key "${k}" at ${path}`);
    scanForbiddenKeys(val, `${path}.${k}`, errors);
  }
}

function validateField(v: unknown, i: number, errors: string[]): ToolField | null {
  if (!isRecord(v)) { errors.push(`field[${i}] is not an object`); return null; }
  if (typeof v.id !== 'string' || !ID_PATTERN.test(v.id)) { errors.push(`field[${i}].id must match ${ID_PATTERN}`); return null; }
  if (typeof v.label !== 'string' || !v.label.trim() || v.label.length > 120) { errors.push(`field[${i}].label missing or too long`); return null; }
  if (!(TOOL_FIELD_KINDS as readonly string[]).includes(v.kind as string)) {
    errors.push(`field[${i}].kind "${String(v.kind)}" is not an allowlisted primitive`);
    return null;
  }
  const kind = v.kind as ToolField['kind'];
  const f: ToolField = { id: v.id, kind, label: v.label };
  if (typeof v.help === 'string' && v.help.length <= 400) f.help = v.help;
  if (kind === 'range' || kind === 'scale') {
    if (typeof v.min === 'number') f.min = v.min;
    if (typeof v.max === 'number') f.max = v.max;
    if (typeof v.step === 'number' && v.step > 0) f.step = v.step;
    if ((f.min ?? 0) >= (f.max ?? 1) && kind === 'range') { errors.push(`field[${i}] range min must be < max`); return null; }
  }
  if (kind === 'scale' && Array.isArray(v.labels)) f.labels = v.labels.filter((x): x is string => typeof x === 'string').slice(0, 12);
  if (kind === 'choice') {
    const options = Array.isArray(v.options) ? v.options.filter((x): x is string => typeof x === 'string') : [];
    if (options.length < 2 || options.length > 24) { errors.push(`field[${i}] choice needs 2..24 options`); return null; }
    f.options = options;
  }
  if ((kind === 'steps' || kind === 'image-board' || kind === 'pose-sequence') && typeof v.maxItems === 'number') {
    f.maxItems = Math.min(32, Math.max(1, Math.floor(v.maxItems)));
  }
  if (kind === 'preserve-vary') {
    f.rows = Array.isArray(v.rows) ? v.rows.filter((x): x is string => typeof x === 'string').slice(0, 24) : [];
    if (f.rows.length === 0) { errors.push(`field[${i}] preserve-vary needs rows`); return null; }
  }
  if ((kind === 'beat-grid' || kind === 'pose-sequence') && typeof v.beats === 'number') {
    f.beats = Math.min(64, Math.max(1, Math.floor(v.beats)));
  }
  if (kind === 'body-map') {
    f.regions = Array.isArray(v.regions) ? v.regions.filter((x): x is string => typeof x === 'string').slice(0, 32) : [];
    if (f.regions.length === 0) { errors.push(`field[${i}] body-map needs regions`); return null; }
  }
  return f;
}

/** STRICT validation — rejects, never coerces. Use for AI responses, manual
 * imports, and shared packages before a tool can be installed. */
export function validateToolDefinition(value: unknown): ToolValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, tool: null, errors: ['tool definition is not an object'] };
  scanForbiddenKeys(value, 'tool', errors);
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) errors.push('name missing or too long');
  if (typeof value.description !== 'string' || value.description.length > 600) errors.push('description missing or too long');
  const appliesTo = Array.isArray(value.appliesTo) ? value.appliesTo.filter((x): x is string => typeof x === 'string' && APPLIES.has(x)) : [];
  if (appliesTo.length === 0) errors.push('appliesTo must include at least one of: scene or an entity type');
  const rawFields = Array.isArray(value.fields) ? value.fields : [];
  if (rawFields.length === 0 || rawFields.length > 16) errors.push('fields must contain 1..16 entries');
  const fields = rawFields.map((f, i) => validateField(f, i, errors)).filter((f): f is ToolField => Boolean(f));
  if (fields.length !== rawFields.length) errors.push('one or more fields were rejected');
  const ids = new Set(fields.map((f) => f.id));
  if (ids.size !== fields.length) errors.push('field ids must be unique');
  const outputSchema: Record<string, string> = {};
  if (isRecord(value.outputSchema)) {
    for (const [k, v] of Object.entries(value.outputSchema)) {
      if (!OUTPUT_KEY_PATTERN.test(k)) { errors.push(`outputSchema key "${k}" invalid`); continue; }
      if (typeof v !== 'string' || !ids.has(v)) { errors.push(`outputSchema."${k}" must reference a field id`); continue; }
      outputSchema[k] = v;
    }
  }
  if (Object.keys(outputSchema).length === 0) errors.push('outputSchema must map at least one output key to a field id');
  const conflictRules = Array.isArray(value.conflictRules) ? value.conflictRules.filter((x): x is string => typeof x === 'string').slice(0, 12) : [];
  const compileHints = typeof value.compileHints === 'string' ? value.compileHints.slice(0, 1200) : '';

  if (errors.length > 0) return { ok: false, tool: null, errors };
  return {
    ok: true, errors: [],
    tool: {
      id: makeOutputId(),
      name: value.name as string,
      description: value.description as string,
      version: 1,
      appliesTo: appliesTo as Array<'scene' | EntityType>,
      fields, outputSchema, conflictRules, compileHints,
      usageCount: 0, importedFrom: null, createdAt: new Date().toISOString(),
    },
  };
}

/** The exact prompt sent to a text model (and shipped in the manual package)
 * to produce a tool definition. The contract is identical either way. */
export function toolGenerationPrompt(creatorRequest: string, refinement?: string, previousJson?: string): string {
  return [
    'You are designing a DIRECTING TOOL for Song Studio, a music-video directing app.',
    'The creator described a directing intention the current controls cannot express.',
    'Return ONLY a JSON object (no prose, no markdown fence) with this exact shape:',
    '{ "name": string(<=80), "description": string(<=600),',
    '  "appliesTo": ["scene" | "person" | "character" | "object" | "prop" | "wardrobe" | "jewelry" | "tattoo" | "vehicle" | "building" | "location" | "environment" | "creature" | "style"],',
    '  "fields": [ { "id": lowercase-slug, "kind": one of',
    `    ${TOOL_FIELD_KINDS.join(' | ')},`,
    '    "label": string, "help"?: string, "min"?: number, "max"?: number, "step"?: number,',
    '    "labels"?: string[], "options"?: string[], "maxItems"?: number, "rows"?: string[],',
    '    "beats"?: number, "regions"?: string[] } ],',
    '  "outputSchema": { outputKey: fieldId, ... },',
    '  "conflictRules": string[], "compileHints": string }',
    'Rules: fields must ONLY use the allowlisted kinds above. Never include code,',
    'scripts, HTML, or event handlers. Prefer director language over technical jargon.',
    'Use "pose-sequence" for body movement over beats, "beat-grid" for rhythm placement,',
    '"preserve-vary" for what must stay vs may change, "body-map" for body locations.',
    '',
    `CREATOR REQUEST: ${creatorRequest}`,
    refinement ? `REFINEMENT: ${refinement}` : '',
    previousJson ? `PREVIOUS VERSION (refine this): ${previousJson}` : '',
  ].filter(Boolean).join('\n');
}

/** Extract the first JSON object from model text and validate it. */
export function parseToolFromModelText(text: string): ToolValidation {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, tool: null, errors: ['no JSON object found in model response'] };
  try {
    return validateToolDefinition(JSON.parse(text.slice(start, end + 1)));
  } catch (e) {
    return { ok: false, tool: null, errors: [`invalid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

// ── Shareable tool packages (local export/import; registry-ready format) ────

export interface ToolPackage {
  format: 'songstudio-directing-tool';
  formatVersion: 1;
  exportedAt: string;
  tool: Omit<DirectorTool, 'usageCount' | 'importedFrom'>;
}

export function exportToolPackage(tool: DirectorTool): ToolPackage {
  const { usageCount: _u, importedFrom: _i, ...rest } = tool;
  return { format: 'songstudio-directing-tool', formatVersion: 1, exportedAt: new Date().toISOString(), tool: rest };
}

export function importToolPackage(value: unknown, source: string): ToolValidation {
  if (!isRecord(value) || value.format !== 'songstudio-directing-tool') {
    return { ok: false, tool: null, errors: ['not a Song Studio directing-tool package'] };
  }
  const res = validateToolDefinition(value.tool);
  if (res.ok && res.tool) res.tool.importedFrom = source;
  return res;
}
