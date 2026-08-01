import { spawn } from 'node:child_process';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const getArg = name => args[args.indexOf(name) + 1];
const query = getArg('--query') || '';
const deepHomepages = args.includes('--deep-homepages');
const limit = Math.max(1, Number(getArg('--limit') || 100));
const pageSize = Math.min(15, limit);
const maxPages = Math.ceil(limit / pageSize);
const port = 3200 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
const cachePath = path.join(root, 'data', 'enrichment-cache.json');
const child = spawn(process.execPath, [path.join(root, 'server.js')], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'ignore', 'inherit']
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Local enrichment server did not start');
}

const normalizeIssn = value => String(value || '').toLowerCase().replace(/[^0-9x]/g, '');

async function enrichDeepHomepages(records) {
  const targets = records.filter(record => !record.homepage && record.wos?.sourceUrl);
  if (!targets.length) return 0;
  const cache = JSON.parse(await readFile(cachePath, 'utf8'));
  let updated = 0;
  for (const record of targets) {
    try {
      const response = await fetch(record.wos.sourceUrl, { signal: AbortSignal.timeout(60000), headers: { 'user-agent': 'ResearchIndex/1.0 journal homepage enrichment' } });
      if (!response.ok) continue;
      const html = await response.text();
      const homepage = html.match(/<td[^>]*>\s*期刊主页\s*<\/td>\s*<td[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["']/i)?.[1];
      if (!/^https?:\/\//i.test(homepage || '')) continue;
      const keys = [...new Set([record.issn, record.eissn, ...(record.alternateIssns || [])].map(normalizeIssn).filter(Boolean))];
      const current = keys.map(key => cache.byIssn?.[key]).find(Boolean) || {};
      current.homepage = homepage;
      current.homepageSource = 'AbleSci';
      current.homepageCheckedAt = new Date().toISOString();
      for (const key of keys) cache.byIssn[key] = current;
      updated += 1;
      console.log(`Homepage: ${record.title} -> ${homepage}`);
    } catch (error) {
      console.warn(`Homepage lookup failed for ${record.title}: ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 900));
  }
  if (updated) {
    const temporary = `${cachePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(cache, null, 2) + '\n');
    await rename(temporary, cachePath);
  }
  return updated;
}

try {
  await waitForServer();
  let processed = 0;
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= maxPages) {
    const params = new URLSearchParams({ q: query, type: 'journal', sort: 'rank', page: String(page), pageSize: String(pageSize) });
    const response = await fetch(`${baseUrl}/api/search?${params}`, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Search API HTTP ${response.status}`);
    const data = await response.json();
    processed += data.results.length;
    totalPages = data.totalPages;
    const withWos = data.results.filter(record => record.wos?.impactFactor || record.wos?.quartile).length;
    const withHomepage = data.results.filter(record => record.homepage).length;
    console.log(`Page ${page}/${Math.min(totalPages, maxPages)}: ${data.results.length} journals, ${withWos} WoS/JCR, ${withHomepage} homepages`);
    if (deepHomepages) await enrichDeepHomepages(data.results);
    if (!data.results.length) break;
    page += 1;
  }
  console.log(`Enriched ${processed} journal result(s)${query ? ` matching "${query}"` : ''}. Data is cached in data/enrichment-cache.json.`);
} finally {
  child.kill();
}
