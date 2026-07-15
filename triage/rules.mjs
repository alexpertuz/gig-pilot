import { candidateText, normalizeText } from './contracts.mjs';

const SUPPLY_SIDE = [
  /\[for hire\]/i,
  /\b(?:seeking|looking for)\s+(?:a\s+)?(?:job|work|employment|clients?)\b/i,
  /\bhire me\b/i,
  /\bi(?:'m| am)\s+available\s+for\b/i,
  /\bi specialize in\b/i,
  /\bmy services\b/i,
  /\b(?:resume|curriculum vitae|portfolio and cv|my cv)\b/i,
  /\bbusco\s+(?:trabajo|empleo|clientes?)\b/i,
  /\bestoy\s+disponible\s+para\s+trabajar\b/i,
];

const CLIENT_DEMAND = [
  /\[hiring\]/i,
  /\blooking to hire\b/i,
  /\b(?:we|i)\s+(?:are\s+)?hiring\b/i,
  /\b(?:we|i)\s+need\s+(?:an?\s+)?(?:developer|designer|engineer|consultant|contractor|freelancer|someone|person|team|agency)\b/i,
  /\bneed\s+(?:an?\s+)?(?:(?:product|technical|software|mobile|frontend|backend|react|python|independent)\s+)?(?:developer|designer|engineer|consultant|contractor|freelancer)\b/i,
  /\bneed someone to\b/i,
  /\bseeking\s+(?:an?\s+)?(?:developer|designer|engineer|consultant|contractor|freelancer|agency)\b/i,
  /\bbusc(?:o|amos)\s+(?:un(?:a)?\s+)?(?:desarrollador|diseñador|ingeniero|consultor|freelancer|agencia|persona)\b/i,
  /\bnecesito\s+contratar\b/i,
  /\bcontratar\s+a\s+alguien\b/i,
];

const DELIVERABLE = [
  /\b(?:build|develop|integrate|implement|fix|audit|review|design|create|configure|migrate|ship|deliver|refactor|secure|deploy)\b/i,
  /\b(?:construir|desarrollar|integrar|implementar|arreglar|auditar|revisar|diseñar|crear|configurar|migrar|entregar|desplegar)\b/i,
];

const DISCUSSION = [
  /\b(?:need|seeking)\s+(?:some\s+)?advice\b/i,
  /\b(?:advice|tips)\b/i,
  /\b(?:password|login|cashout|payment)\s+(?:problem|issue|reset)\b/i,
  /\b(?:how|why|what|does|should|can)\b[^?]{0,120}\?/i,
  /\banyone\b[^?]{0,120}\?/i,
  /\b(?:aprender|consejos|recomiendan|problema|curso)\b/i,
  /\b(?:troubleshoot|having the same problem|help me understand)\b/i,
];

const FULL_TIME = [
  /\bfull[ -]?time\b/i,
  /\bpermanent\s+(?:employee|position|role)\b/i,
  /\bsalaried\b/i,
  /\bemployee\s+(?:role|position|with)\b/i,
  /\bhealth benefits\b/i,
  /\bcontrato indefinido\b/i,
];

const UNPAID = [
  /\bunpaid\b/i,
  /\bfor (?:your )?portfolio\b/i,
  /\bfor exposure\b/i,
  /\bequity only\b/i,
  /\brevenue share only\b/i,
  /\bno budget\b/i,
  /\bvolunteer\b/i,
];

const CONTINGENT_COMPENSATION = [
  /\bcommission[- ](?:based|only)\b/i,
  /\b\d+(?:\s*[-–]\s*\d+)?%\s+per\s+(?:close|sale|conversion)\b/i,
  /\b(?:revenue|profit)\s+share\b/i,
  /\bsuccess fee only\b/i,
  /\b(?:paid|pay|compensation)\s+(?:is\s+)?based on performance\b/i,
  /\bperformance[- ]based\s+(?:pay|compensation)\b/i,
];

const SCAM = [
  /\bdaily income\b/i,
  /\bturn your charm\b/i,
  /\bearn\s+\d+%\b/i,
  /\bcopy[ -]?paste\b/i,
  /\bpassive income\b/i,
  /\bno upfront needed\b/i,
  /\bpay a fee to (?:start|apply)\b/i,
];

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0];
  }
  return null;
}

function result(state, reasonCodes = [], evidence = []) {
  return { state, reasonCodes: [...new Set(reasonCodes)], evidence: [...new Set(evidence.filter(Boolean))] };
}

function sourceKey(candidate) {
  const source = normalizeText(candidate?.source, 120).toLowerCase();
  if (source.startsWith('r/')) return source;
  try {
    const url = new URL(candidate.url);
    const subreddit = url.pathname.match(/^\/r\/([^/]+)/i)?.[1];
    if (subreddit) return `r/${subreddit.toLowerCase()}`;
  } catch {
    // Candidate validation owns malformed URLs.
  }
  return source;
}

function configuredFloors(profile) {
  return {
    hourly: Number(profile?.rate_card?.hourly?.walk_away ?? 0),
    project: Number(profile?.rate_card?.project?.min ?? 0),
  };
}

function isBelowFloor(candidate, profile) {
  const { cadence, max } = candidate.compensation || {};
  if (!Number.isFinite(max)) return false;
  const floors = configuredFloors(profile);
  if (cadence === 'hourly' && Number.isFinite(floors.hourly) && max < floors.hourly) return true;
  if (cadence === 'project' && Number.isFinite(floors.project) && max < floors.project) return true;
  return false;
}

function paidSignal(candidate, text) {
  if (candidate.paymentModel && /^(?:hourly|fixed|paid|contract)$/i.test(candidate.paymentModel)) return true;
  if (Number.isFinite(candidate.compensation?.max) && candidate.compensation?.cadence !== 'unknown') return true;
  return /\b(?:paid|budget|rate|hourly|fixed fee|compensation|presupuesto|tarifa|pago)\b/i.test(text);
}

function explicitIndependentTerms(text) {
  const negated = /\b(?:without|no|not|does not|isn't|is not)\b[^.\n]{0,50}\b(?:freelanc(?:e|er)|independent contract(?:or)?|contractor|contract)\b/i.test(text);
  if (negated) return false;
  return /\b(?:freelanc(?:e|er)|independent contract(?:or)?|contractor|project contract|fixed project|consultant|por honorarios)\b/i.test(text);
}

export function applyRuleGate(candidate, profile = {}) {
  const text = candidateText(candidate);
  const source = sourceKey(candidate);
  const demandEvidence = firstMatch(text, CLIENT_DEMAND);
  const deliverableEvidence = firstMatch(text, DELIVERABLE);

  const supplyEvidence = firstMatch(text, SUPPLY_SIDE);
  if (supplyEvidence) return result('reject', ['job_seeker'], [supplyEvidence]);

  const contingentEvidence = firstMatch(text, CONTINGENT_COMPENSATION);
  if (contingentEvidence) {
    return result('reject', ['contingent_compensation'], [contingentEvidence]);
  }

  const unpaidEvidence = firstMatch(text, UNPAID);
  if (unpaidEvidence || /^(?:unpaid|equity)$/i.test(candidate.paymentModel || '')) {
    return result('reject', ['unpaid'], [unpaidEvidence || candidate.paymentModel]);
  }

  const scamEvidence = firstMatch(text, SCAM);
  if (scamEvidence) return result('reject', ['scam'], [scamEvidence]);

  const fullTimeEvidence = firstMatch(text, FULL_TIME);
  if (candidate.compensation?.cadence === 'annual' || fullTimeEvidence) {
    return result('reject', ['full_time'], [fullTimeEvidence || candidate.compensation?.raw]);
  }

  if (isBelowFloor(candidate, profile)) {
    return result('reject', ['below_rate_floor'], [candidate.compensation?.raw]);
  }

  const discussionEvidence = demandEvidence ? null : firstMatch(text, DISCUSSION);
  if (discussionEvidence) return result('reject', ['discussion'], [discussionEvidence]);

  if (source === 'r/forhire') {
    if (!/\[hiring\]/i.test(candidate.title)) return result('reject', ['source_policy'], [candidate.title]);
    return result('survivor');
  }

  if (source === 'r/jobbit') {
    if (!/\[hiring\]/i.test(candidate.title)) {
      const code = /^i(?:’|'| a)m\b|\bi specialize\b/i.test(text) ? 'job_seeker' : 'source_policy';
      return result('reject', [code], [candidate.title]);
    }
    return result('survivor');
  }

  if (source === 'r/slavelabour') {
    if (!/\[task\]/i.test(candidate.title)) return result('reject', ['source_policy'], [candidate.title]);
    return result('survivor');
  }

  if (/hn.*freelancer|hacker news.*freelancer/i.test(source)) {
    if (!/^seeking\s+freelancer\b/i.test(text)) return result('reject', ['source_policy'], [candidate.title]);
    return result('survivor');
  }

  if (/hn.*hiring|hacker news.*hiring/i.test(source)) {
    if (!explicitIndependentTerms(text)) return result('reject', ['full_time'], [candidate.title]);
    return result('survivor');
  }

  if (/get\s*on\s*board|remote\s*ok|working\s*nomads?/i.test(source)) {
    if (!explicitIndependentTerms(text)) return result('reject', ['full_time'], [candidate.title]);
    return result('survivor');
  }

  if (['r/ycombinator', 'r/programacion', 'r/beermoney'].includes(source)) {
    if (demandEvidence && deliverableEvidence && paidSignal(candidate, text)) {
      return result('survivor');
    }
    return result('reject', ['source_policy'], [demandEvidence, deliverableEvidence]);
  }

  if (candidate.description.length < 30) {
    return result('quarantine', ['insufficient_content'], [candidate.title]);
  }

  const explicitlyUndefinedScope = /\b(?:not|has not|haven't|hasn't|no)\b[^.\n]{0,60}\b(?:decided|defined|approved|named|deliverable|scope|task|outcome)\b/i.test(text)
    || /\b(?:deliverable|scope|outcome|responsibilities)\b[^.\n]{0,35}\b(?:unknown|undecided|omitted|not defined)\b/i.test(text);
  if (!demandEvidence || !deliverableEvidence || explicitlyUndefinedScope) {
    return result('quarantine', ['missing_scope'], [demandEvidence, deliverableEvidence]);
  }

  return result('survivor');
}
