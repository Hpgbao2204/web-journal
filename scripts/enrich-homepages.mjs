import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(root, 'data', 'catalog.json');
const args = process.argv.slice(2);
const getArg = name => args[args.indexOf(name) + 1];
const limit = Math.max(1, Number(getArg('--limit') || 100));
const delay = Math.max(100, Number(getArg('--delay') || 300));
const clean = value => String(value ?? '').trim();
const normalizeIssn = value => clean(value).replace(/[^0-9Xx-]/g, '');

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const targets = catalog.filter(record => !record.homepage && (record.issn || record.eissn)).slice(0, limit);
let updated = 0;
for (const record of targets) {
  const issn = normalizeIssn(record.issn || record.eissn);
  try {
    const response = await fetch(`https://api.openalex.org/sources/issn:${encodeURIComponent(issn)}`, { headers: { 'user-agent': 'ResearchIndex-local-enricher/1.0 (metadata enrichment)' } });
    if (!response.ok) { await new Promise(resolve => setTimeout(resolve, delay)); continue; }
    const source = await response.json();
    const homepage = clean(source.homepage_url || source.host_organization_lineage?.[0]?.homepage_url || source.primary_location?.source?.homepage_url);
    if (homepage) { record.homepage = homepage; record.homepageSource = 'OpenAlex'; record.homepageFetchedAt = new Date().toISOString(); updated += 1; console.log(`${record.title} -> ${homepage}`); }
  } catch (error) { console.warn(`Failed ${record.title}: ${error.message}`); }
  await new Promise(resolve => setTimeout(resolve, delay));
}
await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Checked ${targets.length} ISSN record(s), enriched ${updated} homepage(s).`);
