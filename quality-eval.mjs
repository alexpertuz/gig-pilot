#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { normalizeProvider } from './agent-runtime.mjs';
import { normalizeCandidate } from './triage/contracts.mjs';
import { isAcceptedDecision, validateDecision } from './triage/decision.mjs';
import { triageCandidates } from './triage/engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORPUS = path.join(HERE, 'triage', 'fixtures', 'relevance-corpus.json');
const DEFAULT_PROFILE = path.join(HERE, 'config', 'profile.yml');

function qualityUrl(id) {
  return `https://quality.gig-ops.local/${encodeURIComponent(id)}`;
}

function corpusCandidate(entry) {
  return normalizeCandidate({
    url: entry.url || qualityUrl(entry.id),
    title: entry.title,
    description: entry.description || '',
    source: entry.source,
    budget: entry.budget,
  }, {
    provider: 'quality-corpus',
    firstSeen: '2026-07-11',
  });
}

function decisionIndex(decisions) {
  const payload = decisions?.decisions || decisions || {};
  if (Array.isArray(payload)) {
    return Object.fromEntries(payload.flatMap((decision) => {
      const keys = [decision?.id, decision?.url].filter(Boolean);
      return keys.map((key) => [key, decision]);
    }));
  }
  return payload && typeof payload === 'object' ? payload : {};
}

function lookupDecision(index, entry, candidate) {
  return index[entry.id] || index[entry.url] || index[candidate.url] || null;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function evaluateQuality(corpus, decisions, {
  minPrecision = 0.95,
  minRecall = 0.70,
  minActivePrecision = 0.95,
  minFitRecall = 0.70,
  minSchemaValidity = 1,
} = {}) {
  if (!Array.isArray(corpus) || corpus.length === 0) throw new Error('quality corpus must be a non-empty array');
  const index = decisionIndex(decisions);
  const rows = corpus.map((entry) => {
    const candidate = corpusCandidate(entry);
    const raw = lookupDecision(index, entry, candidate);
    const augmented = raw && typeof raw === 'object' ? { ...raw, url: raw.url || candidate.url } : raw;
    let schemaValid = false;
    try {
      validateDecision(augmented, candidate);
      schemaValid = true;
    } catch {
      schemaValid = false;
    }
    const accepted = isAcceptedDecision(augmented);
    const score = Number(augmented?.fit?.score ?? augmented?.score ?? 0);
    return {
      id: entry.id,
      expected: entry.expected,
      expectedActive: entry.expectedActive ?? entry.expected === 'survivor',
      accepted,
      active: accepted
        && score >= 3
        && augmented?.fit?.verdict !== 'DECLINE'
        && Number(augmented?.fit?.blocks?.A) >= 3
        && Number(augmented?.fit?.blocks?.B) > 1,
      score,
      schemaValid,
    };
  });

  const positives = rows.filter((row) => row.expected === 'survivor');
  const accepted = rows.filter((row) => row.accepted);
  const truePositives = accepted.filter((row) => row.expected === 'survivor');
  const active = accepted.filter((row) => row.active);
  const expectedActive = rows.filter((row) => row.expectedActive);
  const activeTruePositives = active.filter((row) => row.expectedActive);
  const hardNegativeLeakage = accepted.filter((row) => row.expected === 'reject').length;
  const top20 = [...active].sort((a, b) => b.score - a.score).slice(0, 20);
  const top20Leakage = top20.filter((row) => !row.expectedActive).length;
  const schemaValidity = ratio(rows.filter((row) => row.schemaValid).length, rows.length);
  const precision = ratio(truePositives.length, accepted.length);
  const recall = ratio(truePositives.length, positives.length);
  const activePrecision = ratio(activeTruePositives.length, active.length);
  const fitRecall = ratio(activeTruePositives.length, expectedActive.length);
  const failures = [];

  if (precision < minPrecision) {
    failures.push(`Precision ${(precision * 100).toFixed(1)}% is below ${(minPrecision * 100).toFixed(0)}%`);
  }
  if (recall < minRecall) {
    failures.push(`Recall ${(recall * 100).toFixed(1)}% is below ${(minRecall * 100).toFixed(0)}%`);
  }
  if (activePrecision < minActivePrecision) {
    failures.push(`Active precision ${(activePrecision * 100).toFixed(1)}% is below ${(minActivePrecision * 100).toFixed(0)}%`);
  }
  if (fitRecall < minFitRecall) {
    failures.push(`Fit recall ${(fitRecall * 100).toFixed(1)}% is below ${(minFitRecall * 100).toFixed(0)}%`);
  }
  if (hardNegativeLeakage > 0) {
    failures.push(`${hardNegativeLeakage} hard-negative item(s) leaked into accepted results`);
  }
  if (top20Leakage > 0) {
    failures.push(`${top20Leakage} non-target item(s) leaked into the top 20`);
  }
  if (schemaValidity < minSchemaValidity) {
    failures.push(`Schema validity ${(schemaValidity * 100).toFixed(1)}% is below ${(minSchemaValidity * 100).toFixed(0)}%`);
  }

  return {
    corpusSize: rows.length,
    accepted: accepted.length,
    truePositives: truePositives.length,
    precision,
    recall,
    activePrecision,
    fitRecall,
    hardNegativeLeakage,
    top20Leakage,
    schemaValidity,
    passed: failures.length === 0,
    failures,
  };
}

function optionValue(args, name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function activeProviderDecisions(corpus, provider) {
  const profileText = await readFile(DEFAULT_PROFILE, 'utf8').catch(() => '');
  const profile = profileText ? yaml.load(profileText) || {} : {};
  const candidates = corpus.map(corpusCandidate);
  const result = await triageCandidates(candidates, {
    profile,
    provider,
    reclassify: true,
    maxModelCandidates: candidates.length,
    batchSize: 10,
  });
  return { decisions: result.decisions, metrics: result.metrics, issues: result.issues };
}

async function main(args) {
  const corpusPath = optionValue(args, '--corpus') || DEFAULT_CORPUS;
  const replayPath = optionValue(args, '--replay');
  const active = args.some((arg) => arg === '--active-provider' || arg.startsWith('--active-provider='));
  if (Boolean(replayPath) === Boolean(active)) {
    throw new Error('choose exactly one of --replay <file> or --active-provider[=<provider>]');
  }

  const corpus = await readJson(path.resolve(corpusPath));
  let payload;
  if (replayPath) {
    payload = await readJson(path.resolve(replayPath));
  } else {
    const inlineProvider = optionValue(args, '--active-provider');
    const selected = inlineProvider && !inlineProvider.startsWith('--')
      ? inlineProvider
      : optionValue(args, '--agent-provider') || process.env.GIGOPS_AGENT_PROVIDER || 'claude';
    payload = await activeProviderDecisions(corpus, normalizeProvider(selected));
  }

  const result = evaluateQuality(corpus, payload);
  const output = { ...result, ...(payload.metrics ? { triageMetrics: payload.metrics } : {}), ...(payload.issues ? { issues: payload.issues } : {}) };
  const json = `${JSON.stringify(output, null, 2)}\n`;
  const outputPath = optionValue(args, '--output');
  if (outputPath) await writeFile(path.resolve(outputPath), json, 'utf8');
  process.stdout.write(json);
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
