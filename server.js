import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dataFile = path.join(root, 'data', 'catalog.json');
const port = Number(process.env.PORT || 3000);
const json = (res, value, status = 200) => { const body = JSON.stringify(value); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); };
async function loadRecords() { try { return JSON.parse(await readFile(dataFile, 'utf8')); } catch { return []; } }
function enrich(record) { const displayRank = record.wos?.quartile || record.scimago?.quartile || record.core?.rank || '—'; return { ...record, displayRank, deadlines: record.deadlines || [] }; }
async function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(requested).replace(/^([.][.][\\/])+/, ''); const file = path.join(publicDir, safe);
  if (!file.startsWith(publicDir)) return json(res, { error: 'Not found' }, 404);
  try { const content = await readFile(file); const ext = path.extname(file); const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' }; res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' }); res.end(content); } catch { json(res, { error: 'Not found' }, 404); }
}
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (parsed.pathname === '/api/health') return json(res, { ok: true, service: 'research-index' });
  if (parsed.pathname === '/api/stats') { const records = await loadRecords(); return json(res, { total: records.length, journals: records.filter(r => r.type === 'journal').length, conferences: records.filter(r => r.type === 'conference').length, sources: [...new Set(records.flatMap(r => r.sources || []))] }); }
  if (parsed.pathname === '/api/search') {
    const q = (parsed.searchParams.get('q') || '').trim().toLowerCase(); const type = parsed.searchParams.get('type') || 'all'; const source = parsed.searchParams.get('source') || 'all';
    const records = await loadRecords(); const results = records.filter(record => { const haystack = [record.title, record.publisher, record.issn, record.eissn, record.acronym, ...(record.aliases || []), ...(record.subjects || [])].join(' ').toLowerCase(); return (!q || haystack.includes(q)) && (type === 'all' || record.type === type) && (source === 'all' || (record.sources || []).includes(source)); }).slice(0, 100).map(enrich);
    return json(res, { query: q, total: results.length, results });
  }
  if (parsed.pathname.startsWith('/api/record/')) { const id = decodeURIComponent(parsed.pathname.slice('/api/record/'.length)); const record = (await loadRecords()).find(item => item.id === id); return record ? json(res, enrich(record)) : json(res, { error: 'Record not found' }, 404); }
  return serveStatic(res, parsed.pathname);
});
await mkdir(path.join(root, 'data', 'imports'), { recursive: true });
server.listen(port, () => console.log(`Research Index running at http://localhost:${port}`));
