import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(root, 'data', 'catalog.json');
const args = process.argv.slice(2);
const getArg = name => args[args.indexOf(name) + 1];
const seedFile = path.resolve(getArg('--file') || path.join(root, 'data', 'imports', 'conference-seeds.json'));
const limit = Math.max(1, Number(getArg('--limit') || 50));

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalize = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const stripHtml = value => clean(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' '));

function extractMeta(html, name) {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i');
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i');
  return clean(html.match(pattern)?.[1] || html.match(reverse)?.[1]);
}

function extractCanonical(html) { return clean(html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1]); }

function extractJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try { const data = JSON.parse(block[1].trim()); const values = Array.isArray(data) ? data : [data, ...(data?.['@graph'] || [])]; const event = values.find(item => /event/i.test(item?.['@type'] || '')); if (event) return event; } catch { /* a malformed JSON-LD block should not stop the crawl */ }
  }
  return {};
}

function extractDeadlines(text) {
  const results = []; const pattern = /(?:paper|abstract|poster|workshop|tutorial|registration|early[- ]bird)?\s*(?:submission|registration)?\s*deadline[^\n.;]{0,100}(?:\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b)/gi;
  for (const match of text.matchAll(pattern)) { const value = clean(match[0]); if (!results.includes(value)) results.push(value); }
  return results.slice(0, 8);
}

function matches(record, seed) {
  return record.id === seed.id || (seed.issn && [record.issn, record.eissn].includes(seed.issn)) || normalize(record.title) === normalize(seed.title) || normalize(record.title).includes(normalize(seed.title)) || normalize(seed.title).includes(normalize(record.title));
}

const seeds = JSON.parse(await readFile(seedFile, 'utf8')).slice(0, limit);
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
let updated = 0;
for (const seed of seeds) {
  if (!seed.url) continue;
  try {
    const response = await fetch(seed.url, { headers: { 'user-agent': 'ResearchIndex-local-crawler/1.0 (metadata enrichment)' } });
    if (!response.ok) { console.warn(`${response.status} ${seed.url}`); continue; }
    const html = await response.text(); const text = stripHtml(html); const event = extractJsonLd(html); const canonical = extractCanonical(html) || seed.url;
    const index = catalog.findIndex(record => matches(record, seed));
    if (index === -1) { console.warn(`No catalog match: ${seed.title}`); continue; }
    const record = catalog[index]; const deadlines = [...new Set([...(record.deadlines || []), ...extractDeadlines(text)])];
    catalog[index] = { ...record, homepage: canonical, conferenceMeta: { eventName: clean(event.name || extractMeta(html, 'og:title') || record.title), description: clean(event.description || extractMeta(html, 'description') || extractMeta(html, 'og:description')), startDate: clean(event.startDate), endDate: clean(event.endDate), location: clean(typeof event.location === 'string' ? event.location : event.location?.name), fetchedAt: new Date().toISOString() }, deadlines };
    updated += 1; console.log(`Updated ${record.title} ← ${canonical}`);
  } catch (error) { console.warn(`Failed ${seed.url}: ${error.message}`); }
  await new Promise(resolve => setTimeout(resolve, 600));
}
await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Crawled ${seeds.length} seed(s), updated ${updated} catalog record(s).`);
