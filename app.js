'use strict';

/* ============================================================
   训练日志 · 核心逻辑
   难度 → 下次建议箭头（粘性，不改动重量/次数就不变）：
     简单(easy)   → 重量旁  ↑（建议加重）
     适中(medium) → 仅「连续两次」适中时，每组次数旁 ↑（建议加次数）
     困难(hard)   → 重量旁  ↓（建议减重）
   箭头消失条件：下次记录时「重量」或「每组次数」发生变化。
   ============================================================ */

const STORAGE_KEY = 'training-log.v1';

const DIFF = {
  easy:   { label: '简单', hint: '下次加重',   arrow: '↑', field: 'weight' },
  medium: { label: '适中', hint: '连续两次适中，加次数', arrow: '↑', field: 'reps' },
  hard:   { label: '困难', hint: '下次减重',   arrow: '↓', field: 'weight' }
};

const WT_STEP = 2.5; // 重量每次加减的步长（kg）

const ICONS = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
};

/* ---------- 工具函数 ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function roundW(n) { return Math.round(n * 100) / 100; }
function fmtNum(n) { return String(Math.round(n * 100) / 100); }

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function escapeAttr(s) { return escapeHTML(s); }

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return '今天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '昨天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  const mm = d.getMonth() + 1, dd = d.getDate();
  if (d.getFullYear() === now.getFullYear()) return mm + '/' + dd;
  return d.getFullYear() + '/' + mm + '/' + dd;
}

function relTime(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return mins + ' 分钟前';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' 小时前';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + ' 天前';
  return fmtDate(ts);
}

/* ---------- 状态 ---------- */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.exercises)) {
        if (!Array.isArray(s.tabs) || s.tabs.length === 0) s.tabs = [{ id: uid(), name: '默认' }];
        s.tabs.forEach((t) => { if (!t.mode && t.name === '引体') t.mode = 'sets'; });
        if (!s.tabs.some((t) => t.id === s.activeTab)) s.activeTab = s.tabs[0].id;
        s.exercises.forEach((e) => {
          e.records = Array.isArray(e.records) ? e.records : [];
          e.hint = e.hint || null;
          if (!e.doneAt && e.records[0]) e.doneAt = e.records[0].date;
          // 同一天只保留最新一条
          const seen = new Set();
          e.records = e.records.filter((r) => { const k = new Date(r.date).toDateString(); if (seen.has(k)) return false; seen.add(k); return true; });
          if (!e.reps) e.reps = (e.records[0] && e.records[0].reps) || 10;
          if (!s.tabs.some((t) => t.id === e.tabId)) e.tabId = s.tabs[0].id;
          const tb = s.tabs.find((t) => t.id === e.tabId);
          if (tb && tb.mode === 'sets') {
            e.hint = null;
            if (!Array.isArray(e.setList) || !e.setList.length) {
              const n = Math.max(1, parseInt(e.sets, 10) || 8);
              e.setList = Array.from({ length: n }, () => ({ reps: e.reps || 10, doneAt: 0 }));
            }
          }
        });
        return s;
      }
    }
  } catch (e) { /* 忽略损坏数据 */ }
  const first = { id: uid(), name: '默认' };
  return { tabs: [first], activeTab: first.id, exercises: [] };
}
function save() {
  state.savedAt = Date.now();
  const json = JSON.stringify(state);
  try { localStorage.setItem(STORAGE_KEY, json); } catch (e) { /* 空间不足等，仍有 IndexedDB 兜底 */ }
  mirrorToIDB(json);
}

/* ---------- 防丢失：IndexedDB 镜像 + 自动快照 + 启动自愈 ---------- */
const IDB_NAME = 'training-log';
const IDB_STORE = 'kv';
const MAX_DAILY = 14;   // 保留最近 14 天快照
const MAX_PRE = 10;     // 保留最近 10 份「删除前」快照

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no idb')); return; }
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function idbReq(mode, fn) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const req = fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}
const idbGet = (k) => idbReq('readonly', (st) => st.get(k));
const idbSet = (k, v) => idbReq('readwrite', (st) => st.put(v, k));
const idbDel = (k) => idbReq('readwrite', (st) => st.delete(k));
const idbKeys = () => idbReq('readonly', (st) => st.getAllKeys());

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

async function prune(prefix, keep) {
  const keys = (await idbKeys()).filter((k) => typeof k === 'string' && k.startsWith(prefix)).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - keep))) await idbDel(k);
}

function mirrorToIDB(json) {
  idbSet('state', json)
    .then(() => idbSet('snap:day:' + dayKey(Date.now()), json))
    .then(() => prune('snap:day:', MAX_DAILY))
    .catch(() => {});
}

// 删除动作/标签前调用：留一份「删除前」快照，误删可救回
function snapshotBeforeDestructive() {
  const json = JSON.stringify(state);
  idbSet('snap:pre:' + Date.now(), json).then(() => prune('snap:pre:', MAX_PRE)).catch(() => {});
}

function parseState(raw) {
  try {
    const s = JSON.parse(raw);
    return (s && Array.isArray(s.exercises) && Array.isArray(s.tabs)) ? s : null;
  } catch (e) { return null; }
}
function hasData(s) { return !!(s && s.exercises && s.exercises.length); }

function applyRestored(s, why) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  state = load();
  render();
  toast(why);
}

async function selfHeal() {
  // 申请持久存储，降低被系统自动清理的概率
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
  try {
    const mirrorRaw = await idbGet('state');
    const mirror = mirrorRaw ? parseState(mirrorRaw) : null;
    const localRaw = localStorage.getItem(STORAGE_KEY);
    const local = localRaw ? parseState(localRaw) : null;

    if (local && hasData(local)) {
      // localStorage 正常：若镜像更新（极少见）则以更新者为准，否则补写镜像
      if (mirror && hasData(mirror) && (mirror.savedAt || 0) > (local.savedAt || 0)) {
        applyRestored(mirror, '已从备份恢复最新数据');
      } else if (!mirror || (mirror.savedAt || 0) < (local.savedAt || 0)) {
        mirrorToIDB(JSON.stringify(local));
      }
      return;
    }

    // localStorage 为空或损坏：依次尝试镜像、最近的快照
    if (localRaw && !local) localStorage.setItem(STORAGE_KEY + '.corrupt', localRaw);
    if (hasData(mirror)) { applyRestored(mirror, '检测到数据丢失，已自动恢复'); return; }
    const keys = (await idbKeys()).filter((k) => typeof k === 'string' && k.startsWith('snap:')).sort().reverse();
    for (const k of keys) {
      const snap = parseState(await idbGet(k));
      if (hasData(snap)) { applyRestored(snap, '检测到数据丢失，已从快照恢复'); return; }
    }
  } catch (e) { /* IndexedDB 不可用时，继续只用 localStorage */ }
}

let state = load();

/* ---------- 初始数据（只在空数据时导入一次；?seed=1 可强制重置） ---------- */
function buildSeedState() {
  const now = Date.now();
  const tabs = [], exercises = [];
  SEED.tabs.forEach((t) => {
    const tab = { id: uid(), name: t.name };
    if (t.mode) tab.mode = t.mode;
    tabs.push(tab);
    t.exercises.forEach((x, i) => {
      const records = x.d ? [{ id: uid(), date: now - (i + 1) * 1000, weight: x.weight, reps: x.reps, difficulty: x.d }] : [];
      // 单次适中不出箭头；简单/困难按规则生成
      const hint = (x.d === 'easy' || x.d === 'hard') ? { difficulty: x.d, baseWeight: x.weight, baseReps: x.reps } : null;
      const ex = { id: uid(), tabId: tab.id, name: x.name, weight: x.weight, reps: x.reps, createdAt: now, records, hint };
      if (t.mode === 'sets') { ex.setList = Array.from({ length: x.sets || 8 }, () => ({ reps: x.reps || 10, doneAt: 0 })); ex.hint = null; ex.records = []; }
      exercises.push(ex);
    });
  });
  return { tabs, activeTab: tabs[0].id, exercises, seeded: true };
}

function seedIfNeeded() {
  const force = /[?&]seed=1\b/.test(location.search);
  if (!force && (state.seeded || state.exercises.length > 0)) return;
  if (force) snapshotBeforeDestructive();
  state = buildSeedState();
  save();
  if (force) history.replaceState(null, '', location.pathname);
  render();
  toast('已导入初始训练数据');
}
let sheet = null;                         // { type, id? } | null
let toastTimer = null;

function getTab(id) { return state.tabs.find((t) => t.id === id); }
function activeTab() { return getTab(state.activeTab) || state.tabs[0]; }
// 「引体」这类标签：记录组数 + 每组个数，没有难度和箭头
function isSetsTab(tabId) { const t = getTab(tabId); return !!t && t.mode === 'sets'; }
function isSetsEx(ex) { return isSetsTab(ex.tabId); }
function setsDone(ex) { return (ex.setList || []).filter((x) => isToday(x.doneAt)).length; }
function setsAllDone(ex) { return !!(ex.setList && ex.setList.length) && setsDone(ex) === ex.setList.length; }
function getEx(id) { return state.exercises.find((e) => e.id === id); }
function isToday(ts) { return !!ts && new Date(ts).toDateString() === new Date().toDateString(); }
function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }
// 今天的那一条记录（每个动作每天最多一条）
function todayRecord(ex) { return (ex.records || []).find((r) => isToday(r.date)) || null; }
// 今天之前、最近的一条记录（用来判断“连续两次适中”）
function prevDayRecord(ex) { return (ex.records || []).find((r) => !isToday(r.date)) || null; }
function isDoneToday(ex) { return (ex.setList ? setsAllDone(ex) : isToday(ex.doneAt)); }
let justSavedId = null; // 刚保存的动作，用于播放一次高亮动画
function lastRecord(ex) { return ex.records[0] || null; }

function hintInfo(hint) { return hint ? DIFF[hint.difficulty] : null; }
function hintArrowHTML(hint) {
  const d = hintInfo(hint);
  if (!d) return '';
  return `<span class="hint-arrow ${hint.difficulty}" title="${d.hint}">${d.arrow}</span>`;
}

/* ---------- 渲染 ---------- */
function cardHTML(ex) {
  const done = isDoneToday(ex);
  const cls = 'row-card' + (done ? ' done' : '') + (justSavedId === ex.id ? ' just-saved' : '');
  const check = done ? '<span class="done-check" aria-label="今天已练"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' : '';
  if (isSetsEx(ex)) {
    const list = ex.setList || [];
    const cards = list.map((st, i) => {
      const on = isToday(st.doneAt);
      const pop = justSetKey === ex.id + ':' + i ? ' just-saved' : '';
      return `<div class="set-card${on ? ' on' : ''}${pop}" role="button" tabindex="0" data-action="toggle-set" data-id="${ex.id}" data-i="${i}" aria-pressed="${on}">
      <span class="set-badge">${on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : (i + 1)}</span>
      <span class="set-title">第 ${i + 1} 组</span>
      <span class="set-stepper">
        <button type="button" class="step-btn" data-action="set-reps" data-id="${ex.id}" data-i="${i}" data-delta="-1" ${st.reps <= 1 ? 'disabled' : ''} aria-label="第 ${i + 1} 组减一个">−</button>
        <span class="set-count"><b>${st.reps}</b><small>个</small></span>
        <button type="button" class="step-btn" data-action="set-reps" data-id="${ex.id}" data-i="${i}" data-delta="1" aria-label="第 ${i + 1} 组加一个">+</button>
      </span>
    </div>`;
    }).join('');
    return `<section class="sets-block">
    <div class="sets-head">
      <span class="sets-name">${escapeHTML(ex.name)}</span>
      <span class="sets-meta"><b>${setsDone(ex)}</b> / ${list.length} 组</span>
      <button type="button" class="sets-edit" data-action="edit" data-id="${ex.id}" aria-label="修改名称或删除">${ICONS.edit}</button>
    </div>
    <div class="sets-list">${cards}</div>
    <div class="sets-foot">
      <button type="button" class="add-set" data-action="add-set" data-id="${ex.id}">${ICONS.plus}加一组</button>
      ${list.length > 1 ? `<button type="button" class="del-set" data-action="del-last-set" data-id="${ex.id}">删掉最后一组</button>` : ''}
    </div>
  </section>`;
  }
  const hi = hintInfo(ex.hint);
  const weightArrow = (hi && hi.field === 'weight') ? hintArrowHTML(ex.hint) : '';
  const repsArrow = (hi && hi.field === 'reps') ? hintArrowHTML(ex.hint) : '';
  const tod = todayRecord(ex);
  const diffs = ['easy', 'medium', 'hard'].map((d) => {
    const on = tod && tod.difficulty === d;
    return `<button type="button" class="diff-btn ${d}" data-action="diff" data-id="${ex.id}" data-value="${d}" data-on="${on}" aria-pressed="${on}">${DIFF[d].label}</button>`;
  }).join('');
  return `<div class="${cls}">
    <div class="ex-head">
      <span class="row-name">${check}${escapeHTML(ex.name)}</span>
      <button type="button" class="ex-edit" data-action="edit" data-id="${ex.id}" aria-label="修改名称或删除">${ICONS.edit}</button>
    </div>
    <div class="ex-steppers">
      <div class="ex-step">
        <span class="ex-step-label">重量</span>
        <button type="button" class="step-btn" data-action="wt-step" data-id="${ex.id}" data-delta="-1" aria-label="重量减">−</button>
        <span class="ex-step-num"><input class="ex-num-input" data-action="wt-input" data-id="${ex.id}" type="number" inputmode="decimal" min="0" step="any" value="${ex.weight}" aria-label="重量" /><i>kg</i>${weightArrow}</span>
        <button type="button" class="step-btn" data-action="wt-step" data-id="${ex.id}" data-delta="1" aria-label="重量加">+</button>
      </div>
      <div class="ex-step">
        <span class="ex-step-label">次数</span>
        <button type="button" class="step-btn" data-action="rp-step" data-id="${ex.id}" data-delta="-1" aria-label="次数减">−</button>
        <span class="ex-step-num"><b>${ex.reps}</b><i>次</i>${repsArrow}</span>
        <button type="button" class="step-btn" data-action="rp-step" data-id="${ex.id}" data-delta="1" aria-label="次数加">+</button>
      </div>
    </div>
    <div class="diff-row">${diffs}</div>
  </div>`;
}

function tabBarHTML() {
  const chips = state.tabs.map((t) => {
    const n = state.exercises.filter((e) => e.tabId === t.id).length;
    const on = t.id === state.activeTab;
    return `<button class="tab-chip" data-action="switch-tab" data-id="${t.id}" data-on="${on}" role="tab" aria-selected="${on}">${escapeHTML(t.name)}<span class="tab-count">${n}</span></button>`;
  }).join('');
  return `<div class="tabbar" role="tablist">${chips}</div>`;
}

function progressHTML(exs) {
  let total, n;
  if (exs.length && exs.every(isSetsEx)) {
    total = exs.reduce((t, e) => t + (e.setList ? e.setList.length : 0), 0);
    n = exs.reduce((t, e) => t + setsDone(e), 0);
  } else {
    total = exs.length;
    n = exs.filter(isDoneToday).length;
  }
  if (!total) return '';
  const pct = Math.round(n / total * 100);
  const msg = n === total ? '今天练完了' : n === 0 ? '今天还没开始' : '今天已练';
  const unit = exs.every(isSetsEx) ? ' 组' : '';
  return `<div class="progress" role="status">
    <div class="progress-text"><span>${msg}</span><span class="progress-num"><b>${n}</b> / ${total}${unit}</span></div>
    <div class="progress-bar"><i style="width:${pct}%"></i></div>
  </div>`;
}

function homeHTML() {
  const tab = activeTab();
  const exs = state.exercises.filter((e) => e.tabId === tab.id);
  const body = exs.length === 0
    ? `<div class="empty">
        <div class="empty-plate"></div>
        <h2>「${escapeHTML(tab.name)}」下还没有动作</h2>
        <p>点右下角的 + 添加一个动作，比如「杠铃卧推」，再开始记录。</p>
      </div>`
    : `<div class="list">${exs.map(cardHTML).join('')}</div>`;
  return `<div class="topbar">
      <div class="brand">
        <span class="eyebrow">Lift Log</span>
        <h1>训练日志</h1>
      </div>
    </div>
    ${tabBarHTML()}
    ${progressHTML(exs)}
    ${body}`;
}

/* ---------- 弹层 ---------- */
function exerciseFormHTML(ex) {
  const isEdit = !!ex;
  const setsMode = isEdit ? isSetsEx(ex) : isSetsTab(state.activeTab);
  const name = ex ? ex.name : '';
  const weight = ex ? ex.weight : '';
  const weightField = setsMode ? '' : `
    <div class="field">
      <label for="ex-weight">当前重量</label>
      <div class="num-wrap">
        <input class="num-input" id="ex-weight" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="${weight}" />
        <span class="num-suffix">kg</span>
      </div>
    </div>`;
  return `<h3>${isEdit ? '编辑动作' : '添加动作'}</h3>
    <div class="field">
      <label for="ex-name">动作名称</label>
      <input class="text-input" id="ex-name" placeholder="例如：${setsMode ? '引体向上' : '杠铃卧推'}" value="${escapeAttr(name)}" autocomplete="off" />
    </div>${weightField}${setsMode ? '' : `
    <div class="field">
      <label for="ex-reps">每组次数</label>
      <input class="num-input" id="ex-reps" type="number" inputmode="numeric" min="1" step="1" value="${ex ? ex.reps : 10}" />
    </div>`}
    <button class="btn btn-primary btn-block" data-action="save-exercise" ${isEdit ? `data-id="${ex.id}"` : ''}>${isEdit ? '保存修改' : '添加动作'}</button>${isEdit ? `
    <div class="sheet-links"><button class="danger" data-action="del" data-id="${ex.id}">${ICONS.trash}删除这个动作</button></div>` : ''}`;
}

function deleteHTML(ex) {
  return `<h3>删除动作</h3>
    <p style="color:var(--ink-2);margin:0 0 20px;line-height:1.6">确定删除「${escapeHTML(ex.name)}」吗？它的全部历史记录也会一起被删除，无法恢复。</p>
    <div class="confirm-actions">
      <button class="btn btn-ghost" style="flex:1" data-action="close-sheet">取消</button>
      <button class="btn btn-danger" style="flex:1" data-action="confirm-delete" data-id="${ex.id}">删除</button>
    </div>`;
}

function sheetHTML(s) {
  let inner;
  if (s.type === 'add') inner = exerciseFormHTML(null);
  else if (s.type === 'edit') inner = exerciseFormHTML(getEx(s.id));
  else if (s.type === 'delete') inner = deleteHTML(getEx(s.id));
  return `<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-grab"></div>
      ${inner}
    </div>`;
}

function render() {
  const app = document.getElementById('app');
  // 引体标签里用“加一组”，不需要右下角的新增动作按钮
  const fab = (!sheet && !isSetsTab(state.activeTab)) ? `<button class="fab" data-action="add" aria-label="添加动作">${ICONS.plus}</button>` : '';
  app.innerHTML = homeHTML() + fab + (sheet ? sheetHTML(sheet) : '');
}

/* ---------- 交互 ---------- */
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---------- 动作 ---------- */
function openAdd() { sheet = { type: 'add' }; render(); }
function openEdit(id) { sheet = { type: 'edit', id }; render(); }
function switchTab(id) { state.activeTab = id; save(); render(); }

function openDelete(id) { sheet = { type: 'delete', id }; render(); }
function closeSheet() { sheet = null; render(); }

let justSetKey = null;
function toggleSet(id, i) {
  const ex = getEx(id);
  const st = ex && ex.setList && ex.setList[i];
  if (!st) return;
  const wasDone = isToday(st.doneAt);
  st.doneAt = wasDone ? 0 : Date.now();
  if (!wasDone) { justSetKey = id + ':' + i; setTimeout(() => { if (justSetKey === id + ':' + i) justSetKey = null; }, 900); }
  ex.doneAt = setsAllDone(ex) ? Date.now() : 0;
  save();
  render();
  if (!wasDone && setsAllDone(ex)) toast('引体全部完成');
}

function setReps(id, i, delta) {
  const st = getEx(id).setList[i];
  st.reps = Math.max(1, st.reps + delta);
  save();
  render();
}

function addSet(id) {
  const ex = getEx(id);
  const last = ex.setList[ex.setList.length - 1];
  ex.setList.push({ reps: last ? last.reps : 10, doneAt: 0 });
  ex.doneAt = 0;
  save();
  render();
  toast('已加到第 ' + ex.setList.length + ' 组');
  requestAnimationFrame(() => {
    const cards = document.querySelectorAll('.set-card');
    const el = cards[cards.length - 1];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

function delLastSet(id) {
  const ex = getEx(id);
  if (ex.setList.length <= 1) return;
  ex.setList.pop();
  save();
  render();
  toast('已删掉最后一组');
}

function saveExercise() {
  const name = document.getElementById('ex-name').value.trim();
  if (!name) { toast('请填写动作名称'); return; }
  const ex0 = sheet.type === 'edit' ? getEx(sheet.id) : null;
  const tabId = ex0 ? ex0.tabId : state.activeTab;
  const setsMode = isSetsTab(tabId);
  const repsEl = document.getElementById('ex-reps');
  const repsRaw = repsEl ? parseInt(repsEl.value, 10) : NaN;
  const reps = (isNaN(repsRaw) || repsRaw < 1) ? 10 : repsRaw;
  let weight = 0;
  if (!setsMode) {
    const weightRaw = parseFloat(document.getElementById('ex-weight').value);
    if (isNaN(weightRaw) || weightRaw < 0) { toast('请填写有效重量'); return; }
    weight = roundW(weightRaw);
  }
  if (!ex0) {
    const ex = { id: uid(), tabId, name, weight, reps, createdAt: Date.now(), records: [], hint: null };
    if (setsMode) ex.setList = Array.from({ length: 8 }, () => ({ reps: 10, doneAt: 0 }));
    state.exercises.push(ex);
    toast('已添加「' + name + '」');
  } else {
    ex0.name = name;
    if (!setsMode) { ex0.weight = weight; ex0.reps = reps; }
    toast('已保存修改');
  }
  save();
  sheet = null;
  render();
}

// 统一的“记录一次”入口。同一天对同一动作只保留一条记录：
// 再记就是覆盖今天那条，而不是新增，所以不会被算成“连续两次”。
function commitRecord(ex, weight, reps, difficulty) {
  const prev = prevDayRecord(ex);          // 今天之前的最近一条
  const tod = todayRecord(ex);
  if (tod) {
    // 覆盖今天；箭头回到“今天之前”的状态再重新判断
    ex.hint = tod.hintBefore === undefined ? null : tod.hintBefore;
    tod.weight = weight; tod.reps = reps; tod.difficulty = difficulty; tod.date = Date.now();
  } else {
    ex.records.unshift({ id: uid(), date: Date.now(), weight, reps, difficulty, hintBefore: ex.hint || null, prevWeight: ex.weight, prevReps: ex.reps });
  }
  const rec = todayRecord(ex);
  ex.weight = weight;
  ex.reps = reps;
  ex.doneAt = Date.now();

  // 箭头规则：
  //  - 已有箭头且重量、每组次数都没变 → 保持（粘性）
  //  - 否则按本次难度重新生成：简单→重量↑，困难→重量↓，
  //    适中→仅当「前一天」也是适中时，每组次数↑；否则不出箭头
  const h = ex.hint;
  const unchanged = h && weight === h.baseWeight && reps === h.baseReps;
  if (!unchanged) {
    const twoMedium = difficulty === 'medium' && prev && prev.difficulty === 'medium';
    ex.hint = (difficulty === 'medium' && !twoMedium) ? null : { difficulty, baseWeight: weight, baseReps: reps };
  }
  void rec;
}

function wtStep(id, delta) {
  const ex = getEx(id);
  if (!ex || isSetsEx(ex)) return;
  ex.weight = roundW(Math.max(0, ex.weight + delta * WT_STEP));
  if (ex.hint) ex.hint = null; // 重量有变化 → 旧箭头消失
  save();
  render();
}

function rpStep(id, delta) {
  const ex = getEx(id);
  if (!ex || isSetsEx(ex)) return;
  ex.reps = Math.max(1, ex.reps + delta);
  if (ex.hint) ex.hint = null; // 次数有变化 → 旧箭头消失
  save();
  render();
}

// 手动输入重量：输入完成后保存；改重量不记为已做，旧箭头消失
function wtInput(id, raw) {
  const ex = getEx(id);
  if (!ex || isSetsEx(ex)) return;
  const v = parseFloat(raw);
  if (isNaN(v) || v < 0) { toast('请输入有效重量'); render(); return; }
  const w = roundW(v);
  if (w !== ex.weight) {
    ex.weight = w;
    if (ex.hint) ex.hint = null;
    save();
  }
  render();
}

// 点难度 = 记录今天做了；再点同一个难度 = 取消今天
function setDiff(id, d) {
  const ex = getEx(id);
  if (!ex || isSetsEx(ex)) return;
  const tod = todayRecord(ex);
  if (tod && tod.difficulty === d) {
    ex.records = ex.records.filter((r) => r !== tod);
    ex.hint = (tod.hintBefore === undefined ? null : tod.hintBefore);
    ex.doneAt = 0;
    save();
    render();
    toast('已取消今天的记录');
    return;
  }
  commitRecord(ex, ex.weight, ex.reps, d);
  markSaved(id);
  save();
  render();
  const hi = hintInfo(ex.hint);
  toast(hi ? `已记录 · ${hi.hint} ${hi.arrow}` : (d === 'medium' ? '已记录 · 昨天也适中才会提示加次数' : '已记录'));
}

function markSaved(id) {
  justSavedId = id;
  setTimeout(() => { if (justSavedId === id) justSavedId = null; }, 1400);
}

function confirmDelete(id) {
  snapshotBeforeDestructive();
  state.exercises = state.exercises.filter((e) => e.id !== id);
  save();
  sheet = null;
  render();
  toast('已删除');
}

/* ---------- 事件绑定 ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;
  const id = t.dataset.id;
  switch (action) {
    case 'add': openAdd(); break;
    case 'wt-step': wtStep(id, parseInt(t.dataset.delta, 10)); break;
    case 'rp-step': rpStep(id, parseInt(t.dataset.delta, 10)); break;
    case 'diff': setDiff(id, t.dataset.value); break;
    case 'edit': openEdit(id); break;
    case 'del': openDelete(id); break;
    case 'close-sheet': closeSheet(); break;
    case 'save-exercise': saveExercise(); break;
    case 'confirm-delete': confirmDelete(id); break;
    case 'toggle-set': toggleSet(id, parseInt(t.dataset.i, 10)); break;
    case 'set-reps': setReps(id, parseInt(t.dataset.i, 10), parseInt(t.dataset.delta, 10)); break;
    case 'add-set': addSet(id); break;
    case 'del-last-set': delLastSet(id); break;
    case 'switch-tab': switchTab(id); break;
  }
});

document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-action="wt-input"]');
  if (t) wtInput(t.dataset.id, t.value);
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.getAttribute && e.target.getAttribute('role') === 'button') {
    e.preventDefault();
    e.target.click();
  }
});

/* ---------- 禁止双指缩放（iOS 忽略 user-scalable，需拦截 gesture 事件） ---------- */
['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) => {
  document.addEventListener(ev, (e) => e.preventDefault());
});

/* ---------- 启动 ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
render();
selfHeal().then(seedIfNeeded);
