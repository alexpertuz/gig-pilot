import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

async function readJson(filePath, label, issues) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      issues.push(`${path.basename(filePath)} must contain a JSON object`);
      return {};
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    issues.push(`${path.basename(filePath)} contains invalid JSON (${label}): ${error.message}`);
    return {};
  }
}

export async function readDerivedState(paths) {
  const issues = [];
  const [candidates, triage, scores] = await Promise.all([
    readJson(paths.candidates, 'candidates', issues),
    readJson(paths.triage, 'triage', issues),
    readJson(paths.scores, 'scores', issues),
  ]);
  return { candidates, triage, scores, issues };
}

export async function writeDerivedStateAtomic(paths, state) {
  const entries = [
    ['candidates', paths.candidates],
    ['triage', paths.triage],
    ['scores', paths.scores],
  ];
  const pending = [];
  try {
    for (const [key, filePath] of entries) {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
      await writeFile(temporary, `${JSON.stringify(state[key] || {}, null, 2)}\n`, 'utf8');
      pending.push({ temporary, filePath });
    }
    for (const item of pending) await rename(item.temporary, item.filePath);
  } catch (error) {
    await Promise.all(pending.map((item) => rm(item.temporary, { force: true }).catch(() => {})));
    throw error;
  }
}
