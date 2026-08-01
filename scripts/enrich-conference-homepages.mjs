import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(root, 'data', 'catalog.json');
const args = process.argv.slice(2);
const getArg = name => args[args.indexOf(name) + 1];
const limit = Math.max(1, Number(getArg('--limit') || 100));
const delay = Math.max(500, Number(getArg('--delay') || 900));
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalize = value => clean(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const rankOrder = new Map([['A*', 0], ['A', 1], ['B', 2], ['C', 3]]);

function overlap(left, right) {
  const ignored = new Set(['the', 'and', 'of', 'on', 'for', 'international', 'conference', 'symposium', 'workshop', 'annual']);
  const a = new Set(normalize(left).split(' ').filter(token => token.length > 2 && !ignored.has(token)));
  const b = new Set(normalize(right).split(' ').filter(token => token.length > 2 && !ignored.has(token)));
  if (!a.size || !b.size) return 0;
  return [...a].filter(token => b.has(token)).length / Math.min(a.size, b.size);
}

async function wikidata(pathname, parameters = {}) {
  const url = new URL(pathname, 'https://www.wikidata.org');
  url.search = new URLSearchParams(parameters);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'user-agent': 'ResearchIndex/1.0 conference homepage enrichment' }
    });
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 2) throw new Error(`Wikidata HTTP ${response.status}`);
    const retryAfter = Number(response.headers.get('retry-after') || 2);
    await sleep(Math.max(2000, retryAfter * 1000));
  }
  return {};
}

async function findHomepage(record) {
  const acronym = clean(record.core?.acronym || record.aliases?.[0]);
  const query = acronym && acronym.length >= 2 ? `${acronym} conference` : record.title;
  const data = await wikidata('/w/api.php', { action: 'wbsearchentities', search: query, language: 'en', format: 'json', limit: '8' });
  const candidates = (data.search || []).map(item => {
    const description = clean(item.description);
    const conferenceLike = /conference|symposium|workshop|scientific meeting|academic event/i.test(description);
    const acronymMatch = acronym.length >= 2 && new RegExp(`(^|[^a-z0-9])${acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(item.label);
    return { ...item, score: (conferenceLike ? 2 : 0) + (acronymMatch ? 2 : 0) + overlap(record.title, item.label) };
  }).filter(item => item.score >= 2.45).sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;
  const id = candidates[0].id;
  const entityData = await wikidata(`/wiki/Special:EntityData/${id}.json`);
  const entity = entityData.entities?.[id];
  const homepage = entity?.claims?.P856?.map(claim => claim.mainsnak?.datavalue?.value).find(value => /^https?:\/\//i.test(value));
  return homepage ? { homepage, wikidata: `https://www.wikidata.org/wiki/${id}` } : null;
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const targets = catalog
  .filter(record => record.type === 'conference' && !record.homepage && record.core?.rank)
  .sort((a, b) => (rankOrder.get(a.core.rank) ?? 9) - (rankOrder.get(b.core.rank) ?? 9) || a.title.localeCompare(b.title))
  .slice(0, limit);

let updated = 0;
for (let index = 0; index < targets.length; index += 1) {
  const record = targets[index];
  try {
    const found = await findHomepage(record);
    if (found) {
      record.homepage = found.homepage;
      record.homepageSource = 'Wikidata';
      record.homepageFetchedAt = new Date().toISOString();
      record.core = { ...record.core, wikidata: found.wikidata };
      updated += 1;
      console.log(`[${index + 1}/${targets.length}] ${record.core.acronym || record.title} -> ${found.homepage}`);
    }
  } catch (error) {
    console.warn(`[${index + 1}/${targets.length}] ${record.title}: ${error.message}`);
  }
  await sleep(delay);
}

await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Checked ${targets.length} ranked conferences, enriched ${updated} official homepage(s).`);
