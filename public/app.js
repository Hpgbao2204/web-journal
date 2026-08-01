const $ = selector => document.querySelector(selector);
const pageType = location.pathname.startsWith('/conferences') ? 'conference' : 'journal';
const state = { page: 1, pageSize: 15 };

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
const safeUrl = value => /^https?:\/\//i.test(String(value || '')) ? String(value) : '';
const valueOrDash = value => value !== undefined && value !== null && String(value).trim() !== '' ? escapeHtml(value) : '<span class="muted">—</span>';
const rank = value => value ? `<span class="rank-pill rank-${escapeHtml(String(value).replace(/[^a-z0-9]/gi, '').toLowerCase())}">${escapeHtml(value)}</span>` : '<span class="muted">—</span>';

function metric(value, label) {
  return value !== undefined && value !== null && value !== 0 && String(value).trim() !== '' ? `<span class="metric-line"><b>${escapeHtml(value)}</b> <small>${label}</small></span>` : '';
}

function detailList(record) {
  const details = [
    ['Status', record.status], ['Coverage', record.coverage], ['Open access', record.openAccess],
    ['JCR status', record.wos?.status], ['JCR year', record.wos?.year],
    ['Scopus source ID', record.sourceId], ['Language', record.language], ['ASJC', record.asjcCodes?.join(', ')],
    ['SCImago category', record.scimago?.category], ['SCImago country', record.scimago?.country],
    ['SCImago total docs', record.scimago?.totalDocs], ['SCImago citations 3 years', record.scimago?.totalCitations3Years],
    ['Citations / doc', record.scimago?.citationsPerDoc2Years], ['Refs / doc', record.scimago?.refsPerDoc],
    ['Event dates', [record.conferenceMeta?.startDate, record.conferenceMeta?.endDate].filter(Boolean).join(' → ')],
    ['Location', record.conferenceMeta?.location], ['Deadline', record.deadlines?.join(', ')]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  return details.length ? `<details class="details"><summary>Chi tiết thêm</summary><dl>${details.map(([label, value]) => {
    const url = safeUrl(value);
    const display = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Mở liên kết ↗</a>` : escapeHtml(value);
    return `<div><dt>${label}</dt><dd>${display}</dd></div>`;
  }).join('')}</dl></details>` : '';
}

function titleCell(record) {
  const url = safeUrl(record.homepage);
  const title = url ? `<a class="homepage-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(record.title)} ↗</a>` : `<span class="title-text">${escapeHtml(record.title)}</span>`;
  const note = pageType === 'journal' ? record.publisher : (record.publisher || record.aliases?.[0]);
  return `<td class="title-col"><div class="title-cell"><div>${title}</div><div class="type-note">${escapeHtml(note || 'Chưa có thông tin đơn vị tổ chức')} ${record.eissn ? `· EISSN ${escapeHtml(record.eissn)}` : ''}</div>${detailList(record)}</div></td>`;
}

function issnCell(record) {
  return `<td><div class="issn-cell"><b>${valueOrDash(record.issn)}</b><small>${record.eissn ? `EISSN ${escapeHtml(record.eissn)}` : 'EISSN —'}</small></div></td>`;
}

function wosCell(record) {
  const metrics = [metric(record.wos?.impactFactor, 'IF'), record.wos?.quartile ? rank(record.wos.quartile) : ''].filter(Boolean).join('');
  return metrics || `<span class="metric-line wos-status"><small>${escapeHtml(record.wos?.status || 'Chưa kiểm tra JCR')}</small></span>`;
}

function scopusCell(record) {
  const indexed = (record.sources || []).includes('scopus');
  const scopusUrl = indexed && record.sourceId ? `https://www.scopus.com/source/sourceInfo.url?sourceId=${encodeURIComponent(record.sourceId)}` : '';
  const metrics = [
    metric(record.scopus?.citeScore, 'CiteScore'), metric(record.scopus?.snip, 'SNIP'),
    metric(record.scopus?.sjr, 'SJR'), record.scopus?.quartile ? rank(record.scopus.quartile) : ''
  ].filter(Boolean).join('');
  const membership = indexed ? `<span class="metric-line scopus-indexed"><b>Có</b> <small>trong Scopus</small></span>${scopusUrl ? `<span class="metric-line"><a href="${escapeHtml(scopusUrl)}" target="_blank" rel="noreferrer"><small>Mở Scopus ↗</small></a></span>` : ''}` : '<span class="muted">Chưa xác định</span>';
  const metadata = indexed ? [metric(record.status, 'status'), metric(record.coverage, 'coverage'), metric(record.sourceId, 'source ID')].filter(Boolean).join('') : '';
  return `${membership}${metrics}${metadata}`;
}

function scimagoCell(record) {
  return [metric(record.scimago?.rank, 'rank'), metric(record.scimago?.sjr, 'SJR'), metric(record.scimago?.hIndex, 'H'), record.scimago?.quartile ? rank(record.scimago.quartile) : ''].filter(Boolean).join('') || '<span class="muted">Chưa có</span>';
}

function renderRow(record, index, page, pageSize) {
  const number = `<td class="number-col">${(page - 1) * pageSize + index + 1}</td>`;
  const publisher = `<td class="publisher-cell">${valueOrDash(record.publisher)}</td>`;
  const shared = `${number}${titleCell(record)}${issnCell(record)}${publisher}`;
  if (pageType === 'conference') return `<tr>${shared}<td>${scopusCell(record)}</td><td>${scimagoCell(record)}</td></tr>`;
  return `<tr>${shared}<td>${wosCell(record)}</td><td>${scopusCell(record)}</td><td>${scimagoCell(record)}</td></tr>`;
}

function configurePage() {
  const conference = pageType === 'conference';
  document.title = conference ? 'Conference Search — Research Index' : 'Journal Search — Research Index';
  $('#hero-title').innerHTML = conference ? 'Tìm đúng <em>hội nghị</em><br />cho nghiên cứu.' : 'Tìm đúng <em>tạp chí</em><br />để công bố.';
  $('#hero-subhead').textContent = conference ? 'Tra cứu conference theo tên, ISSN, Scopus và SCImago.' : 'Tra cứu journal theo ISSN, WoS/JCR, Scopus và SCImago.';
  $('#search-input').placeholder = conference ? 'Tên hội nghị, acronym, ISSN hoặc từ khóa...' : 'Tên tạp chí, ISSN hoặc từ khóa...';
  $('#suggestions').innerHTML = conference
    ? '<span>Thử tìm:</span> <button data-query="ICCV">ICCV</button><button data-query="SIGMOD">SIGMOD</button><button data-query="NeurIPS">NeurIPS</button>'
    : '<span>Thử tìm:</span> <button data-query="Nature">Nature</button><button data-query="IEEE Transactions">IEEE Transactions</button><button data-query="machine learning">machine learning</button>';
  $('#results-head').innerHTML = conference
    ? '<th class="number-col">#</th><th class="title-col">Tên / Homepage</th><th>ISSN / EISSN</th><th>Publisher</th><th>Scopus</th><th>SCImago</th>'
    : '<th class="number-col">#</th><th class="title-col">Tên / Homepage</th><th>ISSN / EISSN</th><th>Publisher</th><th>WoS / IF</th><th>Scopus</th><th>SCImago</th>';
  document.querySelectorAll('.section-nav a').forEach(link => link.classList.toggle('active', link.getAttribute('href') === location.pathname));
  document.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click', () => { $('#search-input').value = button.dataset.query; search(true); }));
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
  const response = await fetch(`/api/stats?type=${pageType}`); const data = await response.json();
  const fourth = pageType === 'journal' ? [state.pageSize, 'Dòng / trang'] : [data.withHomepage, 'Có homepage'];
  $('#stats').innerHTML = `<div class="stat"><span class="number">${data.total.toLocaleString()}</span><span class="label">${pageType === 'journal' ? 'Journals' : 'Conferences'}</span></div><div class="stat"><span class="number">${data.scopusIndexed.toLocaleString()}</span><span class="label">Scopus indexed</span></div><div class="stat"><span class="number">${data.scimagoIndexed.toLocaleString()}</span><span class="label">SCImago metrics</span></div><div class="stat"><span class="number">${fourth[0].toLocaleString()}</span><span class="label">${fourth[1]}</span></div>`;
}

async function search(resetPage = true) {
  if (resetPage) state.page = 1;
  const query = $('#search-input').value.trim();
  const params = new URLSearchParams({ q: query, type: pageType, sort: $('#sort-filter').value, page: state.page, pageSize: state.pageSize });
  const columns = pageType === 'journal' ? 7 : 6;
  $('#results-body').innerHTML = `<tr><td colspan="${columns}" class="loading">Đang tra cứu dữ liệu và bổ sung IF/homepage…</td></tr>`; $('#empty').hidden = true;
  const response = await fetch(`/api/search?${params}`); const data = await response.json();
  $('#result-title').textContent = query ? `Kết quả cho “${query}”` : (pageType === 'journal' ? 'Danh sách tạp chí' : 'Danh sách hội nghị');
  $('#result-count').textContent = `${data.total.toLocaleString()} records · ${data.results.length} dòng trên trang này`;
  $('#page-label').textContent = `Trang ${data.page} / ${data.totalPages}`;
  $('#results-body').innerHTML = data.results.map((record, index) => renderRow(record, index, data.page, data.pageSize)).join('');
  $('#empty').hidden = data.results.length > 0;
  renderPagination(data);
}

configurePage();
$('#search-form').addEventListener('submit', event => { event.preventDefault(); search(true); });
$('#sort-filter').addEventListener('change', () => search(true));
loadStats(); search(true);
