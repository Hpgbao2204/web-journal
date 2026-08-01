import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dataFile = path.join(root, 'data', 'catalog.json');
const cacheFile = path.join(root, 'data', 'enrichment-cache.json');
const port = Number(process.env.PORT || 3000);
const wosLookupVersion = 2;

const json = (res, value, status = 200) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

const normalizeIssn = value => String(value || '').toLowerCase().replace(/[^0-9x]/g, '');
const issnKeys = record => [...new Set([record.issn, record.eissn, ...(record.alternateIssns || [])].map(normalizeIssn).filter(Boolean))];

async function loadCache() {
  try { return JSON.parse(await readFile(cacheFile, 'utf8')); }
  catch { return { byIssn: {} }; }
}

function applyCache(record, cache) {
  const cached = issnKeys(record).map(key => cache.byIssn?.[key]).filter(Boolean);
  if (!cached.length) return record;
  const homepageEntry = cached.find(entry => entry.homepage) || {};
  const wosEntry = cached.find(entry => entry.wos?.checkedAt) || cached.find(entry => entry.wos) || {};
  const cachedWos = wosEntry.wos?.indexed === false && wosEntry.wos?.lookupVersion !== wosLookupVersion ? {} : (wosEntry.wos || {});
  return {
    ...record,
    homepage: record.homepage || homepageEntry.homepage || '',
    homepageSource: record.homepageSource || homepageEntry.homepageSource,
    wos: { ...(record.wos || {}), ...cachedWos }
  };
}

async function loadRecords(cache = { byIssn: {} }) {
  try { return JSON.parse(await readFile(dataFile, 'utf8')).map(record => applyCache(record, cache)); }
  catch { return []; }
}

function hasValue(value) { return value !== undefined && value !== null && String(value).trim() !== '' && value !== 0; }
function hasUsefulData(record) {
  if (!record?.title?.trim()) return false;
  return [record.publisher, record.issn, record.eissn, record.sourceId, record.coverage, record.sourceType, record.asjcCodes?.length, record.homepage, record.wos?.impactFactor, record.wos?.quartile, record.scopus?.citeScore, record.scopus?.snip, record.scopus?.sjr, record.scimago?.sjr, record.scimago?.quartile].some(hasValue);
}

function rankValues(record) { return [...new Set([record.wos?.quartile, record.scimago?.quartile, record.scopus?.quartile].filter(Boolean))]; }
const rankOrder = ['Q1', 'A*', 'A+', 'Q2', 'A', 'Q3', 'B', 'Q4', 'C'];
function rankScore(record) {
  const scores = rankValues(record).map(rank => rankOrder.indexOf(String(rank).toUpperCase().replace(/\s+/g, ''))).filter(score => score >= 0);
  return scores.length ? Math.min(...scores) : 99;
}
function rankLabel(record) { return rankValues(record).sort((a, b) => (rankOrder.indexOf(String(a).toUpperCase()) + 1 || 100) - (rankOrder.indexOf(String(b).toUpperCase()) + 1 || 100)).join(' · '); }
function homepage(record) { return record.homepage || record.links?.find(link => /home|official|website/i.test(link.label))?.url || ''; }
function enrich(record) {
  const { core: _hiddenCore, ...visibleRecord } = record;
  return { ...visibleRecord, displayRank: rankLabel(record) || '—', homepage: homepage(record), deadlines: record.deadlines || [], completeness: [record.issn, record.eissn, record.publisher, record.sourceType, record.coverage, record.wos?.impactFactor, record.scopus?.citeScore, record.scopus?.snip, record.scimago?.sjr].filter(hasValue).length };
}

function sortRecords(records, sort) {
  return [...records].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'publisher') return (a.publisher || '').localeCompare(b.publisher || '');
    const rankDiff = rankScore(a) - rankScore(b);
    return rankDiff || a.title.localeCompare(b.title);
  });
}

const decodeHtml = value => String(value || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&ordm;/gi, 'º');
const stripHtml = value => decodeHtml(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const formatIssn = value => { const normalized = normalizeIssn(value).toUpperCase(); return normalized.length === 8 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized; };
const normalizeTitle = value => stripHtml(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function parseAbleSci(html, record) {
  const table = html.match(/<div class="search-results"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>[\s\S]*?<\/table>/i)?.[1] || '';
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => match[1]);
  if (!rows.length) return null;
  const expectedIssns = new Set(issnKeys(record));
  const expectedTitle = normalizeTitle(record.title);
  const row = rows.map(content => {
    const cells = [...content.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(match => match[1]);
    const title = stripHtml(cells[0]);
    const issn = normalizeIssn(stripHtml(cells[1]));
    const normalizedTitle = normalizeTitle(title);
    const titleMatch = normalizedTitle === expectedTitle || normalizedTitle.includes(expectedTitle) || expectedTitle.includes(normalizedTitle);
    return { content, cells, titleMatch, issnMatch: expectedIssns.has(issn) };
  }).sort((a, b) => Number(b.issnMatch) - Number(a.issnMatch) || Number(b.titleMatch) - Number(a.titleMatch)).find(candidate => candidate.issnMatch || candidate.titleMatch);
  if (!row) return null;
  const cells = row.cells;
  const firstIfText = stripHtml(cells[2]?.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || cells[2]);
  const impactFactor = /^\d+(?:[.,]\d+)?$/.test(firstIfText) ? Number(firstIfText.replace(',', '.')) : null;
  const quartile = stripHtml(cells.at(-1)).match(/Q[1-4]/i)?.[0]?.toUpperCase() || '';
  const detailPath = row.content.match(/class="journal-name"[^>]+href="([^"]+)"/i)?.[1] || row.content.match(/href="([^"]*\/journal\/detail\?id=[^"]+)"/i)?.[1] || '';
  const detailUrl = detailPath ? new URL(detailPath, 'https://www.ablesci.com').href : '';
  return { indexed: Boolean(impactFactor || quartile), impactFactor, quartile, status: impactFactor || quartile ? 'Có trong JCR' : 'Không thuộc JCR mới nhất', year: '2026', source: 'AbleSci', sourceUrl: detailUrl, lookupVersion: wosLookupVersion, checkedAt: new Date().toISOString() };
}

async function fetchAbleSci(record) {
  const queries = [...new Set([record.title, ...issnKeys(record).map(formatIssn)].filter(Boolean))];
  let validResponses = 0;
  for (const query of queries) {
    const response = await fetch(`https://www.ablesci.com/journal/index?keywords=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'ResearchIndex/1.0 metadata lookup' } });
    if (!response.ok) continue;
    const html = await response.text();
    if (!/class="search-results"/i.test(html)) continue;
    validResponses += 1;
    const parsed = parseAbleSci(html, record);
    if (parsed) return parsed;
    await sleep(250);
  }
  if (!validResponses) throw new Error('AbleSci unavailable');
  return { indexed: false, status: 'Không có trong dữ liệu JCR/AbleSci', source: 'AbleSci', lookupVersion: wosLookupVersion, checkedAt: new Date().toISOString() };
}

async function fetchOpenAlexHomepages(records) {
  const targets = records.filter(record => !record.homepage && issnKeys(record).length);
  if (!targets.length) return new Map();
  const requested = [...new Set(targets.flatMap(issnKeys))].slice(0, 100).map(formatIssn);
  const response = await fetch(`https://api.openalex.org/sources?filter=issn:${encodeURIComponent(requested.join('|'))}&per-page=100`, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'ResearchIndex/1.0 metadata lookup' } });
  if (!response.ok) throw new Error(`OpenAlex ${response.status}`);
  const data = await response.json(); const byIssn = new Map(); const wikidataSources = [];
  for (const source of data.results || []) {
    if (source.homepage_url) for (const issn of source.issn || []) byIssn.set(normalizeIssn(issn), { url: source.homepage_url, source: 'OpenAlex' });
    else {
      const wikidataId = source.ids?.wikidata?.match(/Q\d+/i)?.[0]?.toUpperCase();
      if (wikidataId) wikidataSources.push({ wikidataId, issns: source.issn || [] });
    }
  }
  const ids = [...new Set(wikidataSources.map(source => source.wikidataId))];
  if (ids.length) {
    try {
      const wikidataUrl = new URL('https://www.wikidata.org/w/api.php');
      wikidataUrl.search = new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims', format: 'json' });
      const wikidataResponse = await fetch(wikidataUrl, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'ResearchIndex/1.0 metadata lookup' } });
      if (wikidataResponse.ok) {
        const entities = (await wikidataResponse.json()).entities || {};
        for (const source of wikidataSources) {
          const officialUrl = entities[source.wikidataId]?.claims?.P856?.map(claim => claim.mainsnak?.datavalue?.value).find(value => /^https?:\/\//i.test(value));
          if (officialUrl) for (const issn of source.issns) byIssn.set(normalizeIssn(issn), { url: officialUrl, source: 'Wikidata' });
        }
      }
    } catch { /* OpenAlex homepages remain usable when Wikidata is unavailable */ }
  }
  return byIssn;
}

async function saveCache(cache) {
  const temporary = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(cache, null, 2) + '\n');
  await rename(temporary, cacheFile);
}

function needsWosRefresh(record) {
  const wos = record.wos || {};
  if (!wos.checkedAt || wos.lookupVersion !== wosLookupVersion) return true;
  if (wos.indexed !== false) return false;
  return Date.now() - new Date(wos.checkedAt).getTime() > 7 * 24 * 60 * 60 * 1000;
}

async function enrichPage(records, cache) {
  let changed = false; let homepages = new Map();
  try { homepages = await fetchOpenAlexHomepages(records); } catch { /* local results remain usable when OpenAlex is unavailable */ }
  for (const record of records) {
    const keys = issnKeys(record); if (!keys.length) continue;
    const primary = keys[0]; const current = cache.byIssn[primary] || {};
    const discoveredHomepage = keys.map(key => homepages.get(key)).find(Boolean);
    const homepage = record.homepage || discoveredHomepage?.url || current.homepage;
    if (homepage && homepage !== current.homepage) { current.homepage = homepage; current.homepageSource = discoveredHomepage?.source || record.homepageSource || 'catalog'; changed = true; }
    for (const key of keys) cache.byIssn[key] = current;
  }
  const targets = records.filter(record => record.type === 'journal' && needsWosRefresh(record));
  for (const record of targets) {
    try {
      const wos = await fetchAbleSci(record); if (!wos) continue;
      const keys = issnKeys(record); const current = cache.byIssn[keys[0]] || {}; current.wos = wos;
      for (const key of keys) cache.byIssn[key] = current;
      changed = true;
    } catch { /* transient external errors must not become a permanent negative cache */ }
    await sleep(900);
  }
  if (changed) await saveCache(cache);
  return records.map(record => applyCache(record, cache));
}

async function serveStatic(res, pathname) {
  const requested = ['/journals', '/conferences'].includes(pathname) ? '/index.html' : pathname;
  const safe = path.normalize(requested).replace(/^([.][.][\\/])+/, '');
  const file = path.join(publicDir, safe);
  if (!file.startsWith(publicDir)) return json(res, { error: 'Not found' }, 404);
  try {
    const content = await readFile(file);
    const ext = path.extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
    res.end(content);
  } catch { json(res, { error: 'Not found' }, 404); }
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (parsed.pathname === '/') {
    res.writeHead(302, { location: '/journals' });
    return res.end();
  }
  if (parsed.pathname === '/api/health') return json(res, { ok: true, service: 'research-index' });
  if (parsed.pathname === '/api/stats') {
    const cache = await loadCache();
    const type = parsed.searchParams.get('type') || 'journal';
    const records = (await loadRecords(cache)).filter(record => hasUsefulData(record) && (type === 'all' || record.type === type));
    return json(res, {
      total: records.length,
      wosIndexed: records.filter(record => record.wos?.indexed || record.wos?.impactFactor || record.wos?.quartile).length,
      scopusIndexed: records.filter(record => (record.sources || []).includes('scopus')).length,
      scimagoIndexed: records.filter(record => record.scimago?.sjr || record.scimago?.quartile).length,
      withHomepage: records.filter(record => homepage(record)).length
    });
  }
  if (parsed.pathname === '/api/search') {
    const q = (parsed.searchParams.get('q') || '').trim().toLowerCase();
    const type = parsed.searchParams.get('type') || 'all';
    const sort = parsed.searchParams.get('sort') || 'rank';
    const page = Math.max(1, Number(parsed.searchParams.get('page') || 1));
    const pageSize = Math.min(50, Math.max(1, Number(parsed.searchParams.get('pageSize') || 15)));
    const cache = await loadCache();
    const records = (await loadRecords(cache)).filter(record => {
      const haystack = [record.title, record.publisher, record.issn, record.eissn, record.sourceId, record.status, record.sourceType, record.coverage, record.homepage, ...(record.aliases || []), ...(record.subjects || []), ...(record.asjcCodes || [])].join(' ').toLowerCase();
      return hasUsefulData(record) && (!q || haystack.includes(q)) && (type === 'all' || record.type === type);
    });
    const ordered = sortRecords(records, sort);
    const totalPages = Math.max(1, Math.ceil(ordered.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const pageRecords = ordered.slice((safePage - 1) * pageSize, safePage * pageSize);
    const results = (await enrichPage(pageRecords, cache)).map(enrich);
    return json(res, { query: q, total: ordered.length, page: safePage, pageSize, totalPages, sort, results });
  }
  if (parsed.pathname.startsWith('/api/record/')) {
    const id = decodeURIComponent(parsed.pathname.slice('/api/record/'.length));
    const cache = await loadCache();
    const record = (await loadRecords(cache)).find(item => item.id === id);
    if (!record) return json(res, { error: 'Record not found' }, 404);
    const [enrichedRecord] = await enrichPage([record], cache);
    return json(res, enrich(enrichedRecord));
  }
  return serveStatic(res, parsed.pathname);
});

await mkdir(path.join(root, 'data', 'imports'), { recursive: true });
server.listen(port, () => console.log(`Research Index running at http://localhost:${port}`));
