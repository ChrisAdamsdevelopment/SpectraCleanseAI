"use strict";

/**
 * Compliance rule registry engine. Platform/distributor policies are DATA
 * (versioned JSON rule packs), evaluated by this generic engine — no hardcoded
 * platform logic anywhere else. See release-readiness-spec.md §5.
 *
 * Conditions are a small declarative AST. There is NO eval — every operator is
 * an explicit, safe function.
 */

const { makeFinding } = require('./findings');

/** Resolve a dot-path ("metadata.title") against the release context. */
function getField(context, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), context);
}

function asString(value) {
  return value == null ? '' : String(value);
}

const OPS = {
  present: (v) => v != null && asString(v).trim() !== '',
  absent: (v) => v == null || asString(v).trim() === '',
  eq: (v, expected) => v === expected,
  in: (v, list) => Array.isArray(list) && list.includes(v),
  gt: (v, n) => Number(v) > Number(n),
  lt: (v, n) => Number(v) < Number(n),
  matches: (v, pattern) => new RegExp(pattern, 'i').test(asString(v)),
  not_matches: (v, pattern) => !new RegExp(pattern, 'i').test(asString(v)),
};

/** Evaluate a Condition node to a boolean. Unknown shapes evaluate to false. */
function evaluateCondition(condition, context) {
  if (!condition || typeof condition !== 'object') return false;
  if (Array.isArray(condition.all)) return condition.all.every((c) => evaluateCondition(c, context));
  if (Array.isArray(condition.any)) return condition.any.some((c) => evaluateCondition(c, context));
  if (condition.not) return !evaluateCondition(condition.not, context);
  if (typeof condition.field === 'string' && typeof condition.op === 'string') {
    const op = OPS[condition.op];
    if (!op) return false;
    return Boolean(op(getField(context, condition.field), condition.value));
  }
  return false;
}

/**
 * Evaluate a rule pack against a context.
 * @param {object} context  the ReleaseContext
 * @param {{ registryId?:string, version?:string, rules:Array }} pack
 * @returns {Array} findings (one per failed rule)
 */
function evaluateRules(context, pack = {}) {
  const rules = Array.isArray(pack.rules) ? pack.rules : [];
  const version = pack.version || 'unversioned';
  const registryId = pack.registryId || 'rules';
  const findings = [];

  for (const rule of rules) {
    if (rule.appliesWhen && !evaluateCondition(rule.appliesWhen, context)) continue;
    const compliant = evaluateCondition(rule.assertion, context);
    if (compliant) continue;
    findings.push(makeFinding({
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      status: 'fail',
      confidence: rule.confidence == null ? 1 : rule.confidence,
      title: rule.title,
      what: rule.what,
      why: rule.why,
      businessImpact: rule.businessImpact,
      howToFix: rule.howToFix,
      scoreImpact: rule.scoreImpact,
      field: rule.field,
      learnMoreId: rule.learnMoreId,
      ruleRef: { registryId: rule.registryId || registryId, version },
    }));
  }
  return findings;
}

module.exports = { evaluateCondition, evaluateRules, getField };
