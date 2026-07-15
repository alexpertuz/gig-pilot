import { candidateText, normalizeText } from './contracts.mjs';

const ELIGIBILITY = new Set(['eligible', 'rejected', 'uncertain']);
const INTENT = new Set(['client_hiring', 'worker_seeking', 'discussion', 'promotion', 'unknown']);
const ENGAGEMENT = new Set(['freelance', 'project', 'contract', 'part_time', 'full_time', 'unpaid', 'unknown']);
const RELATIONSHIP = new Set(['independent', 'employee', 'unknown']);
const VERDICT = new Set(['GO', 'NEGOTIATE', 'DECLINE']);
const BLOCKS = ['A', 'B', 'C', 'D', 'E', 'F'];
const WEIGHTS = { A: 0.25, B: 0.25, C: 0.2, D: 0.15, E: 0.1, F: 0.05 };

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function enumValue(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`${label} must be one of: ${[...allowed].join(', ')}`);
  }
  return value;
}

function boundedNumber(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a number from ${min} to ${max}`);
  }
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value.map((item) => normalizeText(item, 500));
}

function expectedVerdict(score, blocks) {
  if (blocks.B === 1) return 'DECLINE';
  if (score >= 4) return 'GO';
  if (score >= 3) return 'NEGOTIATE';
  return 'DECLINE';
}

function validateFit(value) {
  const fit = object(value, 'fit');
  const score = boundedNumber(fit.score, 1, 5, 'fit score');
  const blocksInput = object(fit.blocks, 'fit blocks');
  const blocks = {};
  for (const name of BLOCKS) blocks[name] = boundedNumber(blocksInput[name], 1, 5, `fit blocks: block ${name}`);

  const verdict = enumValue(fit.verdict, VERDICT, 'fit verdict');
  const requiredVerdict = expectedVerdict(score, blocks);
  if (verdict !== requiredVerdict) {
    throw new Error(`fit verdict ${verdict} is inconsistent with score ${score}; expected ${requiredVerdict}`);
  }

  const weighted = BLOCKS.reduce((total, name) => total + blocks[name] * WEIGHTS[name], 0);
  if (Math.abs(weighted - score) > 0.15) {
    throw new Error(`fit score ${score} does not match weighted blocks (${weighted.toFixed(2)})`);
  }

  return {
    score,
    blocks,
    reasons: stringArray(fit.reasons, 'fit reasons'),
    redFlags: stringArray(fit.redFlags, 'fit redFlags'),
    verdict,
  };
}

function validateEvidence(value, candidate) {
  if (!Array.isArray(value)) throw new Error('evidence must be an array');
  const sourceText = candidateText(candidate).toLocaleLowerCase();
  return value.map((entry, index) => {
    const item = object(entry, `evidence ${index}`);
    const quote = normalizeText(item.quote, 500);
    const meaning = normalizeText(item.meaning, 500);
    if (!quote || !meaning) throw new Error(`evidence ${index} requires quote and meaning`);
    if (!sourceText.includes(quote.toLocaleLowerCase())) {
      throw new Error(`evidence quote was not found in candidate content: ${quote}`);
    }
    return { quote, meaning };
  });
}

export function validateDecision(raw, candidate) {
  const input = object(raw, 'decision');
  if (input.url !== candidate.url) throw new Error(`decision URL does not match candidate URL: ${input.url}`);
  const eligibility = enumValue(input.eligibility, ELIGIBILITY, 'eligibility');
  const confidence = boundedNumber(input.confidence, 0, 1, 'confidence');
  const intent = enumValue(input.intent, INTENT, 'intent');
  const engagement = enumValue(input.engagement, ENGAGEMENT, 'engagement');
  const relationship = enumValue(input.relationship, RELATIONSHIP, 'relationship');
  if (input.paid !== true && input.paid !== false && input.paid !== null) {
    throw new Error('paid must be true, false, or null');
  }
  const evidence = validateEvidence(input.evidence, candidate);
  const reasonCodes = stringArray(input.reasonCodes, 'reasonCodes');
  const fit = input.fit == null ? null : validateFit(input.fit);

  if (eligibility === 'eligible' && fit === null) throw new Error('eligible decisions require a complete fit score');
  if (eligibility !== 'eligible' && fit !== null) throw new Error(`${eligibility} decisions must not include fit`);

  return {
    url: candidate.url,
    eligibility,
    confidence,
    intent,
    engagement,
    relationship,
    paid: input.paid,
    evidence,
    reasonCodes,
    fit,
  };
}

export function isAcceptedDecision(decision) {
  return decision?.eligibility === 'eligible'
    && decision.confidence >= 0.85
    && decision.intent === 'client_hiring'
    && decision.relationship === 'independent'
    && ['freelance', 'project', 'contract'].includes(decision.engagement)
    && decision.paid === true
    && Array.isArray(decision.evidence)
    && decision.evidence.length > 0
    && decision.fit !== null;
}

export function validateDecisionList(rawDecisions, candidates) {
  if (!Array.isArray(rawDecisions)) throw new Error('model response must be a decision array');
  const byUrl = new Map(candidates.map((candidate) => [candidate.url, candidate]));
  const seen = new Set();
  const validated = [];
  for (const raw of rawDecisions) {
    if (!raw || typeof raw.url !== 'string' || !byUrl.has(raw.url)) {
      throw new Error(`model returned an unknown URL: ${raw?.url ?? '<missing>'}`);
    }
    if (seen.has(raw.url)) throw new Error(`model returned duplicate URL: ${raw.url}`);
    seen.add(raw.url);
    validated.push(validateDecision(raw, byUrl.get(raw.url)));
  }
  const missing = [...byUrl.keys()].filter((url) => !seen.has(url));
  if (missing.length > 0) throw new Error(`model response is missing ${missing.length} candidate URL(s)`);
  return validated;
}
