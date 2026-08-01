import { writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const getArg = name => args[args.indexOf(name) + 1];
const sourceName = getArg('--source') || 'ICORE2026';
const requestedPages = Number(getArg('--pages') || 0);
const delay = Math.max(0, Number(getArg('--delay') || 150));
const output = path.join(root, 'data', 'imports', `${sourceName.toLowerCase()}-conferences.json`);
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function decodeHtml(value) {
  return clean(String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16))));
}

async function fetchPage(page) {
  const url = new URL('https://portal.core.edu.au/conf-ranks/');
  url.search = new URLSearchParams({ by: 'all', page: String(page), search: '', sort: 'arank', source: sourceName });
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { 'user-agent': 'ResearchIndex/1.0 conference metadata sync' }
  });
  if (!response.ok) throw new Error(`CORE page ${page}: HTTP ${response.status}`);
  return response.text();
}

function parseRows(html) {
  const records = [];
  const rowPattern = /<tr[^>]+onclick="navigate\('([^']+)'\)"[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const match of html.matchAll(rowPattern)) {
    const cells = [...match[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1]);
    if (cells.length < 7) continue;
    const title = decodeHtml(cells[0]);
    const acronym = decodeHtml(cells[1]);
    const rankingSource = decodeHtml(cells[2]);
    const rank = decodeHtml(cells[3]);
    const dblp = cells[5].match(/href=["']([^"']+)["']/i)?.[1] || '';
    if (!title) continue;
    records.push({
      'conference name': title,
      acronym,
      aliases: acronym,
      'source name': rankingSource,
      rank,
      year: rankingSource.match(/(20\d{2})/)?.[1] || '',
      'primary for': decodeHtml(cells[6]),
      'source url': new URL(match[1], 'https://portal.core.edu.au').href,
      dblp
    });
  }
  return records;
}

const firstHtml = await fetchPage(1);
const total = Number(firstHtml.match(/Showing results\s+\d+\s*-\s*\d+\s+of\s+(\d+)/i)?.[1] || 0);
const totalPages = requestedPages > 0 ? requestedPages : Math.max(1, Math.ceil(total / 50));
const records = parseRows(firstHtml);
console.log(`CORE ${sourceName}: page 1/${totalPages}, ${records.length} rows`);

for (let page = 2; page <= totalPages; page += 1) {
  await sleep(delay);
  const pageRecords = parseRows(await fetchPage(page));
  records.push(...pageRecords);
  console.log(`CORE ${sourceName}: page ${page}/${totalPages}, ${pageRecords.length} rows`);
}

const unique = [...new Map(records.map(record => [`${record['conference name'].toLowerCase()}|${record.acronym.toLowerCase()}`, record])).values()];
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(unique, null, 2) + '\n');
console.log(`Saved ${unique.length} conference rows to ${path.relative(root, output)}`);

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'import-data.mjs'), '--source', 'core', '--file', output], { cwd: root, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`CORE import exited with code ${code}`)));
});
