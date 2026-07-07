import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

const HOURLY_HINT = /\b(hour|hourly|per hour|an hour)\b|\/\s*hr/i;

/**
 * Parse a compensation signal out of free text.
 * @returns {{raw:string,min:number|null,max:number|null,unit:'hourly'|'project'}|null}
 */
export function parseBudget(text) {
  if (!text) return null;
  const amounts = [];
  const re = /\$\s*([\d,]+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n)) amounts.push(n);
  }
  if (amounts.length === 0) return null;
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  // Hourly only when the text says so; otherwise treat a bare amount as a project budget.
  const unit = HOURLY_HINT.test(text) ? 'hourly' : 'project';
  return {
    raw: text.match(/\$[\s\d,.\-–to/a-z]*/i)?.[0]?.trim() ?? `$${max}`,
    min: amounts.length > 1 ? min : null,
    max,
    unit,
  };
}
