'use strict';
/* Run tab — the 18-week sub-45 10K plan, carried over from the "10K Sub-45 Tracker" artifact.
   Data lives in the same private GitHub repo as the gym sessions, under running/:
     plan.json     plan meta + every session (written by Claude, patched here for race pace and reverts)
     runs/<id>.json one file per run: <session id> when it matches a planned session, x-<labelId> otherwise
     fitness.json  VDOT records (baseline, races/tests, pace steps) — sets every pace and the race estimate
     changes.json  plan change log
     status.json   last COROS import + the watch's predictions (written by the nightly import task)
   Everything is cached in localStorage and edits are queued, so the tab works offline like the rest of the app.
   Loaded before app.js; it only uses app.js globals (gh, ref, settings, toast, sessions, sheet, promptSheet…) inside functions. */
const RT = (() => {
  /* ---------- basics ---------- */
  const q = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p2 = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const pd = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const diffD = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);
  const TODAY = () => window.__TODAY__ || ymd(new Date());
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtD = s => { const d = pd(s); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
  const fmtDY = s => `${fmtD(s)} ${pd(s).getFullYear()}`;
  const nowIso = () => new Date().toISOString();
  function fmtT(sec) { sec = Math.round(sec || 0); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`; }
  function fmtP(sec) { const s = Math.round(sec || 0); return `${Math.floor(s / 60)}:${p2(s % 60)}`; }
  function parseClock(str) { const p = String(str ?? '').trim().split(':'); if (!p[0] || p.length > 3 || p.some(x => x === '' || isNaN(Number(x)))) return null; return p.map(Number).reduce((a, b) => a * 60 + b, 0); }
  const r5 = s => Math.round(s / 5) * 5;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const cl = o => JSON.parse(JSON.stringify(o));
  const narrow = () => (window.innerWidth || 1024) < 560;
  const KIND = { easy: 'Easy', long: 'Long run', thr: 'Threshold', vo2: 'VO2max', pace: 'Race pace', test: 'Test', race: 'Race', extra: 'Extra run' };
  const DAYS = ['Mon', 'Wed', 'Fri', 'Sun'];

  /* ---------- fitness math (Daniels VDOT) ---------- */
  const vo2 = v => -4.60 + 0.182258 * v + 0.000104 * v * v;
  const pctMax = t => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  const vdotFrom = (m, sec) => { const t = sec / 60; return vo2(m / t) / pctMax(t); };
  function raceTime(vdot, m = 10000) { let lo = m / 1000 * 120, hi = m / 1000 * 720; for (let i = 0; i < 70; i++) { const mid = (lo + hi) / 2; if (vdotFrom(m, mid) > vdot) lo = mid; else hi = mid; } return (lo + hi) / 2; }
  function paceAt(vdot, pct) { const a = 0.000104, b = 0.182258, c = -4.6 - vdot * pct; const v = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a); return 60000 / v; }
  function paceSet(vdot, rp) {
    const p = x => r5(paceAt(vdot, x));
    return { vdot, E: [p(.704), p(.617)], ST: [p(.815), p(.77)], F: [p(.86), p(.815)], T: p(.88), TK: r5(raceTime(vdot) / 10), I: p(.98), S: p(1.05), RP: rp || 270, JOG: 420 };
  }
  function zoneSec(P, z) {
    if (z === 'JOG') return 420;
    const v = P[z];
    if (Array.isArray(v)) return (v[0] + v[1]) / 2;
    if (typeof v === 'number') return v;
    const m = /^P(\d+(?:\.\d+)?)$/.exec(z);
    return m ? paceAt(P.vdot, Number(m[1]) / 100) : (P.E[0] + P.E[1]) / 2;
  }
  const sessionKm = (s, P) => (s.segs && s.segs.length ? s.segs : [[s.dur, 'E']]).reduce((a, [m, z]) => a + m * 60 / zoneSec(P, z), 0);
  function tokenText(tok, P) {
    if (tok === 'E' || tok === 'ST' || tok === 'F') { const [a, b] = P[tok]; return `${fmtP(a)}–${fmtP(b)}/km`; }
    if (['T', 'TK', 'I', 'S', 'RP'].includes(tok)) return `${fmtP(P[tok])}/km`;
    const m = /^P(\d+(?:\.\d+)?)$/.exec(tok);
    if (m) return `${fmtP(r5(paceAt(P.vdot, Number(m[1]) / 100)))}/km`;
    return `{${tok}}`;
  }
  const TOK = /\{([A-Z]{1,2}\d{0,3}(?:\.\d+)?)\}/g;
  const lineHtml = (t, P) => esc(t).replace(TOK, (_, k) => `<span class="pz">${tokenText(k, P)}</span>`);
  const linePlain = (t, P) => String(t).replace(TOK, (_, k) => tokenText(k, P));

  /* ---------- state + local cache ---------- */
  const LK = { plan: 'rt.plan', runs: 'rt.runs', fitness: 'rt.fitness', changes: 'rt.changes', status: 'rt.status', sha: 'rt.sha', q: 'rt.queue', view: 'rt.view', pulled: 'rt.pulled' };
  const ld = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const sv = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Could not save on this phone: ' + e.message); } };
  const S = {
    plan: ld(LK.plan, null), runs: ld(LK.runs, {}), fitness: ld(LK.fitness, []), changes: ld(LK.changes, []), status: ld(LK.status, null),
    sha: ld(LK.sha, {}), q: ld(LK.q, { runs: {}, fitness: [], changes: [], sessions: {}, meta: {} }),
    view: ld(LK.view, 'overview'), pulled: ld(LK.pulled, 0), missing: false, open: null, form: null, confirm: null, lapView: {}, err: ''
  };
  const persistRT = () => { sv(LK.plan, S.plan); sv(LK.runs, S.runs); sv(LK.fitness, S.fitness); sv(LK.changes, S.changes); sv(LK.status, S.status); sv(LK.sha, S.sha); sv(LK.q, S.q); sv(LK.view, S.view); sv(LK.pulled, S.pulled); };
  const meta = () => S.plan && S.plan.meta;
  const sessionsMap = () => new Map(Object.entries((S.plan && S.plan.sessions) || {}).map(([id, s]) => [id, { id, ...s }]));
  let SES = sessionsMap();
  const refresh = () => { SES = sessionsMap(); };
  const runOf = id => S.runs[id] ? { id, ...S.runs[id] } : null;
  const pendingCount = () => Object.keys(S.q.runs).length + S.q.fitness.length + S.q.changes.length + Object.keys(S.q.sessions).length + Object.keys(S.q.meta).length;

  /* local edits (applied at once, uploaded at the next sync) */
  function putRun(id, doc) { S.runs[id] = doc; S.q.runs[id] = { fields: cl(doc) }; persistRT(); afterEdit(); }
  function patchRun(id, fields) { if (!S.runs[id]) return; Object.assign(S.runs[id], fields); const e = S.q.runs[id]; S.q.runs[id] = e && !e.del ? { fields: { ...e.fields, ...fields } } : { fields: cl(fields) }; persistRT(); afterEdit(); }
  function delRun(id) { delete S.runs[id]; S.q.runs[id] = { del: true }; persistRT(); afterEdit(); }
  function addFitness(rec) { rec.id = rec.id || 'f' + Date.now().toString(36); S.fitness.push(rec); S.q.fitness.push(rec); persistRT(); afterEdit(); }
  function addChange(c) { c.id = c.id || 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); S.changes.unshift(c); S.q.changes.push(c); persistRT(); afterEdit(); }
  function setSession(id, doc) { S.plan.sessions[id] = doc; S.q.sessions[id] = doc; refresh(); persistRT(); afterEdit(); }
  function setMeta(fields) { Object.assign(S.plan.meta, fields); Object.assign(S.q.meta, fields); persistRT(); afterEdit(); }
  function afterEdit() { draw(); if (typeof renderSync === 'function') renderSync(); if (typeof syncAll === 'function' && navigator.onLine) { clearTimeout(afterEdit.t); afterEdit.t = setTimeout(syncAll, 1500); } }

  /* ---------- GitHub sync (uses app.js gh/ref/settings) ---------- */
  const ub64 = c => new TextDecoder().decode(Uint8Array.from(atob(String(c).replace(/\s/g, '')), ch => ch.charCodeAt(0)));
  async function getJson(path) { const r = await gh('GET', `contents/${path}${ref()}`); return r ? { sha: r.sha, doc: r.content ? JSON.parse(ub64(r.content)) : null } : null; }
  async function putJson(path, obj, sha, message) {
    const r = await gh('PUT', `contents/${path}`, { message, content: b64(JSON.stringify(obj, null, 1) + '\n'), branch: settings.branch, ...(sha ? { sha } : {}) });
    if (r && r.content) S.sha[path] = r.content.sha;
  }
  async function push() {
    for (const id of Object.keys(S.q.runs)) {
      const op = S.q.runs[id], path = `running/runs/${id}.json`, cur = await getJson(path);
      if (op.del) { if (cur && cur.sha) await gh('DELETE', `contents/${path}`, { message: `Remove run ${id}`, sha: cur.sha, branch: settings.branch }); delete S.sha[path]; }
      else await putJson(path, { ...(cur && cur.doc || {}), ...op.fields }, cur && cur.sha, `Run ${id}`);
      delete S.q.runs[id]; persistRT();
    }
    for (const [file, key, field] of [['fitness.json', 'fitness', 'records'], ['changes.json', 'changes', 'changes']]) {
      if (!S.q[key].length) continue;
      const path = 'running/' + file, cur = await getJson(path), list = (cur && cur.doc && cur.doc[field]) || [];
      for (const rec of S.q[key]) { const i = list.findIndex(x => x.id === rec.id); if (i >= 0) list[i] = rec; else list.push(rec); }
      await putJson(path, { [field]: list }, cur && cur.sha, key === 'fitness' ? 'Fitness update' : 'Plan change log');
      S.q[key] = []; persistRT();
    }
    if (Object.keys(S.q.sessions).length || Object.keys(S.q.meta).length) {
      const path = 'running/plan.json', cur = await getJson(path);
      if (!cur || !cur.doc) throw new Error('running/plan.json is missing in the data repository');
      const plan = cur.doc; Object.assign(plan.sessions, S.q.sessions); Object.assign(plan.meta, S.q.meta); plan.updated = nowIso();
      await putJson(path, plan, cur.sha, 'Plan edit from Gym Log');
      S.q.sessions = {}; S.q.meta = {}; persistRT();
    }
  }
  async function pull() {
    const dir = await gh('GET', `contents/running${ref()}`);
    if (!dir || !Array.isArray(dir)) { S.missing = true; return; }
    S.missing = false;
    const shaOf = n => (dir.find(f => f.name === n) || {}).sha;
    for (const [name, apply] of [
      ['plan.json', d => { S.plan = d; Object.assign(S.plan.sessions, S.q.sessions); Object.assign(S.plan.meta, S.q.meta); }],
      ['fitness.json', d => { S.fitness = (d.records || []).concat(S.q.fitness.filter(r => !(d.records || []).some(x => x.id === r.id))); }],
      ['changes.json', d => { const l = (d.changes || []).concat(S.q.changes.filter(r => !(d.changes || []).some(x => x.id === r.id))); S.changes = l.sort((a, b) => String(b.at).localeCompare(String(a.at))); }],
      ['status.json', d => { S.status = d; }]]) {
      const sha = shaOf(name), path = 'running/' + name;
      if (!sha || S.sha[path] === sha) continue;
      const txt = await gh('GET', `contents/${path}${ref()}`, null, true);
      try { apply(JSON.parse(txt)); S.sha[path] = sha; } catch { /* keep the cached copy if the file is mid-edit */ }
    }
    const runsDir = dir.some(f => f.name === 'runs' && f.type === 'dir') ? (await gh('GET', `contents/running/runs${ref()}`) || []) : [];
    const remote = new Map(runsDir.filter(f => f.name.endsWith('.json')).map(f => [f.name.slice(0, -5), f.sha]));
    for (const id of Object.keys(S.runs)) if (!remote.has(id) && !(S.q.runs[id] && !S.q.runs[id].del)) { delete S.runs[id]; delete S.sha[`running/runs/${id}.json`]; }
    const todo = [...remote].filter(([id, sha]) => S.sha[`running/runs/${id}.json`] !== sha && !(S.q.runs[id] && S.q.runs[id].del));
    const worker = async () => { while (todo.length) { const [id, sha] = todo.shift(); const path = `running/runs/${id}.json`;
      const txt = await gh('GET', `contents/${path}${ref()}`, null, true);
      try { const d = JSON.parse(txt); const pend = S.q.runs[id]; S.runs[id] = pend && pend.fields ? { ...d, ...pend.fields } : d; S.sha[path] = sha; } catch {} } };
    await Promise.all([worker(), worker(), worker()]);
    refresh(); S.pulled = Date.now(); persistRT();
  }
  async function sync() {
    if (!ghReady()) return false;
    S.err = '';
    try { await push(); await pull(); } catch (e) { S.err = e.message; throw e; }
    if (view === 'run') draw();
    return true;
  }

  /* ---------- derived data ---------- */
  const sessionList = () => [...SES.values()].sort((a, b) => a.date.localeCompare(b.date));
  const weekSessions = w => sessionList().filter(s => s.week === w);
  const fitnessList = () => [...S.fitness].filter(f => Number(f.vdot) > 20).sort((a, b) => (a.date + (a.at || '')).localeCompare(b.date + (b.at || '')));
  function currentFit() { const l = fitnessList(); return l[l.length - 1] || { vdot: 40.01, date: '2026-12-06', source: 'baseline', note: 'Assumed 50:00 at the 6 Dec 10K.' }; }
  const curPaces = () => paceSet(currentFit().vdot, meta() && meta().racePaceSec);
  function status(s) {
    if (s.removed) return 'removed';
    const a = S.runs[s.id];
    if (a && a.status === 'done') return 'done';
    if (a && a.status === 'skipped') return 'skipped';
    const t = TODAY();
    return s.date < t ? 'missed' : s.date === t ? 'today' : 'planned';
  }
  const phaseOf = w => ((meta() && meta().phases) || []).find(p => w >= p.from && w <= p.to) || null;
  function position() {
    const t = TODAY(), st = meta().startDate, race = meta().raceDate;
    if (t < st) return { mode: 'pre', toStart: diffD(t, st), toRace: diffD(t, race) };
    if (t > race) return { mode: 'post' };
    return { mode: 'in', week: Math.min(18, Math.floor(diffD(st, t) / 7) + 1), toRace: diffD(t, race) };
  }
  const weekStart = w => addD(meta().startDate, 7 * (w - 1));
  const extras = () => Object.entries(S.runs).filter(([, a]) => !a.sessionId && a.status === 'done').map(([id, a]) => ({ id, ...a }));
  const gymOn = date => (typeof sessions !== 'undefined' ? sessions : []).filter(s => s.start && s.start.slice(0, 10) === date);

  function runDays(override) {
    const m = new Map();
    const add = (d, min, rpe, ref) => { if (!m.has(d)) m.set(d, []); m.get(d).push({ min, rpe, ref }); };
    const mt = meta().maintenance, ex = extras();
    if (mt) for (let d = mt.from; d <= mt.to; d = addD(d, 1)) {
      if (!mt.dayOffsets.includes(diffD(mt.from, d) % 7)) continue;
      const wk0 = addD(mt.from, Math.floor(diffD(mt.from, d) / 7) * 7), wk1 = addD(wk0, 6);
      if (ex.some(a => a.date >= wk0 && a.date <= wk1)) continue; // real runs logged that week replace the assumed 2 × 40 min
      add(d, mt.min, mt.rpe, 'maint');
    }
    for (const s0 of SES.values()) {
      const s = override && override.id === s0.id ? { ...s0, ...override.doc } : s0;
      const a = S.runs[s.id];
      if (a && a.status === 'done') add(a.date || s.date, (a.durSec || 0) / 60, Number(a.rpe) || s.rpe, s.id);
      else if ((a && a.status === 'skipped') || s.removed) continue;
      else add(s.date, s.dur, s.rpe, s.id);
    }
    for (const a of ex) add(a.date, (a.durSec || 0) / 60, Number(a.rpe) || 3, a.id);
    return m;
  }
  function loadModel(override) {
    const days = runDays(override), M = meta();
    const base = (M.maintenance && M.maintenance.from) || addD(M.startDate, -56);
    const pre = Math.round(diffD(base, M.startDate) / 7), nW = pre + 18;
    const L = Array(nW).fill(0);
    for (const [d, runs] of days) { const k = Math.floor(diffD(base, d) / 7); if (k >= 0 && k < nW) L[k] += runs.reduce((a, r) => a + r.min * r.rpe, 0); }
    const weeks = [];
    for (let w = 1; w <= 18; w++) {
      const k = pre + w - 1;
      const c4 = L.slice(Math.max(0, k - 3), k + 1).reduce((a, b) => a + b, 0) / 4;
      const p4 = L.slice(Math.max(0, k - 4), k).reduce((a, b) => a + b, 0) / 4;
      const ws = weekStart(w);
      let longest = null;
      for (let i = 0; i < 7; i++) { const d = addD(ws, i); for (const r of days.get(d) || []) if (!longest || r.min > longest.min) longest = { ...r, date: d }; }
      let max30 = 0;
      if (longest) for (let i = 1; i <= 30; i++) for (const r of days.get(addD(longest.date, -i)) || []) max30 = Math.max(max30, r.min);
      weeks.push({ n: w, load: L[k], acwr: c4 ? L[k] / c4 : 0, unc: p4 ? L[k] / p4 : 0, longMin: longest ? longest.min : 0, max30, ratio: longest && max30 ? longest.min / max30 : null });
    }
    return { weeks, L };
  }
  function weekStats(w, P) {
    const ss = weekSessions(w), ws = weekStart(w), we = addD(ws, 6);
    let planMin = 0, planKm = 0, doneMin = 0, doneKm = 0;
    for (const s of ss) {
      if (!s.removed) { planMin += s.dur; planKm += sessionKm(s, P); }
      const a = S.runs[s.id];
      if (a && a.status === 'done') { doneMin += (a.durSec || 0) / 60; doneKm += a.distKm || 0; }
    }
    for (const a of extras()) if (a.date >= ws && a.date <= we) { doneMin += (a.durSec || 0) / 60; doneKm += a.distKm || 0; }
    return { planMin, planKm, doneMin, doneKm };
  }
  function acwrPill(x) {
    if (!x) return '<span class="pill">–</span>';
    const R = meta().rules || {}; const c = x > (R.acwrCap || 1.5) ? 'bad' : x > (R.acwrHigh || 1.3) ? 'warn' : x >= (R.acwrLow || 1) * 0.8 ? 'ok' : '';
    return `<span class="pill ${c} num">${x.toFixed(2)}</span>`;
  }
  const lastSync = () => S.pulled ? new Date(S.pulled) : null;
  const relTime = iso => { if (!iso) return 'never'; const d = new Date(iso), m = Math.round((Date.now() - d) / 60000); if (m < 2) return 'just now'; if (m < 90) return m + ' min ago'; const h = Math.round(m / 60); if (h < 36) return h + ' h ago'; return fmtD(ymd(d)); };

  /* ---------- tiles and lines ---------- */
  function tile(s, P) {
    const st = status(s), a = S.runs[s.id];
    const badge = { done: a && a.review ? '✓ Reviewed' : '✓ Done', missed: '! Log', skipped: 'Skipped', removed: 'Removed', today: 'Today', planned: '' }[st];
    const meta1 = a && a.status === 'done' ? `${fmtT(a.durSec)} · ${(a.distKm || 0).toFixed(1)} km` : `${s.durNote || s.dur} min · ${sessionKm(s, P).toFixed(1)} km`;
    const gym = s.gym && gymOn(s.date).length ? ' · gym ✓' : '';
    return `<button class="st k-${esc(s.kind)} ${st}" data-rt="open" data-id="${esc(s.id)}" aria-label="${esc(fmtD(s.date) + ', ' + s.title + (badge ? ', ' + badge : ''))}">
      <span class="d">${esc(fmtD(s.date))}</span><span class="t">${esc(s.title)}${s.edited ? '<span class="edited-dot" title="Changed by the coach"></span>' : ''}</span>
      <span class="m">${esc(meta1 + gym)}</span>${badge ? `<span class="b">${esc(badge)}</span>` : ''}</button>`;
  }
  function weekGrid(w, P) {
    const ss = weekSessions(w), by = Object.fromEntries(ss.map(s => [s.day, s]));
    const cols = DAYS.map(d => by[d] ? 'minmax(0,1fr)' : 'minmax(0,.55fr)').join(' ');
    return `<div class="wk" style="--cols:${cols}">${DAYS.map(d => by[d] ? tile(by[d], P) : `<div class="st rest">${d} · rest</div>`).join('')}</div>`;
  }
  const linesHtml = (s, P) => `<div class="lines">${(s.lines || []).map(l => `<div class="ln"><span class="lb">${esc(l.k || '')}</span><span>${lineHtml(l.t, P)}</span></div>`).join('')}</div>`;

  /* ---------- views ---------- */
  function render() {
    const box = document.createElement('div'); box.className = 'rt rt-view';
    if (!S.plan) {
      box.innerHTML = `<div class="card"><h2 style="font-size:20px">Your running plan</h2><p class="muted">${ghReady()
        ? (S.missing ? 'No running/ folder was found in your data repository yet. Claude puts the plan there; sync again once it is in place.' : 'Loading your plan from GitHub…')
        : 'The running plan lives in the same private GitHub repository as your gym sessions. Connect it in Settings, then sync.'}</p>
        <div class="acts"><button class="btn" data-rt="sync">Sync now</button></div></div>`;
      return box;
    }
    const tabs = `<nav class="tabs" role="tablist" aria-label="Run views">${[['overview', 'Overview'], ['plan', 'Plan'], ['log', 'Changes']].map(([v, l]) => `<button class="tab" role="tab" data-rt="tab" data-v="${v}" aria-selected="${S.view === v}">${l}</button>`).join('')}</nav>`;
    box.innerHTML = tabs + (S.view === 'plan' ? renderPlan() : S.view === 'log' ? renderLog() : renderOverview());
    return box;
  }
  function draw() {
    if (view === 'run') { const m = q('#main'); const y = m.scrollTop; m.innerHTML = ''; m.append(render()); m.scrollTop = y; }
    drawLayer();
  }

  function renderOverview() {
    const P = curPaces(), fit = currentFit(), pos = position(), lm = loadModel(), M = meta();
    const est = raceTime(fit.vdot), lo = raceTime(fit.vdot + .75), hi = raceTime(fit.vdot - .75), goal = M.goalSec || 2700;
    const gap = est - goal;
    const [mm, ss] = fmtT(est).split(':');
    const curW = pos.mode === 'in' ? pos.week : pos.mode === 'pre' ? 1 : 18;
    const phases = M.phases || [];
    const lanes = Array.from({ length: 18 }, (_, i) => {
      const w = i + 1, c = [], st = weekStats(w, P);
      if (pos.mode !== 'pre' && (w < curW || pos.mode === 'post')) c.push('done');
      if (pos.mode === 'in' && w === curW) c.push('cur');
      if (phases.some(p => p.from === w && w > 1)) c.push('gap');
      return `<div class="lane ${c.join(' ')}" title="Week ${w}: ${Math.round(st.doneMin)} of ${st.planMin} min"></div>`;
    }).join('');
    const phl = phases.map(p => `<span style="grid-column:${p.from}/${p.to + 1}">${esc(p.name)}</span>`).join('');
    const co = S.status && S.status.coros;
    const watch = co && co.tenK ? `${esc(co.tenK)} <small>COROS · rough</small>` : '<small>after the first import</small>';
    const hero = `<section class="hero" aria-label="Estimated race result">
      <div>
        <div class="eyebrow">Estimated 10K today</div>
        <div class="clock" aria-label="${esc(fmtT(est))}">${esc(mm)}<span class="sep">:</span>${esc(ss)}</div>
        <div class="range">${esc(fmtT(lo))}–${esc(fmtT(hi))} · VDOT ${fit.vdot.toFixed(1)}</div>
        <div class="basis">Based on ${esc(fit.source === 'baseline' ? 'the baseline' : fit.source === 'race' ? 'a race or test result' : 'a pace update')} from ${esc(fmtDY(fit.date))}: ${esc(fit.note || '')}</div>
      </div>
      <div class="hero-side">
        <div class="hstat"><span class="k">Goal</span><span class="v">sub-45 <small>4:30/km</small></span></div>
        <div class="hstat"><span class="k">${gap > 0 ? 'Still to find' : 'Ahead of goal'}</span><span class="v">${gap > 0 ? '−' : '+'}${esc(fmtT(Math.abs(gap)))}<small>${Math.abs(gap / 10).toFixed(0)} s/km</small></span></div>
        <div class="hstat"><span class="k">${pos.mode === 'pre' ? 'Plan starts' : 'Race'}</span><span class="v">${pos.mode === 'pre' ? `${pos.toStart} <small>days · ${esc(fmtD(M.startDate))}</small>` : pos.mode === 'in' ? `${pos.toRace} <small>days · ${esc(fmtD(M.raceDate))}</small>` : 'done'}</span></div>
        <div class="hstat"><span class="k">Watch prediction</span><span class="v">${watch}</span></div>
        <div class="hero-acts"><button class="btn gold" data-rt="race-open">Log a race or test</button></div>
      </div>
      <div class="track"><div class="lanes" aria-hidden="true">${lanes}</div><div class="phlab">${phl}</div></div>
    </section>`;

    const ws = weekStats(curW, P), wk = lm.weeks[curW - 1], ph = phaseOf(curW), wm = (M.weeks || [])[curW - 1];
    const thisWeek = `<section class="card">
      <div class="card-h"><h2>${pos.mode === 'pre' ? 'Week 1 preview' : `Week ${curW}`}<span class="tag">${esc(ph ? ph.name : '')}</span>${((wm && wm.tags) || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</h2><span class="muted num">${esc(fmtD(weekStart(curW)))} – ${esc(fmtD(addD(weekStart(curW), 6)))}</span></div>
      ${weekGrid(curW, P)}
      <div class="kv">
        <div><div class="k">Running done</div><div class="v">${Math.round(ws.doneMin)}<small> / ${ws.planMin} min</small></div></div>
        <div><div class="k">ACWR${pos.mode === 'in' ? '' : ' (planned)'}</div><div class="v">${acwrPill(wk.acwr)}</div></div>
        <div><div class="k">Longest run</div><div class="v">${wk.ratio ? `×${wk.ratio.toFixed(2)}` : '–'}<small> of 30-day max</small></div></div>
      </div>${wm && wm.note ? `<div class="wnote">${esc(wm.note)}</div>` : ''}</section>`;

    const nx = sessionList().find(s => s.date >= TODAY() && ['planned', 'today'].includes(status(s)));
    const next = nx ? `<section class="card"><div class="card-h"><h2>Next session</h2><span class="muted">${esc(fmtD(nx.date))}${nx.date === TODAY() ? ' · today' : ''}</span></div>
      <div class="next k-${esc(nx.kind)}"><div class="kindlab">${esc(nx.label || KIND[nx.kind] || '')}</div>
        <div class="nt">${esc(nx.title)}</div>
        <div class="muted num" style="font-size:13px">${esc(nx.durNote || nx.dur)} min · ≈ ${sessionKm(nx, P).toFixed(1)} km${nx.gym ? ' · + ' + esc(nx.gym) : ''}</div>
        ${linesHtml(nx, P)}</div>
      <div class="acts"><button class="btn" data-rt="open" data-id="${esc(nx.id)}">Open session</button></div></section>` : '';

    const todo = [];
    for (const s of sessionList()) {
      const st = status(s), ago = diffD(s.date, TODAY()), a = S.runs[s.id];
      if (st === 'missed' && ago <= 21) todo.push({ id: s.id, s, what: 'Not logged yet', btn: 'Log it' });
      if (st === 'done' && ago <= 14 && !(a && a.review)) todo.push({ id: s.id, s, what: 'Done · not reviewed yet', btn: 'Review' });
    }
    const st0 = S.status;
    const importLine = `<div class="wnote">COROS runs arrive by themselves every evening${st0 && st0.updatedAt ? ` · last import ${esc(relTime(st0.updatedAt))}` : ''}. <button class="linkbtn" data-rt="import-now">Import now with Claude</button></div>`;
    const todoCard = `<section class="card"><div class="card-h"><h2>To do</h2>${todo.length ? `<span class="pill warn">${todo.length}</span>` : ''}</div>
      ${todo.length ? `<div class="todo">${todo.slice().reverse().slice(0, 6).map(t => `<div class="todo-i"><div class="tx"><b>${esc(fmtD(t.s.date))} · ${esc(t.s.title)}</b><span>${esc(t.what)}</span></div><button class="btn sm" data-rt="open" data-id="${esc(t.id)}">${esc(t.btn)}</button></div>`).join('')}</div>${todo.length > 6 ? `<div class="wnote">and ${todo.length - 6} more in the Plan view</div>` : ''}`
        : `<div class="empty">${pos.mode === 'pre' ? `Nothing yet. Your first session is ${esc(fmtD((sessionList()[0] || {}).date || M.startDate))}. After each run, open it here and tap Review this workout.` : 'All caught up: every past session is logged and reviewed.'}</div>`}
      ${importLine}</section>`;

    const charts = `<section class="card"><div class="card-h"><h2>Weekly running</h2><span class="muted small-note">minutes, planned vs done</span></div>${chartVolume(P, curW, pos)}</section>
      <section class="card"><div class="card-h"><h2>Training load</h2><span class="muted small-note">ACWR · target 1.0–1.3, cap 1.5</span></div>${chartAcwr(lm, curW, pos)}</section>
      <section class="card"><div class="card-h"><h2>Estimated 10K</h2><span class="muted small-note">from race results and pace updates</span></div>${chartFitness()}</section>`;
    return `${hero}<div class="grid"><div class="col">${thisWeek}${next}${todoCard}</div><div class="col">${charts}</div></div>`;
  }

  /* ---------- charts ---------- */
  function chartVolume(P, curW, pos) {
    const W = narrow() ? 380 : 640, H = narrow() ? 240 : 230, l = 34, r = 8, t = 26, b = 30, n = 18, bw = (W - l - r) / n;
    const st = Array.from({ length: n }, (_, i) => weekStats(i + 1, P));
    const ymax = Math.max(60, Math.ceil(Math.max(...st.map(s => Math.max(s.planMin, s.doneMin))) / 60) * 60);
    const y = v => H - b - v / ymax * (H - b - t), x = i => l + i * bw;
    let g = '';
    for (let v = 0; v <= ymax; v += 60) g += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line-2)"/><text x="${l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--faint)">${v}</text>`;
    for (const p of meta().phases || []) g += `<text x="${(x(p.from - 1) + x(p.to)) / 2}" y="${t - 10}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(p.name.split(' ')[0])}</text>` + (p.from > 1 ? `<line x1="${x(p.from - 1)}" x2="${x(p.from - 1)}" y1="${t - 20}" y2="${H - b}" stroke="var(--line)"/>` : '');
    if (pos.mode === 'in') g += `<rect x="${x(curW - 1)}" y="${t - 4}" width="${bw}" height="${H - b - t + 4}" fill="var(--gold)" opacity=".14" rx="3"/>`;
    st.forEach((s, i) => {
      const w = i + 1, cx = x(i) + bw * .18, ww = bw * .64;
      g += `<rect x="${cx}" y="${y(s.planMin)}" width="${ww}" height="${H - b - y(s.planMin)}" fill="none" stroke="var(--faint)" stroke-width="1.2" stroke-dasharray="3 2" rx="2"><title>Week ${w}: planned ${s.planMin} min</title></rect>`;
      if (s.doneMin > 0) g += `<rect x="${cx}" y="${y(s.doneMin)}" width="${ww}" height="${H - b - y(s.doneMin)}" fill="var(--ink)" rx="2"><title>Week ${w}: done ${Math.round(s.doneMin)} min of ${s.planMin}</title></rect>`;
      if (!narrow() || w % 2 === 1 || w === curW) g += `<text x="${x(i) + bw / 2}" y="${H - b + 15}" text-anchor="middle" font-size="11" fill="${w === curW && pos.mode === 'in' ? 'var(--ink)' : 'var(--faint)'}" font-weight="${w === curW && pos.mode === 'in' ? 700 : 400}">${w}</text>`;
    });
    const peak = st.reduce((a, s, i) => s.planMin > st[a].planMin ? i : a, 0);
    g += `<text x="${x(peak) + bw / 2}" y="${y(st[peak].planMin) - 5}" text-anchor="middle" font-size="11" fill="var(--muted)">${st[peak].planMin}</text>`;
    const tot = st.reduce((a, s) => a + s.doneKm, 0);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly running minutes, planned versus done">${g}</svg>
      <div class="legend"><span><i style="border:1.2px dashed var(--faint)"></i>Planned</span><span><i style="background:var(--ink)"></i>Done</span><span class="num">${tot ? `${tot.toFixed(0)} km logged so far` : 'Nothing logged yet'}</span></div>`;
  }
  function chartAcwr(lm, curW, pos) {
    const W = narrow() ? 380 : 640, H = narrow() ? 230 : 210, l = 34, r = 8, t = 12, b = 30, n = 18, bw = (W - l - r) / n, lo = .4, hi = 1.7;
    const y = v => H - b - (clamp(v, lo, hi) - lo) / (hi - lo) * (H - b - t), x = i => l + i * bw + bw / 2;
    const R = meta().rules || { acwrLow: 1, acwrHigh: 1.3, acwrCap: 1.5 };
    let g = `<rect x="${l}" y="${y(R.acwrHigh)}" width="${W - l - r}" height="${y(R.acwrLow) - y(R.acwrHigh)}" fill="var(--ok)" opacity=".1"/>`;
    for (const v of [.6, 1, 1.4]) g += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line-2)"/><text x="${l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--faint)">${v.toFixed(1)}</text>`;
    g += `<line x1="${l}" x2="${W - r}" y1="${y(R.acwrCap)}" y2="${y(R.acwrCap)}" stroke="var(--bad)" stroke-dasharray="4 3"/><text x="${W - r}" y="${y(R.acwrCap) - 5}" text-anchor="end" font-size="11" fill="var(--bad)">cap ${R.acwrCap}</text>`;
    const pts = lm.weeks.map((w, i) => [x(i), y(w.acwr), w]);
    const split = pos.mode === 'pre' ? 0 : pos.mode === 'post' ? 18 : curW;
    const path = arr => arr.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    if (split > 0) g += `<path d="${path(pts.slice(0, split))}" fill="none" stroke="var(--ink)" stroke-width="2"/>`;
    if (split < 18) g += `<path d="${path(pts.slice(Math.max(0, split - 1)))}" fill="none" stroke="var(--faint)" stroke-width="1.6" stroke-dasharray="4 3"/>`;
    pts.forEach(([px, py, w], i) => {
      const over = w.acwr > R.acwrCap, warn = w.acwr > R.acwrHigh;
      g += `<circle cx="${px}" cy="${py}" r="${i + 1 === curW && pos.mode === 'in' ? 4.5 : 3}" fill="${over ? 'var(--bad)' : warn ? 'var(--warn)' : i < split ? 'var(--ink)' : 'var(--panel)'}" stroke="${i < split ? 'var(--ink)' : 'var(--faint)'}" stroke-width="1.4"><title>Week ${w.n}: ACWR ${w.acwr.toFixed(2)} (uncoupled ${w.unc.toFixed(2)})${i < split ? '' : ' · projected'}</title></circle>`;
      if (!narrow() || w.n % 2 === 1) g += `<text x="${px}" y="${H - b + 15}" text-anchor="middle" font-size="11" fill="var(--faint)">${w.n}</text>`;
    });
    const mx = lm.weeks.reduce((a, w) => w.acwr > a.acwr ? w : a, lm.weeks[0]);
    g += `<text x="${x(mx.n - 1)}" y="${y(mx.acwr) - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${mx.acwr.toFixed(2)}</text>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Acute to chronic workload ratio by week">${g}</svg>
      <div class="legend"><span><i style="background:var(--ink)"></i>From logged runs</span><span><i style="border:1.4px dashed var(--faint)"></i>Projected from plan</span><span><i style="background:var(--ok);opacity:.3"></i>Target band</span></div>`;
  }
  function chartFitness() {
    const recs = fitnessList(), M = meta(), goal = M.goalSec || 2700;
    const x0 = pd('2026-12-01'), x1 = pd(M.raceDate), W = narrow() ? 380 : 640, H = narrow() ? 220 : 190, l = 46, r = 12, t = 14, b = 28;
    const times = recs.map(f => raceTime(f.vdot));
    const ymin = Math.min(goal, ...times) - 90, ymax = Math.max(goal, ...times) + 90;
    const x = d => l + (pd(d) - x0) / (x1 - x0) * (W - l - r), y = s => t + (s - ymin) / (ymax - ymin) * (H - b - t);
    let g = '';
    for (let s = Math.ceil(ymin / 120) * 120; s <= ymax; s += 120) g += `<line x1="${l}" x2="${W - r}" y1="${y(s)}" y2="${y(s)}" stroke="var(--line-2)"/><text x="${l - 6}" y="${y(s) + 4}" text-anchor="end" font-size="11" fill="var(--faint)">${fmtT(s)}</text>`;
    for (const m of ['2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01', '2027-06-01']) g += `<text x="${x(m)}" y="${H - b + 16}" text-anchor="middle" font-size="11" fill="var(--faint)">${MON[pd(m).getMonth()]}</text>`;
    g += `<line x1="${l}" x2="${W - r}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--gold)" stroke-width="2" stroke-dasharray="6 4"/><text x="${W - r}" y="${y(goal) - 6}" text-anchor="end" font-size="11" font-weight="700" fill="var(--warn)">goal sub-45</text>`;
    const today = TODAY();
    if (today >= '2026-12-01' && today <= M.raceDate) g += `<line x1="${x(today)}" x2="${x(today)}" y1="${t}" y2="${H - b}" stroke="var(--line)"/><text x="${x(today) + 4}" y="${t + 10}" font-size="11" fill="var(--faint)">today</text>`;
    if (recs.length) {
      let d = '';
      recs.forEach((f, i) => { const px = clamp(x(f.date), l, W - r), py = y(times[i]); d += i ? `H${px.toFixed(1)}V${py.toFixed(1)}` : `M${px.toFixed(1)},${py.toFixed(1)}`; });
      const lastD = recs[recs.length - 1].date;
      d += `H${clamp(x(today < M.raceDate ? (today > lastD ? today : lastD) : M.raceDate), l, W - r).toFixed(1)}`;
      g += `<path d="${d}" fill="none" stroke="var(--link)" stroke-width="2.2"/>`;
      recs.forEach((f, i) => { g += `<circle cx="${clamp(x(f.date), l, W - r)}" cy="${y(times[i])}" r="4" fill="var(--link)"><title>${fmtDY(f.date)}: ${fmtT(times[i])} (VDOT ${Number(f.vdot).toFixed(1)})</title></circle>`; });
      const lt = times[times.length - 1];
      g += `<text x="${clamp(x(lastD), l, W - r) + 8}" y="${y(lt) - 8}" font-size="12" font-weight="700" fill="var(--link)">${fmtT(lt)}</text>`;
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated 10K time over time against the sub-45 goal">${g}</svg>
      <div class="legend"><span>Faster is higher.</span><span>${recs.length < 2 ? 'Log race results and pace updates to build this line.' : `${recs.length} updates`}</span></div>`;
  }

  /* ---------- plan + change log ---------- */
  function renderPlan() {
    const P = curPaces(), lm = loadModel(), pos = position(), M = meta();
    const pc = (k, v) => `<div class="pc"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const rpForm = S.form && S.form.type === 'rp'
      ? `<form class="form inline" data-rtform="rp"><label for="rt-rp">Race pace (min/km)<input id="rt-rp" name="rp" value="${esc(fmtP(P.RP))}" inputmode="numeric" placeholder="4:30"></label><button class="btn primary sm" type="submit">Save</button><button class="btn sm" type="button" data-rt="form-cancel">Cancel</button></form>`
      : '<button class="btn sm" data-rt="rp-edit">Set race pace</button>';
    const top = `<section class="card"><div class="plan-top"><div>
        <h2>Your current paces</h2>
        <div class="muted" style="font-size:13px">VDOT ${P.vdot.toFixed(1)} · every session below uses these. They change when you log a race or Claude records a pace step.</div>
        <div class="paces">${pc('Easy', `${fmtP(P.E[0])}–${fmtP(P.E[1])}`)}${pc('Steady', `${fmtP(P.ST[0])}–${fmtP(P.ST[1])}`)}${pc('Threshold', fmtP(P.T))}${pc('10K now', fmtP(P.TK))}${pc('Interval', fmtP(P.I))}${pc('Strides', '~' + fmtP(P.S))}${pc('Race pace', fmtP(P.RP))}</div>
      </div><div class="plan-act">${rpForm}</div></div></section>`;
    const phases = (M.phases || []).map(p => {
      const weeks = [];
      for (let w = p.from; w <= p.to; w++) {
        const st = weekStats(w, P), wk = lm.weeks[w - 1], wm = (M.weeks || [])[w - 1] || {};
        weeks.push(`<div class="week ${pos.mode === 'in' && pos.week === w ? 'current' : ''}" id="rt-week-${w}">
          <div class="week-h"><div><span class="w">Week ${w}</span><span class="dts">${esc(fmtD(weekStart(w)))} – ${esc(fmtD(addD(weekStart(w), 6)))}</span>${(wm.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="wstats"><span><b>${st.planMin}</b> min</span><span>≈ <b>${st.planKm.toFixed(0)}</b> km</span>${st.doneMin ? `<span>done <b>${Math.round(st.doneMin)}</b> min</span>` : ''}<span>ACWR ${acwrPill(wk.acwr)}</span><span>long ×<b>${wk.ratio ? wk.ratio.toFixed(2) : '–'}</b></span></div></div>
          ${weekGrid(w, P)}${wm.note ? `<div class="wnote">${esc(wm.note)}</div>` : ''}</div>`);
      }
      return `<section class="phase"><div class="phase-h"><span class="n">PHASE ${p.n}</span><h2>${esc(p.name)}</h2><span class="meta">${esc(p.dates)} · weeks ${p.from}–${p.to} · ${esc(p.runs)}</span></div>
        <details><summary>What this phase is for, and when to adjust</summary><p>${esc(p.lead)}</p><ul>${(p.rules || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>${weeks.join('')}</section>`;
    }).join('');
    const ex = extras().sort((a, b) => b.date.localeCompare(a.date));
    const extraCard = ex.length ? `<section class="card" style="margin-top:20px"><div class="card-h"><h2>Runs outside the plan</h2><span class="muted small-note">${ex.length}</span></div><div class="todo">${ex.slice(0, 12).map(a => `<div class="todo-i"><div class="tx"><b>${esc(fmtD(a.date))} · ${esc(a.name || 'Run')}</b><span>${fmtT(a.durSec)} · ${(a.distKm || 0).toFixed(1)} km${a.review ? ' · reviewed' : ''}</span></div><button class="btn sm" data-rt="open" data-id="${esc(a.id)}">Open</button></div>`).join('')}</div></section>` : '';
    return top + phases + extraCard;
  }
  function renderLog() {
    const fit = fitnessList().slice().reverse();
    const reverted = new Set(S.changes.filter(c => c.revertOf).map(c => c.revertOf));
    const rows = S.changes.length ? S.changes.map(c => {
      const s = c.sessionId ? SES.get(c.sessionId) : null;
      const can = c.type === 'session' && c.before && !c.revertOf && !reverted.has(c.id) && s && status(s) !== 'done' && s.date >= TODAY();
      const key = 'revert:' + c.id;
      return `<div class="log-i"><div class="when">${esc(fmtDY(String(c.at || '').slice(0, 10) || TODAY()))}</div><div class="what"><b>${esc(c.summary || 'Change')}</b><span>${esc(c.reason || '')}${reverted.has(c.id) ? ' · reverted' : ''}${c.by ? ' · by ' + esc(c.by) : ''}</span>${s ? `<div><button class="linkbtn" data-rt="open" data-id="${esc(s.id)}">${esc(fmtD(s.date))} · ${esc(s.title)}</button></div>` : ''}</div>
        <div>${can ? `<button class="btn sm" data-rt="revert" data-id="${esc(c.id)}">${S.confirm === key ? 'Tap again to revert' : 'Revert'}</button>` : ''}</div></div>`;
    }).join('') : '<div class="empty">No changes yet. When Claude changes a session after a review, it shows up here with the reason, and you can undo it.</div>';
    const fr = fit.map(f => `<div class="log-i"><div class="when">${esc(fmtDY(f.date))}</div><div class="what"><b>VDOT ${Number(f.vdot).toFixed(1)} · est. 10K ${esc(fmtT(raceTime(f.vdot)))}</b><span>${esc({ baseline: 'Baseline', race: 'Race or test', coach: 'Pace step (Claude)', manual: 'Manual' }[f.source] || f.source)} · ${esc(f.note || '')}</span></div><div></div></div>`).join('');
    return `<section class="card"><div class="card-h"><h2>Plan changes</h2></div><div class="log">${rows}</div></section>
      <section class="card" style="margin-top:16px"><div class="card-h"><h2>Fitness updates</h2><span class="muted small-note">what sets your paces and estimate</span></div><div class="log">${fr}</div></section>`;
  }

  /* ---------- sheets (run session, race result) ---------- */
  let layerKey = '';
  function layer() { let L = q('#rt-layer'); if (!L) { L = document.createElement('div'); L.id = 'rt-layer'; L.className = 'rt'; document.body.append(L); } return L; }
  function shell(key, head) {
    const L = layer();
    if (layerKey !== key) {
      layerKey = key;
      L.innerHTML = `<div class="rscrim" data-rt="close"></div><div class="rsheet" role="dialog" aria-modal="true" aria-labelledby="rt-title">
        <div class="rsheet-h"><div class="ttl" id="rt-title"></div><button class="xbtn" data-rt="close" aria-label="Close">×</button></div><div class="rsheet-b" id="rt-body"></div></div>`;
    }
    const t = q('#rt-title'); if (t.innerHTML !== head) t.innerHTML = head;
    return q('#rt-body');
  }
  const setHtml = (el, html) => { if (el && el.__h !== html) { el.innerHTML = html; el.__h = html; } };
  function drawLayer() {
    if (!S.open) { if (layerKey) { layer().innerHTML = ''; layerKey = ''; } return; }
    if (S.open === '__race') return raceSheet();
    const id = S.open, s = SES.get(id) || null, a = runOf(id);
    if (!s && !a) { close(); return; }
    const P = curPaces();
    const head = s ? `<b>${esc(s.title)}</b><span>${esc(fmtDY(s.date))} · week ${s.week} · ${esc((phaseOf(s.week) || {}).name || '')}</span>` : `<b>${esc(a.name || 'Extra run')}</b><span>${esc(fmtDY(a.date))} · not in the plan</span>`;
    const body = shell('s:' + id, head);
    if (!body.__built) { body.innerHTML = '<div id="rt-plan"></div><div id="rt-act"></div><div id="rt-rev"></div>'; body.__built = true; }
    let plan = '';
    if (s) {
      const st = status(s);
      plan = `<div class="sec k-${esc(s.kind)}"><h3><span><span class="kindlab">${esc(s.label || KIND[s.kind] || '')}</span> · planned</span><span class="muted num sub">${esc(s.durNote || s.dur)} min · ≈ ${sessionKm(s, P).toFixed(1)} km · RPE ${s.rpe}</span></h3>
        ${s.removed ? `<div class="notice warn">Removed from the plan${s.edited && s.edited.reason ? ': ' + esc(s.edited.reason) : '.'}</div>` : linesHtml(s, P)}
        ${s.gym ? `<div class="wnote">+ ${esc(s.gym)} (lower body, straight after the run)${gymOn(s.date).length ? ' · logged in Gym Log ✓' : ''}</div>` : ''}
        ${s.note ? `<div class="wnote">${esc(s.note)}</div>` : ''}
        ${s.edited && !s.removed ? `<div class="wnote" style="color:var(--link)">Changed on ${esc(fmtD(String(s.edited.at).slice(0, 10)))}: ${esc(s.edited.reason || '')}</div>` : ''}
        ${st === 'missed' ? '<div class="notice warn" style="margin-top:10px">This date has passed and nothing is logged. If you ran, COROS adds it this evening; otherwise log it by hand or mark it skipped.</div>' : ''}</div>`;
    }
    setHtml(q('#rt-plan'), plan);
    const act = q('#rt-act');
    if (S.form && S.form.type === 'manual' && S.form.id === id) { if (!act.__form) { act.innerHTML = manualForm(id, s, a); act.__form = true; act.__h = null; } }
    else { act.__form = false; setHtml(act, actualHtml(id, s, a, P)); }
    setHtml(q('#rt-rev'), reviewHtml(id, s, a));
  }
  function actualHtml(id, s, a, P) {
    if (!a) return `<div class="sec"><h3>What you did</h3><div class="empty">Nothing logged yet. COROS runs are imported every evening${S.status && S.status.updatedAt ? ` (last import ${esc(relTime(S.status.updatedAt))})` : ''}.</div><div class="acts">
      <button class="btn" data-rt="manual" data-id="${esc(id)}">Log it by hand</button><button class="btn ghost" data-rt="skip" data-id="${esc(id)}">Mark skipped</button><button class="btn ghost" data-rt="import-now">Import now with Claude</button></div></div>`;
    if (a.status === 'skipped') return `<div class="sec"><h3>What you did</h3><div class="notice">Marked as skipped${a.notes ? ': ' + esc(a.notes) : '.'} It counts as zero load.</div><div class="acts"><button class="btn sm" data-rt="unlink" data-id="${esc(id)}">${S.confirm === 'unlink:' + id ? 'Tap again to undo' : 'Undo skip'}</button></div></div>`;
    const lapsW = a.laps && a.laps.length > 1 ? a.laps : null, splits = a.splits && a.splits.length ? a.splits : null;
    const v = S.lapView[id] || (lapsW ? 'laps' : 'splits'), rows = v === 'laps' ? lapsW : splits;
    const tq = s && !['easy', 'long'].includes(s.kind) ? P.E[0] - 15 : null;
    const table = rows ? `<div class="tbl"><table><tr><th>#</th><th>Dist</th><th>Time</th><th>Pace</th><th>Avg HR</th><th>Max HR</th></tr>${rows.map(r => `<tr class="${tq && r.pace && r.pace < tq ? 'q' : ''}"><td>${r.i}</td><td>${(r.km || 0).toFixed(2)}</td><td>${fmtT(r.sec)}</td><td>${r.pace ? fmtP(r.pace) : '–'}</td><td>${r.hr || '–'}</td><td>${r.max || '–'}</td></tr>`).join('')}</table></div>` : '';
    const seg = lapsW && splits ? `<span class="seg2" role="group" aria-label="Lap view"><button data-rt="lapview" data-id="${esc(id)}" data-v="laps" aria-pressed="${v === 'laps'}">Workout laps</button><button data-rt="lapview" data-id="${esc(id)}" data-v="splits" aria-pressed="${v === 'splits'}">Km splits</button></span>` : '';
    const rpe = Number(a.rpe) || (s && s.rpe) || 3;
    const cands = candidates(a.date, id);
    const link = a.sessionId ? `<button class="btn sm ghost" data-rt="make-extra" data-id="${esc(id)}">${S.confirm === 'extra:' + id ? 'Tap again: not this session' : 'Not this session'}</button>`
      : cands.length ? `<span class="relink"><label for="rt-rl" hidden>Link to</label><select id="rt-rl">${cands.map(c => `<option value="${esc(c.id)}">${esc(fmtD(c.date))} · ${esc(c.title)}</option>`).join('')}</select><button class="btn sm" data-rt="relink" data-id="${esc(id)}">Link to plan</button></span>` : '';
    return `<div class="sec"><h3><span>What you did</span><span class="muted sub">${a.source === 'coros' ? 'COROS' : 'Entered by hand'}${a.name ? ' · ' + esc(a.name) : ''}${s && a.date !== s.date ? ' · run on ' + esc(fmtD(a.date)) : ''}</span></h3>
      <div class="facts"><div class="fact"><div class="k">Time</div><div class="v">${fmtT(a.durSec)}</div></div><div class="fact"><div class="k">Distance</div><div class="v">${(a.distKm || 0).toFixed(2)}<small> km</small></div></div><div class="fact"><div class="k">Avg pace</div><div class="v">${a.paceSec ? fmtP(a.paceSec) : '–'}</div></div><div class="fact"><div class="k">Avg HR</div><div class="v">${a.avgHr || '–'}</div></div><div class="fact"><div class="k">Max HR</div><div class="v">${a.maxHr || '–'}</div></div></div>
      ${rows ? `<div class="acts spread"><span class="eyebrow">${v === 'laps' ? 'Workout laps' : 'Kilometre splits'}</span>${seg}</div>${table}` : ''}
      <div style="margin-top:12px"><div class="eyebrow" style="margin-bottom:6px">How hard did it feel? Session RPE (1–10)${a.rpeSet ? '' : ' · planned ' + ((s && s.rpe) ?? '–')}</div>
        <div class="rpe2" role="group" aria-label="Session RPE">${Array.from({ length: 10 }, (_, i) => i + 1).map(n => `<button data-rt="rpe" data-id="${esc(id)}" data-v="${n}" aria-pressed="${!!a.rpeSet && Math.round(rpe) === n}">${n}</button>`).join('')}</div></div>
      <div style="margin-top:12px"><label class="eyebrow" for="rt-note">Notes for the coach</label><textarea class="note-in" id="rt-note" data-note="${esc(id)}" placeholder="Legs, sleep, weather, any niggles…">${esc(a.notes || '')}</textarea></div>
      <div class="acts">${link}<button class="btn sm danger" data-rt="unlink" data-id="${esc(id)}">${S.confirm === 'unlink:' + id ? 'Tap again to remove' : 'Remove this run'}</button></div></div>`;
  }
  function manualForm(id, s, a) {
    return `<div class="sec"><h3>Log the run</h3><form class="form" data-rtform="manual" data-id="${esc(id)}">
      <label for="rt-mdate">Date<input id="rt-mdate" name="date" type="date" value="${esc((a && a.date) || (s && s.date) || TODAY())}" required></label>
      <label for="rt-mdur">Time (h:mm:ss or mm:ss)<input id="rt-mdur" name="dur" inputmode="numeric" placeholder="${esc(s ? s.dur + ':00' : '45:00')}" required></label>
      <label for="rt-mdist">Distance (km)<input id="rt-mdist" name="dist" type="number" step="0.01" min="0" placeholder="8.0"></label>
      <label for="rt-mhr">Avg HR<input id="rt-mhr" name="hr" type="number" min="40" max="230" placeholder="145"></label>
      <label for="rt-mmax">Max HR<input id="rt-mmax" name="max" type="number" min="40" max="240" placeholder="170"></label>
      <label for="rt-mrpe">Session RPE (1–10)<input id="rt-mrpe" name="rpe" type="number" min="1" max="10" step="0.5" value="${esc((s && s.rpe) ?? 3)}"></label>
      <label class="wide" for="rt-mnotes">Notes<textarea id="rt-mnotes" name="notes" rows="2" placeholder="Reps, how it felt, anything odd"></textarea></label>
      <div class="acts wide"><button class="btn primary" type="submit">Save run</button><button class="btn" type="button" data-rt="form-cancel">Cancel</button></div></form></div>`;
  }
  function reviewHtml(id, s, a) {
    const done = a && a.status === 'done';
    const rv = a && a.review;
    return `<div class="sec rev"><h3><span>Coach review</span>${rv ? `<span class="muted sub">${esc(relTime(rv.at))}</span>` : ''}</h3>
      ${rv ? `<p class="verdict">${esc(rv.verdict)}</p>` : `<div class="empty">${done ? 'Send this run to Claude for a full review: laps against the plan, earlier sessions of the same kind, the pace-update rule, and whether anything coming up should change.' : 'Ask Claude about this session before you run it: moving it, shortening it, how to pace it.'}</div>`}
      <div class="acts"><button class="btn ${done ? 'gold' : ''}" data-rt="review" data-id="${esc(id)}">${done ? (rv ? 'Review again' : 'Review this workout') : 'Ask Claude about this session'}</button></div></div>`;
  }
  function raceSheet() {
    const body = shell('race', '<b>Log a race or test</b><span>Sets your fitness, paces and estimate</span>');
    if (body.__built) return; body.__built = true;
    body.innerHTML = `<div class="sec"><form class="form" data-rtform="race">
      <label for="rt-rdate">Date<input id="rt-rdate" name="date" type="date" value="${esc(TODAY())}" required></label>
      <label for="rt-rdist">Distance<select id="rt-rdist" name="dist"><option value="5">5 km</option><option value="10" selected>10 km</option><option value="21.0975">Half marathon</option><option value="other">Other (km)</option></select></label>
      <label for="rt-rkm">Other distance (km)<input id="rt-rkm" name="km" type="number" step="0.01" min="1" placeholder="8"></label>
      <label for="rt-rtime">Finish time<input id="rt-rtime" name="time" inputmode="numeric" placeholder="50:00" required></label>
      <label class="wide" for="rt-rnote">Note<input id="rt-rnote" name="note" placeholder="Race name, course, conditions"></label>
      <div class="wide notice" id="rt-rprev">Enter a finish time to see what it means for your paces.</div>
      <div class="acts wide"><button class="btn primary" type="submit">Save result</button><button class="btn" type="button" data-rt="close">Cancel</button></div></form></div>
      <div class="wnote" style="padding:0 4px">Use a real all-out race or the COROS test. A training run understates your fitness. The result updates the estimate and every pace in the plan.</div>`;
  }
  function raceInput() {
    const f = q('form[data-rtform="race"]'); if (!f) return null;
    const dv = f.dist.value, km = dv === 'other' ? Number(f.km.value) : Number(dv), sec = parseClock(f.time.value);
    if (!km || !sec || sec < km * 150 || sec > km * 720) return null;
    return { km, sec, date: f.date.value, note: f.note.value.trim(), vdot: vdotFrom(km * 1000, sec) };
  }
  function racePreview() {
    const el = q('#rt-rprev'); if (!el) return; const r = raceInput();
    if (!r) { el.textContent = 'Enter a finish time to see what it means for your paces.'; return; }
    const P = paceSet(r.vdot, meta().racePaceSec);
    el.innerHTML = `VDOT <b>${r.vdot.toFixed(1)}</b> · est. 10K <b>${esc(fmtT(raceTime(r.vdot)))}</b> · threshold <b>${fmtP(P.T)}</b>/km · easy ${fmtP(P.E[0])}–${fmtP(P.E[1])}/km`;
  }
  function candidates(date, exceptId) {
    return sessionList().filter(s => Math.abs(diffD(s.date, date)) <= 3 && !s.removed && !S.runs[s.id] && s.id !== exceptId)
      .sort((a, b) => Math.abs(diffD(a.date, date)) - Math.abs(diffD(b.date, date)));
  }
  function open(id) { S.open = id; S.form = null; S.confirm = null; layerKey = ''; drawLayer(); }
  function close() { S.open = null; S.form = null; S.confirm = null; drawLayer(); }

  /* ---------- prompts for Claude ---------- */
  const ATHLETE_FALLBACK = ['Background and injury notes: see meta.athlete in running/plan.json of the data repository.'];
  function rulesLine() { return 'ACWR (session RPE × minutes; this week ÷ average of the last 4 weeks incl. this one) ≤ 1.5, aim 1.0–1.3 · long run ≤ 1.10 × the longest run of the previous 30 days · pace-update rule: reps 2+ faster at the same HR, or the same pace ≥3–5 bpm lower (flat route, similar weather) → paces one step faster (≈5 s/km, +1 VDOT), at most one step per 4 weeks · lower-body gym on Wednesday straight after the run, never the day before a key run.'; }
  function repSummary(a, P) {
    const rows = a && a.laps && a.laps.length > 1 ? a.laps.filter(r => r.pace && r.pace < P.E[0] - 15) : [];
    return rows.length ? rows.map(r => `${fmtP(r.pace)}/${r.hr || '?'}`).join(', ') : '';
  }
  function reviewPrompt(id) {
    const s = SES.get(id) || null, a = runOf(id), P = curPaces(), fit = currentFit(), lm = loadModel(), M = meta();
    const done = a && a.status === 'done', L = [];
    L.push(done ? 'Review this run from my 10K sub-45 plan.' : 'Question about an upcoming session in my 10K sub-45 plan.', '');
    if (s) {
      L.push(`SESSION ${s.id} · ${fmtDY(s.date)} · week ${s.week}/18 (${(phaseOf(s.week) || {}).name || ''}) · ${s.label || KIND[s.kind]}: ${s.title}`);
      L.push(`Planned: ${s.durNote || s.dur} min ≈ ${sessionKm(s, P).toFixed(1)} km · planned RPE ${s.rpe}${s.gym ? ' · ' + s.gym : ''}${s.removed ? ' · REMOVED from the plan' : ''}`);
      for (const l of s.lines || []) L.push(`- ${l.k ? l.k + ': ' : ''}${linePlain(l.t, P)}`);
      if (s.note) L.push(`Note: ${s.note}`);
      if (s.edited) L.push(`Changed on ${String(s.edited.at).slice(0, 10)}: ${s.edited.reason || ''}`);
    } else L.push(`EXTRA RUN (not in the plan) · ${fmtDY(a.date)} · file running/runs/${id}.json`);
    if (done) {
      L.push('', `DONE (${a.source === 'coros' ? `COROS activity ${a.labelId}, sportType ${a.sportType || 100}` : 'entered by hand'}) on ${a.date}: ${fmtT(a.durSec)} · ${(a.distKm || 0).toFixed(2)} km · ${a.paceSec ? fmtP(a.paceSec) + '/km' : '?'} · avg HR ${a.avgHr || '?'} · max HR ${a.maxHr || '?'} · RPE ${a.rpeSet ? a.rpe : 'not given'}`);
      if (a.notes) L.push(`My notes: ${a.notes}`);
      const rows = a.laps && a.laps.length > 1 ? a.laps : a.splits || [];
      if (rows.length) { L.push(`${a.laps && a.laps.length > 1 ? 'Workout laps' : 'Km splits'} (# · km · time · pace · avg HR · max HR):`); rows.slice(0, 24).forEach(r => L.push(`${r.i} · ${(r.km || 0).toFixed(2)} · ${fmtT(r.sec)} · ${r.pace ? fmtP(r.pace) : '-'} · ${r.hr || '-'} · ${r.max || '-'}`)); }
      const g = gymOn(a.date);
      if (g.length) L.push(`Gym the same day: ${g.map(x => `${x.planName || 'session'}, ${(x.sets || []).filter(z => !z.warm).length} working sets, RPE ${x.rpe || '?'}`).join('; ')}`);
    } else if (a && a.status === 'skipped') L.push('', 'Marked as skipped.');
    L.push('', 'CONTEXT');
    L.push(`- Fitness: VDOT ${fit.vdot.toFixed(1)} (${fit.source}, ${fit.date}) → est. 10K ${fmtT(raceTime(fit.vdot))}. Goal sub-45 on ${fmtDY(M.raceDate)}.`);
    L.push(`- Current paces: easy ${fmtP(P.E[0])}–${fmtP(P.E[1])}, steady ${fmtP(P.ST[0])}–${fmtP(P.ST[1])}, threshold ${fmtP(P.T)}, 10K now ${fmtP(P.TK)}, interval ${fmtP(P.I)}, strides ~${fmtP(P.S)}, race pace ${fmtP(P.RP)} (min/km).`);
    const w = s ? s.week : (position().week || 1), wk = lm.weeks[w - 1], ws = weekStats(w, P);
    L.push(`- Week ${w}: planned ${ws.planMin} min, done ${Math.round(ws.doneMin)} min · ACWR ${wk.acwr.toFixed(2)} (uncoupled ${wk.unc.toFixed(2)}) · longest run ×${wk.ratio ? wk.ratio.toFixed(2) : '–'} of the 30-day max.`);
    if (s) {
      const comp = sessionList().filter(x => x.id !== s.id && x.kind === s.kind && x.date < s.date && S.runs[x.id] && S.runs[x.id].status === 'done').slice(-3);
      for (const x of comp) { const ax = S.runs[x.id]; const reps = repSummary(ax, P); L.push(`- Earlier ${KIND[x.kind].toLowerCase()}: ${x.id} ${fmtD(x.date)} ${x.title} · ${fmtT(ax.durSec)}, ${(ax.distKm || 0).toFixed(1)} km, ${ax.paceSec ? fmtP(ax.paceSec) : '?'}/km, ${ax.avgHr || '?'} bpm, RPE ${ax.rpeSet ? ax.rpe : '?'}${reps ? ` · reps (pace/HR): ${reps}` : ''}`); }
    }
    const up = sessionList().filter(x => x.date >= TODAY() && x.id !== id && !['done', 'skipped', 'removed'].includes(status(x))).slice(0, 5);
    if (up.length) L.push(`- Next sessions: ${up.map(x => `${x.id} ${fmtD(x.date)} ${x.title} ${x.dur} min RPE ${x.rpe}`).join(' · ')}`);
    L.push(`- Rules: ${rulesLine()}`);
    const ph = s ? phaseOf(s.week) : null;
    if (ph) L.push(`- ${ph.name} phase rules: ${(ph.rules || []).join(' ')}`);
    L.push(`- About me: ${(M.athlete || ATHLETE_FALLBACK).join(' ')}`);
    L.push('', 'WHAT I WANT');
    if (done) {
      if (a.source === 'coros') L.push(`1. Pull fresh data from COROS first (queryActivityLapData with labelId ${a.labelId}, sportType ${a.sportType || 100}) and trust it over the numbers above if they differ.`);
      else L.push('1. I entered this run by hand. If it is on COROS (querySportRecords for that date), use the COROS laps.');
      L.push('2. Review it: a 1–2 sentence verdict; a short table of the key reps or laps (pace, avg HR, max HR); what stands out (intended intensity, pacing or fade, HR drift, easy runs really easy; ignore obvious sensor glitches); one thing to watch. Compare with the earlier sessions of the same kind.');
      L.push('3. Say whether the pace-update rule is met.');
      L.push('4. If an upcoming session should change, name it by id and say exactly how and why, within the limits above. Only after I confirm: edit that session in running/plan.json in my private repo DesneuxFlorian/gym-data and add an entry to running/changes.json (formats in that repo\'s README).');
      L.push(`5. If you can write to that repo, save your verdict as "review": {"at": "<ISO time>", "verdict": "<1–2 sentences>"} in running/runs/${id}.json so my Gym Log app shows it.`);
    } else {
      L.push('Answer my question below within the rules above. If the session should change, name it by id and say exactly how; only after I confirm, edit running/plan.json in DesneuxFlorian/gym-data and log it in running/changes.json.', '', 'My question: ');
    }
    if (done) L.push('Keep it short: I read on my phone. Pace in min/km, HR in bpm.');
    return L.join('\n');
  }
  function importPrompt() {
    const st = S.status, from = st && st.lastImport ? addD(st.lastImport, -2) : addD(TODAY(), -7);
    return ['Import my recent COROS runs into my Gym Log app (Run tab).', '',
      `1. Attach my private repo DesneuxFlorian/gym-data with push access, clone it and read the Running section of README.md.`,
      `2. querySportRecords from ${from.replaceAll('-', '')} to today, sport types 100–103.`,
      '3. For every run whose labelId is not already in running/runs/*.json: get queryActivityLapData (labelId, sportType), save the JSON to a temp file and run scripts/import_run.py add with the record fields and --laps <file>. It links the run to the planned session or saves it as an extra run.',
      '4. queryFitnessAssessmentOverview, then scripts/import_run.py status with the imported ids and the COROS predictions.',
      '5. Commit "Import runs <date>" and push to main (fetch and rebase first). Change nothing else.',
      '6. Tell me in one line which runs you added and to which sessions.'].join('\n');
  }

  /* ---------- history rows for app.js ---------- */
  function historyItems() {
    return Object.entries(S.runs).filter(([, a]) => a.status === 'done').map(([id, a]) => {
      const s = SES.get(id);
      const el = document.createElement('button');
      el.className = 'card runrow'; el.dataset.rt = 'open'; el.dataset.id = id;
      el.innerHTML = `<div class="row"><span class="kdot" style="--k:var(--rk-${esc(s ? s.kind : 'extra')})"></span><strong class="grow">${esc(s ? 'Run · ' + s.title : a.name || 'Run')} · ${esc(fmtDY(a.date))}</strong>${a.review ? '<span class="tiny" style="color:var(--done);font-weight:700">REVIEWED</span>' : ''}</div>
        <div class="muted small">${esc([fmtT(a.durSec), (a.distKm || 0).toFixed(2) + ' km', a.paceSec ? fmtP(a.paceSec) + '/km' : null, a.avgHr ? a.avgHr + ' bpm' : null, a.rpeSet ? 'RPE ' + a.rpe : null].filter(Boolean).join(' · '))}</div>
        ${s ? `<div class="small" style="color:var(--ink2)">Week ${s.week} · ${esc(s.label || KIND[s.kind])}</div>` : ''}`;
      return { key: a.date + 'T23:59', el };
    });
  }
  function weekRunsFor(dateIso) {
    if (!S.plan) return '';
    const d = String(dateIso).slice(0, 10), ws = addD(d, -((pd(d).getDay() + 6) % 7)), we = addD(ws, 6);
    const P = curPaces();
    const xs = sessionList().filter(s => s.date >= ws && s.date <= we).map(s => { const a = S.runs[s.id]; return `${fmtD(s.date)} ${s.title} (${a && a.status === 'done' ? `done: ${fmtT(a.durSec)}, RPE ${a.rpeSet ? a.rpe : '?'}` : status(s)})`; });
    const ex = extras().filter(a => a.date >= ws && a.date <= we).map(a => `${fmtD(a.date)} extra run ${fmtT(a.durSec)}`);
    const nx = sessionList().find(s => s.date > d && !s.removed && ['thr', 'vo2', 'pace', 'test', 'race', 'long'].includes(s.kind));
    const out = [];
    if (xs.length || ex.length) out.push(`Runs that week: ${xs.concat(ex).join('; ')}.`);
    if (nx) out.push(`Next key run: ${fmtD(nx.date)} ${nx.title} (${nx.dur} min, ${nx.lines.map(l => linePlain(l.t, P)).join(', ')}).`);
    return out.join(' ');
  }

  /* ---------- events ---------- */
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-rt]'); if (!el) return;
    const act = el.dataset.rt, id = el.dataset.id;
    if (!['unlink', 'revert', 'make-extra'].includes(act)) S.confirm = null;
    switch (act) {
      case 'tab': S.view = el.dataset.v; persistRT(); draw(); q('#main').scrollTop = 0; break;
      case 'sync': syncAll(); break;
      case 'open': open(id); break;
      case 'close': close(); break;
      case 'manual': S.form = { type: 'manual', id }; drawLayer(); break;
      case 'form-cancel': S.form = null; draw(); break;
      case 'skip': putRun(id, { sessionId: id, status: 'skipped', source: 'manual', date: (SES.get(id) || {}).date || TODAY(), notes: '', at: nowIso() }); break;
      case 'unlink': { const k = 'unlink:' + id; if (S.confirm !== k) { S.confirm = k; drawLayer(); break; } S.confirm = null; delRun(id); if (!SES.has(id)) close(); break; }
      case 'make-extra': { const k = 'extra:' + id; if (S.confirm !== k) { S.confirm = k; drawLayer(); break; } S.confirm = null;
        const a = S.runs[id]; const nid = 'x-' + (a.labelId || Date.now().toString(36)); delRun(id); putRun(nid, { ...a, sessionId: null }); open(nid); break; }
      case 'relink': { const sel = q('#rt-rl'); if (!sel) break; const sid = sel.value, a = S.runs[id]; delRun(id); putRun(sid, { ...a, sessionId: sid, rpe: a.rpeSet ? a.rpe : (SES.get(sid) || {}).rpe || a.rpe }); open(sid); break; }
      case 'lapview': S.lapView[id] = el.dataset.v; drawLayer(); break;
      case 'rpe': patchRun(id, { rpe: Number(el.dataset.v), rpeSet: true }); break;
      case 'review': { const s = SES.get(id), a = S.runs[id]; promptSheet(a && a.status === 'done' ? 'Review this workout' : 'Ask Claude', reviewPrompt(id), { what: s ? `${fmtD(s.date)} · ${s.title}` : (a && a.name) || 'Run' }); break; }
      case 'import-now': promptSheet('Import runs now', importPrompt(), { what: 'COROS → Gym Log' }); break;
      case 'race-open': open('__race'); break;
      case 'rp-edit': S.form = { type: 'rp' }; draw(); break;
      case 'revert': {
        const k = 'revert:' + id; if (S.confirm !== k) { S.confirm = k; draw(); break; } S.confirm = null;
        const c = S.changes.find(x => x.id === id), s = c && SES.get(c.sessionId); if (!c || !s) break;
        const before = { ...c.before, week: s.week, day: s.day, date: s.date }; delete before.id;
        setSession(s.id, before);
        addChange({ at: nowIso(), type: 'session', sessionId: s.id, summary: 'Reverted: ' + (c.summary || 'change'), reason: 'Undone in Gym Log', by: 'you', revertOf: c.id });
        toast('Change reverted'); break;
      }
    }
  });
  document.addEventListener('focusout', ev => {
    const id = ev.target.dataset && ev.target.dataset.note; if (!id) return;
    const a = S.runs[id], v = ev.target.value.trim(); if (!a || (a.notes || '') === v) return;
    patchRun(id, { notes: v });
  });
  document.addEventListener('input', ev => { if (ev.target.closest('form[data-rtform="race"]')) racePreview(); });
  document.addEventListener('change', ev => { if (ev.target.closest('form[data-rtform="race"]')) racePreview(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && S.open && !document.querySelector('.sheet')) close(); });
  document.addEventListener('submit', ev => {
    const f = ev.target, kind = f.dataset && f.dataset.rtform; if (!kind) return;
    ev.preventDefault();
    if (kind === 'manual') {
      const id = f.dataset.id, sec = parseClock(f.dur.value), km = Number(f.dist.value) || 0;
      if (!sec) return toast('Enter the time as mm:ss or h:mm:ss');
      S.form = null;
      putRun(id, { sessionId: SES.has(id) ? id : null, status: 'done', source: 'manual', name: 'Entered by hand', date: f.date.value || TODAY(), durSec: sec, distKm: km,
        paceSec: km ? sec / km : null, avgHr: Number(f.hr.value) || null, maxHr: Number(f.max.value) || null, rpe: clamp(Number(f.rpe.value) || 3, 1, 10), rpeSet: !!f.rpe.value,
        notes: f.notes.value.trim(), laps: [], splits: [], importedAt: nowIso() });
    } else if (kind === 'race') {
      const r = raceInput(); if (!r) return toast('Check the distance and the finish time');
      addFitness({ date: r.date, vdot: Math.round(r.vdot * 10) / 10, source: 'race', note: `${r.km} km in ${fmtT(r.sec)}${r.note ? ' · ' + r.note : ''}`, at: nowIso() });
      toast(`Saved: VDOT ${r.vdot.toFixed(1)}, est. 10K ${fmtT(raceTime(r.vdot))}`); close();
    } else if (kind === 'rp') {
      const sec = parseClock(f.rp.value); if (!sec || sec < 200 || sec > 420) return toast('Race pace must look like 4:30');
      const before = meta().racePaceSec; S.form = null;
      setMeta({ racePaceSec: sec });
      addChange({ at: nowIso(), type: 'pace', summary: `Race pace ${fmtP(before || 270)} → ${fmtP(sec)}/km`, reason: 'Set by hand', by: 'you' });
    }
  });
  addEventListener('resize', () => { clearTimeout(RT._rs); RT._rs = setTimeout(() => view === 'run' && draw(), 150); });

  return { render, draw, sync, pendingCount, historyItems, weekRunsFor, open, hasPlan: () => !!S.plan, lastPulled: () => S.pulled,
    _test: { loadModel, paceSet, raceTime, vdotFrom, fmtT, fmtP, reviewPrompt, importPrompt, S, refresh } };
})();
