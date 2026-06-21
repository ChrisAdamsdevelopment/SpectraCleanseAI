import { describe, expect, it } from 'vitest';
const { makeFinding, CATEGORY, SEVERITY, CHECK_STATUS, BUSINESS_IMPACT } = require('../server/readiness/findings');
const { scoreFindings } = require('../server/readiness/scoring');
const { decideVerdict, STATUS } = require('../server/readiness/verdict');
const { evaluateCondition, evaluateRules } = require('../server/readiness/ruleRegistry');
const { generateReport, prioritize } = require('../server/readiness/report');
const providers = require('../server/readiness/providers');

const fail = (over: any = {}) => makeFinding({
  id: 'metadata.missing_artist', category: CATEGORY.METADATA, severity: SEVERITY.CRITICAL,
  status: CHECK_STATUS.FAIL, confidence: 1, title: 't', what: 'w', why: 'y',
  businessImpact: BUSINESS_IMPACT.REVENUE_WITHHELD, howToFix: 'fix', scoreImpact: 40, ...over,
});

describe('findings.makeFinding', () => {
  it('rejects unknown enums', () => {
    expect(() => makeFinding({ id: 'x', category: 'nope', severity: 'critical', status: 'fail' })).toThrow();
    expect(() => makeFinding({ id: 'x', category: CATEGORY.METADATA, severity: 'huge', status: 'fail' })).toThrow();
  });
  it('clamps confidence to 0..1 and defaults to 1', () => {
    expect(makeFinding({ id: 'x', category: CATEGORY.METADATA, severity: SEVERITY.INFO, status: CHECK_STATUS.PASS }).confidence).toBe(1);
    expect(fail({ confidence: 5 }).confidence).toBe(1);
    expect(fail({ confidence: -2 }).confidence).toBe(0);
  });
});

describe('scoring', () => {
  it('deducts scoreImpact x confidence', () => {
    expect(scoreFindings([fail({ confidence: 1 })], [CATEGORY.METADATA]).categoryScores[0].score).toBe(60);
    expect(scoreFindings([fail({ confidence: 0.5 })], [CATEGORY.METADATA]).categoryScores[0].score).toBe(80);
  });
  it('ignores info/pass findings', () => {
    const info = fail({ severity: SEVERITY.INFO, status: CHECK_STATUS.PASS, scoreImpact: 40 });
    expect(scoreFindings([info], [CATEGORY.METADATA]).categoryScores[0].score).toBe(100);
  });
  it('overall renormalizes over assessed categories only', () => {
    // only metadata assessed -> overall equals the metadata score
    const r = scoreFindings([fail({ confidence: 1 })], [CATEGORY.METADATA]);
    expect(r.overallScore).toBe(60);
  });
});

describe('verdict', () => {
  it('a confident critical fail forces high_risk regardless of score', () => {
    const v = decideVerdict({ findings: [fail()], overallScore: 95, assessedCategories: [CATEGORY.METADATA, CATEGORY.RIGHTS, CATEGORY.PLATFORM_COMPLIANCE] });
    expect(v.status).toBe(STATUS.HIGH_RISK);
  });
  it('never returns ready when a required category is not assessed (honesty cap)', () => {
    const v = decideVerdict({ findings: [], overallScore: 100, assessedCategories: [CATEGORY.METADATA] });
    expect(v.status).toBe(STATUS.NEEDS_ATTENTION);
    expect(v.notAssessed).toContain(CATEGORY.RIGHTS);
    expect(v.rationale.join(' ')).toMatch(/not fully assessed/i);
  });
  it('strict threshold: score 88 with all required assessed is needs_attention', () => {
    const v = decideVerdict({ findings: [], overallScore: 88, assessedCategories: [CATEGORY.METADATA, CATEGORY.RIGHTS, CATEGORY.PLATFORM_COMPLIANCE] });
    expect(v.status).toBe(STATUS.NEEDS_ATTENTION);
  });
  it('ready when all required assessed, no issues, score high', () => {
    const v = decideVerdict({ findings: [], overallScore: 100, assessedCategories: [CATEGORY.METADATA, CATEGORY.RIGHTS, CATEGORY.PLATFORM_COMPLIANCE] });
    expect(v.status).toBe(STATUS.READY);
  });
});

describe('rule registry conditions', () => {
  const ctx = { metadata: { title: 'Song', artist: '', genre: 'trap' } };
  it('field operators', () => {
    expect(evaluateCondition({ field: 'metadata.title', op: 'present' }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'metadata.artist', op: 'present' }, ctx)).toBe(false);
    expect(evaluateCondition({ field: 'metadata.artist', op: 'absent' }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'metadata.genre', op: 'in', value: ['trap', 'house'] }, ctx)).toBe(true);
    expect(evaluateCondition({ field: 'metadata.title', op: 'matches', value: 'song' }, ctx)).toBe(true);
  });
  it('all / any / not combinators', () => {
    expect(evaluateCondition({ all: [{ field: 'metadata.title', op: 'present' }, { field: 'metadata.genre', op: 'present' }] }, ctx)).toBe(true);
    expect(evaluateCondition({ any: [{ field: 'metadata.artist', op: 'present' }, { field: 'metadata.title', op: 'present' }] }, ctx)).toBe(true);
    expect(evaluateCondition({ not: { field: 'metadata.artist', op: 'present' } }, ctx)).toBe(true);
  });
  it('emits a finding when assertion is false, tagged with rule ref + version', () => {
    const pack = {
      registryId: 'spotify', version: 'v1', rules: [{
        id: 'spotify.artist_required', category: CATEGORY.PLATFORM_COMPLIANCE, severity: SEVERITY.CRITICAL,
        scoreImpact: 50, businessImpact: BUSINESS_IMPACT.REJECTION,
        assertion: { field: 'metadata.artist', op: 'present' },
        title: 'Artist required', what: 'w', why: 'y', howToFix: 'add artist',
      }],
    };
    const out = evaluateRules(ctx, pack);
    expect(out).toHaveLength(1);
    expect(out[0].ruleRef).toEqual({ registryId: 'spotify', version: 'v1' });
  });
  it('respects appliesWhen precondition', () => {
    const pack = { version: 'v1', rules: [{
      id: 'x.only_when', category: CATEGORY.PLATFORM_COMPLIANCE, severity: SEVERITY.WARNING, scoreImpact: 10,
      appliesWhen: { field: 'metadata.nonexistent', op: 'present' },
      assertion: { field: 'metadata.artist', op: 'present' },
      title: 't', what: 'w', why: 'y', howToFix: 'h',
    }] };
    expect(evaluateRules(ctx, pack)).toHaveLength(0);
  });
});

describe('report generation (end to end)', () => {
  const metaProvider = { category: CATEGORY.METADATA, featureFlag: 'metadata_validation', evaluate: () => [fail()] };
  const rightsProvider = { category: CATEGORY.RIGHTS, featureFlag: 'rights_verification', evaluate: () => [] };
  const platformProvider = {
    category: CATEGORY.PLATFORM_COMPLIANCE, featureFlag: 'platform_compliance',
    evaluate: () => [makeFinding({ id: 'platform.warn', category: CATEGORY.PLATFORM_COMPLIANCE, severity: SEVERITY.WARNING, status: CHECK_STATUS.WARN, confidence: 1, title: 't', what: 'w', why: 'y', businessImpact: BUSINESS_IMPACT.REDUCED_REACH, howToFix: 'h', scoreImpact: 10 })],
  };

  it('produces a full report with all five categories and not_assessed honesty', async () => {
    const report = await generateReport({ releaseId: 1, context: { metadata: {} }, providers: [metaProvider, rightsProvider, platformProvider], ruleRegistryVersion: 'test-1' });
    expect(report.categoryScores).toHaveLength(5);
    const ai = report.categoryScores.find((c: any) => c.category === CATEGORY.AI_DISCLOSURE);
    expect(ai.status).toBe('not_assessed');
    expect(ai.score).toBeNull();
    expect(report.verdict.status).toBe(STATUS.HIGH_RISK); // critical metadata fail
    expect(report.engineVersion).toBeTruthy();
    expect(report.ruleRegistryVersion).toBe('test-1');
    // refinements: plain-English label, score-gain-if-resolved, top issues
    expect(typeof report.scoreLabel).toBe('string');
    expect(report.categoryScores.every((c: any) => typeof c.label === 'string')).toBe(true);
    expect(report.prioritizedFixes[0].scoreGainIfResolved).toBeGreaterThan(0);
    expect(report.topIssues.length).toBeGreaterThan(0);
    expect(report.topIssues[0]).toHaveProperty('title');
  });

  it('prioritizes critical before warning', () => {
    const out = prioritize([
      makeFinding({ id: 'a', category: CATEGORY.PLATFORM_COMPLIANCE, severity: SEVERITY.WARNING, status: CHECK_STATUS.WARN, businessImpact: BUSINESS_IMPACT.REDUCED_REACH, scoreImpact: 10, title: 't', what: 'w', why: 'y', howToFix: 'h' }),
      fail(),
    ]);
    expect(out[0].severity).toBe(SEVERITY.CRITICAL);
  });
});

describe('provider registry gating', () => {
  it('only returns providers whose flag is enabled', () => {
    providers._reset();
    providers.registerProvider({ category: CATEGORY.METADATA, featureFlag: 'metadata_validation', evaluate: () => [] });
    providers.registerProvider({ category: CATEGORY.RIGHTS, featureFlag: 'rights_verification', evaluate: () => [] });
    const enabled = providers.getEnabledProviders({ FEATURES: 'metadata_validation' });
    expect(enabled).toHaveLength(1);
    expect(enabled[0].category).toBe(CATEGORY.METADATA);
    providers._reset();
  });
});
