import {
  escapeHtml,
  escapeVCard,
  formatExternalUrl,
  renderSafeHtml,
  safePhotoUrl,
  safeTelephone
} from './js/security.js';
import { matches, norm } from './js/search.mjs';
import {
  calculateAgeTurning,
  getBirthdaysThisMonth,
  getBirthdaysToday,
  getBirthdaysUpcoming,
  getCountdownToGraduation,
  getCurrentAge,
  isToday,
  parseBirthDate
} from './js/birthday.mjs';

function getPhotoSrc(t) {
  if (!t) return '';
  const candidate = String(t).trim();
  if (candidate.startsWith('data:image/')) {
    return safePhotoUrl(candidate);
  }
  if (candidate.includes('photos/') || candidate.includes('data/photo/')) {
    const separator = candidate.includes('?') ? '&' : '?';
    return safePhotoUrl(`${candidate}${separator}v=20260725-ai-blur`);
  }
  if (!candidate.startsWith('/') && !candidate.includes('/')) {
    const dataUrl = `data:image/jpeg;base64,${candidate}`;
    return safePhotoUrl(dataUrl);
  }
  return safePhotoUrl(candidate);
}

function getPersonPhotoSrc(p, thumbnail = false) {
  const photo = p && p.t ? String(p.t) : '';
  const isCustomPhoto = photo.startsWith('data:image/')
    || photo.includes('photos/edited_')
    || photo.includes('photos/person_');
  if (isCustomPhoto) {
    return getPhotoSrc(photo);
  }

  const no = Number(p && p.no);
  if (Number.isInteger(no) && no >= 1 && no <= 154) {
    const paddedNo = String(no).padStart(3, '0');
    return getPhotoSrc(thumbnail
      ? `photos/thumbs/${paddedNo}.webp`
      : `photos/${paddedNo}.png`);
  }
  return getPhotoSrc(photo);
}

function getNumberedPhotoSrc(p, thumbnail = false) {
  const no = Number(p && p.no);
  if (!Number.isInteger(no) || no < 1 || no > 154) return '';
  const paddedNo = String(no).padStart(3, '0');
  return getPhotoSrc(thumbnail
    ? `photos/thumbs/${paddedNo}.webp`
    : `photos/${paddedNo}.png`);
}

let PEOPLE_BASE = [];
const EDITS_KEY = 'directory268_edits_v1';

async function loadData() {
  let res = await fetch('/api/people', { cache: 'no-store' });
  if (!res.ok) {
    res = await fetch('data/people.json', { cache: 'no-store' });
  }
  if (!res.ok) throw new Error('โหลดรายชื่อไม่สำเร็จ');
  const people = await res.json();
  if (!Array.isArray(people)) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง');
  PEOPLE_BASE = people;
  try {
    const editsRes = await fetch('/api/edits', { cache: 'no-store' });
    if (editsRes.ok) {
      const serverEdits = await editsRes.json();
      if (serverEdits && typeof serverEdits === 'object' && !Array.isArray(serverEdits)) {
        // The server is canonical when reachable, including when it has zero edits.
        localStorage.setItem(EDITS_KEY, JSON.stringify(serverEdits));
      }
    }
  } catch(e) {}
  return PEOPLE_BASE;
}

/* ---------- persistence ---------- */
function getEdits(){
  try{ return JSON.parse(localStorage.getItem(EDITS_KEY) || '{}'); }catch(e){ return {}; }
}
function setEdits(obj){
  try{ localStorage.setItem(EDITS_KEY, JSON.stringify(obj)); }catch(e){ showToast('บันทึกไม่สำเร็จ (พื้นที่จัดเก็บเต็ม)'); }
}

function mergedPerson(no){
  const base = PEOPLE_BASE.find(p => p.no === no);
  const edits = getEdits();
  const merged = { ...base, ...(edits[no] || {}) };
  merged.age = getCurrentAge(merged.birth, merged.age);
  return merged;
}
function isEdited(no){
  const edits = getEdits();
  return !!edits[no] && Object.keys(edits[no]).length > 0;
}
function allMerged(){
  return PEOPLE_BASE.map(p => mergedPerson(p.no));
}

/* ---------- dom refs ---------- */
const $list = document.getElementById('list');
const $search = document.getElementById('search');
const $clear = document.getElementById('clearBtn');
const $quickFilters = document.getElementById('quickFilters');
const $empty = document.getElementById('empty');
const $countLine = document.getElementById('countLine');
const $loadingState = document.getElementById('loadingState');
const $errorState = document.getElementById('errorState');
const $connectionStatus = document.getElementById('connectionStatus');
const $backdrop = document.getElementById('backdrop');
const $sheet = document.getElementById('sheet');
const $sheetBody = document.getElementById('sheetBody');
const $toast = document.getElementById('toast');
const $photoViewer = document.getElementById('photoViewer');
const $photoViewerImage = document.getElementById('photoViewerImage');
const $photoViewerClose = document.getElementById('photoViewerClose');
const $photoInput = document.getElementById('photoInput');

document.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.dataset.fallbackSrc) return;
  const fallbackSrc = image.dataset.fallbackSrc;
  delete image.dataset.fallbackSrc;
  image.src = fallbackSrc;
  if (image.dataset.fallbackFullSrc) {
    image.dataset.fullSrc = image.dataset.fallbackFullSrc;
    delete image.dataset.fallbackFullSrc;
  }
}, true);

function highlight(text, q){
  const safe = escapeHtml(text);
  if(!q) return safe;
  try{
    const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'ig');
    return safe.replace(re, '<mark>$1</mark>');
  }catch(e){ return safe; }
}

function batchCategory(p){
  const batch = norm(p && p.batch);
  if(batch.includes('กอน')) return 'กอน';
  if(batch.includes('กอส')) return 'กอส';
  if(batch.includes('นรต')) return 'นรต';
  return 'other';
}

function getBirthTimestamp(p) {
  const parsed = parseBirthDate(p.birth);
  if (!parsed) return Infinity;
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day);
}

let activeFilter = 'all';

function formatPhone(p){
  if(p && p.length === 10) return p.slice(0,3)+'-'+p.slice(3,6)+'-'+p.slice(6);
  return p;
}

function cardHtml(p, q, seniorityRank){
  const edited = isEdited(p.no);
  return `
  <div class="card" data-no="${p.no}" role="button" tabindex="0" aria-label="เปิดข้อมูล ${escapeHtml(p.rank)} ${escapeHtml(p.name)} ลำดับที่ ${p.no}">
    <div class="thumb-wrap">
      <img class="thumb" src="${getPersonPhotoSrc(p, true)}" data-full-src="${getPersonPhotoSrc(p)}" data-fallback-src="${getNumberedPhotoSrc(p, true)}" data-fallback-full-src="${getNumberedPhotoSrc(p)}" alt="${escapeHtml(p.rank)}${escapeHtml(p.name)}" loading="lazy" decoding="async">
      <span class="edited-dot ${edited ? 'show' : ''}"></span>
    </div>
    <div class="card-mid">
      <div class="name-row">
        <span class="rank">${highlight(p.rank, q)}</span>
        <span class="name">${highlight(p.name, q)}</span>
        ${p.nick && p.nick !== '-' ? `<span class="nick">"${highlight(p.nick, q)}"</span>` : ''}
      </div>
      <div class="pos">${highlight(p.pos, q)}</div>
      ${p.committeeRole ? `<div class="committee-role">${highlight(p.committeeRole, q)}</div>` : ''}
      <div class="tag-row">
        <span class="tag">${highlight(p.unit, q)}</span>
        <span class="tag">${highlight(p.batch, q)}</span>
      </div>
    </div>
    <div class="card-side">
      <span class="no-badge mono">#${p.no}</span>
      ${seniorityRank ? `<span class="seniority-rank">อาวุโสที่ ${seniorityRank}</span>` : `<span class="phone mono">${highlight(formatPhone(p.phone), q)}</span>`}
      <span class="age">อายุ ${escapeHtml(p.age || '-')}</span>
    </div>
  </div>`;
}

function render(){
  $loadingState.hidden = true;
  $errorState.hidden = true;
  updateBirthdayBadge();
  updateCountdownBar();
  const q = norm($search.value.trim());
  $clear.classList.toggle('show', q.length > 0);
  const all = allMerged();
  const $countBadge = document.getElementById('countBadge');
  if ($countBadge) $countBadge.textContent = `${all.length} นาย`;
  const categoryCounts = { all: all.length, 'กอน': 0, 'กอส': 0, 'นรต': 0, other: 0, 'additional-role': 0 };
  all.forEach(p => {
    categoryCounts[batchCategory(p)]++;
    if(String(p.committeeRole || '').trim()) categoryCounts['additional-role']++;
  });
  $quickFilters.querySelectorAll('.filter-chip').forEach(button => {
    const selected = button.dataset.filter === activeFilter;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
    const countEl = button.querySelector('.filter-count');
    if (countEl) {
      if (button.dataset.filter === 'seniority') {
        countEl.textContent = '';
      } else {
        countEl.textContent = categoryCounts[button.dataset.filter] || 0;
      }
    }
  });

  // Build seniority rank map (across all 154 people, regardless of filter)
  let seniorityRankMap = {};
  if (activeFilter === 'seniority') {
    const sortedAll = [...all].sort((a, b) => getBirthTimestamp(a) - getBirthTimestamp(b) || a.no - b.no);
    sortedAll.forEach((p, i) => { seniorityRankMap[p.no] = i + 1; });
  }

  const filtered = all.filter(p =>
    matches(p, q) && (
      activeFilter === 'all' ||
      activeFilter === 'seniority' ||
      (activeFilter === 'additional-role'
        ? Boolean(String(p.committeeRole || '').trim())
        : batchCategory(p) === activeFilter)
    )
  );

  // Sort filtered list by seniority when in seniority mode
  if (activeFilter === 'seniority') {
    filtered.sort((a, b) => getBirthTimestamp(a) - getBirthTimestamp(b) || a.no - b.no);
  }

  if(filtered.length === 0){
    $list.replaceChildren();
    $empty.style.display = 'flex';
    $countLine.textContent = '';
  }else{
    $empty.style.display = 'none';
    const filteredView = q || activeFilter !== 'all';
    renderSafeHtml($countLine, filteredView
      ? `<div class="filter-summary"><span>พบ ${filtered.length} รายชื่อ</span><button class="reset-filters" id="resultResetBtn" type="button">ล้างตัวกรอง</button></div>`
      : `รายชื่อทั้งหมด ${filtered.length} นาย`);
    $list.innerHTML = filtered.map(p => cardHtml(p, q, seniorityRankMap[p.no])).join('');
  }
}

let searchAnimationFrame = null;
$search.addEventListener('input', () => {
  if (searchAnimationFrame) cancelAnimationFrame(searchAnimationFrame);
  searchAnimationFrame = requestAnimationFrame(render);
});
$clear.addEventListener('click', () => { $search.value=''; render(); $search.focus(); });
function resetDiscovery(){
  $search.value = '';
  activeFilter = 'all';
  render();
  $search.focus();
}
document.getElementById('emptyResetBtn').addEventListener('click', resetDiscovery);
$countLine.addEventListener('click', (event) => {
  if(event.target.closest('#resultResetBtn')) resetDiscovery();
});
$quickFilters.addEventListener('click', (event) => {
  const button = event.target.closest('.filter-chip');
  if(!button) return;
  activeFilter = button.dataset.filter;
  render();
  button.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
});

$list.addEventListener('click', (e) => {
  const photo = e.target.closest('.thumb');
  if(photo){
    openPhotoViewer(photo.dataset.fullSrc || photo.src, photo.alt);
    return;
  }
  const card = e.target.closest('.card');
  if(!card) return;
  const no = parseInt(card.dataset.no, 10);
  openPersonSheet(no);
});
$list.addEventListener('keydown', (event) => {
  if(event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('.card');
  if(!card) return;
  event.preventDefault();
  openPersonSheet(parseInt(card.dataset.no, 10));
});

function updateConnectionStatus(){
  const offline = !navigator.onLine;
  $connectionStatus.classList.toggle('show', offline);
  $connectionStatus.textContent = offline ? 'ออฟไลน์ · แสดงข้อมูลที่บันทึกไว้' : '';
}
window.addEventListener('online', () => {
  updateConnectionStatus();
  showToast('กลับมาออนไลน์แล้ว');
});
window.addEventListener('offline', () => {
  updateConnectionStatus();
  showToast('ออฟไลน์ · บางการทำงานอาจไม่พร้อมใช้งาน');
});
updateConnectionStatus();

/* ---------- generic sheet open/close & history state ---------- */
let lastFocusedElement = null;
let isModalHistoryPushed = false;

function openSheetRaw(html){
  if(!$sheet.classList.contains('show')) lastFocusedElement = document.activeElement;
  renderSafeHtml($sheetBody, html);
  $backdrop.classList.add('show');
  $sheet.classList.add('show');
  document.body.style.overflow = 'hidden';
  $sheet.scrollTop = 0;

  if(!isModalHistoryPushed){
    try{ history.pushState({ modalOpen: true }, ''); }catch(e){}
    isModalHistoryPushed = true;
  }

  requestAnimationFrame(() => {
    const focusTarget = $sheetBody.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if(focusTarget) focusTarget.focus();
  });
}

function closeSheet(){
  $sheet.classList.remove('show');
  if (!$birthdayModal.classList.contains('open') && !$photoViewer.classList.contains('show')) {
    $backdrop.classList.remove('show');
    document.body.style.overflow = '';
  }
  if(lastFocusedElement && document.contains(lastFocusedElement)) lastFocusedElement.focus();
  lastFocusedElement = null;

  if(isModalHistoryPushed && !$birthdayModal.classList.contains('open') && !$photoViewer.classList.contains('show')){
    isModalHistoryPushed = false;
    try{ if(history.state && history.state.modalOpen) history.back(); }catch(e){}
  }
}
$backdrop.addEventListener('click', () => {
  if ($sheet.classList.contains('show')) {
    closeSheet();
  } else if ($linksModal && $linksModal.classList.contains('open')) {
    closeLinksModal();
  } else if ($birthdayModal.classList.contains('open')) {
    closeBirthdayModal();
  }
});

/* ---------- links modal & management ---------- */
const $linksBtn = document.getElementById('linksBtn');
const $linksModal = document.getElementById('linksModal');
const $linksModalClose = document.getElementById('linksModalClose');
const $linksModalBody = document.getElementById('linksModalBody');

async function openLinksModal() {
  lastFocusedElement = document.activeElement;
  await renderLinksModal();
  $backdrop.classList.add('show');
  if ($linksModal) $linksModal.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (!isModalHistoryPushed) {
    try { history.pushState({ modalOpen: true }, ''); } catch (e) {}
    isModalHistoryPushed = true;
  }
}

function closeLinksModal() {
  if ($linksModal) $linksModal.classList.remove('open');
  if (!$sheet.classList.contains('show') && !$birthdayModal.classList.contains('open')) {
    $backdrop.classList.remove('show');
    document.body.style.overflow = '';
  }
  if (lastFocusedElement && document.contains(lastFocusedElement)) {
    lastFocusedElement.focus();
  }
  lastFocusedElement = null;

  if (isModalHistoryPushed && !$sheet.classList.contains('show') && !$birthdayModal.classList.contains('open') && !$photoViewer.classList.contains('show')) {
    isModalHistoryPushed = false;
    try { if (history.state && history.state.modalOpen) history.back(); } catch (e) {}
  }
}

async function renderLinksModal() {
  if (!$linksModalBody) return;
  renderSafeHtml($linksModalBody, `
    <div class="state-panel">
      <div class="spinner" aria-hidden="true"></div>
      <div class="state-title">กำลังโหลดลิงก์</div>
    </div>
  `);
  try {
    const res = await fetch('/api/links', { cache: 'no-store' });
    if (!res.ok) throw new Error('Fetch failed');
    const links = await res.json();

    if (!Array.isArray(links) || links.length === 0) {
      renderSafeHtml($linksModalBody, `
        <div class="birthday-empty">
          ยังไม่มีลิงก์ย่อยในระบบ<br>
          <span style="font-size:12px;color:var(--muted);">ผู้ดูแลสามารถเพิ่มลิงก์ได้ที่เมนูผู้ดูแล</span>
        </div>
      `);
      return;
    }

    const html = links.map(link => {
      const formattedUrl = formatExternalUrl(link.url);
      return `
        <a class="link-card-item" href="${escapeHtml(formattedUrl)}" data-url="${escapeHtml(formattedUrl)}" target="_blank" rel="noopener noreferrer">
          <div class="link-info">
            <div class="link-title">${escapeHtml(link.title)}</div>
            ${link.description ? `<div class="link-desc">${escapeHtml(link.description)}</div>` : ''}
            <div class="link-url-text">${escapeHtml(formattedUrl)}</div>
          </div>
          <div class="link-open-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </div>
        </a>
      `;
    }).join('');

    renderSafeHtml($linksModalBody, html);

    $linksModalBody.querySelectorAll('.link-card-item').forEach(card => {
      card.addEventListener('click', (e) => {
        const rawUrl = card.dataset.url || card.getAttribute('href');
        if (!rawUrl) return;
        const url = formatExternalUrl(rawUrl);

        const isMobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

        if (isMobile || isStandalone) {
          e.preventDefault();
          const win = window.open(url, '_blank', 'noopener,noreferrer');
          if (!win || win.closed || typeof win.closed === 'undefined') {
            window.location.href = url;
          }
        }
      });
    });
  } catch (e) {
    renderSafeHtml($linksModalBody, `
      <div class="birthday-empty">
        ไม่สามารถโหลดลิงก์ได้ กรุณาลองใหม่อีกครั้ง
      </div>
    `);
  }
}

if ($linksBtn) $linksBtn.addEventListener('click', openLinksModal);
if ($linksModalClose) $linksModalClose.addEventListener('click', closeLinksModal);

/* ---------- birthday modal & system ---------- */
const $birthdayBtn = document.getElementById('birthdayBtn');
const $birthdayBadge = document.getElementById('birthdayBadge');
const $birthdayModal = document.getElementById('birthdayModal');
const $birthdayModalClose = document.getElementById('birthdayModalClose');
const $birthdayModalBody = document.getElementById('birthdayModalBody');
const $tabCountToday = document.getElementById('tabCountToday');
const $tabCountUpcoming = document.getElementById('tabCountUpcoming');
const $tabCountMonth = document.getElementById('tabCountMonth');

let activeBirthdayTab = 'today';

function updateBirthdayBadge() {
  const people = allMerged();
  const todayList = getBirthdaysToday(people);
  if (todayList.length > 0) {
    $birthdayBadge.textContent = todayList.length;
    $birthdayBadge.classList.add('show');
  } else {
    $birthdayBadge.classList.remove('show');
  }
}

function updateCountdownBar() {
  const $countdownBar = document.getElementById('countdownBar');
  if (!$countdownBar) return;
  const countdown = getCountdownToGraduation(new Date());

  if (countdown.isToday) {
    renderSafeHtml($countdownBar, `<span>วันนี้วันจบหลักสูตรสารวัตร รุ่น 268 (18 ก.ย. 2569)</span>`);
  } else if (countdown.isPassed) {
    renderSafeHtml($countdownBar, `<span>จบหลักสูตรสารวัตร รุ่น 268 เรียบร้อยแล้ว (18 ก.ย. 2569)</span>`);
  } else {
    renderSafeHtml($countdownBar, `<span>เหลืออีก <strong class="count-highlight">${countdown.days}</strong> วัน จะจบหลักสูตรสารวัตร (18 ก.ย. 69)</span>`);
  }
}

function openBirthdayModal() {
  lastFocusedElement = document.activeElement;
  renderBirthdayModal(activeBirthdayTab);
  $backdrop.classList.add('show');
  $birthdayModal.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (!isModalHistoryPushed) {
    try { history.pushState({ modalOpen: true }, ''); } catch (e) {}
    isModalHistoryPushed = true;
  }
}

function closeBirthdayModal(skipHistory = false) {
  $birthdayModal.classList.remove('open');
  if (!$sheet.classList.contains('show')) {
    $backdrop.classList.remove('show');
    document.body.style.overflow = '';
  }
  if (lastFocusedElement && document.contains(lastFocusedElement)) {
    lastFocusedElement.focus();
  }
  lastFocusedElement = null;

  if (!skipHistory && isModalHistoryPushed && !$sheet.classList.contains('show') && !$photoViewer.classList.contains('show')) {
    isModalHistoryPushed = false;
    try { if (history.state && history.state.modalOpen) history.back(); } catch (e) {}
  }
}

function renderBirthdayModal(tab = 'today') {
  activeBirthdayTab = tab;
  const people = allMerged();
  const todayList = getBirthdaysToday(people);
  const upcomingList = getBirthdaysUpcoming(people, new Date(), 14);
  const monthList = getBirthdaysThisMonth(people);

  if ($tabCountToday) $tabCountToday.textContent = todayList.length;
  if ($tabCountUpcoming) $tabCountUpcoming.textContent = upcomingList.length;
  if ($tabCountMonth) $tabCountMonth.textContent = monthList.length;

  document.querySelectorAll('.birthday-tab').forEach(btn => {
    const isTarget = btn.dataset.tab === tab;
    btn.classList.toggle('active', isTarget);
    btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });

  let targetList = [];
  let emptyMsg = '';

  if (tab === 'today') {
    targetList = todayList;
    emptyMsg = 'ไม่มีเพื่อนร่วมรุ่นที่มีวันเกิดตรงกับวันนี้';
  } else if (tab === 'upcoming') {
    targetList = upcomingList;
    emptyMsg = 'ไม่มีวันเกิดในอีก 14 วันข้างหน้า';
  } else {
    targetList = monthList;
    emptyMsg = 'ไม่มีเพื่อนร่วมรุ่นที่มีวันเกิดในเดือนนี้';
  }

  if (targetList.length === 0) {
    renderSafeHtml($birthdayModalBody, `<div class="birthday-empty">${escapeHtml(emptyMsg)}</div>`);
    return;
  }

  const now = new Date();
  const html = targetList.map(p => {
    let tag = '';
    if (tab === 'today') {
      const turningAge = calculateAgeTurning(p.birth, now);
      tag = `<div class="birthday-item-tag">เกิดวันนี้${turningAge ? ` (อายุครบ ${turningAge} ปี)` : ''}</div>`;
    } else if (tab === 'upcoming') {
      const turningAge = calculateAgeTurning(p.birth, now);
      tag = `<div class="birthday-item-tag">อีก ${p.daysUntil} วัน (${escapeHtml(p.birth)})${turningAge ? ` (อายุครบ ${turningAge} ปี)` : ''}</div>`;
    } else {
      const turningAge = calculateAgeTurning(p.birth, now);
      const isBirthdayToday = isToday(p.birth, now);
      tag = `<div class="birthday-item-tag">${isBirthdayToday ? 'วันนี้ ' : ''}(${escapeHtml(p.birth)})${turningAge ? ` (อายุครบ ${turningAge} ปี)` : ''}</div>`;
    }

    return `
      <div class="birthday-card-item" data-no="${p.no}" role="button" tabindex="0" aria-label="${escapeHtml(p.rank)}${escapeHtml(p.name)}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          ${tag}
        </div>
        ${cardHtml(p, '')}
      </div>
    `;
  }).join('');

  renderSafeHtml($birthdayModalBody, html);

  $birthdayModalBody.querySelectorAll('.birthday-card-item').forEach(card => {
    card.addEventListener('click', (e) => {
      const photo = e.target.closest('.thumb');
      if (photo) {
        openPhotoViewer(photo.dataset.fullSrc || photo.src, photo.alt);
        return;
      }
      const no = parseInt(card.dataset.no, 10);
      openPersonSheet(no);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const no = parseInt(card.dataset.no, 10);
        openPersonSheet(no);
      }
    });
  });
}

if ($birthdayBtn) {
  $birthdayBtn.addEventListener('click', openBirthdayModal);
}
if ($birthdayModalClose) {
  $birthdayModalClose.addEventListener('click', closeBirthdayModal);
}
document.querySelectorAll('.birthday-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    renderBirthdayModal(btn.dataset.tab);
  });
});

/* ---------- full-size photo viewer ---------- */
function openPhotoViewer(src, alt = ''){
  if(!src) return;
  $photoViewerImage.src = src;
  $photoViewerImage.alt = alt;
  $photoViewer.classList.add('show');
  document.body.style.overflow = 'hidden';

  if(!isModalHistoryPushed){
    try{ history.pushState({ modalOpen: true }, ''); }catch(e){}
    isModalHistoryPushed = true;
  }

  $photoViewerClose.focus();
}

function closePhotoViewer(){
  $photoViewer.classList.remove('show');
  document.body.style.overflow = $sheet.classList.contains('show') ? 'hidden' : '';

  if(isModalHistoryPushed && !$sheet.classList.contains('show')){
    isModalHistoryPushed = false;
    try{ if(history.state && history.state.modalOpen) history.back(); }catch(e){}
  }

  setTimeout(() => {
    if(!$photoViewer.classList.contains('show')) $photoViewerImage.src = '';
  }, 200);
}

$photoViewerClose.addEventListener('click', closePhotoViewer);
$photoViewer.addEventListener('click', (e) => {
  if(e.target === $photoViewer) closePhotoViewer();
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && $photoViewer.classList.contains('show')){
    closePhotoViewer();
  }else if(e.key === 'Escape' && $birthdayModal.classList.contains('open')){
    closeBirthdayModal();
  }
});

window.addEventListener('popstate', () => {
  if($photoViewer.classList.contains('show')){
    closePhotoViewer();
  }else if($birthdayModal.classList.contains('open')){
    closeBirthdayModal();
  }else if($sheet.classList.contains('show')){
    closeSheet();
  }
  isModalHistoryPushed = false;
});

/* ---------- person detail sheet ---------- */
function openPersonSheet(no){
  const p = mergedPerson(no);
  const nickHtml = (p.nick && p.nick !== '-') ? `<div class="sheet-nick">ชื่อเล่น "${escapeHtml(p.nick)}"</div>` : '';
  openSheetRaw(`
    <div class="sheet-topbar">
      <button class="icon-btn" id="editPersonBtn" aria-label="แก้ไขข้อมูล">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="icon-btn" id="closeSheetBtn" aria-label="ปิด">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="sheet-head">
      <img class="sheet-photo" src="${getPersonPhotoSrc(p, true)}" data-full-src="${getPersonPhotoSrc(p)}" data-fallback-src="${getNumberedPhotoSrc(p, true)}" data-fallback-full-src="${getNumberedPhotoSrc(p)}" alt="${escapeHtml(p.rank)}${escapeHtml(p.name)}" decoding="async">
      <div>
        <span class="sheet-id">ลำดับที่ <span class="mono">${p.no}</span></span>
        <div class="sheet-name">${escapeHtml(p.rank)} ${escapeHtml(p.name)}</div>
        ${nickHtml}
      </div>
    </div>
    <div class="detail-rows">
      <div class="drow"><div class="k">ตำแหน่ง</div><div class="v">${escapeHtml(p.pos)}</div></div>
      ${p.committeeRole ? `<div class="drow"><div class="k">หน้าที่เพิ่มเติม</div><div class="v" style="white-space:pre-line">${escapeHtml(p.committeeRole)}</div></div>` : ''}
      <div class="drow"><div class="k">หน่วย</div><div class="v">${escapeHtml(p.unit)}</div></div>
      <div class="drow"><div class="k">รุ่นอบรม</div><div class="v">${escapeHtml(p.batch)}</div></div>
      <div class="drow"><div class="k">วันเกิด</div><div class="v">${escapeHtml(p.birth)}</div></div>
      <div class="drow"><div class="k">อายุ</div><div class="v">${escapeHtml(p.age)}</div></div>
      <div class="drow"><div class="k">เบอร์โทร</div><div class="v phone-v">${escapeHtml(formatPhone(p.phone))}</div></div>
    </div>
    <div class="actions">
      <button class="btn btn-primary" id="callPersonBtn" type="button">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        โทรออก
      </button>
      <button class="btn btn-ghost" id="saveContactBtn" type="button">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
        บันทึกรายชื่อ
      </button>
      <button class="btn btn-ghost" id="sharePersonBtn" type="button">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        แชร์ข้อมูล
      </button>
    </div>
  `);
  $sheetBody.querySelector('.sheet-photo').addEventListener('click', (e) => {
    openPhotoViewer(e.currentTarget.dataset.fullSrc || e.currentTarget.src, e.currentTarget.alt);
  });
  document.getElementById('callPersonBtn').addEventListener('click', () => {
    const telephone = safeTelephone(p.phone);
    if(!telephone){
      showToast('หมายเลขโทรศัพท์ไม่ถูกต้อง');
      return;
    }
    const cleanTel = telephone.replace(/[^0-9+]/g, '');
    window.location.href = `tel:${cleanTel}`;
  });
  document.getElementById('saveContactBtn').addEventListener('click', () => {
    saveContact(p);
  });
  document.getElementById('sharePersonBtn').addEventListener('click', async () => {
    const nickStr = (p.nick && p.nick !== '-') ? ` ("${p.nick}")` : '';
    const shareText = `ทำเนียบรุ่น 268: ลำดับที่ ${p.no} ${p.rank}${p.name}${nickStr}\nตำแหน่ง: ${p.pos}\nหน่วย: ${p.unit}\nเบอร์โทร: ${formatPhone(p.phone) || p.phone || '-'}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `ทำเนียบ 268 - ${p.rank}${p.name}`,
          text: shareText,
          url: window.location.href
        });
        showToast('แชร์ข้อมูลเรียบร้อยแล้ว');
      } catch (err) {
        if (err.name !== 'AbortError') {
          copyToClipboardFallback(shareText, 'คัดลอกข้อมูลรายชื่อสำหรับแชร์แล้ว');
        }
      }
    } else {
      copyToClipboardFallback(shareText, 'คัดลอกข้อมูลรายชื่อสำหรับแชร์แล้ว');
    }
  });
  document.getElementById('closeSheetBtn').addEventListener('click', closeSheet);
  document.getElementById('editPersonBtn').addEventListener('click', () => openEditSheet(no));
}

/* ---------- edit form sheet ---------- */
let editingNo = null;
let editingPhotoB64 = null;
let editingVersion = null;

async function openEditSheet(no){
  editingNo = no;
  editingPhotoB64 = null;
  editingVersion = null;
  openSheetRaw(`
    <div class="state-panel">
      <div class="spinner" aria-hidden="true"></div>
      <div class="state-title">กำลังโหลดข้อมูลล่าสุด</div>
    </div>
  `);

  try {
    const latestRes = await fetch(`/api/edits/${no}`, { cache: 'no-store' });
    if(!latestRes.ok) throw new Error('latest edit unavailable');
    const latest = await latestRes.json();
    editingVersion = latest.version;
    const edits = getEdits();
    if(latest.data && Object.keys(latest.data).length > 0) edits[no] = latest.data;
    else delete edits[no];
    setEdits(edits);
  } catch(e) {
    // Offline fallback: allow a local edit, but do not overwrite the server.
    editingVersion = null;
  }

  const p = mergedPerson(no);
  const edited = isEdited(no);
  openSheetRaw(`
    <div class="sheet-topbar">
      <button class="icon-btn" id="closeSheetBtn" aria-label="ปิด">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="edit-photo-row">
      <button class="edit-photo-btn" id="editPhotoBtn" type="button" aria-label="เปลี่ยนรูปประจำตัว">
        <img id="editPhotoPreview" src="${getPersonPhotoSrc(p)}" alt="${escapeHtml(p.rank)}${escapeHtml(p.name)}">
        <span class="edit-photo-overlay">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </span>
      </button>
    </div>
    <div class="field-row">
      <div class="field"><label>ยศ</label><input id="f_rank" value="${escapeHtml(p.rank)}"></div>
      <div class="field"><label>ชื่อเล่น</label><input id="f_nick" value="${escapeHtml(p.nick)}"></div>
    </div>
    <div class="field">
      <label for="f_name">ชื่อ-สกุล *</label>
      <input id="f_name" value="${escapeHtml(p.name)}" required aria-describedby="f_name_error">
      <div class="field-error" id="f_name_error" role="alert"></div>
    </div>
    <div class="field"><label>ตำแหน่ง</label><input id="f_pos" value="${escapeHtml(p.pos)}"></div>
    <div class="field"><label>หน้าที่เพิ่มเติม</label><textarea id="f_committeeRole" rows="3">${escapeHtml(p.committeeRole || '')}</textarea></div>
    <div class="field-row">
      <div class="field"><label>หน่วย</label><input id="f_unit" value="${escapeHtml(p.unit)}"></div>
      <div class="field"><label>รุ่นอบรม</label><input id="f_batch" value="${escapeHtml(p.batch)}"></div>
    </div>
    <div class="field">
      <label for="f_phone">เบอร์โทร</label>
      <input id="f_phone" value="${escapeHtml(p.phone)}" inputmode="tel" autocomplete="tel" aria-describedby="f_phone_error">
      <div class="field-error" id="f_phone_error" role="alert"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>วันเกิด</label><input id="f_birth" value="${escapeHtml(p.birth)}"></div>
      <div class="field"><label>อายุ (คำนวณอัตโนมัติ)</label><input id="f_age" value="${escapeHtml(p.age)}" readonly disabled style="opacity:.85;cursor:not-allowed;background:var(--surface);"></div>
    </div>
    <div class="form-note">ตรวจสอบข้อมูลก่อนส่ง คำขอจะมีผลเมื่อผู้ดูแลอนุมัติแล้ว</div>
    ${edited ? `<button class="revert-link" id="revertBtn">คืนค่าเดิม (ยกเลิกการแก้ไขทั้งหมดของคนนี้)</button>` : ''}
    <div class="actions">
      <button class="btn btn-ghost" id="cancelEditBtn">ยกเลิก</button>
      <button class="btn btn-primary" id="saveEditBtn">ส่งคำขอแก้ไข</button>
    </div>
  `);
  document.getElementById('closeSheetBtn').addEventListener('click', closeSheet);
  document.getElementById('cancelEditBtn').addEventListener('click', () => openPersonSheet(no));
  document.getElementById('saveEditBtn').addEventListener('click', () => submitEdit(no));
  document.getElementById('editPhotoBtn').addEventListener('click', () => $photoInput.click());

  const fBirth = document.getElementById('f_birth');
  const fAge = document.getElementById('f_age');
  if (fBirth && fAge) {
    fBirth.addEventListener('input', () => {
      const calculated = getCurrentAge(fBirth.value.trim());
      if (calculated && calculated !== '-') {
        fAge.value = calculated;
      }
    });
  }
  const revertBtn = document.getElementById('revertBtn');
  if(revertBtn) revertBtn.addEventListener('click', async () => {
    if(!confirm('คืนข้อมูลและรูปของบุคคลนี้กลับเป็นค่าต้นฉบับใช่หรือไม่?')) return;
    if(editingVersion === null){
      showToast('ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อส่งคำขอ');
      return;
    }
    let res;
    try {
      res = await fetch(`/api/edit-requests/${no}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {}, expectedVersion: editingVersion })
      });
    } catch(e) {
      showToast('คืนค่าไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต');
      return;
    }
    if(res.status === 409){
      alert('ข้อมูลถูกแก้ไขจากอีกเครื่องแล้ว กรุณาตรวจสอบข้อมูลล่าสุดอีกครั้ง');
      openEditSheet(no);
      return;
    }
    if(!res.ok){
      showToast('คืนค่าไม่สำเร็จ กรุณาลองใหม่');
      return;
    }
    showToast('ส่งคำขอคืนค่าแล้ว รอผู้ดูแลอนุมัติ');
    await refreshPendingCount();
    openPersonSheet(no);
  });
}

$photoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){
    showToast('กรุณาเลือกไฟล์รูปภาพ');
    $photoInput.value = '';
    return;
  }
  if(file.size > 10 * 1024 * 1024){
    showToast('รูปมีขนาดเกิน 10 MB');
    $photoInput.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const MAX_EDGE = 1600;
      const MAX_IMAGE_BYTES = 500 * 1024;
      let scale = Math.min(1, MAX_EDGE / img.width, MAX_EDGE / img.height);
      let quality = 0.86;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      let dataUrl = '';

      for(let attempt = 0; attempt < 20; attempt += 1){
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL('image/jpeg', quality);
        const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const decodedBytes = Math.floor(encoded.length * 3 / 4);
        if(decodedBytes <= MAX_IMAGE_BYTES) break;
        if(quality > 0.54) quality -= 0.08;
        else {
          scale *= 0.82;
          quality = 0.78;
        }
      }

      const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if(Math.floor(encoded.length * 3 / 4) > MAX_IMAGE_BYTES){
        showToast('รูปมีรายละเอียดสูงเกินไป กรุณาเลือกรูปอื่น');
        return;
      }
      editingPhotoB64 = dataUrl;
      document.getElementById('editPhotoPreview').src = dataUrl;
    };
    img.onerror = () => showToast('ไม่สามารถเปิดไฟล์รูปนี้ได้');
    img.src = ev.target.result;
  };
  reader.onerror = () => showToast('ไม่สามารถอ่านไฟล์รูปนี้ได้');
  reader.readAsDataURL(file);
  $photoInput.value = '';
});

async function submitEdit(no){
  const nameInput = document.getElementById('f_name');
  const phoneInput = document.getElementById('f_phone');
  const nameError = document.getElementById('f_name_error');
  const phoneError = document.getElementById('f_phone_error');
  const normalizedPhone = phoneInput.value.replace(/[\s-]/g, '');
  nameError.textContent = '';
  phoneError.textContent = '';
  nameInput.removeAttribute('aria-invalid');
  phoneInput.removeAttribute('aria-invalid');
  if(!nameInput.value.trim()){
    nameInput.setAttribute('aria-invalid', 'true');
    nameError.textContent = 'กรุณากรอกชื่อ-สกุล';
    nameInput.focus();
    return;
  }
  if(normalizedPhone && !/^\d{9,10}$/.test(normalizedPhone)){
    phoneInput.setAttribute('aria-invalid', 'true');
    phoneError.textContent = 'กรอกตัวเลข 9–10 หลัก';
    phoneInput.focus();
    return;
  }
  const patch = {
    rank: document.getElementById('f_rank').value.trim(),
    name: document.getElementById('f_name').value.trim(),
    nick: document.getElementById('f_nick').value.trim(),
    pos: document.getElementById('f_pos').value.trim(),
    committeeRole: document.getElementById('f_committeeRole').value.trim(),
    unit: document.getElementById('f_unit').value.trim(),
    batch: document.getElementById('f_batch').value.trim(),
    phone: normalizedPhone,
    birth: document.getElementById('f_birth').value.trim(),
    age: document.getElementById('f_age').value.trim(),
  };
  const currentEdit = getEdits()[no] || {};
  if(editingPhotoB64) patch.t = editingPhotoB64;
  else if(currentEdit.t) patch.t = currentEdit.t;

  // only store fields that actually differ from the original baked-in data
  const base = PEOPLE_BASE.find(x => x.no === no);
  const diff = {};
  for(const k in patch){
    if(patch[k] !== String(base[k] ?? '')) diff[k] = patch[k];
  }
  if(editingVersion === null){
    showToast('ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อส่งคำขอแก้ไข');
    return;
  }

  const saveButton = document.getElementById('saveEditBtn');
  saveButton.disabled = true;
  saveButton.textContent = 'กำลังบันทึก…';
  try {
    const res = await fetch(`/api/edit-requests/${no}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: diff, expectedVersion: editingVersion })
    });
    if(res.status === 409){
      alert('ข้อมูลนี้ถูกแก้ไขจากอีกเครื่องแล้ว ระบบจะโหลดข้อมูลล่าสุด กรุณาตรวจสอบและแก้ไขอีกครั้ง');
      openEditSheet(no);
      return;
    }
    if(res.status === 429){
      throw new Error('rate limited');
    }
    if(res.status === 503){
      throw new Error('uploads busy');
    }
    if(res.status === 413 || res.status === 400){
      throw new Error('invalid upload');
    }
    if(!res.ok) throw new Error('save failed');
    showToast('ส่งคำขอแก้ไขแล้ว รอผู้ดูแลอนุมัติ');
    await refreshPendingCount();
    openPersonSheet(no);
  } catch(e) {
    saveButton.disabled = false;
    saveButton.textContent = 'ส่งคำขอแก้ไข';
    const messages = {
      'rate limited': 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่',
      'uploads busy': 'มีผู้กำลังอัปโหลดจำนวนมาก กรุณาลองใหม่อีกครั้ง',
      'invalid upload': 'ข้อมูลหรือรูปไม่ถูกต้อง กรุณาเลือกรูปใหม่'
    };
    showToast(messages[e.message] || 'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่');
  }
}

/* ---------- toast / vcard / clipboard ---------- */
function showToast(msg){
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => $toast.classList.remove('show'), 2400);
}

function copyToClipboardFallback(text, successMessage = 'คัดลอกข้อมูลเรียบร้อยแล้ว'){
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMessage);
    }).catch(() => {
      showToast('ไม่สามารถคัดลอกข้อมูลได้');
    });
  } else {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      showToast(successMessage);
    } catch (e) {
      showToast('ไม่สามารถคัดลอกข้อมูลได้');
    }
  }
}

function saveContact(p){
  const isLineBrowser = /Line\//i.test(navigator.userAgent);
  const nickStr = (p.nick && p.nick !== '-') ? ` ("${p.nick}")` : '';
  const fullName = `${p.rank}${p.name}${nickStr}`;
  const formattedPhone = formatPhone(p.phone) || p.phone || '-';
  const textInfo = `ลำดับที่ ${p.no} ${fullName}\nตำแหน่ง: ${p.pos}\nหน่วย: ${p.unit}\nรุ่นอบรม: ${p.batch}\nเบอร์โทร: ${formattedPhone}\nเกิด: ${p.birth} (อายุ ${p.age} ปี)`;

  if (isLineBrowser) {
    copyToClipboardFallback(textInfo, 'คัดลอกข้อมูลติดต่อแล้ว (สำหรับวางใน LINE / สมุดโทรศัพท์)');
    return;
  }

  const vcardName = escapeVCard(p.rank + p.name);
  const nameParts = String(p.name || '').split(' ').reverse().map(escapeVCard);
  const nick = escapeVCard(p.nick);
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${nameParts.join(';')};;;`,
    `FN:${vcardName}${nick && nick !== '-' ? ' ("' + nick + '")' : ''}`,
    `TITLE:${escapeVCard(p.pos)}`,
    `TEL;TYPE=CELL:${safeTelephone(p.phone)}`,
    `NOTE:หลักสูตรสารวัตร รุ่นที่ 268 ลำดับที่ ${Number(p.no) || ''} · หน่วย ${escapeVCard(p.unit)} · ${escapeVCard(p.batch)} · เกิด ${escapeVCard(p.birth)}`,
    'END:VCARD'
  ].join('\r\n');

  try{
    const blob = new Blob([vcard], {type:'text/vcard'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const filename = String(p.name || 'contact').replace(/[^\p{L}\p{N}._-]+/gu, '_');
    a.download = `${filename}.vcf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast('บันทึกรายชื่อผู้ติดต่อแล้ว');
  }catch(e){
    copyToClipboardFallback(textInfo, 'คัดลอกข้อมูลติดต่อเรียบร้อยแล้ว');
  }
}

/* ---------- admin approval queue ---------- */
const approvalFieldLabels = {
  rank:'ยศ', name:'ชื่อ-นามสกุล', nick:'ชื่อเล่น', pos:'ตำแหน่ง',
  committeeRole:'หน้าที่เพิ่มเติม', unit:'หน่วย', batch:'รุ่นอบรม',
  phone:'เบอร์โทร', birth:'วันเกิด', age:'อายุ', t:'รูปถ่าย'
};
const $adminMenuBtn = document.getElementById('adminMenuBtn');
const $adminPendingBadge = document.getElementById('adminPendingBadge');

function setPendingCount(count){
  const total = Math.max(0, Number(count) || 0);
  $adminPendingBadge.textContent = total > 99 ? '99+' : String(total);
  $adminPendingBadge.classList.toggle('show', total > 0);
  const label = total > 0 ? `เมนูผู้ดูแล มีคำขอรออนุมัติ ${total} รายการ` : 'เมนูผู้ดูแล ไม่มีคำขอรออนุมัติ';
  $adminMenuBtn.setAttribute('aria-label', label);
  $adminMenuBtn.title = label;
}

async function refreshPendingCount(){
  try{
    const res = await fetch('/api/edit-requests/pending-count', { cache:'no-store' });
    if(!res.ok) return;
    const result = await res.json();
    setPendingCount(result.count);
  }catch(e){}
}

async function ensureAdminLogin(){
  try{
    const session = await fetch('/api/admin/session', { cache:'no-store' }).then(r => r.json());
    if(session.admin) return true;
  }catch(e){}
  return new Promise((resolve) => {
    openSheetRaw(`
      <div class="sheet-topbar">
        <button class="icon-btn" id="closeAdminLoginBtn" aria-label="ปิด">×</button>
      </div>
      <form class="admin-login" id="adminLoginForm">
        <div class="admin-login-icon">
          <svg width="31" height="31" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l7 3v5c0 4.6-2.9 8.2-7 10-4.1-1.8-7-5.4-7-10V6l7-3z"/>
            <path d="M9 11V9a3 3 0 0 1 6 0v2"/><rect x="8" y="11" width="8" height="6" rx="1.5"/>
          </svg>
        </div>
        <h2>เข้าสู่ระบบผู้ดูแล</h2>
        <div class="admin-login-subtitle">กรอก PIN เพื่อดูและอนุมัติคำขอแก้ไขข้อมูล</div>
        <label class="admin-pin-label" for="adminPinInput">PIN ผู้ดูแล</label>
        <input class="admin-pin-input" id="adminPinInput" type="password" inputmode="numeric"
          pattern="[0-9]*" maxlength="5" autocomplete="one-time-code" aria-describedby="adminLoginError">
        <div class="admin-login-error" id="adminLoginError" role="alert"></div>
        <div class="admin-login-actions">
          <button class="admin-cancel-btn" id="cancelAdminLoginBtn" type="button">ยกเลิก</button>
          <button class="admin-submit-btn" id="submitAdminLoginBtn" type="submit">เข้าสู่ระบบ</button>
        </div>
      </form>
    `);
    const form = document.getElementById('adminLoginForm');
    const input = document.getElementById('adminPinInput');
    const error = document.getElementById('adminLoginError');
    const submit = document.getElementById('submitAdminLoginBtn');
    let completed = false;
    const finish = (value) => {
      if(completed) return;
      completed = true;
      closeSheet();
      resolve(value);
    };
    document.getElementById('closeAdminLoginBtn').addEventListener('click', () => finish(false));
    document.getElementById('cancelAdminLoginBtn').addEventListener('click', () => finish(false));
    $backdrop.addEventListener('click', () => finish(false), { once:true });
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 5);
      error.textContent = '';
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if(input.value.length !== 5){
        error.textContent = 'กรุณากรอก PIN 5 หลัก';
        input.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'กำลังตรวจสอบ…';
      try{
        const res = await fetch('/api/admin/login', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ pin:input.value })
        });
        if(res.ok) return finish(true);
        error.textContent = res.status === 429
          ? 'ลอง PIN เกินจำนวนที่กำหนด กรุณารอ 15 นาที'
          : 'PIN ไม่ถูกต้อง กรุณาลองใหม่';
      }catch(e){
        error.textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่';
      }
      submit.disabled = false;
      submit.textContent = 'เข้าสู่ระบบ';
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
      input.select();
    });
    setTimeout(() => input.focus(), 250);
  });
}

async function openAdminMenu(){
  if(!await ensureAdminLogin()) return;
  openSheetRaw(`
    <div class="state-panel">
      <div class="spinner" aria-hidden="true"></div>
      <div class="state-title">กำลังโหลดข้อมูลผู้ดูแล</div>
    </div>
  `);
  try{
    const [res, historyRes, linksRes] = await Promise.all([
      fetch('/api/admin/edit-requests', { cache:'no-store' }),
      fetch('/api/admin/edit-history', { cache:'no-store' }),
      fetch('/api/links', { cache:'no-store' })
    ]);
    if(res.status === 401 || historyRes.status === 401){
      closeSheet();
      return openAdminMenu();
    }
    if(!res.ok || !historyRes.ok) throw new Error('load queue failed');
    const requests = await res.json();
    const history = await historyRes.json();
    const links = linksRes.ok ? await linksRes.json() : [];
    setPendingCount(requests.length);
    const cards = requests.map(request => {
      const changes = Object.entries(request.data).map(([key,value]) => `
        <div class="approval-change">
          <div class="k">${escapeHtml(approvalFieldLabels[key] || key)}</div>
          <div class="v">${key === 't' ? 'มีรูปถ่ายใหม่' : escapeHtml(value || '—')}</div>
        </div>
      `).join('') || '<div class="approval-change"><div class="v">ขอคืนค่าเป็นข้อมูลต้นฉบับ</div></div>';
      return `
        <div class="approval-card" data-request-id="${request.id}">
          <div class="approval-title">#${request.no} ${escapeHtml(request.rank || '')}${escapeHtml(request.name || '')}</div>
          <div class="approval-time">${new Date(request.created_at).toLocaleString('th-TH')}</div>
          ${changes}
          <div class="approval-actions">
            <button class="approve-btn" type="button">อนุมัติ</button>
            <button class="reject-btn" type="button">ไม่อนุมัติ</button>
          </div>
        </div>
      `;
    }).join('');
    const historyCards = history.map(request => {
      const changes = Object.entries(request.data).map(([key,value]) => `
        <div class="approval-change">
          <div class="k">${escapeHtml(approvalFieldLabels[key] || key)}</div>
          <div class="v">${key === 't' ? 'มีรูปถ่ายใหม่' : escapeHtml(value || '—')}</div>
        </div>
      `).join('') || '<div class="approval-change"><div class="v">คืนเป็นข้อมูลต้นฉบับ</div></div>';
      const reverted = request.status === 'reverted';
      return `
        <div class="approval-card${reverted ? ' reverted' : ''}" data-request-id="${request.id}">
          <div class="approval-title">#${request.no} ${escapeHtml(request.rank || '')}${escapeHtml(request.name || '')}</div>
          <div class="approval-time">อนุมัติเมื่อ ${new Date(request.reviewed_at || request.created_at).toLocaleString('th-TH')}</div>
          ${changes}
          ${reverted
            ? '<span class="approval-status">คืนค่าเดิมแล้ว</span>'
            : '<div class="approval-actions"><button class="revert-approved-btn" type="button">คืนค่าเดิม</button></div>'}
        </div>
      `;
    }).join('');
    const adminLinksCards = links.map(link => `
      <div class="admin-link-item" data-link-id="${link.id}">
        <div style="overflow:hidden;flex:1;">
          <div style="font-weight:600;font-size:13.5px;color:var(--ink);">${escapeHtml(link.title)}</div>
          <div style="font-size:11px;color:var(--accent);font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(link.url)}</div>
          ${link.description ? `<div style="font-size:11.5px;color:var(--muted);">${escapeHtml(link.description)}</div>` : ''}
        </div>
        <button class="reject-btn delete-link-btn" type="button" style="padding:4px 10px;font-size:12px;flex:none;">ลบ</button>
      </div>
    `).join('') || '<div class="state-panel"><div class="state-title">ยังไม่มีลิงก์ย่อย</div></div>';

    openSheetRaw(`
      <div class="sheet-topbar">
        <button class="icon-btn" id="adminLogoutBtn" aria-label="ออกจากระบบผู้ดูแล" title="ออกจากระบบ">↪</button>
        <button class="icon-btn" id="closeSheetBtn" aria-label="ปิด">×</button>
      </div>
      <h2 style="font-size:18px;">เมนูผู้ดูแลระบบ</h2>
      <div style="font-size:13px;color:var(--muted);margin:3px 0 10px;">คำขอรออนุมัติ ${requests.length} รายการ</div>

      <div class="approval-section-title">จัดการลิงก์สำคัญ / ลิงก์ย่อย</div>
      <form class="admin-link-form" id="adminAddLinkForm">
        <input type="text" id="linkTitleInput" placeholder="ชื่อลิงก์ (เช่น เว็บวิทยาลัยการตำรวจ)" required>
        <input type="url" id="linkUrlInput" placeholder="URL ลิงก์ (เช่น https://tc.police.go.th)" required>
        <input type="text" id="linkDescInput" placeholder="คำอธิบายย่อย (ระบุหรือไม่ก็ได้)">
        <button class="approve-btn" type="submit" style="width:100%;">+ เพิ่มลิงก์ใหม่</button>
      </form>
      <div id="adminLinksList">${adminLinksCards}</div>

      <div class="approval-section-title">รายการรออนุมัติแก้ไข</div>
      <div id="approvalList">${cards || '<div class="state-panel"><div class="state-title">ไม่มีคำขอที่รออนุมัติ</div></div>'}</div>
      <div class="approval-section-title">ประวัติการแก้ไข</div>
      <div id="approvalHistory">${historyCards || '<div class="state-panel"><div class="state-title">ยังไม่มีประวัติการอนุมัติ</div></div>'}</div>
    `);
    document.getElementById('closeSheetBtn').addEventListener('click', closeSheet);
    document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
      await fetch('/api/admin/logout', { method:'POST' });
      closeSheet();
      showToast('ออกจากระบบผู้ดูแลแล้ว');
    });

    const addLinkForm = document.getElementById('adminAddLinkForm');
    if (addLinkForm) {
      addLinkForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('linkTitleInput').value.trim();
        const url = document.getElementById('linkUrlInput').value.trim();
        const description = document.getElementById('linkDescInput').value.trim();
        if (!title || !url) return;

        const addRes = await fetch('/api/admin/links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, url, description })
        });
        if (addRes.ok) {
          showToast('เพิ่มลิงก์เรียบร้อยแล้ว');
          openAdminMenu();
        } else {
          showToast('ไม่สามารถเพิ่มลิงก์ได้');
        }
      });
    }

    const adminLinksList = document.getElementById('adminLinksList');
    if (adminLinksList) {
      adminLinksList.addEventListener('click', async (e) => {
        const btn = e.target.closest('.delete-link-btn');
        if (!btn) return;
        const item = btn.closest('.admin-link-item');
        if (!item) return;
        if (!confirm('ต้องการลบลิงก์นี้ใช่หรือไม่?')) return;
        const delRes = await fetch(`/api/admin/links/${item.dataset.linkId}`, { method: 'DELETE' });
        if (delRes.ok) {
          showToast('ลบลิงก์เรียบร้อยแล้ว');
          openAdminMenu();
        } else {
          showToast('ลบลิงก์ไม่สำเร็จ');
        }
      });
    }

    document.getElementById('approvalList').addEventListener('click', async (event) => {
      const card = event.target.closest('.approval-card');
      if(!card) return;
      const action = event.target.closest('.approve-btn') ? 'approve'
        : event.target.closest('.reject-btn') ? 'reject' : null;
      if(!action) return;
      card.style.pointerEvents = 'none';
      card.style.opacity = '.6';
      const actionRes = await fetch(`/api/admin/edit-requests/${card.dataset.requestId}/${action}`, { method:'POST' });
      if(actionRes.status === 409){
        alert('ข้อมูลมีการเปลี่ยนแปลงหลังส่งคำขอ กรุณาไม่อนุมัติคำขอนี้และให้ผู้ใช้ส่งใหม่');
      }else if(!actionRes.ok){
        showToast('ดำเนินการไม่สำเร็จ');
      }else{
        showToast(action === 'approve' ? 'อนุมัติและอัปเดตข้อมูลแล้ว' : 'ไม่อนุมัติคำขอแล้ว');
        await refreshPendingCount();
        await loadData();
        render();
      }
      openAdminMenu();
    });
    document.getElementById('approvalHistory').addEventListener('click', async (event) => {
      const button = event.target.closest('.revert-approved-btn');
      const card = event.target.closest('.approval-card');
      if(!button || !card) return;
      if(!confirm('คืนข้อมูลของบุคคลนี้กลับเป็นข้อมูลต้นฉบับทั้งหมดใช่หรือไม่?')) return;
      card.style.pointerEvents = 'none';
      card.style.opacity = '.6';
      const actionRes = await fetch(`/api/admin/edit-requests/${card.dataset.requestId}/revert`, { method:'POST' });
      if(!actionRes.ok){
        showToast(actionRes.status === 404 ? 'รายการนี้ถูกคืนค่าไปแล้ว' : 'คืนค่าเดิมไม่สำเร็จ');
      }else{
        showToast('คืนข้อมูลเดิมเรียบร้อยแล้ว');
        await Promise.all([refreshPendingCount(), loadData()]);
        render();
      }
      openAdminMenu();
    });
  }catch(e){
    renderSafeHtml($sheetBody, `
      <div class="state-panel">
        <div class="state-title">โหลดข้อมูลผู้ดูแลไม่สำเร็จ</div>
        <button class="retry-btn" id="retryAdminBtn">ลองใหม่</button>
      </div>`);
    document.getElementById('retryAdminBtn').addEventListener('click', openAdminMenu);
  }
}
$adminMenuBtn.addEventListener('click', openAdminMenu);

/* ---------- install hint ---------- */
(function(){
  const $hint = document.getElementById('installHint');
  const $hintClose = document.getElementById('hintClose');
  const $hintText = document.getElementById('installHintText');
  let deferredInstallPrompt = null;
  let dismissed = false;
  try{ dismissed = localStorage.getItem('installHintDismissed268') === '1'; }catch(e){}
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if(dismissed || isStandalone){ $hint.style.display = 'none'; }

  const isLineBrowser = /Line\//i.test(navigator.userAgent);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  if(isLineBrowser){
    renderSafeHtml($hintText, '<b>เปิดใน LINE:</b> ใช้งานค้นหา ดูรูป และเบอร์โทรได้ทันทีในแอป');
  }else if(isIOS){
    renderSafeHtml($hintText, '<b>ติดตั้งเป็นแอป:</b> แตะแถบนี้เพื่อดูวิธีติดตั้งบน iPhone');
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $hint.style.display = 'flex';
    if(!isLineBrowser){
      renderSafeHtml($hintText, '<b>ติดตั้งเป็นแอป:</b> แตะแถบนี้เพื่อติดตั้งลงในโทรศัพท์');
    }
  });

  async function installApp(){
    if(isStandalone) return;
    if(isLineBrowser){
      alert('คุณกำลังเปิดใช้งานผ่าน LINE In-App Browser\n\n- สามารถค้นหา ดูรูปภาพ โทรออก และแชร์ข้อมูลได้ทันทีโดยไม่ต้องสลับหน้า\n- หากต้องการบุ๊กมาร์ก: แตะเมนู (...) มุมขวาบนใน LINE แล้วเลือก "คัดลอกลิงก์" หรือ "เปิดด้วยเบราว์เซอร์อื่น"');
      return;
    }
    if(deferredInstallPrompt){
      $hint.classList.add('installing');
      deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $hint.classList.remove('installing');
      if(result.outcome === 'accepted'){
        $hint.style.display = 'none';
        showToast('ติดตั้งแอปเรียบร้อยแล้ว');
      }
      return;
    }
    if(isIOS){
      alert('วิธีติดตั้งบน iPhone/iPad\n\n1. เปิดหน้านี้ด้วย Safari\n2. แตะปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น)\n3. เลือก “เพิ่มไปยังหน้าจอโฮม”\n4. แตะ “เพิ่ม”');
    }else{
      alert('หากหน้าติดตั้งยังไม่แสดง ให้เปิดเมนูของเบราว์เซอร์ แล้วเลือก “ติดตั้งแอป” หรือ “เพิ่มไปยังหน้าจอหลัก”\n\nหมายเหตุ: เว็บไซต์ต้องเปิดผ่าน HTTPS จึงจะติดตั้งได้');
    }
  }

  $hint.addEventListener('click', (event) => {
    if(event.target.closest('#hintClose')) return;
    installApp();
  });
  $hint.addEventListener('keydown', (event) => {
    if(event.key === 'Enter' || event.key === ' '){
      event.preventDefault();
      installApp();
    }
  });
  $hintClose.addEventListener('click', (event) => {
    event.stopPropagation();
    $hint.style.display = 'none';
    try{ localStorage.setItem('installHintDismissed268', '1'); }catch(e){}
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    $hint.style.display = 'none';
    showToast('ติดตั้งแอปเรียบร้อยแล้ว');
  });
})();

if('serviceWorker' in navigator){
  window.addEventListener('load', async () => {
    try{
      const registration = await navigator.serviceWorker.register('sw.js', {
        updateViaCache: 'none'
      });
      const $updateBanner = document.getElementById('updateBanner');
      const $updateAppBtn = document.getElementById('updateAppBtn');
      let refreshing = false;

      function offerUpdate(worker){
        if(!worker) return;
        $updateBanner.classList.add('show');
        $updateAppBtn.disabled = true;
        $updateAppBtn.textContent = 'กำลังอัปเดต…';
        worker.postMessage({ type: 'SKIP_WAITING' });
      }

      if(registration.waiting && navigator.serviceWorker.controller){
        offerUpdate(registration.waiting);
      }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker.addEventListener('statechange', () => {
          if(worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if(refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      registration.update();
      document.addEventListener('visibilitychange', () => {
        if(document.visibilityState === 'visible') registration.update();
      });
      setInterval(() => registration.update(), 60 * 60 * 1000);
    }catch(error){
      console.warn('Service Worker registration failed:', error);
    }
  });
}

async function startApp(){
  $loadingState.hidden = false;
  $errorState.hidden = true;
  $list.replaceChildren();
  $empty.style.display = 'none';
  $countLine.textContent = '';
  try{
    await Promise.all([loadData(), refreshPendingCount()]);
    render();
    return true;
  }catch(error){
    console.error('Failed to load people data:', error);
    $loadingState.hidden = true;
    $errorState.hidden = false;
    return false;
  }
}
document.getElementById('retryLoadBtn').addEventListener('click', startApp);
document.getElementById('refreshDataBtn').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.classList.add('refreshing');
  button.setAttribute('aria-label', 'กำลังโหลดข้อมูลล่าสุด');
  const success = await startApp();
  button.classList.remove('refreshing');
  button.setAttribute('aria-label', 'โหลดข้อมูลล่าสุด');
  showToast(success ? 'โหลดข้อมูลล่าสุดแล้ว' : 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่');
});
startApp();
