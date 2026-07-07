import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { paths } from './paths.mjs';

const LINE = /^- \[( |x)\]\s+(.+)$/;

export function parsePipeline(text) {
  const items = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(LINE);
    if (!m) continue;
    const checked = m[1] === 'x';
    const parts = m[2].split('|').map((s) => s.trim());
    const url = parts[0];
    if (!/^https?:\/\//.test(url)) continue;
    items.push({
      url,
      status: parts[1] || null,
      title: parts[2] || null,
      checked,
    });
  }
  return items;
}

function itemToLine(it) {
  const box = it.checked ? 'x' : ' ';
  const segs = [it.url];
  if (it.status || it.title) segs.push(it.status || '');
  if (it.title) segs.push(it.title);
  return `- [${box}] ${segs.join(' | ')}`;
}

export function serializePipeline(items, originalText = '') {
  const lines = originalText.split('\n');
  const kept = [];
  let inserted = false;
  for (const line of lines) {
    if (LINE.test(line)) {
      if (!inserted) {
        for (const it of items) kept.push(itemToLine(it));
        inserted = true;
      }
      // drop original item lines
      continue;
    }
    kept.push(line);
  }
  if (!inserted) {
    if (!/## Pending/.test(originalText)) kept.push('', '## Pending', '');
    for (const it of items) kept.push(itemToLine(it));
  }
  return kept.join('\n');
}

export async function atomicWrite(filePath, text) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, filePath);
}

export async function readPipeline() {
  const text = await fs.readFile(paths.pipeline, 'utf8').catch(() => '');
  return parsePipeline(text);
}

export async function writePipeline(items) {
  const original = await fs.readFile(paths.pipeline, 'utf8').catch(() => '# Pipeline\n\n## Pending\n');
  await atomicWrite(paths.pipeline, serializePipeline(items, original));
}

export async function readYaml(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return yaml.load(text) || {};
}

export async function writeYaml(filePath, obj) {
  const text = yaml.dump(obj, { lineWidth: 100, noRefs: true });
  await atomicWrite(filePath, text);
}

export async function readScores() {
  const text = await fs.readFile(paths.scores, 'utf8').catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function readScanHistory() {
  const text = await fs.readFile(paths.scanHistory, 'utf8').catch(() => '');
  const rows = {};
  const lines = text.split('\n').filter(Boolean);
  if (lines.length === 0) return rows;
  const header = lines[0].split('\t');
  const idx = (n) => header.indexOf(n);
  for (const line of lines.slice(1)) {
    const c = line.split('\t');
    const url = c[idx('url')];
    if (!url) continue;
    rows[url] = {
      first_seen: c[idx('first_seen')] || null,
      portal: c[idx('portal')] || null,
      title: c[idx('title')] || null,
      location: c[idx('location')] || null,
    };
  }
  return rows;
}

export function mergePipeline(items, scores = {}, history = {}) {
  return items.map((it) => {
    const s = scores[it.url] || null;
    const h = history[it.url] || null;
    return {
      ...it,
      title: (s && s.title) || (h && h.title) || it.title || it.url,
      source: (s && s.source) || (h && h.portal) || null,
      firstSeen: (s && s.first_seen) || (h && h.first_seen) || null,
      budget: s ? s.budget : null,
      score: s ? s.score : null,
      verdict: s ? s.verdict : null,
      state: s ? s.state : null,
      reasons: s ? s.reasons : [],
      redFlags: s ? s.redFlags : [],
      report: s ? s.report : null,
    };
  });
}
