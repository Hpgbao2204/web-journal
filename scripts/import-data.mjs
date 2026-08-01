import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogPath = path.join(root, 'data', 'catalog.json');
const args = process.argv.slice(2);
const getArg = name => args[args.indexOf(name) + 1];
const sourceArg = getArg('--source');
const fileArg = getArg('--file');
const sourceNames = { ablesci: 'ablesci', wos: 'ablesci', scopus: 'scopus', scimago: 'scimago', core: 'core' };
const source = sourceNames[sourceArg?.toLowerCase()];

if (!source || !fileArg) {
  console.error('Usage: npm.cmd run import -- --source <ablesci|scopus|scimago|core> --file <path-to-csv-json-xlsx>');
  process.exit(1);
}

const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const identifier = value => clean(value).toLowerCase().replace(/[^0-9x]/g, '');
const splitList = value => clean(value).split(/[;,|]/).map(v => v.trim()).filter(Boolean);
const numberOrNull = value => { const raw = clean(value); if (!raw) return null; const normalized = raw.replace(',', '.').replace(/[^0-9.-]/g, ''); if (!normalized) return null; const n = Number(normalized); return Number.isFinite(n) ? n : null; };

function pick(row, names) {
  const entries = Object.entries(row);
  const wanted = names.map(key);
  const exact = entries.find(([name]) => wanted.includes(key(name)));
  if (exact) return clean(exact[1]);
  const partial = entries.find(([name]) => wanted.some(part => part.length > 3 && key(name).includes(part)));
  return partial ? clean(partial[1]) : '';
}

function csvRows(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const parse = line => {
    const out = []; let cell = ''; let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = !quoted;
      else if (c === ',' && !quoted) { out.push(cell); cell = ''; }
      else cell += c;
    }
    out.push(cell); return out;
  };
  const headers = parse(lines[0]);
  return lines.slice(1).map(line => Object.fromEntries(parse(line).map((value, i) => [headers[i] || `column_${i}`, value])));
}

async function readRows(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') return JSON.parse(await readFile(file, 'utf8'));
  if (ext === '.csv' || ext === '.tsv') return csvRows((await readFile(file, 'utf8')).replaceAll('\t', ','));
  if (ext === '.xlsx' || ext === '.xls') {
    const { read, utils } = await import('xlsx');
    const workbook = read(await readFile(file));
    return utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

function toRecord(row, index) {
  const title = pick(row, ['title', 'source title', 'journal title', 'conference', 'conference name', 'name']) || `Imported ${source} ${index + 1}`;
  const issn = pick(row, ['issn', 'print issn']);
  const eissn = pick(row, ['eissn', 'electronic issn', 'e-issn']);
  const sourceType = pick(row, ['source type', 'publication type', 'type']);
  const asjcCodes = splitList(pick(row, ['asjc', 'all science journal classification codes']));
  const homepage = pick(row, ['homepage', 'home page', 'journal website', 'conference website', 'website']);
  const base = {
    id: `${source}-${(issn || eissn || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
    title,
    type: source === 'core' || /conference|proceedings|symposium|workshop/i.test(`${title} ${sourceType}`) ? 'conference' : 'journal',
    publisher: pick(row, ['publisher']),
    issn,
    eissn,
    sourceId: pick(row, ['source record id', 'sourcerecord id', 'scopus source id']),
    status: pick(row, ['active or inactive', 'status']),
    coverage: pick(row, ['coverage']),
    sourceType,
    openAccess: pick(row, ['open access status', 'open access']),
    language: pick(row, ['article language', 'language']),
    aliases: splitList(pick(row, ['alias', 'aliases', 'acronym', 'related title'])),
    subjects: splitList(pick(row, ['subject', 'subject area', 'category', 'categories'])),
    asjcCodes,
    relatedTitles: splitList(pick(row, ['related title 1', 'other related title'])),
    deadlines: splitList(pick(row, ['deadline', 'submission deadline', 'paper deadline', 'abstract deadline', 'due date'])),
    homepage,
    sources: [source],
    sourceUpdated: pick(row, ['year', 'data year', 'updated', 'update date']) || new Date().getFullYear().toString()
  };
  if (source === 'ablesci') base.wos = { impactFactor: numberOrNull(pick(row, ['impact factor', 'if', '影响因子'])), quartile: pick(row, ['quartile', 'jcr quartile', '分区']), category: pick(row, ['category', 'subject category']) };
  if (source === 'scopus') base.scopus = { citeScore: numberOrNull(pick(row, ['citescore', 'cite score'])), snip: numberOrNull(pick(row, ['snip'])), sjr: numberOrNull(pick(row, ['sjr'])), percentile: pick(row, ['percentile', 'highest percentile']), quartile: pick(row, ['quartile', 'citescore quartile']) };
  if (source === 'scimago') base.scimago = { sjr: numberOrNull(pick(row, ['sjr', 'sjr 2024', 'sjr 2023'])), hIndex: numberOrNull(pick(row, ['h index', 'h-index', 'hindex'])), quartile: pick(row, ['quartile', 'best quartile']), country: pick(row, ['country', 'country/territory']), category: pick(row, ['category', 'categories']) };
  if (source === 'core') base.core = { rank: pick(row, ['rank', 'core rank', 'ranking', 'tier']), year: pick(row, ['year', 'ranking year']) || new Date().getFullYear().toString(), field: pick(row, ['field', 'discipline']) };
  if (homepage) base.links = [{ label: 'Homepage', url: homepage }];
  return base;
}

const rows = await readRows(path.resolve(fileArg));
const incoming = rows.map(toRecord);
const current = JSON.parse(await readFile(catalogPath, 'utf8'));
const identityOf = item => identifier(item.issn) || identifier(item.eissn) || key(item.title);
const metricFields = new Set(['impactFactor', 'citeScore', 'snip', 'sjr', 'hIndex']);
const mergeObject = (oldValue = {}, newValue = {}) => {
  const merged = { ...oldValue };
  for (const [field, value] of Object.entries(newValue)) if (value !== undefined && value !== null && value !== '' && !(metricFields.has(field) && Number(value) === 0)) merged[field] = value;
  return Object.fromEntries(Object.entries(merged).filter(([field, value]) => value !== undefined && value !== null && value !== '' && !(metricFields.has(field) && Number(value) === 0)));
};
const mergeRecords = (old, record) => {
  const merged = { ...old };
  for (const [field, value] of Object.entries(record)) {
    if (['sources', 'links', 'aliases', 'subjects', 'asjcCodes', 'relatedTitles', 'deadlines', 'wos', 'scopus', 'scimago', 'core'].includes(field)) continue;
    if (Array.isArray(value) ? value.length : value !== undefined && value !== null && value !== '') merged[field] = value;
  }
  merged.sources = [...new Set([...(old.sources || []), ...(record.sources || [])])];
  for (const field of ['links', 'aliases', 'subjects', 'asjcCodes', 'relatedTitles', 'deadlines']) merged[field] = [...new Set([...(old[field] || []), ...(record[field] || [])])];
  for (const field of ['wos', 'scopus', 'scimago', 'core']) merged[field] = mergeObject(old[field], record[field]);
  return merged;
};
const byKey = new Map();
for (const item of current) byKey.set(identityOf(item), byKey.has(identityOf(item)) ? mergeRecords(byKey.get(identityOf(item)), item) : item);
for (const record of incoming) {
  const identity = identityOf(record);
  const old = byKey.get(identity);
  if (!old) byKey.set(identity, record);
  else byKey.set(identity, mergeRecords(old, record));
}
await writeFile(catalogPath, JSON.stringify([...byKey.values()], null, 2) + '\n');
console.log(`Imported ${incoming.length} rows from ${source}. Catalog now has ${byKey.size} records.`);
