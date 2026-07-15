import {
  CLASSIFIER_VERSION,
  RUBRIC_VERSION,
  hashJson,
} from './contracts.mjs';
import { applyRuleGate } from './rules.mjs';
import { isAcceptedDecision, validateDecision, validateDecisionList } from './decision.mjs';
import { buildTriagePrompt, parseDecisionEnvelope } from './prompt.mjs';
import { runAgentText } from '../agent-runtime.mjs';

const TRANSIENT_REASONS = new Set(['model_unavailable', 'model_invalid', 'model_capacity']);

function relevantProfile(profile = {}) {
  return {
    services: profile.services || {},
    archetypes: Array.isArray(profile.archetypes) ? profile.archetypes : [],
    rate_card: profile.rate_card || {},
    ideal_gig: profile.ideal_gig || {},
  };
}

function metadata(candidate, options, runtimeFingerprint = options.runtimeFingerprint) {
  const profileFingerprint = hashJson(relevantProfile(options.profile));
  const eligibilityFingerprint = hashJson({
    contentHash: candidate.contentHash,
    classifierVersion: CLASSIFIER_VERSION,
    runtimeFingerprint,
  });
  return {
    contentHash: candidate.contentHash,
    classifierVersion: CLASSIFIER_VERSION,
    rubricVersion: RUBRIC_VERSION,
    provider: options.provider,
    runtimeFingerprint,
    profileFingerprint,
    eligibilityFingerprint,
    fitFingerprint: hashJson({ eligibilityFingerprint, profileFingerprint, rubricVersion: RUBRIC_VERSION }),
  };
}

function evidenceRecords(evidence, meaning) {
  return evidence.map((quote) => ({ quote, meaning }));
}

function ruleRecord(candidate, gate, options) {
  return {
    url: candidate.url,
    eligibility: gate.state === 'reject' ? 'rejected' : 'uncertain',
    confidence: gate.state === 'reject' ? 1 : 0,
    intent: 'unknown',
    engagement: 'unknown',
    relationship: 'unknown',
    paid: null,
    evidence: evidenceRecords(gate.evidence, 'deterministic quality-gate evidence'),
    reasonCodes: gate.reasonCodes,
    fit: null,
    origin: 'rule',
    ...metadata(candidate, options),
    evaluatedAt: options.now(),
  };
}

function systemUncertain(candidate, reasonCode, options, issue = null) {
  return {
    url: candidate.url,
    eligibility: 'uncertain',
    confidence: 0,
    intent: 'unknown',
    engagement: 'unknown',
    relationship: 'unknown',
    paid: null,
    evidence: [],
    reasonCodes: [reasonCode],
    fit: null,
    origin: 'system',
    ...metadata(candidate, options),
    evaluatedAt: options.now(),
    ...(issue ? { issue } : {}),
  };
}

function normalizedModelRecord(decision, candidate, options, runtimeFingerprint) {
  let normalized = decision;
  if (decision.confidence < 0.85) {
    normalized = {
      ...decision,
      eligibility: 'uncertain',
      fit: null,
      reasonCodes: [...new Set([...decision.reasonCodes, 'low_confidence'])],
    };
  } else if (decision.eligibility === 'eligible' && !isAcceptedDecision(decision)) {
    normalized = {
      ...decision,
      eligibility: 'uncertain',
      fit: null,
      reasonCodes: [...new Set([...decision.reasonCodes, 'model_invalid'])],
    };
  }
  return {
    ...normalized,
    origin: 'model',
    ...metadata(candidate, options, runtimeFingerprint),
    evaluatedAt: options.now(),
  };
}

function isReusableCache(entry, candidate, options) {
  if (!entry || entry.origin !== 'model') return false;
  if (entry.reasonCodes?.some((code) => TRANSIENT_REASONS.has(code))) return false;
  const expected = metadata(candidate, options);
  if (entry.fitFingerprint !== expected.fitFingerprint) return false;
  try {
    validateDecision(entry, candidate);
    return true;
  } catch {
    return false;
  }
}

function scoreRecord(candidate, decision, now) {
  return {
    title: candidate.title,
    source: candidate.source,
    first_seen: candidate.firstSeen,
    location: candidate.location,
    budget: {
      raw: candidate.compensation.raw,
      min: candidate.compensation.min,
      max: candidate.compensation.max,
      unit: candidate.compensation.cadence,
    },
    score: decision.fit.score,
    blocks: decision.fit.blocks,
    reasons: decision.fit.reasons,
    redFlags: decision.fit.redFlags,
    verdict: decision.fit.verdict,
    eligibility: 'eligible',
    confidence: decision.confidence,
    state: 'evaluated',
    contentHash: decision.contentHash,
    classifierVersion: decision.classifierVersion,
    rubricVersion: decision.rubricVersion,
    provider: decision.provider,
    runtimeFingerprint: decision.runtimeFingerprint,
    profileFingerprint: decision.profileFingerprint,
    eligibilityFingerprint: decision.eligibilityFingerprint,
    fitFingerprint: decision.fitFingerprint,
    report: null,
    scoredAt: now(),
  };
}

async function defaultRunModel(batch, context) {
  const prompt = buildTriagePrompt(batch, context.profile);
  const response = await runAgentText({ provider: context.provider, prompt, timeoutMs: context.timeoutMs });
  return {
    decisions: parseDecisionEnvelope(response.text),
    runtimeFingerprint: response.runtimeFingerprint,
  };
}

function modelResponse(value, fallbackFingerprint) {
  if (Array.isArray(value)) return { decisions: value, runtimeFingerprint: fallbackFingerprint };
  if (Array.isArray(value?.decisions)) {
    return { decisions: value.decisions, runtimeFingerprint: value.runtimeFingerprint || fallbackFingerprint };
  }
  if (typeof value?.text === 'string') {
    return {
      decisions: parseDecisionEnvelope(value.text),
      runtimeFingerprint: value.runtimeFingerprint || fallbackFingerprint,
    };
  }
  throw new Error('model runner returned neither decisions nor text');
}

function likelyUnavailable(error) {
  return /offline|unavailable|authentication|timed out|timeout|exited|spawn|enoent|usage limit|rate limit|quota|credits/i
    .test(String(error?.message || error));
}

function survivorOrder(a, b) {
  const paidA = Number(Number.isFinite(a.compensation?.max));
  const paidB = Number(Number.isFinite(b.compensation?.max));
  return paidB - paidA
    || (b.sourceSignals?.length || 0) - (a.sourceSignals?.length || 0)
    || b.description.length - a.description.length
    || a.url.localeCompare(b.url);
}

export async function triageCandidates(candidates, {
  profile = {},
  provider = process.env.GIGOPS_AGENT_PROVIDER || 'claude',
  runtimeFingerprint = `${provider}:default`,
  cache = {},
  reclassify = false,
  maxModelCandidates = 30,
  batchSize = 10,
  timeoutMs = 300_000,
  now = () => new Date().toISOString(),
  runModel = defaultRunModel,
} = {}) {
  const options = { profile, provider, runtimeFingerprint, timeoutMs, now };
  const decisions = {};
  const scores = {};
  const accepted = [];
  const rejected = [];
  const uncertain = [];
  const issues = [];
  const survivors = [];
  const metrics = {
    fetched: candidates.length,
    ruleRejected: 0,
    ruleQuarantined: 0,
    modelEvaluated: 0,
    modelCalls: 0,
    cached: 0,
    accepted: 0,
    rejected: 0,
    quarantined: 0,
    capacityDeferred: 0,
    bySource: Object.create(null),
  };

  for (const candidate of candidates) {
    const source = candidate.source || 'unknown';
    metrics.bySource[source] ||= { fetched: 0, accepted: 0, rejected: 0, quarantined: 0 };
    metrics.bySource[source].fetched += 1;
  }

  const classifyRecord = (candidate, record) => {
    decisions[candidate.url] = record;
    const sourceMetrics = metrics.bySource[candidate.source || 'unknown'];
    if (record.eligibility === 'rejected') {
      rejected.push(candidate);
      sourceMetrics.rejected += 1;
    }
    else if (isAcceptedDecision(record)) {
      accepted.push(candidate);
      scores[candidate.url] = scoreRecord(candidate, record, now);
      sourceMetrics.accepted += 1;
    } else {
      uncertain.push(candidate);
      sourceMetrics.quarantined += 1;
    }
  };

  for (const candidate of candidates) {
    const gate = applyRuleGate(candidate, profile);
    if (gate.state === 'reject') {
      metrics.ruleRejected += 1;
      classifyRecord(candidate, ruleRecord(candidate, gate, options));
    } else if (gate.state === 'quarantine') {
      metrics.ruleQuarantined += 1;
      classifyRecord(candidate, ruleRecord(candidate, gate, options));
    } else if (!reclassify && isReusableCache(cache[candidate.url], candidate, options)) {
      metrics.cached += 1;
      classifyRecord(candidate, cache[candidate.url]);
    } else {
      survivors.push(candidate);
    }
  }

  survivors.sort(survivorOrder);
  const toEvaluate = survivors.slice(0, maxModelCandidates);
  const overflow = survivors.slice(maxModelCandidates);
  for (const candidate of overflow) {
    metrics.capacityDeferred += 1;
    classifyRecord(candidate, systemUncertain(candidate, 'model_capacity', options));
  }

  for (let offset = 0; offset < toEvaluate.length; offset += batchSize) {
    const batch = toEvaluate.slice(offset, offset + batchSize);
    let validated = null;
    let effectiveFingerprint = runtimeFingerprint;
    let lastError = null;
    for (let attempt = 0; attempt < 2 && !validated; attempt += 1) {
      metrics.modelCalls += 1;
      try {
        const raw = await runModel(batch, { profile, provider, timeoutMs, attempt });
        const response = modelResponse(raw, runtimeFingerprint);
        effectiveFingerprint = response.runtimeFingerprint;
        validated = validateDecisionList(response.decisions, batch);
      } catch (error) {
        lastError = error;
        if (likelyUnavailable(error)) break;
      }
    }

    if (!validated) {
      const reason = likelyUnavailable(lastError) ? 'model_unavailable' : 'model_invalid';
      issues.push(`Model triage failed for ${batch.length} candidate(s): ${lastError?.message || lastError}`);
      for (const candidate of batch) classifyRecord(candidate, systemUncertain(candidate, reason, options, lastError?.message));
      continue;
    }

    metrics.modelEvaluated += batch.length;
    for (let index = 0; index < batch.length; index += 1) {
      const candidate = batch[index];
      classifyRecord(candidate, normalizedModelRecord(validated[index], candidate, options, effectiveFingerprint));
    }
  }

  metrics.accepted = accepted.length;
  metrics.rejected = rejected.length;
  metrics.quarantined = uncertain.length;
  return {
    accepted,
    rejected,
    uncertain,
    candidates: Object.fromEntries(candidates.map((candidate) => [candidate.url, candidate])),
    decisions,
    scores,
    metrics,
    issues,
  };
}
