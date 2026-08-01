import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dataFile = path.join(root, 'data', 'catalog.json');
const port = Number(process.env.PORT || 3000);

const json = (res, value, status = 200) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

async function loadRecords() {
  try { return JSON.parse(await readFile(dataFile, 'utf8')); }
  catch { return []; }
}

function hasValue(value) { return value !== undefined && value !== null && String(value).trim() !== '' && value !== 0; }
function hasUsefulData(record) {
  if (!record?.title?.trim()) return false;
  return [record.publisher, record.issn, record.eissn, record.sourceId, record.coverage, record.sourceType, record.asjcCodes?.length, record.homepage, record.wos?.impactFactor, record.wos?.quartile, record.scopus?.citeScore, record.scopus?.snip, record.scopus?.sjr, record.scimago?.sjr, record.scimago?.quartile, record.core?.rank].some(hasValue);
}

function rankValues(record) { return [...new Set([record.wos?.quartile, record.scimago?.quartile, record.core?.rank, record.scopus?.quartile].filter(Boolean))]; }
function rankScore(record) {
  const order = ['Q1', 'A*', 'A+', 'A', 'Q2', 'B', 'Q3', 'C', 'Q4'];
  const scores = rankValues(record).map(rank => order.indexOf(String(rank).toUpperCase().replace(/\s+/g, ''))).filter(score => score >= 0);
  return scores.length ? Math.min(...scores) : 99;
}
function rankLabel(record) { const order = ['Q1', 'A*', 'A+', 'A', 'Q2', 'B', 'Q3', 'C', 'Q4']; return rankValues(record).sort((a, b) => order.indexOf(String(a).toUpperCase()) - order.indexOf(String(b).toUpperCase())).join(' · '); }
function homepage(record) { return record.homepage || record.links?.find(link => /home|official|website/i.test(link.label))?.url || ''; }
function enrich(record) {
  return { ...record, displayRank: rankLabel(record) || '—', homepage: homepage(record), deadlines: record.deadlines || [], completeness: [record.issn, record.eissn, record.publisher, record.sourceType, record.coverage, record.wos?.impactFactor, record.scopus?.citeScore, record.scopus?.snip, record.scimago?.sjr, record.core?.rank].filter(hasValue).length };
}

function sortRecords(records, sort) {
  return [...records].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'publisher') return (a.publisher || '').localeCompare(b.publisher || '');
    const rankDiff = rankScore(a) - rankScore(b);
    return rankDiff || a.title.localeCompare(b.title);
  });
}

async function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
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
  if (parsed.pathname === '/api/health') return json(res, { ok: true, service: 'research-index' });
  if (parsed.pathname === '/api/stats') {
    const records = (await loadRecords()).filter(hasUsefulData);
    return json(res, { total: records.length, journals: records.filter(r => r.type === 'journal').length, conferences: records.filter(r => r.type === 'conference').length, sources: [...new Set(records.flatMap(r => r.sources || []))] });
  }
  if (parsed.pathname === '/api/search') {
    const q = (parsed.searchParams.get('q') || '').trim().toLowerCase();
    const type = parsed.searchParams.get('type') || 'all';
    const source = parsed.searchParams.get('source') || 'all';
    const sort = parsed.searchParams.get('sort') || 'rank';
    const page = Math.max(1, Number(parsed.searchParams.get('page') || 1));
    const pageSize = Math.min(50, Math.max(1, Number(parsed.searchParams.get('pageSize') || 15)));
    const records = (await loadRecords()).filter(record => {
      const haystack = [record.title, record.publisher, record.issn, record.eissn, record.sourceId, record.status, record.sourceType, record.coverage, record.homepage, ...(record.aliases || []), ...(record.subjects || []), ...(record.asjcCodes || [])].join(' ').toLowerCase();
      return hasUsefulData(record) && (!q || haystack.includes(q)) && (type === 'all' || record.type === type) && (source === 'all' || (record.sources || []).includes(source));
    });
    const ordered = sortRecords(records, sort);
    const totalPages = Math.max(1, Math.ceil(ordered.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const results = ordered.slice((safePage - 1) * pageSize, safePage * pageSize).map(enrich);
    return json(res, { query: q, total: ordered.length, page: safePage, pageSize, totalPages, sort, results });
  }
  if (parsed.pathname.startsWith('/api/record/')) {
    const id = decodeURIComponent(parsed.pathname.slice('/api/record/'.length));
    const record = (await loadRecords()).find(item => item.id === id);
    return record ? json(res, enrich(record)) : json(res, { error: 'Record not found' }, 404);
  }
  return serveStatic(res, parsed.pathname);
});

await mkdir(path.join(root, 'data', 'imports'), { recursive: true });
server.listen(port, () => console.log(`Research Index running at http://localhost:${port}`));
