'use strict';
/* Gym Log — offline-first strength logger.
   Sessions and plans live in localStorage and sync to a private GitHub repo:
   one JSON file per session in sessions/, all plans in plans.json. */

const $ = s => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
};

/* ---------- storage ---------- */
const K = { sessions: 'gl.sessions', active: 'gl.active', settings: 'gl.settings', queue: 'gl.queue', custom: 'gl.custom', plans: 'gl.plans', plansDirty: 'gl.plansDirty', rest: 'gl.rest', coach: 'gl.coach' };
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Could not save on this phone: ' + e.message); } };

const DEFAULT_SETTINGS = {
  owner: '', repo: '', branch: 'main', folder: 'sessions', token: '',
  rest: 90, step: 2.5,
  painAreas: 'Left hamstring, Right hamstring, Left knee, Right knee, Lower back'
};
let settings = { ...DEFAULT_SETTINGS, ...load(K.settings, {}) };
let sessions = load(K.sessions, []);
let active = load(K.active, null);
if (active && !active.items) active = null; // older format
let queue = load(K.queue, []);
let custom = load(K.custom, []);
let plans = load(K.plans, []);              // includes tombstones {id, deleted:true, updatedAt}
let plansDirty = load(K.plansDirty, false);
let restBy = load(K.rest, {});              // last rest used per exercise, seconds
let coach = load(K.coach, null);            // weekly recommendation from coach.json
const persist = () => { save(K.sessions, sessions); save(K.active, active); save(K.queue, queue); save(K.custom, custom); save(K.plans, plans); save(K.plansDirty, plansDirty); save(K.rest, restBy); save(K.coach, coach); };

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
const REST_PRESETS = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
const MUSCLES = ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Back', 'Chest', 'Shoulders', 'Arms', 'Core'];
const MUSCLE_MAP = {
  'Barbell Squat': ['Quads', 'Glutes'], 'Squats': ['Quads', 'Glutes'], 'Hack Squat': ['Quads'], 'Leg Press': ['Quads', 'Glutes'],
  'Leg Extension Machine': ['Quads'], 'Bulgarian Split': ['Quads', 'Glutes'], 'Barbell Split Squats': ['Quads', 'Glutes'],
  'Box Step Up': ['Quads', 'Glutes'], 'Excentric Single Leg Sit Up': ['Quads'],
  'Deadlift': ['Hamstrings', 'Glutes', 'Back'], 'Romanian Deadlift': ['Hamstrings', 'Glutes'], 'Stiff-Legged Deadlift': ['Hamstrings', 'Glutes'],
  'Single Leg RDL': ['Hamstrings', 'Glutes'], 'Lying Leg Curl Machine': ['Hamstrings'], 'Seated Leg Curl Machine': ['Hamstrings'],
  'Leg Curl Elastique': ['Hamstrings'], 'Hamstring Médecine Ball Curl': ['Hamstrings'], 'Glute-Ham Raise': ['Hamstrings', 'Glutes'],
  'Nordic Hamstring Curl': ['Hamstrings'], 'Glute Bridge': ['Glutes', 'Hamstrings'], 'Hip Adduction': ['Glutes'],
  'Standing Calf Raise Machine': ['Calves'], 'Seated Calf Raise Machine': ['Calves'], 'Donkey Calf Raise': ['Calves'],
  'Pull Up': ['Back', 'Arms'], 'Chin Up': ['Back', 'Arms'], 'Lat Pulldown': ['Back'], 'Lat Pull Machine': ['Back'], 'Barbell Row': ['Back'],
  'Dumbbell Row': ['Back'], 'Seated Cable Row': ['Back'], 'Doritos Pull': ['Back'],
  'Flat Barbell Bench Press': ['Chest', 'Arms'], 'Flat Dumbbell Bench Press': ['Chest'], 'Incline Barbell Bench Press': ['Chest', 'Shoulders'],
  'Incline Dumbbell Bench Press': ['Chest', 'Shoulders'], 'Incline Smith Machine Bench': ['Chest', 'Shoulders'], 'Seated Machine Fly': ['Chest'],
  'Cable Crossover': ['Chest'], 'Vertical Chest Press': ['Chest'], 'Dips': ['Chest', 'Arms'],
  'Arnold Dumbbell Press': ['Shoulders'], 'Dumbbell Press': ['Shoulders'], 'Lateral Dumbbell Raise': ['Shoulders'], 'Lateral Cable Rise': ['Shoulders'],
  'Lateral Machine Raise': ['Shoulders'], 'Seated Dumbbell Lateral Raise': ['Shoulders'], 'Front Dumbbell Raise': ['Shoulders'],
  'Rear Delt Dumbbell Raise': ['Shoulders', 'Back'], 'Rear Delt Machine Fly': ['Shoulders', 'Back'], 'Cable Face Pull': ['Shoulders', 'Back'],
  'Trap Raises': ['Shoulders'], 'Pike Push-up': ['Shoulders'],
  'Barbell Curl': ['Arms'], 'EZ-Bar Curl': ['Arms'], 'Preacher Curl': ['Arms'], 'Dumbbell Preacher Curl': ['Arms'], 'Cable Curl': ['Arms'],
  'EZ-Bar Skullcrusher': ['Arms'], 'Rope Push Down': ['Arms'], 'Cable Overhead Triceps Extension': ['Arms'], 'Plank': ['Core']
};
const KEYWORDS = [
  [/leg curl|hamstring|nordic|\brdl\b|romanian|stiff/i, ['Hamstrings']], [/calf/i, ['Calves']],
  [/squat|leg press|leg ext|lunge|split|step.?up/i, ['Quads', 'Glutes']], [/glute|hip thrust|bridge|adduct|abduct/i, ['Glutes']],
  [/deadlift/i, ['Hamstrings', 'Glutes', 'Back']], [/row|pull|chin|pulldown|\blat\b/i, ['Back']],
  [/bench|chest|fly|dip|crossover|push.?up/i, ['Chest']], [/shoulder|lateral|raise|arnold|overhead|military|face pull|delt|trap/i, ['Shoulders']],
  [/curl|tricep|skull|push.?down|extension/i, ['Arms']], [/plank|\babs?\b|crunch|core|sit.?up|hollow/i, ['Core']]];
const CAT_MUSCLE = { Legs: ['Quads'], Calves: ['Calves'], Back: ['Back'], Chest: ['Chest'], Shoulders: ['Shoulders'], Biceps: ['Arms'], Triceps: ['Arms'], Core: ['Core'] };
const MUSCLE_CAT = { Quads: 'Legs', Hamstrings: 'Legs', Glutes: 'Legs', Calves: 'Calves', Back: 'Back', Chest: 'Chest', Shoulders: 'Shoulders', Arms: 'Biceps', Core: 'Core' };
function musclesOf(name, cat) {
  const c = custom.find(x => x.name === name);
  if (c && c.muscles && c.muscles.length) return c.muscles;
  if (MUSCLE_MAP[name]) return MUSCLE_MAP[name];
  for (const [re, m] of KEYWORDS) if (re.test(name)) return m;
  return CAT_MUSCLE[cat || catOf(name)] || ['Core'];
}
const isLeg = x => LEGS.has(x.cat) || musclesOf(x.ex, x.cat).some(m => ['Quads', 'Hamstrings', 'Glutes', 'Calves'].includes(m));
const isHam = x => musclesOf(x.ex, x.cat)[0] === 'Hamstrings';
const work = sets => sets.filter(s => !s.warm);

/* ---------- helpers ---------- */
const pad = n => String(n).padStart(2, '0');
const localISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const idFor = iso => iso.slice(0, 10) + '_' + iso.slice(11, 13) + iso.slice(14, 16);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtDate = iso => new Date(iso.length === 10 ? iso + 'T12:00' : iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const shortDate = iso => new Date(iso.slice(0, 10) + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtW = w => (w === '' || w == null || isNaN(w)) ? '' : String(Math.round(w * 100) / 100);
const setLabel = s => (fmtW(s.w) ? fmtW(s.w) + '×' : '') + s.r;
const mmss = s => `${Math.floor(Math.abs(s) / 60)}:${pad(Math.floor(Math.abs(s) % 60))}`;
const restLabel = s => s >= 60 ? (s % 60 ? mmss(s) : (s / 60) + ' min') : s + ' s';
const allSessions = () => sessions.slice().sort((a, b) => b.start.localeCompare(a.start));
const livePlans = () => plans.filter(p => !p.deleted).sort((a, b) => a.name.localeCompare(b.name));
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }
const clone = o => JSON.parse(JSON.stringify(o));

const mondayOf = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return localISO(x).slice(0, 10); };
function coachNow() { return coach && coach.week === mondayOf(new Date()) ? coach : null; }
const legLimit = () => { const c = coachNow(); return c && c.limits && c.limits.legSets; };

function exerciseList() {
  const m = new Map();
  for (const [n, c] of STARTER) m.set(n, { name: n, cat: c, last: '' });
  for (const s of sessions) for (const x of s.sets) {
    const e = m.get(x.ex) || { name: x.ex, cat: x.cat || 'Other', last: '' };
    if (s.start > e.last) { e.last = s.start; e.cat = x.cat || e.cat; }
    m.set(x.ex, e);
  }
  for (const p of livePlans()) for (const x of p.exercises) if (!m.has(x.ex)) m.set(x.ex, { name: x.ex, cat: x.cat || 'Other', last: '' });
  for (const c of custom) if (!m.has(c.name)) m.set(c.name, { name: c.name, cat: c.cat, last: '' });
  return [...m.values()];
}
const catOf = name => (exerciseList().find(e => e.name === name) || {}).cat || 'Other';
const restOf = ex => restBy[ex] || settings.rest;

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
  for (const s of allSessions()) { const sets = s.sets.filter(x => x.ex === ex); if (sets.length) out.push({ s, sets }); if (out.length >= n) break; }
  return out;
}
const e1rm = (w, r) => (w > 0 && r > 0 && r <= 15) ? w * (1 + r / 30) : 0;

/* ---------- navigation ---------- */
let view = 'today';
function go(v) {
  view = v;
  for (const id of ['today', 'plans', 'history', 'settings']) { const b = $('#nav-' + id); if (id === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  render(); $('#main').scrollTop = 0;
}
for (const id of ['today', 'plans', 'history', 'settings']) $('#nav-' + id).onclick = () => go(id);
$('#sync').onclick = () => go('settings');

function render() {
  const m = $('#main'); const y = m.scrollTop; m.innerHTML = '';
  $('#title').textContent = view === 'today' && active ? (active.planName || 'Session') : 'Gym Log';
  if (view === 'today') m.append(active ? renderSession() : renderIdle());
  else if (view === 'plans') m.append(renderPlans());
  else if (view === 'history') m.append(renderHistory());
  else m.append(renderSettings());
  m.scrollTop = y; renderSync();
}

/* ---------- idle workout screen ---------- */
let tick;
function renderIdle() {
  clearInterval(tick);
  const ps = livePlans();
  const lastDone = id => { const s = allSessions().find(x => x.planId === id); return s ? shortDate(s.start) : null; };
  return h('div', { class: 'stack' },
    coachCard(),
    h('div', { class: 'card hero' }, h('h2', { text: 'Start a session' }), h('p', { class: 'small', text: ps.length ? 'Pick a plan: every set is preloaded, you just confirm or adjust.' : 'Create a plan once and every set will be preloaded next time.' })),
    ...ps.map(p => h('button', { class: 'card plan', onclick: () => startSession(new Date(), { plan: p }) },
      h('div', { class: 'row' }, h('h3', { class: 'grow', text: p.name }), h('span', { class: 'chipbtn', style: 'background:var(--accent);color:var(--accent-ink);border-color:var(--accent)', text: 'Start' })),
      h('div', { class: 'exs', text: p.exercises.map(x => x.ex).join(' · ') }),
      h('div', { class: 'meta', text: `${p.exercises.length} exercises · ${p.exercises.reduce((a, x) => a + x.sets.length, 0)} sets` + (lastDone(p.id) ? ` · last done ${lastDone(p.id)}` : '') }))),
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', onclick: () => startSession(new Date()) }, 'Empty session'),
      h('button', { class: 'btn grow', onclick: pastSessionSheet }, 'Past session')),
    weekSummary());
}

function coachCard() {
  if (!coach) return null;
  const cur = coachNow();
  const tg = Object.entries(coach.targets || {});
  const fmt = sets => { const w = work(sets); if (!w.length) return ''; const same = w.every(s => s.w === w[0].w && s.r === w[0].r);
    return same ? `${w.length}×${w[0].r}${fmtW(w[0].w) ? ' @ ' + fmtW(w[0].w) + ' kg' : ''}` : w.map(setLabel).join(' · '); };
  const open = h('div', { class: 'stack', style: 'gap:8px', hidden: !cur },
    (coach.notes || []).length ? h('ul', { class: 'coachnotes' }, coach.notes.map(n => h('li', { text: n }))) : null,
    tg.length ? h('div', { class: 'coachtg' }, tg.map(([ex, v]) => h('div', { class: 'row' }, h('span', { class: 'grow', text: ex }), h('span', { class: 'num', text: fmt(v.sets || []) })))) : null,
    tg.length ? h('div', { class: 'muted tiny', text: 'These sets are preloaded when you add the exercise or start a plan this week.' }) : null);
  return h('div', { class: 'card coach' },
    h('div', { class: 'row' }, h('div', { class: 'eyebrow grow', style: 'color:var(--accent-text)', text: (cur ? 'Coach · week of ' : 'Coach · last update ') + shortDate(coach.week) }),
      cur ? null : h('button', { class: 'link', onclick: e => { open.hidden = !open.hidden; e.currentTarget.textContent = open.hidden ? 'Show' : 'Hide'; } }, 'Show')),
    h('h3', { text: cur ? coach.headline : 'No recommendation for this week yet' }),
    open);
}

/* ---------- active session ---------- */
/* active = { id, start, past, planId, planName, prefill, items:[{ex, cat, rest, sets:[{w, r, done, t, note, restActual}]}] } */
let focus = null; // {i, j}

function coachTarget(ex) {
  const c = coachNow();
  return c && c.targets && c.targets[ex] ? c.targets[ex] : null;
}
function itemFromLast(ex, n, planSets) {
  const lt = lastTime(ex, active && active.start);
  const ct = coachTarget(ex);
  let sets, fromCoach = false;
  if (ct && ct.sets && ct.sets.length) { sets = ct.sets.map(s => ({ w: s.w ?? '', r: s.r, warm: !!s.warm, done: false })); fromCoach = true; }
  else if (planSets && planSets.length) {
    const lw = lt ? work(lt.sets) : [];
    let k = 0;
    sets = planSets.map(p => {
      let w = p.w;
      if (!p.warm && (!active || active.prefill !== 'plan') && lw.length) { const ls = lw[Math.min(k, lw.length - 1)]; if (ls && ls.w !== '' && ls.w != null) w = ls.w; }
      if (!p.warm) k++;
      return { w, r: p.r, warm: !!p.warm, done: false };
    });
  } else if (lt) sets = lt.sets.map(s => ({ w: s.w, r: s.r, warm: !!s.warm, done: false }));
  else sets = Array.from({ length: n || 3 }, () => ({ w: '', r: 10, done: false }));
  const it = { ex, cat: catOf(ex), rest: (ct && ct.rest) || restOf(ex), sets };
  if (fromCoach) { it.coach = true; if (ct.note) it.coachNote = ct.note; }
  return it;
}

function startSession(d, { plan = null, past = false } = {}) {
  const iso = localISO(d);
  active = { id: idFor(iso), start: iso, past, planId: plan ? plan.id : null, planName: plan ? plan.name : null, prefill: plan ? (plan.prefill || 'last') : 'last', items: [] };
  if (plan) for (const x of plan.exercises) { const it = itemFromLast(x.ex, x.sets.length, x.sets); if (!it.coach) it.rest = x.rest || restOf(x.ex); it.cat = x.cat || it.cat; if (x.note) it.planNote = x.note; active.items.push(it); }
  focus = null; persist(); go('today');
}

function nextPlanned(fromI = 0) {
  if (!active) return null;
  const n = active.items.length;
  for (let k = 0; k < n; k++) { const i = (fromI + k) % n; const j = active.items[i].sets.findIndex(s => !s.done); if (j >= 0) return { i, j }; }
  return null;
}
function validFocus() {
  if (focus && active.items[focus.i] && active.items[focus.i].sets[focus.j]) return focus;
  if (focus && focus.i === -1) return focus; // editor closed on purpose
  return focus = nextPlanned(0);
}
const doneCount = () => active.items.reduce((a, it) => a + it.sets.filter(s => s.done).length, 0);
const totalCount = () => active.items.reduce((a, it) => a + it.sets.length, 0);

function renderSession() {
  clearInterval(tick);
  validFocus();
  const box = h('div', { class: 'stack' });
  const el = h('div', { class: 'elapsed' });
  const upd = () => { el.textContent = active.past ? shortDate(active.start) : mmss((Date.now() - new Date(active.start)) / 1000); };
  upd(); if (!active.past) tick = setInterval(upd, 1000);
  const dc = doneCount(), tc = totalCount();
  box.append(h('div', { class: 'card sess' },
    h('div', {}, h('div', { class: 'eyebrow', text: active.past ? 'Entering a past session' : 'Started ' + active.start.slice(11, 16) }), el),
    h('button', { class: 'btn primary', onclick: finishSheet }, 'Finish'),
    h('div', { class: 'small muted', style: 'grid-column:1/-1', text: `${dc} of ${tc} sets done` }),
    h('div', { class: 'bar' }, h('i', { style: `width:${tc ? dc / tc * 100 : 0}%` }))));

  active.items.forEach((it, i) => box.append(exerciseCard(it, i)));
  box.append(h('button', { class: 'btn block', onclick: () => pickerSheet(ex => { const it = itemFromLast(ex, 3); active.items.push(it); focus = { i: active.items.length - 1, j: 0 }; persist(); render(); scrollToFocus(); }) }, '+ Add exercise'));
  box.append(h('button', { class: 'btn danger block', onclick: discardSheet }, 'Discard session'));
  return box;
}

function exerciseCard(it, i) {
  const lt = lastTime(it.ex, active.start);
  const isCur = focus && focus.i === i;
  const card = h('div', { class: 'card ex' + (isCur ? ' current' : ''), id: 'ex-' + i },
    h('div', { class: 'ex-top' },
      h('h3', {}, h('button', { class: 'exname', onclick: () => progressSheet(it.ex) }, it.ex)),
      h('button', { class: 'chipbtn', 'aria-label': 'Rest time for ' + it.ex, onclick: () => restSheet(it), html: ICON.clock + restLabel(it.rest) }),
      h('button', { class: 'iconbtn', 'aria-label': 'More options for ' + it.ex, onclick: () => itemMenu(i) }, '⋯')),
    lt ? h('div', { class: 'lastline' }, `Last ${shortDate(lt.s.start)}: `, h('b', { text: lt.sets.map(setLabel).join(' · ') })) : h('div', { class: 'lastline', text: 'First time' }),
    it.planNote ? h('div', { class: 'lastline', text: 'Plan: ' + it.planNote }) : null,
    it.coach ? h('div', { class: 'coachline' }, h('b', { text: 'Coach' }), it.coachNote || 'Sets preloaded from this week\'s recommendation') : null);
  const sets = h('div', { class: 'sets' });
  let wn = 0;
  it.sets.forEach((s, j) => { const label = s.warm ? 'W' : String(++wn); sets.append(focus && focus.i === i && focus.j === j ? setEditor(it, i, s, j, label) : setRow(it, i, s, j, label)); });
  card.append(sets, h('div', { class: 'row' },
    h('button', { class: 'link', onclick: () => { const ws = work(it.sets); const l = ws[ws.length - 1] || it.sets[it.sets.length - 1] || { w: '', r: 10 }; it.sets.push({ w: l.w, r: l.r, done: false }); focus = { i, j: it.sets.length - 1 }; persist(); render(); } }, '+ Add set'),
    h('button', { class: 'link', onclick: () => { const ws = work(it.sets); const top = ws.length ? +ws[0].w || 0 : 0; const k = it.sets.findIndex(s => !s.warm); it.sets.splice(k < 0 ? it.sets.length : k, 0, { w: top ? Math.round(top * 0.5 / settings.step) * settings.step : '', r: 8, warm: true, done: false }); focus = { i, j: k < 0 ? it.sets.length - 1 : k }; persist(); render(); } }, '+ Warm-up')));
  return card;
}

function setRow(it, i, s, j, label) {
  return h('button', { class: 'set ' + (s.done ? 'done' : 'planned') + (s.warm ? ' warm' : ''), 'aria-label': `${s.warm ? 'Warm-up set' : 'Set ' + label}: ${setLabel(s)}${s.done ? ', done' : ', planned'}`, onclick: () => { focus = { i, j }; render(); } },
    h('span', { class: 'n', text: label }),
    h('span', { class: 'v' },
      fmtW(s.w) ? [fmtW(s.w), h('small', { text: 'kg' }), h('em', { text: '×' })] : null, String(s.r), h('small', { text: fmtW(s.w) ? '' : 'reps' }),
      s.note ? h('span', { class: 'note', text: s.note }) : null),
    h('span', { class: 'chk', html: ICON.check }));
}

function stepper(label, value, step, onChange, { ghost = false, quick = null } = {}) {
  const inp = h('input', { type: 'number', inputmode: 'decimal', value: value === '' || value == null ? '' : String(value), step: 'any', 'aria-label': label, placeholder: '–', class: ghost ? 'ghosted' : '' });
  const set = v => { inp.value = v === '' ? '' : String(Math.max(0, Math.round(v * 100) / 100)); inp.classList.remove('ghosted'); onChange(inp.value === '' ? '' : parseFloat(inp.value)); };
  inp.addEventListener('input', () => { inp.classList.remove('ghosted'); onChange(inp.value === '' ? '' : parseFloat(inp.value)); });
  inp.addEventListener('focus', () => inp.select());
  return h('div', { class: 'stepper' },
    h('div', { class: 'lab', text: label }),
    h('div', { class: 'ctl' },
      h('button', { type: 'button', 'aria-label': 'Less ' + label, onclick: () => set(parseFloat(inp.value || '0') - step) }, '−'), inp,
      h('button', { type: 'button', 'aria-label': 'More ' + label, onclick: () => set(parseFloat(inp.value || '0') + step) }, '+')),
    quick ? h('div', { class: 'quick' }, quick.map(q => h('button', { type: 'button', onclick: () => set(parseFloat(inp.value || '0') + q) }, (q > 0 ? '+' : '') + q))) : null);
}

function setEditor(it, i, s, j, label) {
  const draft = { w: s.w, r: s.r, note: s.note || '', warm: !!s.warm };
  const warmBtn = h('button', { class: 'chip sm', type: 'button', 'aria-pressed': String(draft.warm), onclick: () => { draft.warm = !draft.warm; warmBtn.setAttribute('aria-pressed', String(draft.warm)); head.textContent = draft.warm ? 'Warm-up' : `Set ${label === 'W' ? '' : label}`.trim(); } }, 'Warm-up');
  const head = h('span', { class: 'n', text: (s.warm ? 'Warm-up' : `Set ${label}`) + (s.done ? ' · done' : '') });
  const note = h('input', { type: 'text', class: 'notefield', value: draft.note, placeholder: 'Note: tempo, side, pain…', oninput: e => draft.note = e.target.value });
  const showNote = h('button', { class: 'link', onclick: () => { note.hidden = false; showNote.hidden = true; note.focus(); } }, '+ Note');
  note.hidden = !draft.note; showNote.hidden = !!draft.note;
  return h('div', { class: 'edit' },
    h('div', { class: 'edit-head' }, head, warmBtn, showNote,
      h('button', { class: 'iconbtn', 'aria-label': 'Close editor', onclick: () => { focus = { i: -1, j: -1 }; render(); } }, '×')),
    h('div', { class: 'steps' },
      stepper('kg', draft.w, settings.step, v => draft.w = v, { ghost: !s.done, quick: [-5, 5] }),
      stepper('reps', draft.r, 1, v => draft.r = v, { ghost: !s.done })),
    note,
    h('div', { class: 'actions' },
      s.done
        ? h('button', { class: 'btn', onclick: () => { s.done = false; delete s.t; delete s.restActual; persist(); render(); } }, 'Undo')
        : h('button', { class: 'btn', 'aria-label': 'Remove this set', onclick: () => { it.sets.splice(j, 1); focus = null; persist(); render(); } }, 'Remove'),
      h('button', { class: 'btn primary', onclick: () => {
        const r = parseInt(draft.r, 10);
        if (!(r > 0)) return toast('Enter reps (or seconds for a hold)');
        Object.assign(s, { w: draft.w === '' || isNaN(draft.w) ? '' : draft.w, r, note: draft.note.trim(), warm: draft.warm });
        if (!s.warm) delete s.warm;
        if (!s.done) {
          const now = new Date();
          const prev = active.items.flatMap(x => x.sets).filter(x => x.done && x.t).map(x => x.t).sort().pop();
          s.done = true; s.t = now.toISOString(); s.restActual = prev ? Math.round((now - new Date(prev)) / 1000) : null;
          const nxt = it.sets.findIndex(x => !x.done);
          focus = nxt >= 0 ? { i, j: nxt } : nextPlanned(i + 1);
          const nx = nxt >= 0 ? it.sets[nxt] : null;
          if (!active.past && focus) startRest(s.warm ? Math.min(it.rest, 60) : it.rest, nx ? `${it.ex} · ${nx.warm ? 'warm-up' : 'next set'}` : `Next: ${active.items[focus.i].ex}`);
          try { navigator.vibrate && navigator.vibrate(30); } catch {}
        } else focus = nextPlanned(i);
        persist(); render(); scrollToFocus();
      } }, s.done ? 'Save' : 'Log set')));
}
function scrollToFocus() { requestAnimationFrame(() => { const e = document.querySelector('.edit'); if (e) e.scrollIntoView({ block: 'center', behavior: 'smooth' }); }); }

function restSheet(it, onDone) {
  let v = it.rest;
  const out = h('div', { class: 'elapsed', style: 'text-align:center', text: restLabel(v) });
  const btns = REST_PRESETS.map(p => h('button', { class: 'btn' }, restLabel(p)));
  const mark = () => btns.forEach((b, k) => b.style.borderColor = REST_PRESETS[k] === v ? 'var(--accent)' : '');
  btns.forEach((b, k) => b.onclick = () => { v = REST_PRESETS[k]; out.textContent = restLabel(v); mark(); });
  mark();
  sheet('Rest · ' + it.ex, close => [
    out,
    h('div', { class: 'row' }, h('button', { class: 'btn grow', onclick: () => { v = Math.max(5, v - 15); out.textContent = restLabel(v); mark(); } }, '−15 s'), h('button', { class: 'btn grow', onclick: () => { v += 15; out.textContent = restLabel(v); mark(); } }, '+15 s')),
    h('div', { class: 'grid4' }, btns),
    h('p', { class: 'muted small', style: 'margin:0', text: 'Remembered for this exercise in future sessions.' }),
    h('button', { class: 'btn primary', onclick: () => { it.rest = v; restBy[it.ex] = v; persist(); close(); onDone ? onDone() : render(); } }, 'Set rest')]);
}

function itemMenu(i) {
  const it = active.items[i];
  const remove = () => { active.items.splice(i, 1); focus = null; persist(); render(); };
  sheet(it.ex, close => [
    h('button', { class: 'btn', disabled: i === 0, onclick: () => { active.items.splice(i - 1, 0, active.items.splice(i, 1)[0]); focus = null; persist(); close(); render(); } }, 'Move up'),
    h('button', { class: 'btn', disabled: i === active.items.length - 1, onclick: () => { active.items.splice(i + 1, 0, active.items.splice(i, 1)[0]); focus = null; persist(); close(); render(); } }, 'Move down'),
    h('button', { class: 'btn', onclick: () => { close(); pickerSheet(ex => { const n = itemFromLast(ex, it.sets.length); active.items[i] = n; focus = null; persist(); render(); }); } }, 'Swap for another exercise'),
    h('button', { class: 'btn', onclick: () => { close(); progressSheet(it.ex); } }, 'Progress and history'),
    h('button', { class: 'btn danger', onclick: () => {
      close();
      if (!it.sets.some(s => s.done)) return remove();
      sheet('Remove logged sets?', c2 => [h('p', { style: 'margin:0', text: 'Sets of this exercise are already logged in this session. They will be deleted.' }),
        h('button', { class: 'btn danger', onclick: () => { c2(); remove(); } }, 'Remove'), h('button', { class: 'btn', onclick: c2 }, 'Cancel')]);
    } }, 'Remove from session')]);
}

function pastSessionSheet() {
  const date = h('input', { type: 'date', value: localISO(new Date()).slice(0, 10) });
  const time = h('input', { type: 'time', value: '18:00' });
  const sel = h('select', {}, h('option', { value: '' }, 'No plan'), livePlans().map(p => h('option', { value: p.id }, p.name)));
  sheet('Log a past session', close => [
    h('p', { class: 'muted small', style: 'margin:0', text: 'For sessions from a paper log. No rest timer; you enter the duration at the end.' }),
    h('label', {}, 'Date', date), h('label', {}, 'Start time', time), h('label', {}, 'Plan', sel),
    h('button', { class: 'btn primary', onclick: () => { close(); startSession(new Date(date.value + 'T' + (time.value || '18:00')), { past: true, plan: plans.find(p => p.id === sel.value) || null }); } }, 'Start entering sets')]);
}
function discardSheet() {
  sheet('Discard this session?', close => [
    h('p', { style: 'margin:0', text: `${doneCount()} logged sets will be deleted from this phone. This can't be undone.` }),
    h('button', { class: 'btn danger', onclick: () => { active = null; stopRest(); persist(); close(); render(); toast('Session discarded'); } }, 'Discard session'),
    h('button', { class: 'btn', onclick: close }, 'Keep it')]);
}

function finishSheet() {
  const done = active.items.flatMap(it => it.sets.filter(s => s.done));
  if (!done.length) return toast('Log at least one set, or discard the session');
  const skipped = totalCount() - done.length;
  const first = new Date(active.start);
  const est = active.past ? 60 : Math.max(1, Math.round((Date.now() - first) / 60000));
  const dur = h('input', { type: 'number', inputmode: 'numeric', value: est });
  let rpe = 0;
  const rpeBox = h('div', { class: 'rpe', role: 'group', 'aria-label': 'Session effort 1 to 10' });
  for (let i = 1; i <= 10; i++) { const b = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { rpe = i; rpeBox.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); } }, String(i)); rpeBox.append(b); }
  const pain = {}; const painBox = h('div', { class: 'pain' });
  settings.painAreas.split(',').map(s => s.trim()).filter(Boolean).forEach(a => {
    const out = h('output', { text: '0' }); pain[a] = 0;
    painBox.append(h('label', {}, a, h('input', { type: 'range', min: 0, max: 10, step: 1, value: 0, 'aria-label': a + ' pain', oninput: e => { pain[a] = +e.target.value; out.textContent = e.target.value; } })), out);
  });
  const note = h('textarea', { placeholder: 'How did it feel? Anything to watch?' });
  const plan = plans.find(p => p.id === active.planId && !p.deleted);
  const upd = plan ? h('input', { type: 'checkbox' }) : null;
  sheet('Finish session', close => [
    skipped ? h('div', { class: 'small', style: 'color:var(--accent-text)', text: `${skipped} planned set${skipped > 1 ? 's' : ''} not done. They won't be saved.` }) : null,
    h('label', {}, 'Duration (min)', dur),
    h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'eyebrow', text: 'Session effort' }), h('div', { class: 'muted tiny', text: '1 very easy · 5 hard but comfortable · 8 very hard · 10 maximal' }), rpeBox),
    h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'eyebrow', text: 'Pain or discomfort (0 = none)' }), painBox),
    note,
    plan ? h('label', { class: 'check' }, upd, `Save today's weights and reps to "${plan.name}"`) : null,
    h('button', { class: 'btn primary', onclick: () => {
      if (!rpe) return toast('Pick a session effort from 1 to 10');
      const d = Math.max(1, parseInt(dur.value, 10) || est);
      const sets = active.items.flatMap(it => it.sets.filter(s => s.done).map(s => ({ ex: it.ex, cat: it.cat, w: s.w, r: s.r, ...(s.warm ? { warm: true } : {}), note: s.note || '', t: s.t || null, rest: it.rest, restActual: s.restActual ?? null })));
      const planned = active.items.map(it => ({ ex: it.ex, planned: it.sets.length, done: it.sets.filter(s => s.done).length }));
      const s = { id: active.id, v: 2, source: 'gymlog', start: active.start, end: localISO(new Date(first.getTime() + d * 60000)), durationMin: d, rpe, load: d * rpe,
        planId: active.planId, planName: active.planName, pain, note: note.value.trim(), planned, sets };
      if (plan && upd.checked) {
        plan.exercises = active.items.map(it => { const old = plan.exercises.find(x => x.ex === it.ex) || {}; const ds = it.sets.filter(x => x.done);
          return { ex: it.ex, cat: it.cat, rest: it.rest, note: old.note || '', sets: (ds.length ? ds : it.sets).map(x => ({ w: x.w, r: x.r, ...(x.warm ? { warm: true } : {}) })) }; });
        plan.updatedAt = new Date().toISOString(); plansDirty = true;
      }
      sessions = sessions.filter(x => x.id !== s.id).concat(s);
      if (!queue.includes(s.id)) queue.push(s.id);
      active = null; focus = null; stopRest(); persist(); close(); go('today');
      toast('Session saved'); syncAll();
    } }, 'Save session')]);
}

/* ---------- sheets ---------- */
function sheet(title, build, { full = false } = {}) {
  const wrap = h('div', { class: 'sheet' + (full ? ' full' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => { wrap.remove(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const inner = h('div', {}, h('div', { class: 'bar2' }, h('h2', { text: title }), h('button', { class: 'x', 'aria-label': 'Close', onclick: close }, '×')));
  inner.append(...build(close, inner).filter(Boolean));
  wrap.append(inner);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', esc);
  document.body.append(wrap);
  return close;
}

function pickerSheet(onPick) {
  let cat = '';
  const q = h('input', { type: 'search', placeholder: 'Search exercises', autocomplete: 'off', 'aria-label': 'Search exercises' });
  try { cat = sessionStorage.getItem('gl.pickerMuscle') || ''; } catch {}
  const list = h('div', { class: 'list' });
  const chips = h('div', { class: 'chips' });
  sheet('Choose exercise', close => {
    const pick = n => { close(); onPick(n); };
    const draw = () => {
      const term = q.value.trim().toLowerCase();
      const xs = exerciseList().filter(e => (!cat || musclesOf(e.name, e.cat).includes(cat)) && (!term || e.name.toLowerCase().includes(term)))
        .sort((a, b) => (b.last || '').localeCompare(a.last || '') || a.name.localeCompare(b.name));
      list.innerHTML = '';
      for (const e of xs) list.append(h('button', { onclick: () => pick(e.name) },
        h('span', { class: 'grow' }, e.name, h('span', { class: 'muscles', text: musclesOf(e.name, e.cat).join(' · ') })),
        h('span', { class: 'muted small', text: e.last ? shortDate(e.last) : '' })));
      if (!xs.length) list.append(h('p', { class: 'muted small', text: 'No exercise matches. Create one below.' }));
      if (term && !xs.some(e => e.name.toLowerCase() === term)) list.append(h('button', { onclick: () => { close(); newExerciseSheet(q.value.trim(), onPick, cat); } }, h('span', { class: 'grow', text: `Create "${q.value.trim()}"` }), h('span', { class: 'muted small', text: 'new' })));
    };
    chips.append(...['', ...MUSCLES].map(c => { const b = h('button', { class: 'chip', 'aria-pressed': String(c === cat), onclick: () => { cat = c; try { sessionStorage.setItem('gl.pickerMuscle', c); } catch {} chips.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); } }, c || 'All'); return b; }));
    q.addEventListener('input', draw); draw();
    return [h('div', { class: 'sticky' }, q, chips), list, h('button', { class: 'btn', onclick: () => { close(); newExerciseSheet(q.value.trim(), onPick, cat); } }, 'New exercise')];
  });
}
function newExerciseSheet(name, onPick, muscle = '') {
  const n = h('input', { type: 'text', value: name, placeholder: 'e.g. Nordic Hamstring Curl' });
  const picked = new Set(muscle ? [muscle] : []);
  const chips = h('div', { class: 'chips', style: 'flex-wrap:wrap' }, MUSCLES.map(m => { const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(picked.has(m)), onclick: () => { picked.has(m) ? picked.delete(m) : picked.add(m); b.setAttribute('aria-pressed', String(picked.has(m))); } }, m); return b; }));
  sheet('New exercise', close => [h('label', {}, 'Name', n),
    h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'eyebrow', text: 'Body parts (main one first)' }), chips),
    h('button', { class: 'btn primary', onclick: () => {
      const v = n.value.trim(); if (!v) return toast('Give the exercise a name');
      if (!picked.size) return toast('Pick at least one body part');
      const ms = MUSCLES.filter(m => picked.has(m)); if (muscle && picked.has(muscle)) ms.sort((a, b) => (b === muscle) - (a === muscle));
      if (!exerciseList().some(e => e.name === v)) custom.push({ name: v, cat: MUSCLE_CAT[ms[0]] || 'Other', muscles: ms });
      persist(); close(); onPick(v);
    } }, 'Create')]);
}

/* ---------- rest timer ---------- */
let restEnd = 0, restTotal = 0, restInt, audio;
function startRest(sec, label) {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch {}
  restEnd = Date.now() + sec * 1000; restTotal = sec * 1000; let buzzed = false;
  $('#timerlbl').textContent = 'Rest · ' + label; $('#timer').hidden = false; clearInterval(restInt);
  const upd = () => {
    const left = (restEnd - Date.now()) / 1000;
    $('#timer').classList.toggle('over', left <= 0);
    $('#timertxt').textContent = left > 0 ? mmss(Math.ceil(left)) : 'Go · +' + mmss(-left);
    $('#timerprog').style.width = Math.max(0, Math.min(100, (1 - left * 1000 / restTotal) * 100)) + '%';
    if (left <= 0 && !buzzed) { buzzed = true; try { navigator.vibrate && navigator.vibrate([250, 120, 250]); } catch {} beep(); }
    if (left < -120) stopRest();
  };
  upd(); restInt = setInterval(upd, 250);
}
function stopRest() { clearInterval(restInt); $('#timer').hidden = true; }
function beep() { if (!audio) return; try { [0, .25].forEach(dt => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; g.gain.value = .18; o.connect(g); g.connect(audio.destination); o.start(audio.currentTime + dt); o.stop(audio.currentTime + dt + .18); }); } catch {} }
$('#timer-add').onclick = () => { restEnd += 15000; restTotal += 15000; };
$('#timer-sub').onclick = () => { restEnd -= 15000; };
$('#timer').addEventListener('click', e => { if (e.target.closest('button')) return; stopRest(); });

/* ---------- plans ---------- */
function renderPlans() {
  const ps = livePlans();
  return h('div', { class: 'stack' },
    h('div', { class: 'card hero' }, h('h2', { text: 'Plans' }), h('p', { class: 'small', text: 'A plan lists exercises, sets, target reps and rest. Starting it preloads every set; weights come from your last session or from the plan.' })),
    ...ps.map(p => h('div', { class: 'card plan' },
      h('h3', { text: p.name }),
      h('div', { class: 'exs', text: p.exercises.map(x => `${x.ex} ${x.sets.length}×${x.sets[0] ? x.sets[0].r : ''}`).join(' · ') }),
      h('div', { class: 'meta', text: (p.prefill === 'plan' ? 'Weights from plan' : 'Weights from last session') + ` · ${p.exercises.reduce((a, x) => a + x.sets.length, 0)} sets` }),
      h('div', { class: 'row', style: 'margin-top:4px' },
        h('button', { class: 'btn primary sm', onclick: () => { if (active) return toast('Finish or discard the current session first'); startSession(new Date(), { plan: p }); } }, 'Start'),
        h('button', { class: 'btn sm', onclick: () => planEditor(clone(p)) }, 'Edit'),
        h('button', { class: 'btn sm', onclick: () => { const c = clone(p); c.id = uid(); c.name = p.name + ' (copy)'; planEditor(c, true); } }, 'Duplicate')))),
    h('button', { class: 'btn primary block', onclick: () => planEditor({ id: uid(), name: '', prefill: 'last', exercises: [] }, true) }, '+ New plan'),
    allSessions().length ? h('button', { class: 'btn block', onclick: fromSessionSheet }, 'New plan from a past session') : null);
}
function planFromSession(s) {
  const ex = [];
  for (const x of s.sets) { let e = ex.find(y => y.ex === x.ex); if (!e) ex.push(e = { ex: x.ex, cat: x.cat, rest: x.rest || restOf(x.ex), note: '', sets: [] }); e.sets.push({ w: x.w, r: x.r, ...(x.warm ? { warm: true } : {}) }); }
  return { id: uid(), name: '', prefill: 'last', exercises: ex };
}
function fromSessionSheet() {
  sheet('Pick a session', close => [h('div', { class: 'list' }, allSessions().slice(0, 40).map(s => h('button', { onclick: () => { close(); planEditor(planFromSession(s), true); } },
    h('span', { class: 'grow', text: shortDate(s.start) + ' · ' + [...new Set(s.sets.map(x => x.ex))].slice(0, 3).join(', ') }), h('span', { class: 'muted small', text: s.sets.length + ' sets' }))))]);
}
function planEditor(p, isNew = false) {
  sheet(isNew ? 'New plan' : 'Edit plan', close => {
    const body = h('div', { class: 'stack' });
    const name = h('input', { type: 'text', value: p.name, placeholder: 'e.g. Legs · hamstring focus', oninput: e => p.name = e.target.value });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Where weights come from' });
    [['last', 'Last session'], ['plan', 'This plan']].forEach(([v, l]) => seg.append(h('button', { type: 'button', 'aria-pressed': String((p.prefill || 'last') === v), onclick: e => { p.prefill = v; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, l)));
    const draw = () => {
      body.innerHTML = '';
      p.exercises.forEach((x, k) => {
        const rows = h('div', { class: 'pe-sets' }, h('span'), h('span', { class: 'h', text: 'kg' }), h('span', { class: 'h', text: 'reps' }), h('span'), h('span'));
        let wn = 0;
        x.sets.forEach((s, j) => rows.append(
          h('button', { class: 'wtog', type: 'button', 'aria-pressed': String(!!s.warm), title: 'Tap to mark as warm-up', 'aria-label': `Set ${j + 1} warm-up`, onclick: () => { s.warm = !s.warm; if (!s.warm) delete s.warm; draw(); } }, s.warm ? 'W' : String(++wn)),
          h('input', { type: 'number', inputmode: 'decimal', step: 'any', value: fmtW(s.w), placeholder: '–', 'aria-label': `${x.ex} set ${j + 1} kg`, oninput: e => s.w = e.target.value === '' ? '' : parseFloat(e.target.value) }),
          h('input', { type: 'number', inputmode: 'numeric', value: s.r, 'aria-label': `${x.ex} set ${j + 1} reps`, oninput: e => s.r = parseInt(e.target.value, 10) || 0 }),
          h('button', { class: 'iconbtn', 'aria-label': 'Remove set', onclick: () => { x.sets.splice(j, 1); draw(); } }, '×'), h('span')));
        body.append(h('div', { class: 'card pe' },
          h('div', { class: 'ex-top' }, h('h3', { text: x.ex }),
            h('button', { class: 'chipbtn', html: ICON.clock + restLabel(x.rest || restOf(x.ex)), onclick: () => { const it = { ex: x.ex, rest: x.rest || restOf(x.ex) }; restSheet(it, () => { x.rest = it.rest; draw(); }); } }),
            h('button', { class: 'iconbtn', 'aria-label': 'Move up', disabled: k === 0, onclick: () => { p.exercises.splice(k - 1, 0, p.exercises.splice(k, 1)[0]); draw(); } }, '↑'),
            h('button', { class: 'iconbtn', 'aria-label': 'Move down', disabled: k === p.exercises.length - 1, onclick: () => { p.exercises.splice(k + 1, 0, p.exercises.splice(k, 1)[0]); draw(); } }, '↓'),
            h('button', { class: 'iconbtn', 'aria-label': 'Remove exercise', onclick: () => { p.exercises.splice(k, 1); draw(); } }, '×')),
          rows,
          h('div', { class: 'row' },
            h('button', { class: 'link', onclick: () => { const l = work(x.sets).pop() || { w: '', r: 10 }; x.sets.push({ w: l.w, r: l.r }); draw(); } }, '+ Add set'),
            h('span', { class: 'muted tiny grow', style: 'text-align:right', text: 'Tap a set number to mark it as warm-up' })),
          h('input', { type: 'text', class: 'notefield', value: x.note || '', placeholder: 'Cue shown during the session, e.g. 3 s lowering', 'aria-label': x.ex + ' cue', oninput: e => x.note = e.target.value })));
      });
    };
    draw();
    return [
      h('label', {}, 'Name', name),
      h('div', { class: 'stack', style: 'gap:6px' }, h('div', { class: 'eyebrow', text: 'Prefill weights from' }), seg),
      body,
      h('button', { class: 'btn block', onclick: () => pickerSheet(ex => { const lt = lastTime(ex); p.exercises.push({ ex, cat: catOf(ex), rest: restOf(ex), note: '', sets: lt ? lt.sets.map(s => ({ w: s.w, r: s.r })) : [{ w: '', r: 10 }, { w: '', r: 10 }, { w: '', r: 10 }] }); draw(); }) }, '+ Add exercise'),
      h('button', { class: 'btn primary block', onclick: () => {
        if (!p.name.trim()) return toast('Give the plan a name');
        if (!p.exercises.length) return toast('Add at least one exercise');
        p.name = p.name.trim(); p.updatedAt = new Date().toISOString();
        plans = plans.filter(x => x.id !== p.id).concat(p); plansDirty = true; persist(); close(); go('plans'); toast('Plan saved'); syncAll();
      } }, 'Save plan'),
      isNew ? null : h('button', { class: 'btn danger block', onclick: () => { plans = plans.filter(x => x.id !== p.id).concat({ id: p.id, deleted: true, updatedAt: new Date().toISOString() }); plansDirty = true; persist(); close(); go('plans'); toast('Plan deleted'); syncAll(); } }, 'Delete plan')];
  }, { full: true });
}

/* ---------- charts (inline SVG, works offline) ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, a = {}, p) => { const e = document.createElementNS(SVGNS, tag); for (const k in a) e.setAttribute(k, a[k]); if (p) p.append(e); return e; };
const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
function chartBox(title, legend, svg, foot) {
  return h('div', { class: 'card chart' }, h('div', { class: 'eyebrow', text: title }),
    legend ? h('div', { class: 'legend' }, legend.map(([c, l, dash]) => h('span', {}, h('i', { class: dash ? 'dash' : '', style: `background:${c}` }), l))) : null, svg, foot ? h('div', { class: 'muted tiny', text: foot }) : null);
}
/* stacked weekly bars: weeks = [{label, a, b, mark}] */
function weekBars(weeks, colA, colB, limit) {
  const W = 340, H = 150, L = 26, R = 4, T = 10, B = 20, iw = W - L - R, ih = H - T - B;
  const max = niceMax(Math.max(limit || 0, ...weeks.map(w => w.a + w.b), 1));
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'svgchart', role: 'img', 'aria-label': 'Working sets per week' });
  const y = v => T + ih - v / max * ih;
  [0, max / 2, max].forEach(v => { sv('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }, svg); sv('text', { x: L - 4, y: y(v) + 3, 'text-anchor': 'end', class: 'ax' }, svg).textContent = Math.round(v); });
  if (limit) { sv('line', { x1: L, x2: W - R, y1: y(limit), y2: y(limit), class: 'limit' }, svg); }
  const bw = iw / weeks.length;
  weeks.forEach((w, i) => {
    const x = L + i * bw + 2, wd = Math.max(2, bw - 4);
    if (w.a) sv('rect', { x, y: y(w.a), width: wd, height: y(0) - y(w.a), rx: 2, fill: colA }, svg);
    if (w.b) sv('rect', { x, y: y(w.a + w.b) , width: wd, height: Math.max(0, y(w.a) - y(w.a + w.b) - (w.a ? 2 : 0)), rx: 2, fill: colB }, svg);
    if (w.mark) sv('circle', { cx: x + wd / 2, cy: y(w.a + w.b) - 7, r: 3.5, fill: 'var(--bad)' }, svg);
    if (i % 2 === (weeks.length - 1) % 2) sv('text', { x: x + wd / 2, y: H - 6, 'text-anchor': 'middle', class: 'ax' }, svg).textContent = w.label;
    const hit = sv('rect', { x: x - 2, y: T, width: bw, height: ih, fill: 'transparent' }, svg);
    sv('title', {}, hit).textContent = `Week of ${w.label}: ${w.a} leg + ${w.b} other working sets${w.mark ? ' · pain logged' : ''}`;
  });
  return svg;
}
/* line chart: series = [{color, dash, points:[{x:index, y}]}], labels per index */
function lineChart(labels, series, unit) {
  const W = 340, H = 160, L = 30, R = 8, T = 10, B = 20, iw = W - L - R, ih = H - T - B;
  const ys = series.flatMap(s => s.points.map(p => p.y));
  if (!ys.length) return h('p', { class: 'muted small', text: 'Not enough data to draw a chart.' });
  let lo = Math.min(...ys), hi = Math.max(...ys); const pad = Math.max(2, (hi - lo) * .1); const st = hi - lo > 30 ? 20 : 10; lo = Math.max(0, Math.floor((lo - pad) / st) * st); hi = Math.ceil((hi + pad) / st) * st;
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'svgchart', role: 'img', 'aria-label': 'Progress chart' });
  const x = i => L + (labels.length < 2 ? iw / 2 : i / (labels.length - 1) * iw), y = v => T + ih - (v - lo) / (hi - lo || 1) * ih;
  [lo, (lo + hi) / 2, hi].forEach(v => { sv('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }, svg); sv('text', { x: L - 4, y: y(v) + 3, 'text-anchor': 'end', class: 'ax' }, svg).textContent = Math.round(v); });
  [0, Math.floor((labels.length - 1) / 2), labels.length - 1].filter((v, k, a) => a.indexOf(v) === k).forEach(i => sv('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle', class: 'ax' }, svg).textContent = labels[i]);
  for (const s of series) {
    if (!s.points.length) continue;
    sv('path', { d: s.points.map((p, k) => (k ? 'L' : 'M') + x(p.x).toFixed(1) + ' ' + y(p.y).toFixed(1)).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-dasharray': s.dash ? '5 4' : '', 'stroke-linejoin': 'round' }, svg);
    s.points.forEach((p, k) => { const c = sv('circle', { cx: x(p.x), cy: y(p.y), r: k === s.points.length - 1 ? 4.5 : 3, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg); sv('title', {}, c).textContent = `${labels[p.x]}: ${Math.round(p.y * 10) / 10} ${unit}`; });
  }
  return svg;
}
function trendsCard() {
  const weeks = [];
  const m0 = new Date(mondayOf(new Date()) + 'T12:00');
  for (let k = 11; k >= 0; k--) {
    const a = new Date(m0); a.setDate(a.getDate() - 7 * k); const b = new Date(a); b.setDate(b.getDate() + 7);
    const xs = sessions.filter(s => { const d = new Date(s.start.length === 10 ? s.start + 'T12:00' : s.start); return d >= new Date(a.getTime() - 12 * 36e5) && d < new Date(b.getTime() - 12 * 36e5); });
    const ws = xs.flatMap(s => work(s.sets));
    weeks.push({ label: shortDate(localISO(a)), a: ws.filter(isLeg).length, b: ws.filter(x => !isLeg(x)).length, mark: xs.some(s => Object.values(s.pain || {}).some(v => v > 0)) });
  }
  return chartBox('Working sets per week · last 12 weeks', [['var(--c-legs)', 'Legs'], ['var(--c-upper)', 'Upper body'], ['var(--bad)', 'Pain logged']],
    weekBars(weeks, 'var(--c-legs)', 'var(--c-upper)', legLimit()), legLimit() ? `Dashed line: this week's leg-set target (${legLimit()}).` : 'Warm-up sets are not counted.');
}
function progressSheet(ex) {
  const hist = exHistory(ex, 20).reverse();
  const labels = hist.map(x => shortDate(x.s.start));
  const top = [], est = [];
  hist.forEach((x, i) => { const ws = work(x.sets).filter(s => +s.w > 0); if (!ws.length) return;
    top.push({ x: i, y: Math.max(...ws.map(s => +s.w)) }); const e = Math.max(...ws.map(s => e1rm(+s.w, +s.r))); if (e) est.push({ x: i, y: e }); });
  const reps = hist.map((x, i) => ({ x: i, y: work(x.sets).reduce((a, s) => a + (+s.r || 0), 0) }));
  const loaded = top.length >= 2;
  const recent = exHistory(ex, 12);
  sheet(ex, close => [
    h('div', { class: 'muscles', text: musclesOf(ex).join(' · ') }),
    loaded ? chartBox('Top working weight and estimated 1RM (kg)', [['var(--c-upper)', 'Top set'], ['var(--c-legs)', 'Est. 1RM', true]], lineChart(labels, [{ color: 'var(--c-upper)', points: top }, { color: 'var(--c-legs)', dash: true, points: est }], 'kg'))
      : chartBox('Total working reps per session', null, lineChart(labels, [{ color: 'var(--c-upper)', points: reps }], 'reps')),
    recent.length ? h('table', {}, h('tbody', {}, recent.map(x => h('tr', {}, h('td', { text: shortDate(x.s.start) }), h('td', { class: 'num' }, x.sets.flatMap((s, k) => [k ? '  ' : '', s.warm ? h('span', { class: 'muted', text: setLabel(s) }) : setLabel(s)])))))) : h('p', { class: 'muted', text: 'No history yet.' }),
    h('div', { class: 'muted tiny', text: 'Gray numbers are warm-up sets.' }),
    h('button', { class: 'btn', onclick: close }, 'Close')]);
}

/* ---------- history ---------- */
const LEGS = new Set(['Legs', 'Calves']);
function weekStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function weekSummary() {
  const ws = weekStart(new Date()); const prev = new Date(ws); prev.setDate(prev.getDate() - 7);
  const sum = (from, to) => { const xs = sessions.filter(s => { const d = new Date(s.start); return d >= from && d < to; });
    return { n: xs.length, sets: xs.reduce((a, s) => a + work(s.sets).length, 0), leg: xs.reduce((a, s) => a + work(s.sets).filter(isLeg).length, 0), load: xs.reduce((a, s) => a + (s.load || 0), 0) }; };
  const now = sum(ws, new Date(ws.getTime() + 7 * 864e5)), last = sum(prev, ws);
  const cell = (label, a, b) => h('div', { class: 'stat' }, h('div', { class: 'eyebrow', text: label }), h('div', { class: 'k', text: String(a) }), h('div', { class: 'muted tiny', text: typeof b === 'string' ? b : 'last week ' + b }));
  return h('div', { class: 'card' }, h('div', { class: 'eyebrow', style: 'margin-bottom:10px;color:var(--ink2)', text: 'This week' }),
    h('div', { class: 'stats' }, cell('Sessions', now.n, last.n), cell('Work sets', now.sets, last.sets), cell('Leg sets', now.leg, legLimit() ? 'target ≤ ' + legLimit() + ' · last ' + last.leg : last.leg), cell('Load', now.load, last.load)));
}
function sessionRow(s) {
  const exs = [...new Set(s.sets.map(x => x.ex))];
  const st = queue.includes(s.id) ? 'pend' : (s.synced ? 'ok' : '');
  const pains = Object.values(s.pain || {}).some(v => v > 0);
  return h('button', { class: 'card', style: 'text-align:left;display:flex;flex-direction:column;gap:4px', onclick: () => sessionSheet(s) },
    h('div', { class: 'row' }, h('strong', { class: 'grow', text: (s.planName ? s.planName + ' · ' : '') + fmtDate(s.start) }), pains ? h('span', { class: 'tiny', style: 'color:var(--bad);font-weight:700', text: 'PAIN' }) : null, st ? h('span', { class: 'dot ' + st, title: st === 'ok' ? 'On GitHub' : 'Waiting to upload' }) : null),
    h('div', { class: 'muted small', text: [s.durationMin ? s.durationMin + ' min' : null, s.sets.length + (s.sets.length === 1 ? ' set' : ' sets'), s.rpe ? 'RPE ' + s.rpe : null].filter(Boolean).join(' · ') }),
    h('div', { class: 'small', style: 'color:var(--ink2)', text: exs.slice(0, 5).join(', ') + (exs.length > 5 ? ` +${exs.length - 5}` : '') }));
}
function renderHistory() {
  const box = h('div', { class: 'stack' }, weekSummary(), trendsCard(),
    h('button', { class: 'btn block', onclick: () => pickerSheet(progressSheet) }, 'Exercise progress charts'));
  const xs = allSessions();
  if (!xs.length) box.append(h('p', { class: 'muted', text: 'No sessions yet. Pull your history from GitHub in Settings.' }));
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
    h('div', { class: 'muted small', text: [s.planName, s.durationMin && s.durationMin + ' min', s.rpe && 'RPE ' + s.rpe, s.load && 'load ' + s.load].filter(Boolean).join(' · ') }),
    pains.length ? h('div', { class: 'small', style: 'color:var(--bad);font-weight:600', text: 'Pain: ' + pains.map(([a, v]) => `${a} ${v}/10`).join(', ') }) : null,
    s.note ? h('p', { style: 'margin:0', text: s.note }) : null,
    h('div', { style: 'overflow-x:auto' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Exercise' }), h('th', { text: 'kg' }), h('th', { text: 'Reps' }), h('th', { text: 'Rest' }))),
      h('tbody', {}, s.sets.map(x => h('tr', { class: x.warm ? 'warmrow' : null }, h('td', {}, x.ex, x.warm ? h('span', { class: 'wtag', text: 'W' }) : null, x.note ? h('div', { class: 'muted tiny', text: x.note }) : null), h('td', { class: 'num', text: fmtW(x.w) }), h('td', { class: 'num', text: String(x.r) }), h('td', { class: 'num muted', text: x.restActual ? mmss(x.restActual) : '' })))))),
    h('button', { class: 'btn', onclick: () => { close(); planEditor(planFromSession(s), true); } }, 'Save as plan'),
    h('button', { class: 'btn', onclick: () => { if (!queue.includes(s.id)) queue.push(s.id); persist(); close(); syncAll(); } }, 'Upload again'),
    h('button', { class: 'btn danger', onclick: () => confirmDelete(s, close) }, 'Delete session')]);
}
function confirmDelete(s, closeParent) {
  sheet('Delete this session?', close => [
    h('p', { style: 'margin:0', text: 'It will be removed from this phone' + (s.synced ? ' and from GitHub.' : '.') }),
    h('button', { class: 'btn danger', onclick: async () => {
      if (s.synced && ghReady()) { try { await ghDelete(ghPath(s.id)); } catch (e) { return toast('GitHub delete failed: ' + e.message); } }
      sessions = sessions.filter(x => x.id !== s.id); queue = queue.filter(x => x !== s.id); persist(); close(); closeParent(); render(); toast('Session deleted');
    } }, 'Delete'),
    h('button', { class: 'btn', onclick: close }, 'Cancel')]);
}

/* ---------- GitHub sync ---------- */
const ghReady = () => settings.owner && settings.repo && settings.token;
const ghPath = id => `${settings.folder.replace(/^\/|\/$/g, '')}/${id}.json`;
const ref = () => '?ref=' + encodeURIComponent(settings.branch);
async function gh(method, path, body, raw) {
  const r = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/${path}`, {
    method, cache: 'no-store', body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: 'Bearer ' + settings.token, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) } });
  if (r.status === 404) return null;
  if (!r.ok) { let m = String(r.status); try { m += ' ' + (await r.json()).message; } catch {} throw new Error(m); }
  return raw ? r.text() : r.json();
}
const b64 = str => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
async function ghPutFile(path, obj, message) {
  const cur = await gh('GET', `contents/${path}${ref()}`);
  await gh('PUT', `contents/${path}`, { message, content: b64(JSON.stringify(obj, null, 1) + '\n'), branch: settings.branch, ...(cur && cur.sha ? { sha: cur.sha } : {}) });
}
async function ghDelete(path) {
  const cur = await gh('GET', `contents/${path}${ref()}`);
  if (cur && cur.sha) await gh('DELETE', `contents/${path}`, { message: `Delete ${path}`, sha: cur.sha, branch: settings.branch });
}
const sortById = a => a.slice().sort((x, y) => x.id.localeCompare(y.id));
async function syncPlans() {
  const txt = await gh('GET', `contents/plans.json${ref()}`, null, true);
  let remote = []; try { remote = txt ? JSON.parse(txt).plans || [] : []; } catch {}
  const before = JSON.stringify(sortById(plans));
  const m = new Map(plans.map(p => [p.id, p]));
  for (const r of remote) { const l = m.get(r.id); if (!l || (r.updatedAt || '') > (l.updatedAt || '')) m.set(r.id, r); }
  plans = [...m.values()];
  if (plansDirty || JSON.stringify(sortById(plans)) !== JSON.stringify(sortById(remote)))
    await ghPutFile('plans.json', { updated: new Date().toISOString(), plans: sortById(plans) }, 'Update gym plans');
  plansDirty = false; persist();
  return before !== JSON.stringify(sortById(plans));
}
async function pullCoach() {
  const txt = await gh('GET', `contents/coach.json${ref()}`, null, true);
  if (!txt) return false;
  try { const c = JSON.parse(txt); const changed = JSON.stringify(c) !== JSON.stringify(coach); coach = c; persist(); return changed; } catch { return false; }
}
let syncing = false, syncErr = '';
async function syncAll() {
  if (syncing || !ghReady() || !navigator.onLine) return renderSync();
  syncing = true; syncErr = ''; renderSync();
  let plansChanged = false;
  try {
    for (const id of queue.slice()) {
      const s = sessions.find(x => x.id === id);
      if (s) { const { synced, ...clean } = s; await ghPutFile(ghPath(s.id), clean, `Gym session ${s.start.slice(0, 10)}`); s.synced = true; }
      queue = queue.filter(x => x !== id); persist(); renderSync();
    }
    plansChanged = await syncPlans();
    if (await pullCoach() && view === 'today' && !active) render();
  } catch (e) { syncErr = e.message; }
  syncing = false; renderSync();
  if (view === 'history' || (plansChanged && (view === 'plans' || (view === 'today' && !active)))) render();
  if (syncErr) toast('Sync failed: ' + syncErr);
}
async function pullHistory(btn) {
  if (!ghReady()) return toast('Fill in the GitHub settings first');
  btn.disabled = true; btn.textContent = 'Reading list…';
  try {
    const list = await gh('GET', `contents/${settings.folder}${ref()}`) || [];
    const have = new Set(sessions.map(s => s.id));
    const todo = list.filter(f => f.name.endsWith('.json') && !have.has(f.name.slice(0, -5)));
    let done = 0;
    const worker = async () => { while (todo.length) { const f = todo.shift();
      const txt = await gh('GET', `contents/${f.path}${ref()}`, null, true);
      try { const s = JSON.parse(txt); s.synced = true; sessions.push(s); } catch {}
      btn.textContent = `Downloaded ${++done}`; } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    await syncPlans(); await pullCoach();
    persist(); toast(`Pulled ${done} sessions and ${livePlans().length} plans`);
  } catch (e) { toast('Pull failed: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Pull history from GitHub';
}
function renderSync() {
  const dot = $('#syncdot'), t = $('#synctxt');
  if (!ghReady()) { dot.className = 'dot'; t.textContent = 'not connected'; return; }
  if (syncing) { dot.className = 'dot pend'; t.textContent = 'syncing…'; return; }
  if (syncErr) { dot.className = 'dot err'; t.textContent = 'sync failed'; return; }
  const n = queue.length + (plansDirty ? 1 : 0);
  if (n) { dot.className = 'dot pend'; t.textContent = n + ' waiting'; return; }
  dot.className = 'dot ok'; t.textContent = 'synced';
}
addEventListener('online', syncAll);

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
  const [iD, iE, iC, iW, iU, iR, iT, iN] = ['Date', 'Exercise', 'Category', 'Weight', 'Weight Unit', 'Reps', 'Time', 'Comment'].map(n => head.indexOf(n));
  if (iD < 0 || iE < 0) throw new Error('This does not look like a FitNotes export');
  const byDay = new Map();
  for (const r of rows) {
    const d = r[iD]; if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    let w = r[iW] === '' ? '' : parseFloat(r[iW]); if (w !== '' && r[iU] === 'lbs') w = Math.round(w * 0.4536 * 10) / 10;
    let reps = parseInt(r[iR], 10); let note = (r[iN] || '').trim();
    if (!(reps > 0) && iT >= 0 && r[iT]) { reps = r[iT].split(':').map(Number).reduce((a, x) => a * 60 + x, 0); note = (note + ' (seconds)').trim(); }
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({ ex: r[iE], cat: r[iC] || 'Other', w, r: reps || 0, note });
  }
  let added = 0;
  for (const [d, sets] of byDay) {
    const id = d + '_fitnotes';
    if (sessions.some(s => s.id === id)) continue;
    inferWarmups(sets);
    sessions.push({ id, v: 1, source: 'fitnotes', start: d + 'T00:00', end: null, durationMin: null, rpe: null, load: null, pain: {}, note: '', sets });
    added++;
  }
  persist(); return added;
}
// FitNotes has no warm-up flag: leading sets under 75% of the exercise's top weight (when top >= 20 kg) count as warm-ups
function inferWarmups(sets) {
  const by = new Map(); sets.forEach(s => { if (!by.has(s.ex)) by.set(s.ex, []); by.get(s.ex).push(s); });
  for (const xs of by.values()) {
    const top = Math.max(0, ...xs.map(x => +x.w || 0)); if (top < 20) continue;
    for (const x of xs) { if ((+x.w || 0) < 0.75 * top) { x.warm = true; x.warmInferred = true; } else break; }
  }
}
function exportCSV() {
  const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = ['Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment'];
  for (const s of sessions.slice().sort((a, b) => a.start.localeCompare(b.start))) for (const x of s.sets)
    lines.push([s.start.slice(0, 10), x.ex, x.cat, x.w === '' ? '' : Number(x.w).toFixed(1), 'kgs', x.r, '', '', '', (x.warm ? '[warm-up] ' : '') + (x.note || '')].map(esc).join(','));
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
    const inp = h('input', { value: settings[key], type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...attrs });
    inp.addEventListener('change', () => { settings[key] = attrs.type === 'number' ? Number(inp.value) : inp.value.trim(); save(K.settings, settings); renderSync(); });
    return h('label', {}, label, inp);
  };
  return h('div', { class: 'stack' },
    h('div', { class: 'card stack' }, h('h2', { text: 'GitHub storage' }),
      h('p', { class: 'muted small', style: 'margin:0', text: 'Each finished session is saved as one JSON file in this repository, and your plans in plans.json. The token stays on this phone.' }),
      f('owner', 'Account'), f('repo', 'Repository'), f('branch', 'Branch'), f('folder', 'Folder'),
      f('token', 'Access token', { type: 'password' }),
      h('button', { class: 'btn primary block', onclick: async () => {
        if (!ghReady()) return toast('Fill in account, repository and token');
        try { const r = await gh('GET', ''); toast(r ? `Connected to ${r.full_name}${r.private ? ' (private)' : '. Warning: this repository is public'}` : 'Repository not found, or the token has no access to it'); }
        catch (e) { toast('Connection failed: ' + e.message); }
      } }, 'Test connection'),
      h('button', { class: 'btn block', onclick: syncAll }, 'Sync now'),
      h('button', { class: 'btn block', onclick: e => pullHistory(e.currentTarget) }, 'Pull history from GitHub')),
    h('div', { class: 'card stack' }, h('h2', { text: 'Workout' }),
      f('rest', 'Default rest for new exercises (seconds)', { type: 'number', inputmode: 'numeric' }),
      f('step', 'Weight step (kg)', { type: 'number', inputmode: 'decimal', step: 'any' }),
      f('painAreas', 'Pain check areas (comma separated)')),
    h('div', { class: 'card stack' }, h('h2', { text: 'Import and export' }),
      h('button', { class: 'btn block', onclick: () => $('#csvfile').click() }, 'Import FitNotes CSV'),
      h('p', { class: 'muted small', style: 'margin:0', text: 'Imported sessions stay on this phone. Use Pull history if they are already on GitHub.' }),
      h('button', { class: 'btn block', onclick: exportCSV }, 'Export all as CSV')),
    h('p', { class: 'muted small', text: `${sessions.length} sessions · ${sessions.reduce((a, s) => a + s.sets.length, 0)} sets · ${livePlans().length} plans on this phone` }));
}

/* ---------- boot ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
syncAll();
