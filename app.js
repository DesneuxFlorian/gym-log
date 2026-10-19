'use strict';
/* Gym Log — offline-first strength logger. Sessions live in localStorage and sync,
   one JSON file per session, to a private GitHub repo through the contents API. */

const $ = s => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

/* ---------- storage ---------- */
const K = { sessions: 'gl.sessions', active: 'gl.active', settings: 'gl.settings', queue: 'gl.queue', custom: 'gl.custom' };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Could not save on this device: ' + e.message); } };

const DEFAULT_SETTINGS = {
  owner: '', repo: '', branch: 'main', folder: 'sessions', token: '',
  rest: 90, step: 2.5,
  painAreas: 'Left hamstring, Right hamstring, Left knee, Right knee, Lower back'
};
let settings = { ...DEFAULT_SETTINGS, ...load(K.settings, {}) };
let sessions = load(K.sessions, []);       // finished sessions
let active = load(K.active, null);         // session in progress
let queue = load(K.queue, []);             // ids waiting to upload
let custom = load(K.custom, []);           // [{name,cat}] user-created exercises

const CATS = ['Legs', 'Back', 'Chest', 'Shoulders', 'Biceps', 'Triceps', 'Core', 'Calves', 'Other'];
const STARTER = [
  ['Barbell Squat', 'Legs'], ['Deadlift', 'Legs'], ['Romanian Deadlift', 'Legs'], ['Single Leg RDL', 'Legs'],
  ['Bulgarian Split', 'Legs'], ['Glute Bridge', 'Legs'], ['Lying Leg Curl Machine', 'Legs'], ['Seated Leg Curl Machine', 'Legs'],
  ['Nordic Hamstring Curl', 'Legs'], ['Leg Extension Machine', 'Legs'], ['Leg Press', 'Legs'], ['Box Step Up', 'Legs'],
  ['Standing Calf Raise Machine', 'Calves'], ['Pull Up', 'Back'], ['Lat Pulldown', 'Back'], ['Barbell Row', 'Back'],
  ['Seated Cable Row', 'Back'], ['Flat Barbell Bench Press', 'Chest'], ['Incline Dumbbell Bench Press', 'Chest'], ['Dips', 'Chest'],
  ['Dumbbell Press', 'Shoulders'], ['Lateral Dumbbell Raise', 'Shoulders'], ['Cable Face Pull', 'Shoulders'],
  ['Barbell Curl', 'Biceps'], ['Rope Push Down', 'Triceps'], ['Plank', 'Core']
];
const persist = () => { save(K.sessions, sessions); save(K.active, active); save(K.queue, queue); save(K.custom, custom); };

/* ---------- helpers ---------- */
const pad = n => String(n).padStart(2, '0');
const localISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const idFor = iso => iso.slice(0, 10) + '_' + iso.slice(11, 13) + iso.slice(14, 16);
const fmtDate = iso => new Date(iso.length === 10 ? iso + 'T12:00' : iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtW = w => (w == null || w === '') ? '' : (Math.round(w * 100) / 100).toString();
const setLabel = s => `${fmtW(s.w)}${s.w !== '' && s.w != null ? '×' : ''}${s.r}`;
const mmss = s => `${s < 0 ? '-' : ''}${Math.floor(Math.abs(s) / 60)}:${pad(Math.floor(Math.abs(s) % 60))}`;
const allSessions = () => sessions.slice().sort((a, b) => b.start.localeCompare(a.start));
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }

function exerciseList() {
  const m = new Map();
  for (const [n, c] of STARTER) m.set(n, { name: n, cat: c, last: '' });
  for (const s of sessions) for (const x of s.sets) {
    const e = m.get(x.ex) || { name: x.ex, cat: x.cat || 'Other', last: '' };
    if (s.start > e.last) { e.last = s.start; e.cat = x.cat || e.cat; }
    m.set(x.ex, e);
  }
  for (const c of custom) if (!m.has(c.name)) m.set(c.name, { name: c.name, cat: c.cat, last: '' });
  return [...m.values()];
}
const catOf = name => (exerciseList().find(e => e.name === name) || {}).cat || 'Other';

function lastTime(ex, beforeISO) {
  for (const s of allSessions()) {
    if (beforeISO && s.start >= beforeISO) continue;
    const sets = s.sets.filter(x => x.ex === ex);
    if (sets.length) return { s, sets };
  }
  return null;
}
function exHistory(ex, n = 8) {
  const out = [];
  for (const s of allSessions()) {
    const sets = s.sets.filter(x => x.ex === ex);
    if (sets.length) out.push({ s, sets });
    if (out.length >= n) break;
  }
  return out;
}
const e1rm = (w, r) => (w > 0 && r > 0 && r <= 15) ? w * (1 + r / 30) : 0;

/* ---------- navigation ---------- */
let view = 'today';
function go(v) {
  view = v;
  for (const id of ['today', 'history', 'settings']) {
    const b = $('#nav-' + id);
    if (id === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  render();
}
$('#nav-today').onclick = () => go('today');
$('#nav-history').onclick = () => go('history');
$('#nav-settings').onclick = () => go('settings');

function render() {
  const m = $('#main'); m.innerHTML = '';
  if (view === 'today') m.append(renderToday());
  else if (view === 'history') m.append(renderHistory());
  else m.append(renderSettings());
  renderSync();
}

/* ---------- workout ---------- */
let tick;
function renderToday() {
  clearInterval(tick);
  const box = h('div', { class: 'stack' });
  if (!active) {
    box.append(
      h('div', { class: 'card stack' },
        h('h2', { text: 'No session running' }),
        h('p', { class: 'muted small', style: 'margin:0', text: 'Start when you walk into the gym. The duration counts from here.' }),
        h('button', { class: 'btn primary block', onclick: () => startSession(new Date()) }, 'Start session'),
        h('button', { class: 'btn block', onclick: pastSessionSheet }, 'Log a past session')),
      weekSummary(),
      recentList(3));
    return box;
  }
  const el = h('span', { class: 'elapsed' });
  const upd = () => { el.textContent = active.past ? fmtDate(active.start) : mmss((Date.now() - new Date(active.start)) / 1000); };
  upd(); if (!active.past) tick = setInterval(upd, 1000);
  box.append(h('div', { class: 'card row' },
    h('div', { class: 'grow' }, h('div', { class: 'eyebrow', text: active.past ? 'Past session' : 'Session started ' + active.start.slice(11, 16) }), el),
    h('button', { class: 'btn primary', onclick: finishSheet }, 'Finish')));

  const groups = [];
  for (const s of active.sets) { let g = groups.find(x => x.ex === s.ex); if (!g) groups.push(g = { ex: s.ex, sets: [] }); g.sets.push(s); }
  for (const g of groups) {
    const lt = lastTime(g.ex, active.start);
    box.append(h('div', { class: 'card ex' },
      h('button', { class: 'ex-head', onclick: () => loggerSheet(g.ex) }, h('h3', { text: g.ex }), h('span', { class: 'muted small', text: 'Add set ›' })),
      h('div', { class: 'sets' }, g.sets.map(s => h('button', { class: 'set done', onclick: () => editSetSheet(s), title: s.note || '' }, setLabel(s) + (s.note ? ' •' : '')))),
      lt ? h('div', { class: 'last', text: 'Last ' + lt.s.start.slice(5, 10) + ': ' + lt.sets.map(setLabel).join(', ') }) : null));
  }
  box.append(h('button', { class: 'btn block', onclick: pickerSheet }, '+ Add exercise'));
  box.append(h('button', { class: 'btn danger block', onclick: discardSheet }, 'Discard session'));
  return box;
}

function startSession(d, past = false) {
  const iso = localISO(d);
  active = { id: idFor(iso), start: iso, sets: [], past, v: 1 };
  persist(); render();
}

function pastSessionSheet() {
  const date = h('input', { type: 'date', id: 'past-date', value: localISO(new Date()).slice(0, 10) });
  const time = h('input', { type: 'time', id: 'past-time', value: '18:00' });
  sheet('Log a past session', close => [
    h('p', { class: 'muted small', style: 'margin:0', text: 'For sessions from a paper log. You enter the duration when you finish.' }),
    h('label', {}, 'Date', date), h('label', {}, 'Start time', time),
    h('button', { class: 'btn primary', onclick: () => { close(); startSession(new Date(date.value + 'T' + (time.value || '18:00')), true); } }, 'Start entering sets')]);
}

function discardSheet() {
  sheet('Discard this session?', close => [
    h('p', { style: 'margin:0', text: `${active.sets.length} sets will be deleted from this phone. This can't be undone.` }),
    h('button', { class: 'btn danger', onclick: () => { active = null; persist(); close(); render(); toast('Session discarded'); } }, 'Discard session'),
    h('button', { class: 'btn', onclick: close }, 'Keep it')]);
}

/* ---------- sheets ---------- */
function sheet(title, build) {
  const wrap = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title });
  const close = () => { wrap.remove(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const inner = h('div', {}, h('div', { class: 'bar' }, h('h2', { text: title }), h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, '×')));
  inner.append(...build(close, inner).filter(Boolean));
  wrap.append(inner);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', esc);
  document.body.append(wrap);
  return close;
}

function pickerSheet() {
  let cat = '';
  const q = h('input', { type: 'search', id: 'ex-search', placeholder: 'Search exercises', autocomplete: 'off' });
  const list = h('div', { class: 'list' });
  const chips = h('div', { class: 'chips' });
  const draw = (close) => {
    const term = q.value.trim().toLowerCase();
    const xs = exerciseList()
      .filter(e => (!cat || e.cat === cat) && (!term || e.name.toLowerCase().includes(term)))
      .sort((a, b) => (b.last || '').localeCompare(a.last || '') || a.name.localeCompare(b.name));
    list.innerHTML = '';
    for (const e of xs) list.append(h('button', { onclick: () => { close(); loggerSheet(e.name); } },
      h('span', { class: 'grow', text: e.name }), h('span', { class: 'muted small', text: e.last ? e.last.slice(0, 10) : e.cat })));
    if (term && !xs.some(e => e.name.toLowerCase() === term)) list.append(h('button', { onclick: () => { close(); newExerciseSheet(q.value.trim()); } },
      h('span', { class: 'grow', text: `Create "${q.value.trim()}"` }), h('span', { class: 'muted small', text: 'new' })));
  };
  sheet('Add exercise', close => {
    chips.append(...['', ...CATS].map(c => { const b = h('button', { class: 'chip', 'aria-pressed': String(c === cat), onclick: () => { cat = c; chips.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(close); } }, c || 'All'); return b; }));
    q.addEventListener('input', () => draw(close));
    draw(close);
    setTimeout(() => q.focus(), 50);
    return [q, chips, list, h('button', { class: 'btn', onclick: () => { close(); newExerciseSheet(''); } }, 'New exercise')];
  });
}

function newExerciseSheet(name) {
  const n = h('input', { type: 'text', id: 'new-ex-name', value: name, placeholder: 'e.g. Nordic Hamstring Curl' });
  const c = h('select', { id: 'new-ex-cat' }, CATS.map(x => h('option', { value: x }, x)));
  sheet('New exercise', close => [h('label', {}, 'Name', n), h('label', {}, 'Category', c),
    h('button', { class: 'btn primary', onclick: () => {
      const v = n.value.trim(); if (!v) return toast('Give the exercise a name');
      if (!exerciseList().some(e => e.name === v)) custom.push({ name: v, cat: c.value });
      persist(); close(); loggerSheet(v);
    } }, 'Create and log')]);
}

function stepper(id, value, step, label) {
  const inp = h('input', { type: 'number', id, inputmode: 'decimal', value, step: 'any', 'aria-label': label });
  const bump = d => { const v = parseFloat(inp.value || '0') + d; inp.value = String(Math.max(0, Math.round(v * 100) / 100)); };
  return { el: h('label', {}, label, h('div', { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': 'Less ' + label, onclick: () => bump(-step) }, '−'), inp,
    h('button', { type: 'button', 'aria-label': 'More ' + label, onclick: () => bump(step) }, '+'))), inp };
}

function loggerSheet(ex) {
  if (!active) return;
  const cur = active.sets.filter(s => s.ex === ex);
  const lt = lastTime(ex, active.start);
  const ref = cur[cur.length - 1] || (lt && lt.sets[Math.min(cur.length, lt.sets.length - 1)]) || { w: '', r: 10 };
  const W = stepper('set-w', ref.w ?? '', settings.step, 'Weight (kg)');
  const R = stepper('set-r', ref.r ?? 10, 1, 'Reps');
  const note = h('input', { type: 'text', id: 'set-note', placeholder: 'Note (tempo, unilateral, pain…)' });
  const curBox = h('div', { class: 'sets' });
  const drawCur = () => { curBox.innerHTML = ''; active.sets.filter(s => s.ex === ex).forEach((s, i) => curBox.append(h('span', { class: 'set' }, `${i + 1}. ${setLabel(s)}`))); };
  drawCur();
  const hist = exHistory(ex, 8);
  const best = hist.reduce((b, x) => Math.max(b, ...x.sets.map(s => e1rm(+s.w, +s.r))), 0);
  sheet(ex, close => [
    lt ? h('div', { class: 'last', text: `Last time (${lt.s.start.slice(0, 10)}): ${lt.sets.map(setLabel).join(', ')}` }) : h('div', { class: 'muted small', text: 'First time logging this exercise.' }),
    W.el, R.el,
    note,
    h('button', { class: 'btn primary block', onclick: () => {
      const w = W.inp.value === '' ? '' : Math.max(0, parseFloat(W.inp.value));
      const r = parseInt(R.inp.value, 10);
      if (!(r > 0)) return toast('Enter the number of reps (or seconds for a hold)');
      active.sets.push({ ex, cat: catOf(ex), w, r, note: note.value.trim(), t: new Date().toISOString() });
      note.value = ''; persist(); drawCur(); render();
      if (!active.past) startRest(settings.rest);
      toast(`Set ${active.sets.filter(s => s.ex === ex).length} logged`);
    } }, 'Log set'),
    h('div', {}, h('div', { class: 'eyebrow', text: 'This session' }), curBox),
    hist.length ? h('div', {},
      h('div', { class: 'eyebrow', text: 'History' + (best ? ` · best est. 1RM ${Math.round(best)} kg` : '') }),
      h('table', {}, h('tbody', {}, hist.map(x => h('tr', {}, h('td', { text: x.s.start.slice(2, 10) }), h('td', { text: x.sets.map(setLabel).join('  ') })))))) : null,
    h('button', { class: 'btn', onclick: close }, 'Done')]);
}

function editSetSheet(s) {
  const W = stepper('edit-w', s.w ?? '', settings.step, 'Weight (kg)');
  const R = stepper('edit-r', s.r, 1, 'Reps');
  const note = h('input', { type: 'text', id: 'edit-note', value: s.note || '' });
  sheet(s.ex, close => [
    W.el, R.el,
    h('label', {}, 'Note', note),
    h('button', { class: 'btn primary', onclick: () => { s.w = W.inp.value === '' ? '' : parseFloat(W.inp.value); s.r = parseInt(R.inp.value, 10) || s.r; s.note = note.value.trim(); persist(); close(); render(); } }, 'Save set'),
    h('button', { class: 'btn danger', onclick: () => { active.sets.splice(active.sets.indexOf(s), 1); persist(); close(); render(); } }, 'Delete set')]);
}

function finishSheet() {
  if (!active.sets.length) return toast('Log at least one set, or discard the session');
  const first = new Date(active.start);
  const lastT = active.sets.reduce((m, s) => s.t > m ? s.t : m, active.start);
  const est = active.past ? 60 : Math.max(1, Math.round((Date.now() - first) / 60000));
  const dur = h('input', { type: 'number', id: 'fin-dur', inputmode: 'numeric', value: est });
  let rpe = 0;
  const rpeBox = h('div', { class: 'rpe', role: 'group', 'aria-label': 'Session effort 1 to 10' });
  for (let i = 1; i <= 10; i++) { const b = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { rpe = i; rpeBox.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); } }, String(i)); rpeBox.append(b); }
  const areas = settings.painAreas.split(',').map(s => s.trim()).filter(Boolean);
  const pain = {};
  const painBox = h('div', { class: 'pain' });
  areas.forEach((a, i) => {
    const out = h('output', { text: '0' });
    pain[a] = 0;
    painBox.append(h('label', {}, a, h('input', { type: 'range', id: 'pain-' + i, min: 0, max: 10, step: 1, value: 0, oninput: e => { pain[a] = +e.target.value; out.textContent = e.target.value; } })), out);
  });
  const note = h('textarea', { id: 'fin-note', placeholder: 'How did it feel? Anything to watch?' });
  sheet('Finish session', close => [
    h('label', {}, 'Duration (min)', dur),
    h('div', {}, h('div', { class: 'eyebrow', text: 'Session effort (RPE)' }), h('div', { class: 'muted small', text: '1 = very easy · 5 = hard but comfortable · 8 = very hard · 10 = maximal' }), rpeBox),
    h('div', { class: 'stack' }, h('div', { class: 'eyebrow', text: 'Pain or discomfort (0 = none)' }), painBox),
    note,
    h('button', { class: 'btn primary', onclick: () => {
      if (!rpe) return toast('Pick a session effort from 1 to 10');
      const d = Math.max(1, parseInt(dur.value, 10) || est);
      const end = localISO(new Date(first.getTime() + d * 60000));
      const s = { id: active.id, v: 1, source: 'gymlog', start: active.start, end, durationMin: d, rpe, load: d * rpe, pain, note: note.value.trim(), sets: active.sets };
      sessions = sessions.filter(x => x.id !== s.id).concat(s);
      if (!queue.includes(s.id)) queue.push(s.id);
      active = null; stopRest(); persist(); close(); go('today');
      toast('Session saved'); syncQueue();
    } }, 'Save session')]);
}

/* ---------- rest timer ---------- */
let restEnd = 0, restInt, audio;
function startRest(sec) {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  restEnd = Date.now() + sec * 1000; let buzzed = false;
  $('#timer').hidden = false; clearInterval(restInt);
  const upd = () => {
    const left = (restEnd - Date.now()) / 1000;
    $('#timer').classList.toggle('over', left <= 0);
    $('#timertxt').textContent = left > 0 ? mmss(Math.ceil(left)) : '+' + mmss(-left) + ' go';
    if (left <= 0 && !buzzed) { buzzed = true; try { navigator.vibrate && navigator.vibrate([250, 120, 250]); } catch {} beep(); }
  };
  upd(); restInt = setInterval(upd, 250);
}
function stopRest() { clearInterval(restInt); $('#timer').hidden = true; }
function beep() { if (!audio) return; try { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; g.gain.value = .15; o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + .35); } catch {} }
$('#timer-add').onclick = () => { restEnd += 30000; };
$('#timer-stop').onclick = stopRest;

/* ---------- history ---------- */
const LEGS = new Set(['Legs', 'Calves']);
function weekStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function weekSummary() {
  const ws = weekStart(new Date()); const prev = new Date(ws); prev.setDate(prev.getDate() - 7);
  const sum = (from, to) => { const xs = sessions.filter(s => { const d = new Date(s.start); return d >= from && d < to; });
    return { n: xs.length, sets: xs.reduce((a, s) => a + s.sets.length, 0), leg: xs.reduce((a, s) => a + s.sets.filter(x => LEGS.has(x.cat)).length, 0), load: xs.reduce((a, s) => a + (s.load || 0), 0) }; };
  const now = sum(ws, new Date(ws.getTime() + 7 * 864e5)), last = sum(prev, ws);
  const cell = (label, a, b) => h('div', {}, h('div', { class: 'eyebrow', text: label }), h('div', { class: 'mono', style: 'font-size:1.3rem;font-weight:700', text: String(a) }), h('div', { class: 'muted small mono', text: 'last wk ' + b }));
  return h('div', { class: 'card' }, h('div', { class: 'eyebrow', style: 'margin-bottom:8px', text: 'This week' }),
    h('div', { class: 'stats' },
      cell('Sessions', now.n, last.n), cell('Sets', now.sets, last.sets), cell('Leg sets', now.leg, last.leg), cell('Load', now.load, last.load)));
}
function recentList(n) {
  const xs = allSessions().slice(0, n);
  if (!xs.length) return h('p', { class: 'muted small', text: 'No sessions yet. Pull your history from GitHub or import a FitNotes CSV in Settings.' });
  return h('div', { class: 'stack' }, h('div', { class: 'eyebrow', text: 'Recent' }), ...xs.map(sessionRow));
}
function sessionRow(s) {
  const exs = [...new Set(s.sets.map(x => x.ex))];
  const st = queue.includes(s.id) ? 'pend' : (s.synced ? 'ok' : '');
  return h('button', { class: 'card', style: 'text-align:left;display:flex;flex-direction:column;gap:4px', onclick: () => sessionSheet(s) },
    h('div', { class: 'row' }, h('strong', { class: 'grow', text: fmtDate(s.start) }), st ? h('span', { class: 'dot ' + st, title: st === 'ok' ? 'On GitHub' : 'Waiting to upload' }) : null),
    h('div', { class: 'muted small mono', text: [s.durationMin ? s.durationMin + ' min' : null, s.sets.length + ' sets', s.rpe ? 'RPE ' + s.rpe : null].filter(Boolean).join(' · ') }),
    h('div', { class: 'small', style: 'color:var(--ink2)', text: exs.slice(0, 5).join(', ') + (exs.length > 5 ? ` +${exs.length - 5}` : '') }));
}
function renderHistory() {
  const box = h('div', { class: 'stack' }, weekSummary());
  const xs = allSessions();
  if (!xs.length) box.append(h('p', { class: 'muted', text: 'No sessions yet.' }));
  let month = '';
  for (const s of xs.slice(0, 200)) {
    const m = s.start.slice(0, 7);
    if (m !== month) { month = m; box.append(h('div', { class: 'eyebrow', style: 'margin-top:6px', text: new Date(m + '-15').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) })); }
    box.append(sessionRow(s));
  }
  return box;
}
function sessionSheet(s) {
  const pains = Object.entries(s.pain || {}).filter(([, v]) => v > 0);
  sheet(fmtDate(s.start), close => [
    h('div', { class: 'muted small mono', text: [s.durationMin && s.durationMin + ' min', s.rpe && 'RPE ' + s.rpe, s.load && 'load ' + s.load, s.source].filter(Boolean).join(' · ') }),
    pains.length ? h('div', { class: 'small', style: 'color:var(--bad)', text: 'Pain: ' + pains.map(([a, v]) => `${a} ${v}/10`).join(', ') }) : null,
    s.note ? h('p', { style: 'margin:0', text: s.note }) : null,
    h('div', { style: 'overflow-x:auto' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Exercise' }), h('th', { text: 'kg' }), h('th', { text: 'Reps' }), h('th', { text: 'Note' }))),
      h('tbody', {}, s.sets.map(x => h('tr', {}, h('td', { text: x.ex }), h('td', { text: fmtW(x.w) }), h('td', { text: String(x.r) }), h('td', { text: x.note || '' })))))),
    h('button', { class: 'btn', onclick: () => { if (!queue.includes(s.id)) queue.push(s.id); persist(); close(); syncQueue(); } }, 'Upload again'),
    h('button', { class: 'btn danger', onclick: () => confirmDelete(s, close) }, 'Delete session')]);
}
function confirmDelete(s, closeParent) {
  sheet('Delete this session?', close => [
    h('p', { style: 'margin:0', text: 'It will be removed from this phone' + (s.synced ? ' and from GitHub.' : '.') }),
    h('button', { class: 'btn danger', onclick: async () => {
      if (s.synced && ghReady()) { try { await ghDelete(s.id); } catch (e) { return toast('GitHub delete failed: ' + e.message); } }
      sessions = sessions.filter(x => x.id !== s.id); queue = queue.filter(x => x !== s.id); persist(); close(); closeParent(); render(); toast('Session deleted');
    } }, 'Delete'),
    h('button', { class: 'btn', onclick: close }, 'Cancel')]);
}

/* ---------- GitHub sync ---------- */
const ghReady = () => settings.owner && settings.repo && settings.token;
const ghPath = id => `${settings.folder.replace(/^\/|\/$/g, '')}/${id}.json`;
async function gh(method, path, body, accept) {
  const r = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/${path}`, {
    method, headers: { Authorization: 'Bearer ' + settings.token, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) { let m = r.status + ''; try { m += ' ' + (await r.json()).message; } catch {} throw new Error(m); }
  return accept && accept.includes('raw') ? r.text() : r.json();
}
const b64 = str => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
async function ghPut(s) {
  const path = ghPath(s.id);
  const cur = await gh('GET', `contents/${path}?ref=${encodeURIComponent(settings.branch)}`);
  const { synced, ...clean } = s;
  await gh('PUT', `contents/${path}`, { message: `Gym session ${s.start.slice(0, 10)}`, content: b64(JSON.stringify(clean, null, 1) + '\n'), branch: settings.branch, ...(cur && cur.sha ? { sha: cur.sha } : {}) });
}
async function ghDelete(id) {
  const path = ghPath(id);
  const cur = await gh('GET', `contents/${path}?ref=${encodeURIComponent(settings.branch)}`);
  if (cur && cur.sha) await gh('DELETE', `contents/${path}`, { message: `Delete gym session ${id}`, sha: cur.sha, branch: settings.branch });
}
let syncing = false, syncErr = '';
async function syncQueue() {
  if (syncing || !ghReady() || !queue.length || !navigator.onLine) return renderSync();
  syncing = true; syncErr = ''; renderSync();
  for (const id of queue.slice()) {
    const s = sessions.find(x => x.id === id);
    try { if (s) { await ghPut(s); s.synced = true; } queue = queue.filter(x => x !== id); persist(); }
    catch (e) { syncErr = e.message; break; }
    renderSync();
  }
  syncing = false; renderSync(); if (view === 'history') render();
  if (syncErr) toast('Upload failed: ' + syncErr);
}
async function pullHistory(btn) {
  if (!ghReady()) return toast('Fill in the GitHub settings first');
  btn.disabled = true; btn.textContent = 'Reading list…';
  try {
    const list = await gh('GET', `contents/${settings.folder}?ref=${encodeURIComponent(settings.branch)}`) || [];
    const have = new Set(sessions.map(s => s.id));
    const todo = list.filter(f => f.name.endsWith('.json') && !have.has(f.name.slice(0, -5)));
    let done = 0;
    const worker = async () => { while (todo.length) { const f = todo.shift();
      const txt = await gh('GET', `contents/${f.path}?ref=${encodeURIComponent(settings.branch)}`, null, 'application/vnd.github.raw+json');
      try { const s = JSON.parse(txt); s.synced = true; sessions.push(s); } catch {}
      btn.textContent = `Downloaded ${++done}`; } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    persist(); toast(`Pulled ${done} sessions`);
  } catch (e) { toast('Pull failed: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Pull history from GitHub';
}
function renderSync() {
  const dot = $('#syncdot'), t = $('#synctxt');
  if (!ghReady()) { dot.className = 'dot'; t.textContent = 'not connected'; return; }
  if (syncing) { dot.className = 'dot pend'; t.textContent = 'uploading…'; return; }
  if (syncErr) { dot.className = 'dot err'; t.textContent = 'upload failed'; return; }
  if (queue.length) { dot.className = 'dot pend'; t.textContent = queue.length + ' waiting'; return; }
  dot.className = 'dot ok'; t.textContent = 'synced';
}
addEventListener('online', syncQueue);

/* ---------- FitNotes CSV ---------- */
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.length > 1);
}
function importFitNotes(text) {
  const rows = parseCSV(text); const head = rows.shift().map(x => x.trim());
  const ix = n => head.indexOf(n);
  const [iD, iE, iC, iW, iU, iR, iT, iN] = ['Date', 'Exercise', 'Category', 'Weight', 'Weight Unit', 'Reps', 'Time', 'Comment'].map(ix);
  if (iD < 0 || iE < 0) throw new Error('This does not look like a FitNotes export');
  const byDay = new Map();
  for (const r of rows) {
    const d = r[iD]; if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    let w = r[iW] === '' ? '' : parseFloat(r[iW]); if (w !== '' && r[iU] === 'lbs') w = Math.round(w * 0.4536 * 10) / 10;
    let reps = parseInt(r[iR], 10); let note = (r[iN] || '').trim();
    if (!(reps > 0) && iT >= 0 && r[iT]) { const p = r[iT].split(':').map(Number); reps = p.reduce((a, x) => a * 60 + x, 0); note = (note + ' (seconds)').trim(); }
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({ ex: r[iE], cat: r[iC] || 'Other', w, r: reps || 0, note });
  }
  let added = 0;
  for (const [d, sets] of byDay) {
    const id = d + '_fitnotes';
    if (sessions.some(s => s.id === id || (s.start.slice(0, 10) === d && s.source !== 'gymlog'))) continue;
    sessions.push({ id, v: 1, source: 'fitnotes', start: d + 'T00:00', end: null, durationMin: null, rpe: null, load: null, pain: {}, note: '', sets });
    added++;
  }
  persist(); return added;
}
function exportCSV() {
  const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = ['Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment'];
  for (const s of sessions.slice().sort((a, b) => a.start.localeCompare(b.start))) for (const x of s.sets)
    lines.push([s.start.slice(0, 10), x.ex, x.cat, x.w === '' ? '' : Number(x.w).toFixed(1), 'kgs', x.r, '', '', '', x.note].map(esc).join(','));
  const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
  const a = h('a', { href: url, download: `gymlog_${localISO(new Date()).slice(0, 10)}.csv` }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$('#csvfile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const n = importFitNotes(await f.text()); toast(`Imported ${n} sessions`); render(); } catch (err) { toast(err.message); }
  e.target.value = '';
});

/* ---------- settings ---------- */
function renderSettings() {
  const f = (key, label, attrs = {}) => {
    const inp = h('input', { id: 'set-' + key, value: settings[key], type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...attrs });
    inp.addEventListener('change', () => { settings[key] = attrs.type === 'number' ? Number(inp.value) : inp.value.trim(); save(K.settings, settings); renderSync(); });
    return h('label', {}, label, inp);
  };
  const pull = h('button', { class: 'btn block', onclick: e => pullHistory(e.currentTarget) }, 'Pull history from GitHub');
  return h('div', { class: 'stack' },
    h('div', { class: 'card stack' }, h('h2', { text: 'GitHub storage' }),
      h('p', { class: 'muted small', style: 'margin:0', text: 'Each finished session is saved as one JSON file in this repository. The token stays on this phone only.' }),
      f('owner', 'Account'), f('repo', 'Repository'), f('branch', 'Branch'), f('folder', 'Folder'),
      f('token', 'Access token', { type: 'password' }),
      h('button', { class: 'btn primary block', onclick: async () => {
        if (!ghReady()) return toast('Fill in account, repository and token');
        try { const r = await gh('GET', ''); toast(r ? `Connected to ${r.full_name}${r.private ? ' (private)' : ' — warning: repo is public'}` : 'Repository not found, or the token has no access to it'); }
        catch (e) { toast('Connection failed: ' + e.message); }
      } }, 'Test connection'),
      h('button', { class: 'btn block', onclick: syncQueue }, `Upload waiting sessions (${queue.length})`),
      pull),
    h('div', { class: 'card stack' }, h('h2', { text: 'Workout' }),
      f('rest', 'Rest timer (seconds)', { type: 'number', inputmode: 'numeric' }),
      f('step', 'Weight step (kg)', { type: 'number', inputmode: 'decimal', step: 'any' }),
      f('painAreas', 'Pain check areas (comma separated)')),
    h('div', { class: 'card stack' }, h('h2', { text: 'Import and export' }),
      h('button', { class: 'btn block', onclick: () => $('#csvfile').click() }, 'Import FitNotes CSV'),
      h('p', { class: 'muted small', style: 'margin:0', text: 'Imported sessions stay on this phone. Use Pull history if they are already on GitHub.' }),
      h('button', { class: 'btn block', onclick: exportCSV }, 'Export all as CSV')),
    h('p', { class: 'muted small', text: `${sessions.length} sessions on this phone · ${sessions.reduce((a, s) => a + s.sets.length, 0)} sets` }));
}

/* ---------- boot ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
syncQueue();
