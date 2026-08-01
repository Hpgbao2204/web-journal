const $ = selector => document.querySelector(selector);
const state = { page: 1, pageSize: 15 };

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
const safeUrl = value => /^https?:\/\//i.test(String(value || '')) ? String(value) : '';
const valueOrDash = value => value !== undefined && value !== null && String(value).trim() !== '' ? escapeHtml(value) : '<span class="muted">—</span>';
const rank = value => value ? `<span class="rank-pill rank-${escapeHtml(String(value).replace(/[^a-z0-9]/gi, '').toLowerCase())}">${escapeHtml(value)}</span>` : '<span class="muted">—</span>';

function metric(value, label) {
  return value !== undefined && value !== null && String(value).trim() !== '' ? `<span class="metric-line"><b>${escapeHtml(value)}</b> <small>${label}</small></span>` : '';
}

function detailList(record) {
  const details = [
    ['Status', record.status], ['Coverage', record.coverage], ['Open access', record.openAccess],
    ['Language', record.language], ['ASJC', record.asjcCodes?.join(', ')], ['Updated', record.sourceUpdated],
    ['Event dates', [record.conferenceMeta?.startDate, record.conferenceMeta?.endDate].filter(Boolean).join(' → ')], ['Location', record.conferenceMeta?.location],
    ['Deadline', record.deadlines?.join(', ')]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  return details.length ? `<details class="details"><summary>Chi tiết thêm</summary><dl>${details.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></details>` : '';
}

function renderRow(record, index, page, pageSize) {
  const url = safeUrl(record.homepage);
  const title = url ? `<a class="homepage-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(record.title)} ↗</a>` : `<span class="title-text">${escapeHtml(record.title)}</span>`;
  const wos = [metric(record.wos?.impactFactor, 'IF'), record.wos?.quartile ? rank(record.wos.quartile) : ''].filter(Boolean).join('') || '<span class="muted">Không có</span>';
  const scopus = [metric(record.scopus?.citeScore, 'CiteScore'), metric(record.scopus?.snip, 'SNIP'), metric(record.scopus?.sjr, 'SJR'), record.scopus?.quartile ? rank(record.scopus.quartile) : ''].filter(Boolean).join('') || `<span class="metric-line">${valueOrDash(record.sourceType)}</span>`;
  const scimago = [metric(record.scimago?.sjr, 'SJR'), metric(record.scimago?.hIndex, 'H'), record.scimago?.quartile ? rank(record.scimago.quartile) : ''].filter(Boolean).join('') || '<span class="muted">Không có</span>';
  const core = record.core?.rank ? `${rank(record.core.rank)}${metric(record.core.year, 'year')}` : '<span class="muted">—</span>';
  const sourceTags = (record.sources || []).map(source => `<span class="source-tag">${escapeHtml(source)}</span>`).join('');
  return `<tr><td class="number-col">${(page - 1) * pageSize + index + 1}</td><td class="title-col"><div class="title-cell"><div>${title}</div><div class="type-note">${escapeHtml(record.publisher || 'Publisher chưa có dữ liệu')} ${record.eissn ? `· EISSN ${escapeHtml(record.eissn)}` : ''}</div>${detailList(record)}</div></td><td><span class="type-badge">${record.type === 'conference' ? 'Hội nghị' : 'Tạp chí'}</span></td><td><div class="issn-cell"><b>${valueOrDash(record.issn)}</b><small>${record.eissn ? `EISSN ${escapeHtml(record.eissn)}` : 'EISSN —'}</small></div></td><td class="publisher-cell">${valueOrDash(record.publisher)}</td><td>${wos}</td><td>${scopus}</td><td>${scimago}</td><td>${core}</td><td><div class="source-cell">${sourceTags || '<span class="muted">—</span>'}</div></td></tr>`;
}

function renderPagination(data) {
  if (data.totalPages <= 1) { $('#pagination').innerHTML = ''; return; }
  const pages = new Set([1, data.totalPages, data.page - 1, data.page, data.page + 1].filter(page => page > 0 && page <= data.totalPages));
  const items = [...pages].sort((a, b) => a - b); let html = `<button data-page="${data.page - 1}" ${data.page === 1 ? 'disabled' : ''}>← Trước</button>`; let previous = 0;
  for (const page of items) { if (previous && page - previous > 1) html += '<span class="dots">…</span>'; html += `<button class="${page === data.page ? 'active' : ''}" data-page="${page}">${page}</button>`; previous = page; }
  html += `<button data-page="${data.page + 1}" ${data.page === data.totalPages ? 'disabled' : ''}>Sau →</button>`; $('#pagination').innerHTML = html;
  $('#pagination').querySelectorAll('button[data-page]').forEach(button => button.addEventListener('click', () => { state.page = Number(button.dataset.page); search(false); }));
}

async function loadStats() {
  const response = await fetch('/api/stats'); const data = await response.json();
  $('#stats').innerHTML = `<div class="stat"><span class="number">${data.total.toLocaleString()}</span><span class="label">Records indexed</span></div><div class="stat"><span class="number">${data.journals.toLocaleString()}</span><span class="label">Journals</span></div><div class="stat"><span class="number">${data.conferences.toLocaleString()}</span><span class="label">Conferences</span></div><div class="stat"><span class="number">${data.sources.length}</span><span class="label">Data sources</span></div>`;
}

async function search(resetPage = true) {
  if (resetPage) state.page = 1;
  const query = $('#search-input').value.trim();
  const params = new URLSearchParams({ q: query, type: $('#type-filter').value, source: $('#source-filter').value, sort: $('#sort-filter').value, page: state.page, pageSize: state.pageSize });
  $('#results-body').innerHTML = '<tr><td colspan="10" class="loading">Đang tra cứu local index…</td></tr>'; $('#empty').hidden = true;
  const response = await fetch(`/api/search?${params}`); const data = await response.json();
  $('#result-title').textContent = query ? `Kết quả cho “${query}”` : 'Tất cả nguồn dữ liệu';
  $('#result-count').textContent = `${data.total.toLocaleString()} records · ${data.results.length} dòng trên trang này`;
  $('#page-label').textContent = `Trang ${data.page} / ${data.totalPages}`;
  $('#results-body').innerHTML = data.results.map((record, index) => renderRow(record, index, data.page, data.pageSize)).join('');
  $('#empty').hidden = data.results.length > 0;
  renderPagination(data);
}

$('#search-form').addEventListener('submit', event => { event.preventDefault(); search(true); });
$('#type-filter').addEventListener('change', () => search(true)); $('#source-filter').addEventListener('change', () => search(true)); $('#sort-filter').addEventListener('change', () => search(true));
document.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click', () => { $('#search-input').value = button.dataset.query; search(true); }));
loadStats(); search(true);
