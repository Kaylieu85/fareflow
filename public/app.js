/* FareFlow client — fleet channel manager SPA ------------------------------------ */
const S = { state: null, route: 'diary', weekOffset: 0, driverFilter: 'all', es: null, serverTimeOffset: 0, authed: false, me: null, connDriver: null, reqQueue: [] };
const EXTRA_CH = { manual: { id: 'manual', name: 'Manual block', color: '#94A3B8' } };
/* driver duty statuses — Accepting is the only one that receives routed offers */
const DRV_STATUS = {
  online:     { label: 'Accepting',  icon: '🟢', pill: 'ok',   mapColor: null },
  on_job:     { label: 'On job',     icon: '🚕', pill: 'info', mapColor: '#3B82F6' },
  break:      { label: 'On break',   icon: '☕', pill: 'warn', mapColor: '#A78BFA' },
  offline:    { label: 'Offline',    icon: '⚫', pill: 'mut',  mapColor: '#3D5478' },
  on_journey: { label: 'On journey', icon: '🚗', pill: 'warn', mapColor: '#FBBF24' },
};
const drvStatus = (d) => DRV_STATUS[d && d.status] || DRV_STATUS.offline;

/* ------------------------------------------------------------------ helpers */
const $ = (sel, el = document) => el.querySelector(el ? sel : sel);
const GBP = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n || 0);
const fmtHM = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDay = (ts) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ch = (id) => (S.state && S.state.channels[id]) || EXTRA_CH[id] || { id, name: id, color: '#888' };
const drv = (id) => (S.state && S.state.drivers.find((d) => d.id === id)) || null;
const drvName = (id) => id === 'all' ? 'Whole fleet' : (drv(id) ? drv(id).name : '—');
const drvFirst = (id) => { const d = drv(id); return d ? d.name.split(' ')[0] : '—'; };
const drvInit = (id) => { const d = drv(id); return d ? d.name.split(' ').map((w) => w[0]).slice(0, 2).join('') : 'FF'; };
const drvColor = (id) => (drv(id) ? drv(id).color : '#64748B');
const onlineDrivers = () => S.state.drivers.filter((d) => d.status === 'online');
const blocks = () => Object.values(S.state.blocks);
const nowMs = () => Date.now() + S.serverTimeOffset;
function startOfWeek(off = 0) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + off * 7);
  return d;
}
const DAY_MIN = 6 * 60, DAY_SPAN = 18 * 60, HOUR_PX = 48;
const yOf = (ts) => {
  const d = new Date(ts);
  return Math.max(0, Math.min(DAY_SPAN, d.getHours() * 60 + d.getMinutes() - DAY_MIN)) / 60 * HOUR_PX;
};
function timeLabel(ts) {
  const d = new Date(ts), t = new Date();
  const sameDay = d.toDateString() === t.toDateString();
  const tom = new Date(t); tom.setDate(tom.getDate() + 1);
  if (sameDay) return 'Today ' + fmtHM(ts);
  if (d.toDateString() === tom.toDateString()) return 'Tomorrow ' + fmtHM(ts);
  return fmtDay(ts) + ' ' + fmtHM(ts);
}
function driverClashLocal(driverId, startTs, endTs) {
  return blocks().find((b) => (b.driverId === driverId || b.driverId === 'all') &&
    (b.status === 'confirmed' || b.status === 'in-progress' || b.status === 'on_journey') &&
    new Date(startTs) < new Date(b.end) && new Date(endTs) > new Date(b.start));
}

/* ------------------------------------------------------------------- api */
async function api(path, method = 'GET', body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000); // never hang forever — free hosts nap between visits
  let res;
  try {
    res = await fetch(path, {
      method, signal: ctl.signal, headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const err = new Error(e.error || res.statusText);
    err.status = res.status;
    if (res.status === 401 || e.error === 'auth') {
      err.auth = true;
      if (S.authed) { S.authed = false; setTimeout(() => showLogin(), 0); }
    }
    throw err;
  }
  return res.json();
}
let refreshTimer = null;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      const { state, serverTime, me } = await api('/api/state');
      S.serverTimeOffset = new Date(serverTime) - Date.now();
      S.state = state; S.me = me;
      // drop queued request popups that were answered elsewhere / expired
      const before = S.reqQueue[0] && S.reqQueue[0].id;
      S.reqQueue = S.reqQueue.filter((q) => { const live = state.requests[q.id]; return !live || live.status === 'pending'; });
      if (before && !(S.reqQueue[0] && S.reqQueue[0].id === before)) { const root = document.getElementById('reqPopRoot'); if (root) root.dataset.open = ''; showNextReq(); }
      render();
    } catch (e) { if (!(e && e.auth)) setConn(false); }
  }, 120);
}
function setConn(on) {
  $('#connDot').className = 'dot ' + (on ? 'on' : 'off');
  $('#connText').textContent = on ? 'live' : 'reconnecting…';
}
function setupSSE() {
  try {
    const es = new EventSource('/api/events');
    S.es = es;
    es.onopen = () => setConn(true);
    es.onerror = () => setConn(false);
    es.addEventListener('state', () => refresh());
    es.addEventListener('booking', (e) => { try { popBooking(JSON.parse(e.data)); } catch {} });
    es.addEventListener('request', (e) => { try { queueRequest(JSON.parse(e.data)); } catch {} });
    es.addEventListener('log', (e) => {
      const entry = JSON.parse(e.data);
      if (['ok', 'warn', 'err'].includes(entry.level)) toast(entry.msg, entry.level);
    });
  } catch (e) { /* noop */ }
}
setInterval(() => { if (S.state) api('/api/state').then(({ state, serverTime }) => { S.state = state; S.serverTimeOffset = new Date(serverTime) - Date.now(); render(); }).catch(() => {}); }, 25000);

/* ---------------------------------------------------------------- toasts */
function toast(msg, level = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + level;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 4200);
}

/* ------------------------------------------------ real-time booking popups */
function chime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = chime.ac || (chime.ac = new AC());
    if (ac.state === 'suspended') ac.resume();
    const t0 = ac.currentTime;
    [[880, 0], [1174.6, 0.12], [1568, 0.24]].forEach(([f, dt]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + dt);
      g.gain.linearRampToValueAtTime(0.16, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + 0.5);
      o.connect(g).connect(ac.destination);
      o.start(t0 + dt); o.stop(t0 + dt + 0.55);
    });
  } catch {}
}
function notifySystem(b) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
    const n = new Notification(`🚕 New ${b.channel} booking — £${(+b.fare || 0).toFixed(2)}`, {
      body: `${b.rider}\n${b.pickup} → ${b.dropoff}\n${b.driver} · pickup ${fmtHM(b.start)}`,
      icon: '/icons/icon-192.png', tag: 'booking-' + b.id,
    });
    n.onclick = () => { try { window.focus(); } catch {} jumpToBooking(b.id, b.start); };
  } catch {}
}
function requestNotify() {
  if (!('Notification' in window)) return toast('This browser has no notification support', 'warn');
  if (Notification.permission === 'granted') return toast('🔔 Booking alerts are on for this device', 'ok');
  if (Notification.permission === 'denied') return toast('Notifications are blocked — allow them in browser site settings', 'err');
  Notification.requestPermission().then((p) => {
    toast(p === 'granted' ? '🔔 Booking alerts will pop on this device' : 'Notifications not enabled', p === 'granted' ? 'ok' : 'warn');
  });
}
function jumpToBooking(id, start) {
  const day = new Date(start), today = new Date();
  day.setHours(0, 0, 0, 0); today.setHours(0, 0, 0, 0);
  S.weekOffset = Math.round((day - today) / (7 * 86400000));
  if (location.hash !== '#/diary') location.hash = '#/diary'; else setRoute();
  render();
  openBlockModal(id);
}
function popBooking(b) {
  if (!S.state || !b || !b.id) return;
  chime();
  if (navigator.vibrate) try { navigator.vibrate([90, 40, 90]); } catch {}
  notifySystem(b);
  toast(`🚕 New ${b.channel} booking — ${b.rider}, £${(+b.fare || 0).toFixed(2)}`, 'ok');
  const root = document.getElementById('bookPops');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'book-pop';
  el.style.setProperty('--bp', b.color || '#38BDF8');
  el.innerHTML = `
    <div class="bp-head"><span class="bp-pill">${esc(b.channel)}</span><span class="bp-via">${b.via === 'auto' ? '⚡ auto-accepted' : b.via === 'direct' ? '📞 direct booking' : '✓ just accepted'}</span><button class="bp-x" aria-label="Dismiss">✕</button></div>
    <div class="bp-main">
      <div class="bp-fare">£${(+b.fare || 0).toFixed(2)}</div>
      <div class="bp-who"><b>${esc(b.rider)}</b> → driver ${esc(b.driver)}</div>
      <div class="bp-route">${esc(b.pickup)} → ${esc(b.dropoff)}</div>
      <div class="bp-when">${fmtDay(b.start)} · pickup ${fmtHM(b.start)}${b.distanceMi ? ` · ${b.distanceMi} mi` : ''}${b.code ? ` · pickup code <b>${esc(String(b.code))}</b>` : ''}</div>
    </div>
    <div class="bp-actions">${(() => {
      const live = S.state.blocks[b.id];
      const d = live && drv(live.driverId);
      const canStart = live && live.kind === 'booking' && live.driverId !== 'all' && d && d.status !== 'on_journey'
        && (live.status === 'confirmed' || live.status === 'in-progress')
        && ((S.me && S.me.driverId === live.driverId) || isAdmin());
      return canStart ? `<button class="bp-view">▶ Start journey — navigate</button>` : `<button class="bp-view">Open in diary →</button>`;
    })()}</div>
    <div class="bp-bar"><i></i></div>`;
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 380); };
  el.querySelector('.bp-x').onclick = kill;
  el.querySelector('.bp-view').onclick = () => {
    kill();
    const live = S.state.blocks[b.id];
    if (el.querySelector('.bp-view').textContent.startsWith('▶')) { if (live) startJourney(b.id); }
    else jumpToBooking(b.id, b.start);
  };
  root.appendChild(el);
  setTimeout(() => { if (el.isConnected) kill(); }, 14000);
}

/* --------------------------------------------------- journey mode (safety lock) */
const myDriver = () => (S.me && S.me.driverId && S.state) ? S.state.drivers.find((d) => d.id === S.me.driverId) || null : null;
const isAdmin = () => !!(S.me && !S.me.driverId);
function journeyBlock() {
  if (!S.state) return null;
  const d = myDriver();
  if (d && d.status === 'on_journey' && d.journeyBlockId) {
    const b = S.state.blocks[d.journeyBlockId];
    if (b && b.status === 'on_journey') return b;
  }
  if (isAdmin()) {
    /* fleet/admin console mirrors the journey it started (fallback: any live journey, e.g. for demo playback) */
    const js = Object.values(S.state.blocks).filter((b) => b.kind === 'booking' && b.status === 'on_journey');
    return js.find((b) => b.journey && b.journey.startedBy === S.me.id) || js[0] || null;
  }
  return null;
}
const journeyActive = () => !!journeyBlock();
const placeQ = (p) => (p ? [p.n, p.pc].filter(Boolean).join(', ') : '');
const navUrl = (p) => 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(placeQ(p));
const appleNavUrl = (p) => 'https://maps.apple.com/?dirflg=d&daddr=' + encodeURIComponent(placeQ(p));
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(ss).padStart(2, '0');
}
async function startJourney(id) {
  const b = S.state.blocks[id];
  if (!b) return;
  /* gesture-safe: open navigation first, then flip server state (journey screen also has a nav button) */
  try { window.open(navUrl(b.pickup || b.dropoff), '_blank'); } catch {}
  try {
    await api(`/api/blocks/${id}/journey/start`, 'POST');
    closeModal();
    toast('🚗 Journey started — everything else is locked. Drive safe!', 'ok');
  } catch (e) { toast(e.message, 'err'); }
  refresh();
}
async function journeyLeg(id) {
  const b = S.state.blocks[id];
  if (!b) return;
  try { window.open(navUrl(b.dropoff), '_blank'); } catch {}
  try { await api(`/api/blocks/${id}/journey/leg`, 'POST', { leg: 'to_dropoff' }); toast('✓ Rider on board — heading to drop-off', 'ok'); } catch (e) { toast(e.message, 'err'); }
  refresh();
}
async function completeJourney(id) {
  try {
    await api(`/api/blocks/${id}/journey/complete`, 'POST');
    chime();
    if (navigator.vibrate) try { navigator.vibrate([120, 50, 120]); } catch {}
    toast('✅ Job complete — you’re back online and receiving jobs', 'ok');
  } catch (e) { toast(e.message, 'err'); }
  refresh();
}
async function abortJourney(id) {
  if (!confirm('End this journey early? (rider no-show, job fell through…)\nThe job goes back to “confirmed” so you can restart it — or cancel it from the diary once unlocked.')) return;
  try { await api(`/api/blocks/${id}/journey/abort`, 'POST'); toast('Journey ended — job is back to confirmed', 'warn'); } catch (e) { toast(e.message, 'err'); }
  refresh();
}
/* keep the screen awake while driving so navigation stays visible */
let wakeLock = null;
async function acquireWakeLock() {
  try {
    if (!('wakeLock' in navigator) || wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {}
}
function releaseWakeLock() { try { if (wakeLock) wakeLock.release(); } catch {} wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && journeyActive()) acquireWakeLock(); });
let jlTimer = null;
function renderJourneyLock() {
  const root = document.getElementById('journeyLock');
  if (!root) return;
  const b = journeyBlock();
  clearInterval(jlTimer); jlTimer = null;
  if (!b) { root.innerHTML = ''; root.classList.add('hidden'); releaseWakeLock(); return; }
  root.classList.remove('hidden');
  const c = ch(b.channelId);
  const j = b.journey || {};
  const leg = j.leg === 'to_dropoff' ? 'to_dropoff' : 'to_pickup';
  const target = leg === 'to_dropoff' ? b.dropoff : b.pickup;
  const startedAt = j.startedAt ? new Date(j.startedAt).getTime() : Date.now();
  const stop = (p, lbl, nowLeg) => p ? `<div class="jl-stop${leg === nowLeg ? ' now' : ''}">
      <i class="jl-dot ${nowLeg === 'to_pickup' ? 'a' : 'b'}"></i>
      <div><div class="jl-lbl">${lbl}${leg === nowLeg ? ' <span class="jl-nowtag">HEADING HERE</span>' : leg !== nowLeg && nowLeg === 'to_pickup' ? ' <span class="jl-donetag">✓ done</span>' : ''}</div>
      <div class="jl-place">${esc(p.n || '')}</div>${p.pc ? `<div class="jl-pc">${esc(p.pc)}</div>` : ''}</div></div>` : '';
  root.innerHTML = `<div class="jl-screen" style="--jl:${c.color}" role="alertdialog" aria-label="On journey — app locked for safety">
    <div class="jl-inner">
      <div class="jl-badge"><span class="jl-pulse"></span>🚗 ON JOURNEY</div>
      <div class="jl-elapsed">${fmtElapsed(Date.now() - startedAt)}</div>
      <div class="jl-sub">${esc(c.name)}${b.fare ? ' · ' + GBP(b.fare) : ''} · ${esc(b.rider || 'Rider')}</div>
      <div class="jl-route">
        ${stop(b.pickup, leg === 'to_pickup' ? 'PICKUP' : 'PICKUP', 'to_pickup')}
        ${stop(b.dropoff, 'DROP-OFF', 'to_dropoff')}
      </div>
      ${target ? `<a class="jl-nav" href="${navUrl(target)}" target="_blank" rel="noopener">🧭 Navigate to ${leg === 'to_dropoff' ? 'drop-off' : 'pickup'} (Google Maps)</a>` : ''}
      ${target ? `<a class="jl-apple" href="${appleNavUrl(target)}" target="_blank" rel="noopener">Open in Apple Maps instead →</a>` : ''}
      ${leg === 'to_pickup'
        ? `<button class="jl-leg" onclick="journeyLeg('${b.id}')">✓ Rider on board — navigate to drop-off</button>`
        : ''}
      <button class="jl-complete" onclick="completeJourney('${b.id}')">🏁 ${leg === 'to_dropoff' ? 'Arrived — complete job · back online' : 'Complete job · back online'}</button>
      ${b.code && !b.pickupVerifiedAt && leg === 'to_pickup' ? `<div class="jl-code">Rider pickup code <b>${esc(String(b.code))}</b></div>` : ''}
      <div class="jl-note">🔒 Everything else is locked while you drive. New job offers still pop up — you get <b>20 seconds</b> to accept.</div>
      <button class="jl-abort" onclick="abortJourney('${b.id}')">Problem? End journey early</button>
    </div>
  </div>`;
  acquireWakeLock();
  jlTimer = setInterval(() => {
    const el = root.querySelector('.jl-elapsed');
    if (!el || !journeyActive()) { clearInterval(jlTimer); jlTimer = null; return; }
    el.textContent = fmtElapsed(Date.now() - startedAt);
  }, 1000);
}

/* ------------------------- incoming request modal (centre-screen respond) */
function queueRequest(r) {
  if (!S.state || !r || !r.id) return;
  if (S.reqQueue.some((q) => q.id === r.id)) return;
  const live = S.state.requests[r.id];
  if (live && live.status !== 'pending') return;
  r._ttlMs = Math.max(5000, new Date(r.expiresAt) - Date.now() + (S.serverTimeOffset || 0));
  if (journeyActive() && r._ttlMs > 20000) { r._ttlMs = 20000; r._quick = true; } /* safety: 20s accept window while driving */
  r._t0 = Date.now();
  S.reqQueue.push(r);
  chime(); setTimeout(chime, 450);
  if (navigator.vibrate) try { navigator.vibrate([160, 60, 160, 60, 160]); } catch {}
  toast(`📲 ${r.channel} request for ${r.driver} — tap to respond`, 'ok');
  showNextReq();
}
function showNextReq() {
  const root = document.getElementById('reqPopRoot');
  if (!root) return;
  const r = S.reqQueue[0];
  if (!r) { root.innerHTML = ''; root.dataset.open = ''; return; }
  if (root.dataset.open === r.id) return;
  root.dataset.open = r.id;
  const other = S.reqQueue.length - 1;
  root.innerHTML = `<div class="rq-back">
    <div class="rq-card" style="--rq:${r.color || '#38BDF8'}" role="alertdialog" aria-label="Incoming ${esc(r.channel)} request">
      <div class="rq-top">
        <span class="rq-pill">${esc(r.channel)}</span>
        ${r.asap ? '<span class="rq-asap">🔥 ASAP pickup</span>' : ''}
        <span class="rq-mini">${other ? `+${other} more waiting` : ''}</span>${r._quick ? '<span class="rq-jtag">⚡ <span class="rq-cd">20s</span> — on journey</span>' : ''}<span class="rq-live">● LIVE</span>
      </div>
      <div class="rq-fare">£${(+r.fare || 0).toFixed(2)}</div>
      <div class="rq-line"><b>${esc(r.rider)}</b> · offered to <b>${esc(r.driver)}</b></div>
      <div class="rq-route"><div><i class="rq-dot a"></i>${esc(r.pickup)}</div><div><i class="rq-dot b"></i>${esc(r.dropoff)}</div></div>
      <div class="rq-meta">${fmtDay(r.pickupAt)} · pickup ${fmtHM(r.pickupAt)} · ${r.distanceMi || '?'} mi · ~${r.durationMin || '?'} min${r.distanceMi && r.fare ? ` · £${(r.fare / r.distanceMi).toFixed(2)}/mi` : ''}</div>
      <div class="rq-code">Pickup code for this job <b>${esc(String(r.code || '—'))}</b></div>
      <div class="rq-btns">
        <button class="rq-dec" onclick="respondReq('${r.id}', false)">✕ Decline</button>
        <button class="rq-acc" onclick="respondReq('${r.id}', true)">✓ Accept · blocks all apps</button>
      </div>
      <div class="rq-ttl"><i></i></div>
    </div>
  </div>`;
  tickTtl(r);
}
function tickTtl(r) {
  const root = document.getElementById('reqPopRoot');
  if (!root || !S.reqQueue[0] || S.reqQueue[0].id !== r.id) return;
  const remain = Math.max(0, r._ttlMs - (Date.now() - r._t0));
  const bar = root.querySelector('.rq-ttl i');
  if (bar) bar.style.width = (remain / r._ttlMs * 100).toFixed(1) + '%';
  const cd = root.querySelector('.rq-cd');
  if (cd) cd.textContent = Math.ceil(remain / 1000) + 's';
  if (remain <= 0) { /* while driving, a timed-out offer is declined so nothing lingers */ if (journeyActive()) respondReq(r.id, false); else dismissReq(r.id, true); return; }
  setTimeout(() => tickTtl(r), 250);
}
function dismissReq(id, expired) {
  const idx = S.reqQueue.findIndex((q) => q.id === id);
  if (idx >= 0) S.reqQueue.splice(idx, 1);
  const root = document.getElementById('reqPopRoot');
  if (root) root.dataset.open = '';
  if (expired) toast('That offer timed out', 'warn');
  showNextReq();
}
async function respondReq(id, accept) {
  dismissReq(id);
  try { await api(`/api/requests/${id}/${accept ? 'accept' : 'decline'}`, 'POST'); }
  catch (e) { toast(e.message, 'err'); }
  refresh();
}

/* ----------------------------------------------------------------- modal */
function openModal(html) {
  $('#modalRoot').innerHTML = `<div class="modal-back" onclick="if(event.target===this)closeModal()"><div class="modal" role="dialog">${html}</div></div>`;
}
function closeModal() { $('#modalRoot').innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ============================================================== RENDERING */
function render() {
  if (!S.state || !S.authed) return;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === S.route));
  const pending = Object.values(S.state.requests).filter((r) => r.status === 'pending');
  const badge = $('#reqBadge');
  badge.textContent = pending.length; badge.classList.toggle('hidden', !pending.length);
  const online = Object.values(S.state.channels).some((c) => c.id !== 'direct' && c.status === 'connected');
  const mb = $('#masterBtn');
  mb.textContent = online ? 'Go offline everywhere' : 'Back online everywhere';
  mb.className = 'master ' + (online ? 'online-state' : 'offline-state');
  const sc = document.getElementById('statusChipWrap');
  if (sc) {
    const meD = myDriver();
    if (!meD) { sc.innerHTML = ''; }
    else {
      const st = drvStatus(meD);
      const breakLeft = meD.status === 'break' && meD.breakUntil ? ' · back ' + fmtHM(meD.breakUntil) : '';
      sc.innerHTML = `<button class="duty-chip ${meD.status}" id="statusChip" onclick="openStatusPicker()" title="Your duty status — tap to change">${st.icon} ${st.label}${breakLeft} ▾</button>`;
    }
  }
  const uc = document.getElementById('userChip');
  if (uc) uc.innerHTML = S.me
    ? `<span class="user-chip" onclick="openProfile()" title="Your profile — FAQ, how-to, support">
         <span class="avatar" style="width:26px;height:26px;font-size:10px;background:${S.me.driverId ? drvColor(S.me.driverId) : '#38BDF8'}">${esc(S.me.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>
         <span class="uc-name">${esc(S.me.name.split(' ')[0])}</span>
       </span>
       <button class="logout-btn" onclick="logout()" title="Sign out">⏻</button>` : '';
  const view = $('#view');
  if (S.route === 'diary') view.innerHTML = renderDiary();
  else if (S.route === 'requests') view.innerHTML = renderRequests();
  else if (S.route === 'map') view.innerHTML = renderMap();
  else if (S.route === 'demand') { view.innerHTML = renderDemand(); ensureDemand(); }
  else if (S.route === 'fleet') view.innerHTML = renderFleet();
  else if (S.route === 'channels') view.innerHTML = renderChannels();
  else if (S.route === 'messages') view.innerHTML = renderMessages();
  else if (S.route === 'earnings') view.innerHTML = renderEarnings();
  else if (S.route === 'api') view.innerHTML = renderApi();
  else if (S.route === 'settings') view.innerHTML = renderSettings();
  else if (S.route === 'faq') view.innerHTML = renderFaq();
  else if (S.route === 'howto') view.innerHTML = renderHowto();
  else if (S.route === 'support') view.innerHTML = renderSupport();
  positionNowLine();
  renderJourneyLock();
}
function driverFilterChips() {
  return `<div class="drv-filters">
    <span class="drv-f ${S.driverFilter === 'all' ? 'on' : ''}" onclick="setDriverFilter('all')">👥 Everyone</span>
    ${S.state.drivers.map((d) => `<span class="drv-f ${S.driverFilter === d.id ? 'on' : ''}" onclick="setDriverFilter('${d.id}')">
      <span class="cdot" style="background:${d.color}"></span>${esc(d.name)}${d.status !== 'online' ? ' ' + drvStatus(d).icon : ''}</span>`).join('')}
  </div>`;
}
function setDriverFilter(id) { S.driverFilter = id; render(); }
function filterBlocks(list) {
  return list.filter((b) => S.driverFilter === 'all' || b.driverId === S.driverFilter || b.driverId === 'all');
}

/* ----------------------------------------------------------------- diary */
/* split overlapping items into side-by-side columns (interval-graph coloring) */
function laneLayout(items) {
  const clusters = []; let cur = [], curEnd = null;
  const flush = () => { if (cur.length) clusters.push(cur); cur = []; curEnd = null; };
  for (const b of items) {
    const s = new Date(b.start), e = new Date(b.end);
    if (curEnd && s < curEnd) { cur.push([b, s, e]); if (e > curEnd) curEnd = e; }
    else { flush(); cur.push([b, s, e]); curEnd = e; }
  }
  flush();
  const out = [];
  for (const cl of clusters) {
    const colsArr = [];
    const placed = [];
    for (const [b, s, e] of cl) {
      let cIdx = -1;
      for (let i = 0; i < colsArr.length; i++) { if (s >= colsArr[i]) { cIdx = i; colsArr[i] = e; break; } }
      if (cIdx < 0) { colsArr.push(e); cIdx = colsArr.length - 1; }
      placed.push({ b, col: cIdx, cols: colsArr.length });
    }
    for (const o of placed) o.cols = colsArr.length;
    out.push(...placed);
  }
  return out;
}
function renderDiary() {
  const ws = startOfWeek(S.weekOffset);
  const days = [...Array(7)].map((_, i) => { const d = new Date(ws); d.setDate(d.getDate() + i); return d; });
  const todayStr = new Date().toDateString();
  const dayEnd = (d) => { const e = new Date(d); e.setDate(e.getDate() + 1); return e; };

  /* lanes: every driver gets their own mini-column per day so bookings never cross */
  const allFiltered = filterBlocks(blocks());
  let lanes;
  if (S.driverFilter === 'all') {
    lanes = S.state.drivers
      .filter((d) => ['online', 'on_journey', 'on_job'].includes(d.status) || allFiltered.some((b) => b.driverId === d.id))
      .map((d) => d.id);
    if (!lanes.length) lanes = S.state.drivers.map((d) => d.id);
    if (allFiltered.some((b) => b.driverId === 'all')) lanes = ['all', ...lanes];
  } else lanes = [S.driverFilter];
  const laneW = 100 / lanes.length;

  const cols = days.map((day) => {
    const list = allFiltered
      .filter((b) => new Date(b.start) < dayEnd(day) && new Date(b.end) > day)
      .sort((a, b) => new Date(a.start) - new Date(b.start));
    let html = '';
    if (lanes.length > 1) {
      for (let li = 1; li < lanes.length; li++) html += `<div class="lane-sep" style="left:${li * laneW}%"></div>`;
      html += lanes.map((id, li) => `<div class="lane-tag" style="left:${li * laneW}%;width:${laneW}%;color:${id === 'all' ? '#CBD5E1' : drvColor(id)}">${id === 'all' ? '🌐' : esc(drvInit(id))}</div>`).join('');
    }
    lanes.forEach((laneId, li) => {
      const items = list.filter((b) => b.driverId === laneId);
      for (const { b, col, cols: nCols } of laneLayout(items)) {
        const c = ch(b.channelId);
        const top = yOf(new Date(b.start) < day ? day : b.start);
        const bottom = Math.min(DAY_SPAN / 60 * HOUR_PX, yOf(new Date(b.end) > dayEnd(day) ? dayEnd(day) : b.end) || DAY_SPAN / 60 * HOUR_PX);
        const h = Math.max(26, bottom - top - 3);
        const holds = Object.entries(b.holds || {});
        const syncing = holds.filter(([, hd]) => hd.state === 'syncing').length;
        const failed = holds.filter(([, hd]) => hd.state === 'failed').length;
        const blockedN = holds.filter(([, hd]) => hd.state === 'blocked').length;
        const dots = holds.slice(0, 5).map(([, hd]) => `<i class="${hd.state}"></i>`).join('');
        const title = b.kind === 'manual' ? esc(b.rider) : `${esc(c.name)} · ${esc(b.rider || '')}`;
        const w = laneW / nCols;
        html += `<div class="blk ${b.kind} ${b.status}${b.driverId === 'all' ? ' fleet-block' : ''}" style="top:${top}px;height:${h}px;left:${li * laneW + col * w}%;width:calc(${w}% - 3px);border-left-color:${c.color}"
          onclick="openBlockModal('${b.id}')" title="${esc(`${title} — ${fmtHM(b.start)}–${fmtHM(b.end)}`)}">
          <div class="b-t">${b.status === 'on_journey' ? '🚗 ' : ''}${title}${b.pickupVerifiedAt ? ' <span style="color:var(--lime)">✓</span>' : ''}</div>
          ${h >= 46 ? `<div class="b-s">${b.status === 'on_journey' ? 'ON JOURNEY · ' : ''}${fmtHM(b.start)}–${fmtHM(b.end)}${b.pickup && b.pickup.n ? ' · ' + esc(b.pickup.n) : ''}</div>` : ''}
          ${holds.length && h >= 60 ? `<div class="b-sync">${dots}${failed ? `<span style="color:var(--err);font-weight:800;margin-left:2px">!</span>` : ''}${!failed && !syncing ? `<span style="color:var(--muted2);margin-left:2px;font-size:9.5px">${blockedN}×</span>` : ''}</div>` : ''}
        </div>`;
      }
    });
    return html;
  });

  const hours = [...Array(19)].map((_, i) => `<div class="hr" style="top:${i * HOUR_PX}px">${String(6 + i).padStart(2, '0')}:00</div>`).join('');
  const legendChs = [...Object.values(S.state.channels).filter((c) => c.id !== 'direct'), ch('direct'), EXTRA_CH.manual];
  const upcoming = filterBlocks(blocks()).filter((b) => b.status === 'confirmed' && new Date(b.end) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start));
  const todayBlocks = filterBlocks(blocks()).filter((b) => new Date(b.start).toDateString() === todayStr && b.status !== 'cancelled');
  const failedHolds = filterBlocks(blocks()).flatMap((b) => Object.entries(b.holds || {}).filter(([, hd]) => hd.state === 'failed').map(([cid]) => ({ b, cid })));
  const syncingN = filterBlocks(blocks()).reduce((n, b) => n + Object.values(b.holds || {}).filter((hd) => hd.state === 'syncing').length, 0);

  return `
  <div class="page-head">
    <div>
      <h1 class="page-title">Diary</h1>
      <div class="page-desc">One availability pool per driver. Accept a job anywhere and the slot is blocked on every other app automatically.</div>
    </div>
    <div class="diary-toolbar">
      <button class="btn sm" onclick="shiftWeek(-1)">← Prev</button>
      <button class="btn sm" onclick="thisWeek()">Today</button>
      <button class="btn sm" onclick="shiftWeek(1)">Next →</button>
      <button class="btn sm" onclick="openCalModal()">⇅ Calendar feed</button>
      <button class="btn sm" onclick="openManualModal()">＋ Block time</button>
      <button class="btn primary sm" onclick="openDirectModal()">＋ Direct booking</button>
    </div>
  </div>
  ${driverFilterChips()}
  <div class="legend">
    ${legendChs.map((c) => `<span class="lg"><i style="background:${c.color}"></i>${esc(c.name)}</span>`).join('')}
  </div>
  <div class="diary-wrap" style="margin-top:14px">
    <div class="diary-scroll">
      <div class="diary">
        <div class="diary-head">
          <div class="dh"></div>
          ${days.map((d) => `<div class="dh ${d.toDateString() === todayStr ? 'today' : ''}">
            <div class="dow">${d.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
            <div class="dnum">${d.getDate()} <span style="font-size:11px;color:var(--muted);font-weight:600">${d.toLocaleDateString('en-GB', { month: 'short' })}</span></div>
          </div>`).join('')}
        </div>
        <div class="diary-body">
          <div class="gutter">${hours}</div>
          ${days.map((d, i) => `<div class="dcol ${d.toDateString() === todayStr ? 'today' : ''}">${cols[i]}${d.toDateString() === todayStr ? '<div class="nowline" id="nowline"></div>' : ''}</div>`).join('')}
        </div>
      </div>
    </div>
    <div class="side-col">
      <div class="panel">
        <h3>Today${S.driverFilter !== 'all' ? ' · ' + esc(drvFirst(S.driverFilter)) : ''}</h3>
        <div class="mini-stat"><span>Bookings</span><b>${todayBlocks.length}</b></div>
        <div class="mini-stat"><span>Next job</span><b>${upcoming.length ? timeLabel(upcoming[0].start) : '—'}</b></div>
        <div class="mini-stat"><span>Syncs in flight</span><b>${syncingN || 'none'}</b></div>
        <div class="mini-stat"><span>Failed pushes</span><b style="color:${failedHolds.length ? 'var(--err)' : 'inherit'}">${failedHolds.length}</b></div>
      </div>
      ${failedHolds.length ? `<div class="panel" style="border-color:rgba(248,113,113,.4)">
        <h3 style="color:var(--err)">Needs attention</h3>
        ${failedHolds.slice(0, 4).map(({ b, cid }) => `
          <div class="hold-alert" style="margin-top:8px">⚠ ${esc(ch(cid).name)} couldn't be blocked for ${fmtHM(b.start)}
            <button class="btn sm" style="margin-left:auto" onclick="retryHold('${b.id}','${cid}')">Retry</button>
          </div>`).join('')}
      </div>` : ''}
      <div class="panel">
        <h3>Sync log</h3>
        <div class="sync-log">
          ${S.state.logs.slice(0, 40).map((l) => `<div class="sl ${l.level}"><span class="t">${fmtHM(l.t)}</span><span class="m">${esc(l.msg)}</span></div>`).join('') || '<div class="muted" style="padding:8px">No activity yet.</div>'}
        </div>
      </div>
    </div>
  </div>`;
}
function positionNowLine() {
  const el = $('#nowline');
  if (el) el.style.top = yOf(new Date(nowMs()).toISOString()) + 'px';
}
function shiftWeek(n) { S.weekOffset += n; render(); }
function thisWeek() { S.weekOffset = 0; render(); }

/* block detail modal */
function openBlockModal(id) {
  const b = S.state.blocks[id];
  if (!b) return;
  const c = ch(b.channelId);
  const d = drv(b.driverId);
  const holds = Object.entries(b.holds || {});
  const statusPill = { confirmed: 'ok', 'in-progress': 'info', on_journey: 'warn', completed: 'mut', cancelled: 'err' }[b.status];
  const holdRow = ([cid, hd]) => {
    const cc = ch(cid);
    const icon = hd.state === 'blocked' ? '<span style="color:var(--ok)">✓ blocked</span>'
      : hd.state === 'syncing' ? '<span class="spin"></span> <span style="color:var(--warn)">pushing…</span>'
      : hd.state === 'failed' ? '<span style="color:var(--err)">⚠ failed</span>'
      : '<span class="muted">released</span>';
    const retry = hd.state === 'failed' ? `<button class="btn sm" onclick="retryHold('${b.id}','${cid}')">Retry</button>` : '';
    return `<div class="hold-row"><span class="nm"><span class="cdot" style="width:9px;height:9px;border-radius:50%;background:${cc.color}"></span>${esc(cc.name)}</span>${icon}${retry}</div>`;
  };
  const canVerify = b.code && !b.pickupVerifiedAt && (b.status === 'confirmed' || b.status === 'in-progress' || b.status === 'on_journey');
  const codeSection = b.code ? `
    <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:16px 0 6px">Secret pickup code</h3>
    <div class="code-display">${b.code.split('').map((n) => `<span class="code-digit">${n}</span>`).join('')}</div>
    ${b.pickupVerifiedAt
      ? `<div class="verified-banner">✓ Identity verified at pickup — code matched at ${fmtHM(b.pickupVerifiedAt)}${b.verifyAttempts > 1 ? ` (${b.verifyAttempts - 1} earlier failed attempt${b.verifyAttempts > 2 ? 's' : ''})` : ''}</div>`
      : canVerify ? `
      <div class="verify-box">
        <div class="vh">Verify rider at pickup</div>
        <div class="vd" style="margin-top:0">The rider received this code in their confirmation. Ask them for it — it proves <b>you</b> are their driver and <b>they</b> are your passenger, both ways.</div>
        <div style="display:flex;gap:10px;align-items:center;margin-top:12px">
          <input class="code-input" id="verifyInput" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="····" autocomplete="off">
          <button class="btn accept" onclick="verifyCode('${b.id}')">Verify pickup</button>
        </div>
        <div class="vd" style="margin-top:10px">${b.verifyAttempts ? `<span style="color:var(--err)">⚠ ${b.verifyAttempts} failed attempt${b.verifyAttempts > 1 ? 's' : ''} — 3 locks it.</span>` : ''}
        <span class="hint-code">(Demo: the rider's real code is shown above.)</span></div>
      </div>` : ''}` : '';
  openModal(`
    <h2>${b.kind === 'manual' ? esc(b.rider) : esc(b.rider || 'Booking')}</h2>
    <div class="msub">
      <span class="chip"><span class="cdot" style="background:${c.color}"></span>${b.kind === 'manual' ? 'Manual block' : 'Booked via ' + esc(c.name)}</span>
      <span class="pill ${statusPill}" style="margin-left:6px">${b.status.replace('-', ' ')}</span>
      ${b.fare ? `<span class="chip" style="margin-left:6px">${GBP(b.fare)}</span>` : ''}
    </div>
    <div class="detail-list">
      <div class="dr"><span class="k">When</span><span class="v">${fmtDay(b.start)} · ${fmtHM(b.start)} – ${fmtHM(b.end)}${b.kind === 'booking' ? ` <span class="muted">(incl. ${S.state.settings.bufferMin} min buffer)</span>` : ''}</span></div>
      <div class="dr"><span class="k">Driver</span><span class="v">${b.driverId === 'all' ? '🌐 Whole fleet' : `<span class="avatar" style="width:20px;height:20px;font-size:8.5px;background:${drvColor(b.driverId)};margin-right:6px;vertical-align:middle">${drvInit(b.driverId)}</span>${d ? esc(d.name) + ' · ' + esc(d.vehicle) + ' (' + esc(d.reg) + ')' : '—'}`}</span></div>
      ${b.pickup ? `<div class="dr"><span class="k">Pickup</span><span class="v">${esc(b.pickup.n)}${b.pickup.pc ? ' · ' + esc(b.pickup.pc) : ''}</span></div>` : ''}
      ${b.dropoff ? `<div class="dr"><span class="k">Drop-off</span><span class="v">${esc(b.dropoff.n)}${b.dropoff.pc ? ' · ' + esc(b.dropoff.pc) : ''}</span></div>` : ''}
      ${b.distanceMi ? `<div class="dr"><span class="k">Distance</span><span class="v">${b.distanceMi} mi · ~${b.durationMin} min</span></div>` : ''}
      ${b.note ? `<div class="dr"><span class="k">Note</span><span class="v">${esc(b.note)}</span></div>` : ''}
      ${b.riderPhone ? `<div class="dr"><span class="k">Rider phone</span><span class="v">${esc(b.riderPhone)} · <a href="javascript:void(0)" onclick="resendMsg('${b.id}')" style="color:var(--accent)">resend confirmation${b.msgType === 'whatsapp' ? ' (WhatsApp)' : ' (SMS)'}</a></span></div>` : ''}
    </div>
    ${codeSection}
    <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:16px 0 10px">Availability pushed to other apps</h3>
    ${holds.length ? holds.map(holdRow).join('') : '<div class="muted" style="font-size:13px">No other channels connected — nothing to sync.</div>'}
    <div class="m-actions">
      ${(() => {
        const driver = drv(b.driverId);
        const mine = S.me && S.me.driverId && b.driverId === S.me.driverId;
        const dBusy = driver && driver.status === 'on_journey' && driver.journeyBlockId !== b.id;
        if (b.kind === 'booking' && (mine || isAdmin()) && b.driverId !== 'all' && driver && (b.status === 'confirmed' || b.status === 'in-progress') && !dBusy) {
          return `<button class="btn journey" onclick="startJourney('${b.id}')">▶ Start journey — navigate to pickup</button>`;
        }
        if (b.status === 'on_journey') return `<div class="journey-flag">🚗 ON JOURNEY — the app is locked for safety. Use the journey screen to complete the job.</div>`;
        return '';
      })()}
      ${(b.status === 'confirmed' || b.status === 'in-progress') ? `<button class="btn danger" onclick="cancelBlock('${b.id}')">${b.kind === 'manual' ? 'Remove block' : 'Cancel job'} & release slot</button>` : ''}
      <button class="btn" onclick="closeModal()">Close</button>
    </div>`);
  const vi = $('#verifyInput');
  if (vi) vi.focus();
}
async function verifyCode(blockId) {
  const code = ($('#verifyInput') || {}).value || '';
  try {
    await api(`/api/blocks/${blockId}/verify`, 'POST', { code });
    closeModal();
    toast('Pickup verified ✓ — rider & driver identities confirmed', 'ok');
  } catch (e) {
    toast(e.message, 'err');
    const b = S.state.blocks[blockId];
    if (b) { /* re-open modal to update failed-attempt counter, keep input */ openBlockModal(blockId); }
  }
  refresh();
}

/* -------------------------------------------------------------- requests */
function renderRequests() {
  const reqs = S.state.requestOrder.map((id) => S.state.requests[id]).filter(Boolean);
  const pending = reqs.filter((r) => r.status === 'pending').sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
  const history = reqs.filter((r) => r.status !== 'pending').slice(0, 14);
  const card = (r) => {
    const c = ch(r.channelId);
    const ppm = r.fare / r.distanceMi;
    const endTs = new Date(new Date(r.pickupAt).getTime() + (r.durationMin + S.state.settings.bufferMin) * 60000);
    const eligible = S.state.settings.autoAccept && ppm >= S.state.settings.minPerMile;
    return `<div class="req-card" style="--rch:${c.color}">
      <div class="req-top">
        <div>
          <div class="req-rider">${esc(r.rider)}</div>
          <div class="req-time">${r.asap ? '⚡ ASAP — pickup in ~' + Math.max(1, Math.round((new Date(r.pickupAt) - nowMs()) / 60000)) + ' min' : timeLabel(r.pickupAt)}</div>
        </div>
        <div class="req-fare">
          <div class="amt">${GBP(r.fare)}</div>
          <div class="ppm">£${ppm.toFixed(2)}/mi ${eligible ? '· <span style="color:var(--ok)">auto-accept ✓</span>' : ''}</div>
        </div>
      </div>
      <span class="chip"><span class="cdot" style="background:${c.color}"></span>${esc(c.name)}</span>
      <div class="req-route">
        <div class="stop"><span class="pin a"></span><div><div>${esc(r.pickup.n)}</div><div class="lbl">${esc(r.pickup.pc)}</div></div></div>
        <div class="stop"><span class="pin b"></span><div><div>${esc(r.dropoff.n)}</div><div class="lbl">${esc(r.dropoff.pc)}</div></div></div>
      </div>
      ${r.note ? `<div class="req-note">📝 ${esc(r.note)}</div>` : ''}
      <div class="req-meta"><span>📏 ${r.distanceMi} mi</span><span>⏱ ~${r.durationMin} min</span><span>🕓 pickup ${fmtHM(r.pickupAt)}</span></div>
      <div class="req-driver">
        <span>Route to:</span>
        <select class="mini" onchange="assignReq('${r.id}', this.value)">
          ${r.driverId ? '' : '<option value="" selected disabled>Assign a driver…</option>'}
          ${S.state.drivers.map((d) => {
            const off = ['offline', 'on_job', 'break'].includes(d.status);
            const onJ = d.status === 'on_journey';
            const offLbl = d.status === 'offline' ? ' (offline)' : d.status === 'on_job' ? ' (🚕 on job)' : ' (☕ break)';
            const linked = !!(d.connections && d.connections[r.channelId]);
            const clash = !off && linked && driverClashLocal(d.id, r.pickupAt, endTs);
            return `<option value="${d.id}" ${r.driverId === d.id ? 'selected' : ''} ${off || !linked || clash ? 'disabled' : ''}>${esc(d.name)}${off ? offLbl : onJ ? ' (🚗 on journey)' : !linked ? ` (not linked on ${esc(c.name)})` : clash ? ' (clashes ' + fmtHM(clash.start) + ')' : ''}</option>`;
          }).join('')}
        </select>
        ${r.driverId ? `<span class="avatar" style="background:${drvColor(r.driverId)};width:22px;height:22px;font-size:9px">${drvInit(r.driverId)}</span>` : '<span class="pill warn">no free driver</span>'}
      </div>
      <div class="req-actions">
        <button class="btn accept grow" ${r.driverId ? '' : 'disabled style="opacity:.45;flex:1"'} onclick="acceptReq('${r.id}')">${r.driverId ? `Accept — ${esc(drvFirst(r.driverId))} · blocks all other apps` : 'Assign a driver to accept'}</button>
        <button class="btn ghost" onclick="declineReq('${r.id}')">Decline</button>
      </div>
      <div class="cd"><div class="cd-fill" data-exp="${new Date(r.expiresAt).getTime()}" data-born="${new Date(r.createdAt).getTime()}" style="width:100%"></div></div>
      <div class="cd-label"><span>Offer expires if you don't respond</span><span class="cd-secs" data-exp2="${new Date(r.expiresAt).getTime()}">—</span></div>
    </div>`;
  };
  const histRow = (r) => {
    const c = ch(r.channelId);
    const pill = { accepted: 'ok', declined: 'mut', expired: 'mut', 'auto-declined': 'warn', 'driver-cancelled': 'err' }[r.status] || 'mut';
    return `<div class="hist-row">
      <span class="chip"><span class="cdot" style="background:${c.color}"></span>${esc(c.name)}</span>
      <span class="who">${esc(r.rider)} · ${esc(r.pickup.n)} → ${esc(r.dropoff.n)}</span>
      ${r.status === 'accepted' && r.code ? `<span class="chip" title="Pickup code">🔑 ${r.code}</span>` : ''}
      <span class="muted" style="font-size:12px">${timeLabel(r.pickupAt)}</span>
      <span class="fare">${GBP(r.fare)}</span>
      <span class="pill ${pill}">${r.status.replace('-', ' ')}</span>
    </div>`;
  };
  return `
  <div class="page-head">
    <div>
      <h1 class="page-title">Requests</h1>
      <div class="page-desc">Every app in one inbox, auto-routed to the first free driver. You can re-assign before accepting.</div>
    </div>
    <div class="chip">Auto-accept ${S.state.settings.autoAccept ? `on ≥ £${S.state.settings.minPerMile.toFixed(2)}/mi` : 'off'} · ${S.state.drivers.filter((d) => ['online', 'on_journey'].includes(d.status)).length}/${S.state.drivers.length} drivers accepting</div>
  </div>
  ${pending.length ? `<div class="req-grid">${pending.map(card).join('')}</div>` : `
    <div class="card empty-state"><div class="big">🛰️</div>Listening on ${Object.values(S.state.channels).filter((c) => c.id !== 'direct' && c.status === 'connected').length} channels…<br>
    <span style="font-size:12px">New requests will land here, pre-routed to a free driver.</span></div>`}
  <h3 style="margin:22px 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">Recent activity</h3>
  <div class="card">${history.length ? history.map(histRow).join('') : '<div class="empty-state" style="padding:26px">Nothing yet — accepted, declined and expired requests will appear here.</div>'}</div>`;
}

/* ------------------------------------------------------------------ map */
const MAP = { w: 760, h: 880, west: -6.3, east: 2.2, south: 49.8, north: 59.6 };
const proj = (lat, lng) => [
  ((lng - MAP.west) / (MAP.east - MAP.west)) * MAP.w,
  ((MAP.north - lat) / (MAP.north - MAP.south)) * MAP.h,
];
const GB = [[-5.72,50.07],[-5.05,50.03],[-4.2,50.32],[-3.55,50.62],[-2.95,50.71],[-1.95,50.72],[-1.0,50.79],[-0.25,50.82],[0.35,50.85],[1.13,51.1],[1.4,51.35],[1.05,51.62],[1.62,51.95],[1.72,52.5],[1.35,52.75],[0.35,52.9],[0.1,53.55],[-0.25,53.75],[-0.4,54.3],[-1.1,54.55],[-1.5,55.0],[-2.0,55.8],[-2.95,55.98],[-2.1,57.15],[-1.9,57.55],[-2.6,57.68],[-3.1,58.42],[-4.4,58.55],[-5.0,58.6],[-5.15,58.15],[-5.75,57.85],[-5.7,57.35],[-5.4,56.9],[-5.65,56.35],[-5.1,56.1],[-4.85,55.7],[-4.6,55.3],[-4.9,54.85],[-4.4,54.75],[-3.4,54.85],[-3.15,54.35],[-2.85,54.05],[-3.05,53.55],[-3.1,53.3],[-3.85,53.32],[-4.55,53.42],[-4.75,53.2],[-4.05,53.05],[-4.55,52.9],[-4.2,52.65],[-4.15,52.35],[-4.6,52.12],[-5.25,51.85],[-5.3,51.65],[-4.9,51.7],[-4.5,51.6],[-4.0,51.55],[-3.2,51.45],[-3.15,51.2],[-3.7,51.2],[-4.25,51.15],[-4.6,50.9],[-4.9,50.7],[-4.55,50.35],[-5.2,50.15]];
function renderMap() {
  const upcoming = filterBlocks(blocks()).filter((b) =>
    b.status !== 'completed' && b.status !== 'cancelled' && new Date(b.end) > new Date() &&
    b.pickup && b.pickup.lat && b.dropoff && b.dropoff.lat);
  const pending = Object.values(S.state.requests).filter((r) => r.status === 'pending');
  const nextJob = upcoming.slice().sort((a, b) => new Date(a.start) - new Date(b.start))[0];
  const gbPath = 'M' + GB.map(([lng, lat]) => proj(lat, lng).map((n) => n.toFixed(1)).join(',')).join('L') + 'Z';
  const grat = [];
  for (let lng = -6; lng <= 2; lng++) { const [x] = proj(55, lng); grat.push(`<line x1="${x}" y1="0" x2="${x}" y2="${MAP.h}" stroke="#1E2A44" stroke-opacity=".5"/>`); }
  for (let lat = 50; lat <= 59; lat++) { const [, y] = proj(lat, 0); grat.push(`<line x1="0" y1="${y}" x2="${MAP.w}" y2="${y}" stroke="#1E2A44" stroke-opacity=".5"/>`); }
  const cityLabels = Object.values(S.state.cities).map((ct) => {
    const [x, y] = proj(ct.lat, ct.lng);
    return `<circle cx="${x}" cy="${y}" r="2" fill="#3D5478"/><text x="${x + 6}" y="${y + 4}" class="city-label">${esc(ct.name.toUpperCase())}</text>`;
  }).join('');
  const routes = upcoming.map((b) => {
    const [x1, y1] = proj(b.pickup.lat, b.pickup.lng);
    const [x2, y2] = proj(b.dropoff.lat, b.dropoff.lng);
    const col = ch(b.channelId).color;
    const isNext = nextJob && b.id === nextJob.id;
    return `<g onclick="openBlockModal('${b.id}')" style="cursor:pointer">
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${isNext ? 3 : 1.6}" stroke-opacity="${isNext ? 0.95 : 0.45}" class="${b.status === 'confirmed' ? 'map-route' : ''}"/>
      <circle cx="${x1}" cy="${y1}" r="${isNext ? 6 : 4.5}" fill="${col}" stroke="#0A0F1A" stroke-width="1.5"/>
      ${isNext ? `<circle class="map-pulse" cx="${x1}" cy="${y1}" r="6" fill="none" stroke="${col}" stroke-width="2"/>` : ''}
      <rect x="${x2 - 3.5}" y="${y2 - 3.5}" width="7" height="7" fill="${col}" stroke="#0A0F1A" opacity=".9"/>
      <circle cx="${x1}" cy="${y1}" r="4.5" fill="none" stroke="${drvColor(b.driverId)}" stroke-width="1.8" stroke-dasharray="${b.driverId === 'all' ? '2 2' : 'none'}"/>
      <title>${esc(ch(b.channelId).name)} · ${esc(b.rider || '')} · ${fmtHM(b.start)} · ${esc(drvName(b.driverId))}${b.code ? ' · code ' + b.code : ''}</title>
    </g>`;
  }).join('');
  const pendMarks = pending.map((r) => {
    const [x, y] = proj(r.pickup.lat, r.pickup.lng);
    return `<g onclick="location.hash='#/requests'" style="cursor:pointer">
      <circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#FBBF24" stroke-width="2" stroke-dasharray="3 3"/>
      <circle class="map-pulse" cx="${x}" cy="${y}" r="6" fill="none" stroke="#FBBF24" stroke-width="1.5"/>
      <title>Pending ${esc(ch(r.channelId).name)} request — ${esc(r.rider)}, ${GBP(r.fare)}</title>
    </g>`;
  }).join('');
  const homes = S.state.drivers.map((d) => {
    if (!d.home) return '';
    const [x, y] = proj(d.home.lat, d.home.lng);
    const st = drvStatus(d);
    const col = st.mapColor || d.color;
    return `<g>
      <rect x="${x - 7}" y="${y - 14}" width="14" height="19" rx="4" fill="${col}" stroke="#0A0F1A" stroke-width="1.5"/>
      <text x="${x}" y="${y}" text-anchor="middle" font-size="8.5" font-weight="800" fill="#06101C">${esc(drvInit(d.id))}</text>
      <title>${esc(d.name)} — based in ${esc(d.home.name)} (${st.icon} ${st.label})</title>
    </g>`;
  }).join('');
  const sideJob = (b) => `<div class="map-job" onclick="openBlockModal('${b.id}')">
      <span class="m-pin" style="background:${ch(b.channelId).color}"></span>
      <div style="flex:1;min-width:0"><div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.rider || 'Booking')}</div>
      <div class="m-when">${timeLabel(b.start)} · ${esc(b.pickup.n)} → ${esc(b.dropoff.n)}</div></div>
      <span class="avatar" style="width:22px;height:22px;font-size:9px;background:${b.driverId === 'all' ? '#CBD5E1' : drvColor(b.driverId)}">${b.driverId === 'all' ? '🌐' : drvInit(b.driverId)}</span>
    </div>`;
  return `
  <div class="page-head">
    <div><h1 class="page-title">Live map</h1>
    <div class="page-desc">Upcoming jobs (channel colour = booked via, ring = assigned driver), pending offers (amber), and driver bases. Click any marker to open it.</div></div>
  </div>
  ${driverFilterChips()}
  <div class="map-layout" style="margin-top:14px">
    <div>
      <div class="panel" style="margin-bottom:16px"><h3>Fleet status</h3>
        ${S.state.drivers.map((d) => { const st = drvStatus(d); return `<div class="mini-stat"><span><span class="cdot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${st.mapColor || d.color};margin-right:7px"></span>${esc(d.name)}</span><b class="${d.status === 'online' ? '' : 'muted'}">${st.icon} ${st.label}</b></div>`; }).join('')}
      </div>
      <div class="panel"><h3>On the map (${upcoming.length})</h3>
        ${upcoming.length ? upcoming.sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 9).map(sideJob).join('') : '<div class="muted" style="font-size:13px;padding:6px 0">No geocoded jobs upcoming. Direct bookings typed in free text may not appear here.</div>'}
      </div>
    </div>
    <div class="map-wrap">
      <svg class="map-svg" viewBox="0 0 ${MAP.w} ${MAP.h}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${MAP.w}" height="${MAP.h}" fill="#0D1626" rx="8"/>
        ${grat.join('')}
        <path d="${gbPath}" fill="#141E33" stroke="#2E4166" stroke-width="1.5"/>
        ${cityLabels}
        ${routes}
        ${pendMarks}
        ${homes}
      </svg>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- demand */
let demandData = null, demandTs = 0;
S.demandCh = S.demandCh || 'all';
async function loadDemand() {
  try { demandData = await api('/api/demand'); demandTs = Date.now(); return true; }
  catch (e) { return false; }
}
function ensureDemand() {
  if (!demandData || Date.now() - demandTs > 60000) {
    loadDemand().then((ok) => { if (ok && S.route === 'demand') render(); });
  }
}
function setDemandCh(id) { S.demandCh = id; render(); }
function hexA(hex, a) {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((x) => x + x).join('') : m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function renderDemand() {
  if (!demandData) return '<div class="loading">Crunching demand patterns…</div>';
  const active = S.demandCh;
  const grid = active === 'all' ? demandData.all : (demandData.byChannel[active] || demandData.all);
  const color = active === 'all' ? '#38BDF8' : ch(active).color;
  const nowD = new Date(), nowDow = (nowD.getDay() + 6) % 7, nowH = nowD.getHours();
  // top hotspots
  const cells = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) cells.push({ d, h, v: grid[d][h] });
  cells.sort((a, b) => b.v - a.v);
  const top = cells.filter((c2, i2) => cells.findIndex((x) => x.d === c2.d && x.h === c2.h) === i2).slice(0, 3);
  // heat spots on the map: recent + upcoming geocoded pickups for the filter
  const spots = {};
  const spotKey = (lat, lng) => lat.toFixed(2) + ',' + lng.toFixed(2);
  const addSpot = (cid, lat, lng) => {
    if (lat == null || (active !== 'all' && cid !== active)) return;
    const k = spotKey(lat, lng);
    spots[k] = spots[k] || { lat, lng, n: 0, cid };
    spots[k].n++;
  };
  for (const b of blocks()) if (b.status !== 'cancelled' && b.pickup) addSpot(b.channelId, b.pickup.lat, b.pickup.lng);
  for (const r of Object.values(S.state.requests)) if (r.status === 'pending') addSpot(r.channelId, r.pickup.lat, r.pickup.lng);
  const spotList = Object.values(spots);
  const maxN = Math.max(1, ...spotList.map((s2) => s2.n));
  const gbPath = 'M' + GB.map(([lng, lat]) => proj(lat, lng).map((n) => n.toFixed(1)).join(',')).join('L') + 'Z';
  const hourLabel = (h) => String(h).padStart(2, '0') + ':00';
  return `
  <div class="page-head">
    <div><h1 class="page-title">Demand heatmap</h1>
    <div class="page-desc">Ride demand by hour — forecast model blended with your observed bookings. Go online where the heat is; let auto-accept work the peaks.</div></div>
  </div>
  <div class="drv-filters" style="margin:0 0 14px">
    <span class="drv-f ${active === 'all' ? 'on' : ''}" onclick="setDemandCh('all')">🔥 All channels</span>
    ${Object.values(S.state.channels).map((c2) => `<span class="drv-f ${active === c2.id ? 'on' : ''}" onclick="setDemandCh('${c2.id}')">
      <span class="cdot" style="background:${c2.color}"></span>${esc(c2.name)}</span>`).join('')}
  </div>
  <div class="two-col" style="grid-template-columns:1.35fr 1fr">
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3>${active === 'all' ? 'All channels blended' : esc(ch(active).name)} · demand 0–100</h3>
        <span class="lg" style="font-size:11px;color:var(--muted)">model + observed (max ${demandData.maxObs}/hr)</span>
      </div>
      <div class="heat-grid">
        <div class="hg-h"></div>${DOWS.map((d) => `<div class="hg-h">${d}</div>`).join('')}
        ${[...Array(24)].map((_, h) => `
          <div class="hg-h hg-hour">${hourLabel(h)}</div>
          ${[...Array(7)].map((_, d) => {
            const v = grid[d][h];
            return `<div class="hg-c ${d === nowDow && h === nowH ? 'now' : ''}" style="background:${hexA(color, 0.05 + (v / 100) * 0.9)}" title="${DOWS[d]} ${hourLabel(h)} — demand ${v}/100"></div>`;
          }).join('')}`).join('')}
      </div>
      <div class="heat-scale"><span>quiet</span><span class="hs-bar" style="background:linear-gradient(90deg,${hexA(color, 0.06)},${hexA(color, 0.95)})"></span><span>peak</span></div>
    </div>
    <div>
      <div class="panel" style="margin-bottom:16px"><h3>Peak windows (${active === 'all' ? 'all channels' : esc(ch(active).name)})</h3>
        ${top.map((c2) => `<div class="mini-stat"><span>${DOWS[c2.d]} ${hourLabel(c2.h)}–${hourLabel((c2.h + 1) % 24)}</span><b style="color:${color}">${c2.v}/100</b></div>`).join('')}
        <div class="hint" style="margin-top:12px">💡 Match your shifts to the peaks. With auto-accept set ≥ £${S.state.settings.minPerMile.toFixed(2)}/mi you can work the surge hands-free.</div>
      </div>
      <div class="panel heat-panel">
        <h3>Pickup hotspots</h3>
        <div class="heat-map">
          <svg viewBox="0 0 ${MAP.w} ${MAP.h}" class="heat-svg" xmlns="http://www.w3.org/2000/svg">
            <rect width="${MAP.w}" height="${MAP.h}" fill="#0D1626" rx="8"/>
            <path d="${gbPath}" fill="#141E33" stroke="#2E4166" stroke-width="1.2"/>
          </svg>
          ${spotList.map((s2) => {
            const [x, y] = proj(s2.lat, s2.lng);
            const size = 46 + (s2.n / maxN) * 80;
            const scol = active === 'all' ? ch(s2.cid).color : color;
            return `<div class="heat-spot" style="left:${x / MAP.w * 100}%;top:${y / MAP.h * 100}%;width:${size}px;height:${size}px;background:radial-gradient(circle,${hexA(scol, 0.18 + (s2.n / maxN) * 0.5)} 0%,${hexA(scol, 0.06)} 45%,transparent 70%)"></div>`;
          }).join('')}
        </div>
        <div class="muted" style="font-size:11px;margin-top:8px">${spotList.length ? `${spotList.length} hotspots from your bookings & live offers` : 'No geocoded pickups for this filter yet.'}</div>
      </div>
    </div>
  </div>`;
}

/* -------------------------------------------------------------------- api */
S.keysShown = S.keysShown || {};
function renderApi() {
  const appCh = Object.values(S.state.channels).filter((c2) => c2.id !== 'direct');
  const card = (c2) => {
    const shown = !!S.keysShown[c2.id];
    const keyShown = shown ? c2.apiKey : '••••••••••••' + c2.apiKey.slice(-4);
    const last = S.state.webhookLog.find((l) => l.channel === c2.id);
    return `<div class="ch-card" style="--chc:${c2.color}">
      <div class="ch-head">
        <div class="ch-logo">${esc(c2.name[0])}</div>
        <div><div class="ch-name">${esc(c2.name)} dispatch API</div>
        <div class="ch-sub">Inbound offers → FareFlow router → accept → availability push-back</div></div>
        <div class="ch-body"><span class="pill ${c2.status === 'connected' ? 'ok' : 'mut'}">${c2.status}</span></div>
      </div>
      <div class="form-row" style="margin:6px 0"><label>API key (X-FareFlow-Key)</label>
        <div class="feed-link">
          <input class="input" style="font-family:ui-monospace,monospace;font-size:12px" readonly value="${keyShown}">
          <button class="btn sm" onclick="toggleKey('${c2.id}')">${shown ? 'Hide' : 'Show'}</button>
          <button class="btn sm" onclick="copyText('${c2.apiKey}')">Copy</button>
        </div>
      </div>
      <div class="form-row" style="margin:6px 0"><label>Offer webhook</label>
        <div class="feed-link">
          <input class="input" style="font-family:ui-monospace,monospace;font-size:11.5px" readonly value="${location.origin}/api/integrations/${c2.id}/offers">
          <button class="btn sm" onclick="copyText('${location.origin}/api/integrations/${c2.id}/offers')">Copy</button>
        </div>
      </div>
      <div class="ch-foot">
        <span>${last ? `${esc(last.event)} · ${last.status} · ${fmtHM(last.t)}` : 'No API calls yet'}</span>
        <span style="display:flex;gap:8px">
          <button class="btn sm" onclick="testOffer('${c2.id}')">⚡ Fire test offer</button>
          <button class="btn sm danger ghost" onclick="rotateKey('${c2.id}')">Rotate key</button>
        </span>
      </div>
    </div>`;
  };
  const uberKey = S.state.channels.uber.apiKey;
  const curl = 'curl -X POST ' + location.origin + '/api/integrations/uber/offers \\\n'
    + '  -H "Content-Type: application/json" \\\n'
    + '  -H "X-FareFlow-Key: ' + uberKey.slice(0, 6) + '…" \\\n'
    + "  -d '{\n"
    + '    "externalId": "ub_trip_991",\n'
    + '    "rider": "Aisha Khan",\n'
    + '    "pickupName": "Canary Wharf", "pickupLat": 51.5054, "pickupLng": -0.0235,\n'
    + '    "dropoffName": "Heathrow T5",\n'
    + '    "pickupAt": "2026-08-08T09:30:00Z",\n'
    + '    "fare": 58.40, "distanceMi": 22.7, "ttlSec": 300\n'
    + "  }'";
  return `
  <div class="page-head">
    <div><h1 class="page-title">Integrations API</h1>
    <div class="page-desc">The seam where real operator dispatch systems plug in. Offers come in over authenticated webhooks, flow through the same router, and availability blocks are pushed back to the operator.</div></div>
  </div>
  <div class="ch-grid">${appCh.map(card).join('')}</div>
  <div class="two-col" style="margin-top:16px">
    <div class="panel">
      <h3>How an adapter plugs in</h3>
      <div class="api-flow">
        <div class="af-step"><b>1 · Operator → FareFlow</b><span><code>POST /api/integrations/:channel/offers</code> with <code>X-FareFlow-Key</code>. We route it to a free driver, hold an expiry window (default 5 min), and return <code>202</code> + the pickup code.</span></div>
        <div class="af-step"><b>2 · Driver accepts</b><span>Status flips via <code>GET …/blocks</code> (poll) — or hook an outbound adapter: FareFlow POSTs <code>offer.accepted</code> / <code>offer.cancelled</code> back to the operator's endpoint.</span></div>
        <div class="af-step"><b>3 · Availability push-back</b><span>Every accepted slot lands in the channel's block list, so the operator's marketplace stops offering it. Cancelling via <code>POST …/offers/:externalId/cancel</code> releases it everywhere.</span></div>
      </div>
      <h4 style="margin:16px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">Try it now</h4>
      <pre class="code-pre">${esc(curl)}</pre>
      <div class="muted" style="font-size:11.5px;margin-top:8px">Cancel: <code>POST /api/integrations/uber/offers/ub_trip_991/cancel</code> · Operator's jobs: <code>GET /api/integrations/uber/blocks</code> (header auth).</div>
    </div>
    <div class="panel">
      <h3>Webhook log (latest)</h3>
      ${S.state.webhookLog.length ? S.state.webhookLog.slice(0, 12).map((l) => `
        <div class="hist-row" style="font-size:12px">
          <span class="chip">${esc(ch(l.channel).name)}</span>
          <span class="who">${esc(l.event)}</span>
          <span class="muted">${esc(l.detail)}</span>
          <span class="pill ${l.status < 300 ? 'ok' : 'err'}">${l.status}</span>
        </div>`).join('') : '<div class="empty-state" style="padding:24px">No calls yet — fire a test offer from a channel card above.</div>'}
    </div>
  </div>`;
}
function toggleKey(cid) { S.keysShown[cid] = !S.keysShown[cid]; render(); }
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); toast('Copied to clipboard', 'ok'); }
  catch (e) { toast('Copy failed — select and copy manually', 'warn'); }
}
async function testOffer(cid) {
  try {
    const res = await fetch(`/api/integrations/${cid}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FareFlow-Key': S.state.channels[cid].apiKey }, body: '{}' });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'failed');
    toast(`${S.state.channels[cid].name} test offer fired — watch Requests`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
  refresh();
}
async function rotateKey(cid) {
  if (!confirm(`Rotate the ${S.state.channels[cid].name} API key? The operator's adapter must be updated with the new key.`)) return;
  try { await api(`/api/integrations/${cid}/rotate`, 'POST'); toast('API key rotated', 'warn'); }
  catch (e) { toast(e.message, 'err'); }
  refresh();
}

/* ----------------------------------------------------------------- fleet */
function renderFleet() {
  const todayStr = new Date().toDateString();
  const card = (d) => {
    const doneToday = blocks().filter((b) => b.driverId === d.id && b.status === 'completed' && new Date(b.start).toDateString() === todayStr);
    const upNext = blocks().filter((b) => b.driverId === d.id && b.status === 'confirmed' && new Date(b.end) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start));
    const earned = doneToday.reduce((s, b) => s + (b.fare || 0), 0);
    const next = upNext[0];
    return `<div class="dr-card ${['offline', 'break'].includes(d.status) ? 'off' : ''}">
      <div class="dr-head">
        <span class="avatar lg" style="background:${d.color}">${esc(d.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>
        <div style="flex:1">
          <div class="dr-name">${esc(d.name)}</div>
          <div class="dr-sub">${esc(d.vehicle)} · ${esc(d.reg)} · ${esc(d.home ? d.home.name : '')}</div>
          <div class="conn-dots">${Object.values(S.state.channels).filter((c2) => c2.id !== 'direct').map((c2) => {
            const conn = d.connections && d.connections[c2.id];
            return conn ? `<i style="background:${c2.color}" title="${esc(c2.name)}: ${esc(conn.ref)}"></i>` : '';
          }).join('') || '<span class="muted" style="font-size:10.5px">no apps linked — add driver numbers in Settings</span>'}</div>
        </div>
        <span class="pill ${drvStatus(d).pill}">${drvStatus(d).icon} ${drvStatus(d).label}${d.status === 'break' && d.breakUntil ? ' · back ' + fmtHM(d.breakUntil) : ''}</span>
      </div>
      <div class="dr-stats">
        <div><div class="v">${doneToday.length}</div><div class="k">trips today</div></div>
        <div><div class="v">${GBP(earned)}</div><div class="k">today</div></div>
        <div><div class="v">${upNext.length}</div><div class="k">upcoming</div></div>
        <div><div class="v" style="font-size:12px;padding-top:3px">${esc(d.pco)}</div><div class="k">licence</div></div>
      </div>
      <div class="dr-next">${next ? `Next: <b style="color:var(--text)">${timeLabel(next.start)}</b> — ${esc(next.rider || 'Booking')}${next.pickup ? ' · ' + esc(next.pickup.n) : ''}${next.code ? ` · code <b>${next.code}</b>` : ''}` : 'No upcoming bookings.'}</div>
      <div class="dr-foot">
        <button class="btn sm" onclick="openDriverModal('${d.id}')">Edit profile</button>
        ${d.status === 'on_journey'
          ? `<button class="btn sm" disabled title="Finish the journey from the journey screen first">🚗 driving…</button>`
          : `<select class="duty-sel" onchange="assignStatus('${d.id}', this.value)" title="Duty status">${['online', 'on_job', 'break', 'offline'].map((s) => `<option value="${s}" ${d.status === s ? 'selected' : ''}>${DRV_STATUS[s].icon} ${DRV_STATUS[s].label}</option>`).join('')}</select>`}
      </div>
    </div>`;
  };
  return `
  <div class="page-head">
    <div><h1 class="page-title">Fleet</h1>
    <div class="page-desc">Every driver gets their own routed diary under one account. Off-duty drivers keep existing bookings but get no new routed jobs.</div></div>
  </div>
  <div class="fleet-grid">
    ${S.state.drivers.map(card).join('')}
    <button class="dr-add" onclick="openDriverModal()">＋ Add driver</button>
  </div>`;
}
function openDriverModal(id) {
  const d = id ? drv(id) : null;
  const cities = Object.values(S.state.cities);
  openModal(`
    <h2>${d ? 'Edit driver' : 'Add driver'}</h2>
    <div class="msub">${d ? esc(d.name) : 'They’ll immediately join the routing pool and get their own synced diary.'}</div>
    <form onsubmit="return submitDriver(event, '${id || ''}')">
      <div class="form-row"><label>Full name</label><input class="input" name="name" value="${d ? esc(d.name) : ''}" required placeholder="e.g. Jordan Blake"></div>
      <div class="grid2">
        <div class="form-row"><label>Vehicle</label><input class="input" name="vehicle" value="${d ? esc(d.vehicle) : ''}" placeholder="Toyota Prius"></div>
        <div class="form-row"><label>Reg plate</label><input class="input" name="reg" value="${d ? esc(d.reg) : ''}" placeholder="AB12 CDE"></div>
      </div>
      <div class="grid2">
        <div class="form-row"><label>PCO licence no.</label><input class="input" name="pco" value="${d ? esc(d.pco) : ''}" placeholder="PCO-123456"></div>
        <div class="form-row"><label>Home city</label><select class="input" name="city">
          ${cities.map((ct) => `<option value="${ct.key}" ${d && d.home && d.home.key === ct.key ? 'selected' : ''}>${esc(ct.name)}</option>`).join('')}
        </select></div>
      </div>
      <div class="m-actions">
        <button class="btn ghost" type="button" onclick="closeModal()">Cancel</button>
        <button class="btn primary" type="submit">${d ? 'Save changes' : 'Add to fleet'}</button>
      </div>
    </form>`);
}
async function submitDriver(e, id) {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = { name: f.get('name'), vehicle: f.get('vehicle'), reg: f.get('reg'), pco: f.get('pco'), city: f.get('city') };
  try {
    await api(id ? `/api/drivers/${id}/edit` : '/api/drivers', 'POST', body);
    closeModal(); toast(id ? 'Driver updated' : 'Driver added to the fleet', 'ok');
  } catch (err) { toast(err.message, 'err'); }
  refresh(); return false;
}
async function toggleDriver(id) { try { await api(`/api/drivers/${id}/toggle`, 'POST'); } catch (e) { toast(e.message, 'err'); } refresh(); }
async function setDriverStatus(id, status, breakMin) {
  try {
    await api(`/api/drivers/${id}/status`, 'POST', { status, breakMin });
    const st = DRV_STATUS[status];
    const msg = { online: '🟢 Accepting — job offers will route to you', on_job: '🚕 On a job — no new offers until you\'re back', break: `☕ On a break${breakMin ? ` — back in ${breakMin} min` : ''}`, offline: '⚫ Offline — see you next shift' }[status];
    toast(msg || (st ? st.label : status), status === 'online' ? 'ok' : 'warn');
  } catch (e) { toast(e.message, 'err'); }
  refresh();
}
/* duty-status picker: Accepting / On job / Break / Offline (On journey is set by journey mode) */
function openStatusPicker() {
  const d = myDriver();
  if (!d) return;
  if (d.status === 'on_journey') return toast('🚗 You’re on a journey — complete it from the journey screen first', 'warn');
  const opt = (s, desc) => {
    const st = DRV_STATUS[s];
    return `<button class="duty-opt ${d.status === s ? 'cur' : ''}" onclick="pickStatus('${s}')">
      <span class="d-ico">${st.icon}</span>
      <span class="d-txt"><b>${st.label}</b><span>${desc}</span></span>
      ${d.status === s ? '<span class="d-tick">✓</span>' : ''}
    </button>`;
  };
  const breakBtns = [15, 30, 45, 60].map((m) => `<button class="btn sm" onclick="pickBreak(${m})">${m} min</button>`).join('');
  openModal(`
    <h2>Your duty status</h2>
    <div class="msub" style="margin-bottom:14px">Only <b>Accepting</b> receives routed job offers. Everything else pauses them.</div>
    <div class="duty-list">
      ${opt('online', 'Offers route to you as they land')}
      ${opt('on_job', 'Working a job not tracked in FareFlow')}
      ${opt('offline', 'Off duty — finished for the day')}
    </div>
    <div class="duty-break ${d.status === 'break' ? 'cur' : ''}">
      <div class="duty-break-head"><span class="d-ico">☕</span><b>On a break</b>${d.status === 'break' ? '<span class="d-tick">✓</span>' : ''}</div>
      <div class="duty-break-desc">Pick a length and you’re automatically back to Accepting when it ends${d.status === 'break' && d.breakUntil ? ` — currently back ~${fmtHM(d.breakUntil)}` : ''}.</div>
      <div class="duty-break-btns">${breakBtns}<button class="btn sm" onclick="pickBreak(0)">Until I’m back</button></div>
    </div>
    <div class="m-actions"><button class="btn" onclick="closeModal()">Done</button></div>`);
}
function pickStatus(s) { closeModal(); const d = myDriver(); if (d) setDriverStatus(d.id, s); }
function pickBreak(mins) { closeModal(); const d = myDriver(); if (d) setDriverStatus(d.id, 'break', mins || undefined); }
function assignStatus(id, s) { setDriverStatus(id, s); }

/* -------------------------------------------------------------- channels */
function renderChannels() {
  const list = Object.values(S.state.channels);
  const card = (c) => {
    const isPaused = c.status === 'paused';
    const todayStr = new Date().toDateString();
    const done = blocks().filter((b) => b.channelId === c.id && b.status === 'completed' && new Date(b.start).toDateString() === todayStr);
    const holdsOn = blocks().reduce((n, b) => n + (b.holds && b.holds[c.id] && b.holds[c.id].state === 'blocked' ? 1 : 0), 0);
    const failed = blocks().flatMap((b) => Object.entries(b.holds || {}).filter(([cid, hd]) => cid === c.id && hd.state === 'failed').map(() => b));
    const earned = done.reduce((s, b) => s + (b.fare || 0), 0);
    return `<div class="ch-card ${isPaused ? 'paused' : ''}" style="--chc:${c.color}">
      <div class="ch-head">
        <div class="ch-logo">${esc(c.name[0])}</div>
        <div>
          <div class="ch-name">${esc(c.name)}</div>
          <div class="ch-sub">${c.id === 'direct'
            ? 'Phone &amp; concierge bookings (built in)'
            : `${c.latency[0]}–${c.latency[1]} ms push · ${(c.reliability * 100).toFixed(1)}% uptime (sim) · <b style="color:${S.state.drivers.some((d) => d.connections && d.connections[c.id]) ? 'inherit' : 'var(--warn)'}">${S.state.drivers.filter((d) => d.connections && d.connections[c.id]).length}/${S.state.drivers.length} drivers linked</b>`}</div>
        </div>
        <div class="ch-body"><span class="pill ${isPaused ? 'mut' : 'ok'}">${isPaused ? 'paused' : 'connected'}</span></div>
      </div>
      <div class="ch-stats">
        <div class="cs"><div class="v">${done.length}</div><div class="k">trips today</div></div>
        <div class="cs"><div class="v">${GBP(earned)}</div><div class="k">earned today</div></div>
        <div class="cs"><div class="v">${holdsOn}</div><div class="k">slots blocked</div></div>
      </div>
      ${failed.length ? `<div class="hold-alert">⚠ ${failed.length} block push${failed.length > 1 ? 'es' : ''} failed
        <button class="btn sm" style="margin-left:auto" onclick="retryHold('${failed[0].id}','${c.id}')">Retry</button></div>` : ''}
      <div class="ch-foot">
        <span>${c.lastSyncAt ? 'Last sync ' + fmtHM(c.lastSyncAt) : (isPaused ? 'Offline' : 'Awaiting first sync')}</span>
        ${c.id === 'direct' ? '<span class="muted">always on</span>' : `<button class="btn sm ${isPaused ? 'primary' : ''}" onclick="toggleChannel('${c.id}')">${isPaused ? 'Connect' : 'Pause'}</button>`}
      </div>
    </div>`;
  };
  const connected = Object.values(S.state.channels).filter((c) => c.id !== 'direct' && c.status === 'connected').length;
  return `
  <div class="page-head">
    <div>
      <h1 class="page-title">Channels</h1>
      <div class="page-desc">Fleet-wide distribution channels. Pausing keeps existing blocks; reconnecting catches the whole diary back up.</div>
    </div>
    <button class="btn ${connected ? '' : 'primary'}" onclick="toggleMaster()">${connected ? 'Pause all' : 'Connect all'}</button>
  </div>
  <div class="ch-grid">${list.map(card).join('')}</div>`;
}

/* -------------------------------------------------------------- messages */
function renderMessages() {
  const msgs = S.state.messages;
  const tickFor = (m) => m.status === 'delivered' ? '<span class="tick delivered">✓✓ delivered</span>'
    : m.status === 'sent' ? '<span class="tick sent">✓ sent</span>' : '<span class="tick queued">🕓 queued…</span>';
  const threads = {};
  for (const m of msgs) { const key = m.blockId || ('to:' + m.to); (threads[key] = threads[key] || []).push(m); }
  const threadIds = Object.keys(threads).sort((a, b) => new Date(threads[b][0].t) - new Date(threads[a][0].t));
  const highlightCodes = (txt) => esc(txt)
    .replace(/fflow\.link\/t\/([\w-]+)/g, '<a href="/t/$1" target="_blank" rel="noopener" style="color:var(--accent);word-break:break-all">fflow.link/t/$1</a>')
    .replace(/\b(\d{4})\b/g, '<span class="code-inline">$1</span>');
  const threadHtml = (tid) => {
    const list = threads[tid].slice().sort((a, b) => new Date(a.t) - new Date(b.t));
    const first = list[0];
    const bMsg = list.find((m) => m.blockId);
    const b = bMsg ? S.state.blocks[bMsg.blockId] : null;
    const head = b
      ? { who: b.rider, meta: `${timeLabel(b.start)} pickup · ${b.pickup ? esc(b.pickup.n) : ''} · ${b.status}`, phone: first.to }
      : { who: first.kind === 'promo' ? 'Install-link request' : first.to, meta: first.kind, phone: first.to };
    return `<div class="thread">
      <div class="thread-head">
        <span class="msg-type ${first.type}">${first.type === 'whatsapp' ? '🟢' : '💬'}</span>
        <span class="who">${esc(head.who)}</span>
        <span class="meta">${head.meta}</span>
        <span style="margin-left:auto" class="meta">${esc(head.phone)}</span>
        ${b && b.riderPhone ? `<button class="btn sm" onclick="resendMsg('${b.id}')">Resend</button>` : ''}
      </div>
      <div class="thread-body">
        ${list.map((m) => `<div>
          <div class="bubble ${m.type === 'whatsapp' ? 'wa' : ''}">${highlightCodes(m.body)}</div>
          <div class="bubble-meta"><span>${m.kind} · ${m.type}</span><span>${fmtHM(m.t)}</span>${tickFor(m)}</div>
        </div>`).join('')}
      </div>
    </div>`;
  };
  return `
  <div class="page-head">
    <div><h1 class="page-title">Messages</h1>
    <div class="page-desc">Automated SMS / WhatsApp confirmations and reminders for direct bookings (gateway simulated, receipts live). Every message carries the rider's secret pickup code.</div></div>
  </div>
  ${threadIds.length ? threadIds.map(threadHtml).join('') : `
    <div class="card empty-state"><div class="big">📲</div>No messages yet.<br>
    <span style="font-size:12px">Add a <b>direct booking</b> with a rider phone number and the confirmation goes out automatically — with the pickup code.</span></div>`}
  <div class="hint" style="margin-top:16px">🔔 Riders with a phone number on file also get an automatic reminder ~60 minutes before pickup, with their code repeated. Cancelling a booking texts the rider too.</div>`;
}
async function resendMsg(blockId) {
  try { await api('/api/messages/resend', 'POST', { blockId }); toast('Confirmation re-queued', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
  refresh();
}

/* -------------------------------------------------------------- earnings */
function renderEarnings() {
  const done = blocks().filter((b) => b.status === 'completed' && b.fare);
  const todayStr = new Date().toDateString();
  const today = done.filter((b) => new Date(b.start).toDateString() === todayStr);
  const ws = startOfWeek(0);
  const week = done.filter((b) => new Date(b.start) >= ws);
  const sum = (arr) => arr.reduce((s, b) => s + b.fare, 0);
  const miles = (arr) => arr.reduce((s, b) => s + (b.distanceMi || 0), 0);
  const ppm = week.length ? sum(week) / Math.max(0.1, miles(week)) : 0;
  const days = [...Array(7)].map((_, i) => { const d = new Date(ws); d.setDate(d.getDate() + i); return d; });
  const dayTotals = days.map((d) => sum(done.filter((b) => new Date(b.start).toDateString() === d.toDateString())));
  const maxDay = Math.max(1, ...dayTotals);
  const byCh = {};
  for (const b of week) { byCh[b.channelId] = byCh[b.channelId] || { amt: 0, n: 0 }; byCh[b.channelId].amt += b.fare; byCh[b.channelId].n++; }
  const byDrv = {};
  for (const b of week) { byDrv[b.driverId] = byDrv[b.driverId] || { amt: 0, n: 0 }; byDrv[b.driverId].amt += b.fare; byDrv[b.driverId].n++; }
  const chRows = Object.entries(byCh).sort((a, b2) => b2[1].amt - a[1].amt);
  const drvRows = Object.entries(byDrv).sort((a, b2) => b2[1].amt - a[1].amt);
  const maxCh = Math.max(1, ...chRows.map(([, v]) => v.amt), ...drvRows.map(([, v]) => v.amt));
  const completedBookings = week.filter((b) => b.kind === 'booking');
  const verifiedPct = completedBookings.length ? Math.round(completedBookings.filter((b) => b.pickupVerifiedAt).length / completedBookings.length * 100) : 0;
  const delivered = S.state.messages.filter((m) => m.status === 'delivered').length;
  const recent = done.slice().sort((a, b) => new Date(b.end) - new Date(a.end)).slice(0, 10);
  return `
  <div class="page-head">
    <div><h1 class="page-title">Earnings</h1><div class="page-desc">All channels, all drivers, one ledger. Settlements are simulated.</div></div>
  </div>
  <div class="stat-cards">
    <div class="stat-card"><div class="k">Today</div><div class="v">${GBP(sum(today))}</div><div class="s">${today.length} trip${today.length === 1 ? '' : 's'}</div></div>
    <div class="stat-card"><div class="k">This week</div><div class="v">${GBP(sum(week))}</div><div class="s">${week.length} trips · ${miles(week).toFixed(0)} mi</div></div>
    <div class="stat-card"><div class="k">Avg £/mile (wk)</div><div class="v">£${ppm.toFixed(2)}</div><div class="s">target ≥ £${S.state.settings.minPerMile.toFixed(2)}</div></div>
    <div class="stat-card"><div class="k">Pickup-code verification</div><div class="v">${verifiedPct}%</div><div class="s">this week · ${delivered} messages delivered</div></div>
  </div>
  <div class="two-col">
    <div class="panel"><h3>This week by day</h3>
      <div class="chart-day">
        ${days.map((d, i) => `<div class="col"><span class="cv">${dayTotals[i] ? '£' + dayTotals[i].toFixed(0) : ''}</span><div class="bar" style="height:${dayTotals[i] / maxDay * 100}%" title="${GBP(dayTotals[i])}"></div><span class="cl">${d.toLocaleDateString('en-GB', { weekday: 'short' })}</span></div>`).join('')}
      </div>
    </div>
    <div class="panel"><h3>Channels this week</h3>
      ${chRows.length ? chRows.map(([cid, v]) => `<div class="share-row">
        <span class="nm"><span style="width:9px;height:9px;border-radius:3px;background:${ch(cid).color}"></span>${esc(ch(cid).name)}</span>
        <span class="barwrap"><span class="fill" style="display:block;width:${v.amt / maxCh * 100}%;background:${ch(cid).color}"></span></span>
        <span class="amt">${GBP(v.amt)}</span><span class="cnt">${v.n}</span>
      </div>`).join('') : '<div class="muted" style="padding:12px 0">No completed trips this week yet.</div>'}
      <h3 style="margin-top:18px">Drivers this week</h3>
      ${drvRows.length ? drvRows.map(([did, v]) => `<div class="share-row">
        <span class="nm"><span style="width:9px;height:9px;border-radius:50%;background:${drvColor(did)}"></span>${esc(drvName(did))}</span>
        <span class="barwrap"><span class="fill" style="display:block;width:${v.amt / maxCh * 100}%;background:${drvColor(did)}"></span></span>
        <span class="amt">${GBP(v.amt)}</span><span class="cnt">${v.n}</span>
      </div>`).join('') : '<div class="muted" style="padding:12px 0">—</div>'}
    </div>
  </div>
  <div class="panel"><h3>Latest completed trips</h3>
    ${recent.length ? recent.map((b) => `<div class="hist-row">
      <span class="chip"><span class="cdot" style="background:${ch(b.channelId).color}"></span>${esc(ch(b.channelId).name)}</span>
      <span class="avatar" style="width:22px;height:22px;font-size:9px;background:${drvColor(b.driverId)}">${drvInit(b.driverId)}</span>
      <span class="who">${esc(b.rider || '')} · ${b.pickup ? esc(b.pickup.n) : ''} → ${b.dropoff ? esc(b.dropoff.n) : ''}</span>
      ${b.pickupVerifiedAt ? '<span style="color:var(--lime)" title="Code verified at pickup">✓</span>' : ''}
      <span class="muted" style="font-size:12px">${timeLabel(b.start)}</span>
      <span class="fare">${GBP(b.fare)}</span>
    </div>`).join('') : '<div class="muted" style="padding:8px 0">No trips yet.</div>'}
  </div>`;
}

/* -------------------------------------------------------------- settings */
const CONN_HINT = { uber: 'e.g. UBR-4471290', bolt: 'e.g. BLT-5522091', freenow: 'e.g. FN-209931', gett: 'e.g. GTT-70144', veezu: 'e.g. VZ-33920', addisonlee: 'e.g. AL-51403' };
function renderSettings() {
  const s = S.state.settings;
  const feedUrl = `${location.origin}/api/calendar/${s.feedToken}.ics`;
  const me = S.me || {};
  const selD = S.state.drivers.find((d) => d.id === S.connDriver) || S.state.drivers.find((d) => d.id === me.driverId) || S.state.drivers[0];
  S.connDriver = selD ? selD.id : null;
  const connRows = selD ? Object.values(S.state.channels).filter((c2) => c2.id !== 'direct').map((c2) => {
    const conn = selD.connections && selD.connections[c2.id];
    return `<div class="conn-row">
      <span class="chip" style="min-width:118px"><span class="cdot" style="background:${c2.color}"></span>${esc(c2.name)}</span>
      ${conn
        ? `<span class="conn-ref mono">${esc(conn.ref)}</span><span class="muted" style="font-size:11px;flex-shrink:0">linked ${new Date(conn.linkedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span><button class="btn sm danger ghost" onclick="unlinkConn('${c2.id}')">Unlink</button>`
        : `<input class="input conn-input" id="conn-${c2.id}" placeholder="${CONN_HINT[c2.id] || 'Driver number'}" maxlength="20"><button class="btn sm primary" onclick="linkConn('${c2.id}')">Link</button>`}
    </div>`;
  }).join('') : '';
  const linkedCount = selD && selD.connections ? Object.keys(selD.connections).length : 0;
  return `
  <div class="page-head">
    <div><h1 class="page-title">Settings</h1><div class="page-desc">Account, app connections and fleet-wide automation rules.</div></div>
  </div>
  <div class="set-grid">
    <div>
      <div class="panel" style="margin-bottom:16px">
        <h3>Signed-in account</h3>
        <div class="acct-head">
          <span class="avatar lg" style="background:${me.driverId ? drvColor(me.driverId) : '#38BDF8'}">${esc((me.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>
          <div style="flex:1">
            <b style="font-size:15.5px">${esc(me.name || '')}</b>
            <div class="muted" style="font-size:12.5px">${[me.email, me.phone].filter(Boolean).map(esc).join(' · ')}</div>
            <div class="muted" style="font-size:12px;margin-top:2px">${me.driverId ? `Driver profile: <a href="#/fleet" style="color:var(--accent)">${esc(drvName(me.driverId))}</a>` : 'Fleet owner account'}</div>
          </div>
          <button class="btn danger ghost sm" onclick="logout()">Sign out</button>
        </div>
        <div class="hint">🔐 You can sign in with either your <b>email</b> or your <b>mobile number</b> plus this account's password. Sessions stay signed in for 30 days.</div>
      </div>
      <div class="panel">
        <h3>App connections — driver numbers</h3>
        <div class="tab-note" style="margin-bottom:12px">Each company issues its drivers a unique number. Enter it here so ${selD ? esc(selD.name.split(' ')[0]) : 'the driver'} can receive that app's jobs — FareFlow only routes an app's offers to drivers linked on it.</div>
        <div class="form-row"><label>Driver</label>
          <select class="input" onchange="setConnDriver(this.value)">
            ${S.state.drivers.map((d) => `<option value="${d.id}" ${S.connDriver === d.id ? 'selected' : ''}>${esc(d.name)}${d.status !== 'online' ? ' (' + drvStatus(d).icon + ' ' + drvStatus(d).label + ')' : ''}</option>`).join('')}
          </select>
        </div>
        <div class="conn-summary">${Object.values(S.state.channels).filter((c2) => c2.id !== 'direct').map((c2) => {
          const conn = selD && selD.connections && selD.connections[c2.id];
          return `<i style="background:${conn ? c2.color : 'var(--card3)'};border:1px solid ${conn ? 'transparent' : 'var(--line2)'}" title="${esc(c2.name)}${conn ? ': ' + esc(conn.ref) : ': not linked'}"></i>`;
        }).join('')}
          <span class="muted" style="font-size:11.5px;margin-left:6px">${linkedCount}/6 apps linked</span></div>
        <div style="margin-top:14px">${connRows}</div>
      </div>
    </div>
    <div>
      <div class="panel" style="margin-bottom:16px">
        <h3>Calendar feed (two-way)</h3>
        <div class="cal-section">
          <h4>Subscribe — your diary in Google/Apple Calendar</h4>
          <div class="feed-link">
            <input class="input" id="feedUrl" readonly value="${feedUrl}">
            <button class="btn sm" onclick="copyFeedUrl()">Copy</button>
          </div>
          <div class="muted" style="font-size:11.5px;margin-top:6px">Per-driver: append <code>?driver=drv_alex</code> etc. Feed updates live as bookings land.</div>
        </div>
        <button class="btn" onclick="openCalModal()">Open calendar tools (export / import / reset link)</button>
      </div>
      <div class="panel" style="margin-bottom:16px">
      <h3>Automation rules</h3>
      <div class="switch-row">
        <div class="txt"><div class="t">Auto-decline when no driver is free</div><div class="d">Decline incoming requests that no <b>linked</b> online driver can cover — protects acceptance ratings on every app.</div></div>
        <label class="switch"><input type="checkbox" id="swOverlap" ${s.autoDeclineOverlap ? 'checked' : ''} onchange="saveSwitches()"><span class="sl"></span></label>
      </div>
      <div class="switch-row">
        <div class="txt"><div class="t">Auto-accept profitable jobs</div><div class="d">Accept requests at or above your minimum £/mile, then block the slot everywhere.</div></div>
        <label class="switch"><input type="checkbox" id="swAccept" ${s.autoAccept ? 'checked' : ''} onchange="saveSwitches()"><span class="sl"></span></label>
      </div>
      <div class="form-row" style="margin-top:14px"><label>Minimum £ per mile</label>
        <input class="input" type="number" step="0.1" min="0.5" id="inPpm" value="${s.minPerMile}" onchange="saveSwitches()">
      </div>
      <div class="form-row"><label>Buffer between jobs (minutes)</label>
        <select class="input" id="inBuf" onchange="saveSwitches()">
          ${[0, 5, 10, 15, 20, 30, 45].map((m) => `<option value="${m}" ${m === s.bufferMin ? 'selected' : ''}>${m === 0 ? 'None' : m + ' min'}</option>`).join('')}
        </select>
        <div class="muted" style="font-size:11.5px;margin-top:5px">Applied fleet-wide after every job so back-to-back bookings never overlap — and blocks pushed to all apps include it.</div>
      </div>
      </div>
      <div class="panel">
        <h3>Pickup codes</h3>
        <div class="tab-note">Every accepted booking gets a <b>4-digit secret code</b>. It's sent to the rider in their SMS/WhatsApp confirmation and reminder; the driver sees it in the diary and enters the rider's code at pickup to verify both identities. Three wrong attempts would flag rider support. Earnings shows the fleet verification rate.</div>
      </div>
    </div>
  </div>`;
}
async function saveSwitches() {
  await api('/api/settings', 'POST', {
    autoDeclineOverlap: $('#swOverlap').checked, autoAccept: $('#swAccept').checked,
    minPerMile: parseFloat($('#inPpm').value) || 2.2, bufferMin: parseInt($('#inBuf').value, 10),
  });
  toast('Rules updated', 'ok'); refresh();
}
function copyFeedUrl() {
  const el = $('#feedUrl');
  if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(() => toast('Feed URL copied', 'ok'));
  else { el.select(); document.execCommand('copy'); toast('Feed URL copied', 'ok'); }
}
function setConnDriver(id) { S.connDriver = id; render(); }
async function linkConn(cid) {
  const input = document.getElementById('conn-' + cid);
  const ref = (input ? input.value : '').trim();
  if (!ref) { toast('Enter the driver number first', 'warn'); return; }
  try {
    await api(`/api/drivers/${S.connDriver}/connection`, 'POST', { channelId: cid, ref });
    toast(`${ch(cid).name} linked as ${ref.toUpperCase()} ✓`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
  refresh();
}
async function unlinkConn(cid) {
  if (!confirm(`Unlink this driver from ${ch(cid).name}? They will stop receiving its jobs immediately.`)) return;
  try {
    await api(`/api/drivers/${S.connDriver}/connection`, 'POST', { channelId: cid, remove: true });
    toast(`${ch(cid).name} unlinked`, 'warn');
  } catch (e) { toast(e.message, 'err'); }
  refresh();
}

/* ------------------------------------------------------- calendar modal */
function openCalModal() {
  const s = S.state.settings;
  const feedUrl = `${location.origin}/api/calendar/${s.feedToken}.ics`;
  openModal(`
    <h2>Calendar feed</h2>
    <div class="msub">Two-way sync: subscribe to your FareFlow diary anywhere, and import external .ics files as fleet-wide blocks.</div>
    <div class="cal-section">
      <h4>Export · subscribe (read-only)</h4>
      <div class="feed-link">
        <input class="input" id="calFeedUrl" readonly value="${feedUrl}">
        <button class="btn sm" onclick="copyCalUrl()">Copy</button>
        <a class="btn sm ghost" href="${feedUrl}" target="_blank" rel="noopener">Open</a>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:6px;line-height:1.6">
        Google Calendar → “Other calendars” → “From URL”. Per-driver feeds:<br>
        ${S.state.drivers.slice(0, 4).map((d) => `<code style="font-size:10.5px">…ics?driver=${d.id}</code> · ${esc(d.name)}`).join('<br>')}
      </div>
      <div style="margin-top:10px"><button class="btn sm danger ghost" onclick="regenFeed()">Reset feed URL (kill old links)</button></div>
    </div>
    <div class="cal-section">
      <h4>Import · paste .ics content</h4>
      <div class="form-row"><label>Assign imported events to</label>
        <select class="input" id="icsDriver">
          <option value="all">🌐 Whole fleet</option>
          ${S.state.drivers.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
        </select>
      </div>
      <textarea class="input" id="icsText" placeholder="BEGIN:VCALENDAR&#10;BEGIN:VEVENT&#10;DTSTART:20260809T070000Z&#10;DTEND:20260809T080000Z&#10;SUMMARY:MOT at Kwik Fit&#10;END:VEVENT&#10;END:VCALENDAR"></textarea>
      <div class="m-actions" style="margin-top:10px">
        <button class="btn ghost" onclick="closeModal()">Close</button>
        <button class="btn primary" onclick="importICS()">Import → block on all apps</button>
      </div>
    </div>`);
}
function copyCalUrl() {
  const el = $('#calFeedUrl');
  if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(() => toast('Feed URL copied', 'ok'));
  else { el.select(); document.execCommand('copy'); toast('Feed URL copied', 'ok'); }
}
async function regenFeed() {
  if (!confirm('Regenerate the feed URL? Any calendars subscribed to the old URL will stop updating.')) return;
  await api('/api/settings', 'POST', { regenFeed: true });
  closeModal(); toast('Feed URL regenerated', 'warn'); refresh(); openCalModal();
}
async function importICS() {
  const ics = $('#icsText').value;
  const driverId = $('#icsDriver').value;
  try {
    const r = await api('/api/calendar/import', 'POST', { ics, driverId });
    closeModal();
    toast(`Imported ${r.imported} event${r.imported === 1 ? '' : 's'} — blocked on all apps${r.skipped ? ` (${r.skipped} skipped)` : ''}`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
  refresh();
}

/* --------------------------------------------------------------- actions */
async function acceptReq(id) { try { await api(`/api/requests/${id}/accept`, 'POST'); } catch (e) { toast(e.message, 'err'); } refresh(); }
async function declineReq(id) { try { await api(`/api/requests/${id}/decline`, 'POST'); } catch (e) { toast(e.message, 'err'); } refresh(); }
async function assignReq(id, driverId) {
  try { await api(`/api/requests/${id}/assign`, 'POST', { driverId }); }
  catch (e) { toast(e.message, 'err'); }
  refresh();
}
async function retryHold(blockId, channelId) { try { await api('/api/holds/retry', 'POST', { blockId, channelId }); } catch (e) { toast(e.message, 'err'); } refresh(); }
async function cancelBlock(id) {
  if (!confirm('Cancel this slot and release the block on all other apps?')) return;
  try { await api(`/api/blocks/${id}/cancel`, 'POST'); closeModal(); } catch (e) { toast(e.message, 'err'); }
  refresh();
}
async function toggleChannel(id) {
  const c = S.state.channels[id];
  try { await api(`/api/channels/${id}`, 'POST', { status: c.status === 'connected' ? 'paused' : 'connected' }); } catch (e) { toast(e.message, 'err'); }
  refresh();
}
async function toggleMaster() {
  const online = Object.values(S.state.channels).some((c) => c.id !== 'direct' && c.status === 'connected');
  try { await api('/api/master', 'POST', { online: !online }); } catch (e) { toast(e.message, 'err'); }
  refresh();
}

/* ------------------------------------------------------ direct / manual */
function defaultDate(offsetDays = 0) { const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10); }
function nextHour() { const d = new Date(nowMs() + 3600000); return `${String(d.getHours()).padStart(2, '0')}:00`; }
function driverOptions(includeAll) {
  return `${includeAll ? '<option value="all">🌐 Whole fleet</option>' : ''}` +
    S.state.drivers.map((d) => `<option value="${d.id}">${esc(d.name)}${d.status !== 'online' ? ' (' + drvStatus(d).icon + ' ' + drvStatus(d).label + ')' : ''}</option>`).join('');
}
function openDirectModal() {
  openModal(`
    <h2>New direct booking</h2>
    <div class="msub">Phone, hotel concierge or repeat customer. Instantly blocks every app, and texts the rider their confirmation + secret pickup code.</div>
    <form onsubmit="return submitDirect(event)">
      <div class="form-row"><label>Passenger / label</label><input class="input" name="rider" placeholder="e.g. Mrs Patel — Heathrow drop" required></div>
      <div class="grid2">
        <div class="form-row"><label>Rider phone</label><input class="input" name="phone" placeholder="+44 7700 900123"></div>
        <div class="form-row"><label>Confirm via</label>
          <select class="input" name="msgType"><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select>
        </div>
      </div>
      <div class="form-row"><label>Pickup</label><input class="input" name="pickup" placeholder="e.g. Canary Wharf, E14" required></div>
      <div class="form-row"><label>Drop-off</label><input class="input" name="dropoff" placeholder="e.g. Heathrow Terminal 5" required></div>
      <div class="grid2">
        <div class="form-row"><label>Date</label><input class="input" type="date" name="date" value="${defaultDate()}" required></div>
        <div class="form-row"><label>Pickup time</label><input class="input" type="time" name="time" value="${nextHour()}" required></div>
      </div>
      <div class="grid2">
        <div class="form-row"><label>Duration (min)</label><input class="input" type="number" name="durationMin" value="45" min="5"></div>
        <div class="form-row"><label>Quoted fare (£)</label><input class="input" type="number" step="0.5" name="fare" placeholder="optional"></div>
      </div>
      <div class="form-row"><label>Driver</label><select class="input" name="driverId">${driverOptions(false)}</select></div>
      <div class="m-actions">
        <button class="btn ghost" type="button" onclick="closeModal()">Cancel</button>
        <button class="btn primary" type="submit">Add, text rider &amp; block all apps</button>
      </div>
    </form>`);
}
async function submitDirect(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/api/bookings/direct', 'POST', {
      rider: f.get('rider'), phone: f.get('phone'), msgType: f.get('msgType'),
      pickup: f.get('pickup'), dropoff: f.get('dropoff'), date: f.get('date'), time: f.get('time'),
      durationMin: f.get('durationMin'), fare: f.get('fare') ? +f.get('fare') : null, driverId: f.get('driverId'),
    });
    closeModal(); toast('Direct booking added — rider texted their code, slot blocked everywhere', 'ok');
  } catch (err) { toast(err.message, 'err'); }
  refresh(); return false;
}
function openManualModal() {
  openModal(`
    <h2>Block time</h2>
    <div class="msub">School run, MOT, lunch, prayer break — anything you don't want bookings during.</div>
    <form onsubmit="return submitManual(event)">
      <div class="form-row"><label>Reason</label><input class="input" name="note" placeholder="e.g. School run, gym, dentist" required></div>
      <div class="grid2">
        <div class="form-row"><label>Date</label><input class="input" type="date" name="date" value="${defaultDate()}" required></div>
        <div class="form-row"><label>Start</label><input class="input" type="time" name="time" value="${nextHour()}" required></div>
      </div>
      <div class="grid2">
        <div class="form-row"><label>Duration</label>
          <select class="input" name="durationMin">${[15, 30, 45, 60, 90, 120, 180, 240].map((m) => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${m} min</option>`).join('')}</select>
        </div>
        <div class="form-row"><label>Driver</label><select class="input" name="driverId">${driverOptions(true)}</select></div>
      </div>
      <div class="m-actions">
        <button class="btn ghost" type="button" onclick="closeModal()">Cancel</button>
        <button class="btn primary" type="submit">Block on all apps</button>
      </div>
    </form>`);
}
async function submitManual(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/api/blocks', 'POST', { note: f.get('note'), date: f.get('date'), time: f.get('time'), durationMin: f.get('durationMin'), driverId: f.get('driverId') });
    closeModal(); toast('Time blocked — pushed to every app', 'ok');
  } catch (err) { toast(err.message, 'err'); }
  refresh(); return false;
}

/* ----------------------------------------------------------------- tick */
setInterval(() => {
  const d = new Date();
  $('#clock').textContent = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  document.querySelectorAll('.cd-fill').forEach((el) => {
    const total = +el.dataset.exp - +el.dataset.born;
    const left = Math.max(0, +el.dataset.exp - nowMs());
    el.style.width = (left / total * 100) + '%';
  });
  document.querySelectorAll('.cd-secs').forEach((el) => {
    el.textContent = Math.max(0, Math.round((+el.dataset.exp2 - nowMs()) / 1000)) + 's';
  });
  positionNowLine();
}, 1000);

/* ----------------------------------------------------------------- boot */
function setRoute() {
  const r = (location.hash.replace('#/', '') || 'diary').split('?')[0];
  S.route = ['diary', 'requests', 'map', 'demand', 'fleet', 'channels', 'messages', 'earnings', 'api', 'settings', 'faq', 'howto', 'support'].includes(r) ? r : 'diary';
  render();
}
function startAuthed() {
  S.authed = true;
  document.body.classList.remove('auth-mode');
  if (!S.es) setupSSE();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js')
      .then((r) => r && r.update && r.update())
      .catch(() => {});
    // self-heal stale caches: when a new SW takes over, reload once to get fresh code
    if (!S.swReloadHooked) {
      S.swReloadHooked = true;
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
    }
  }
  setRoute();
}

/* ---------------------------------------------------------- auth screens */
function showLogin() {
  if (S.es) { try { S.es.close(); } catch (e) {} S.es = null; }
  closeModal();
  document.body.classList.add('auth-mode');
  $('#clock').textContent = '';
  $('#view').innerHTML = `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-left">
        <div class="auth-brand"><img src="/icons/icon-192.png" alt="FareFlow"><div><b>FareFlow</b><span>One diary. Every app.</span></div></div>
        <h2 style="font-size:26px">Welcome back</h2>
        <p class="muted" style="font-size:13.5px;margin:6px 0 18px">Sign in with your <b>email</b> or <b>mobile number</b>.</p>
        <form onsubmit="return doLogin(event)">
          <div class="form-row"><label>Email or mobile number</label>
            <input class="input" id="loginId" autocomplete="username" inputmode="email" placeholder="alex@fareflow.uk · +44 7700 900001" required></div>
          <div class="form-row"><label>Password</label>
            <input class="input" id="loginPw" type="password" autocomplete="current-password" placeholder="••••••••" required></div>
          <div class="auth-err" id="authErr"></div>
          <button class="btn primary" style="width:100%;justify-content:center;padding:13px" type="submit">Sign in →</button>
        </form>
        <div class="auth-switch"><a href="javascript:void(0)" onclick="showRegister()">New to FareFlow? <b>Create an account</b></a></div>
        <div class="demo-block">
          <div class="demo-k">Demo accounts — tap to fill</div>
          <div class="demo-chips">
            <span class="demo-chip" onclick="fillLogin('admin@fareflow.uk','fareflow2026')">👑 Fleet owner</span>
            <span class="demo-chip" onclick="fillLogin('alex@fareflow.uk','driver123')">Alex</span>
            <span class="demo-chip" onclick="fillLogin('sam@fareflow.uk','driver123')">Sam</span>
            <span class="demo-chip" onclick="fillLogin('+447700900003','driver123')">Zara (phone login)</span>
          </div>
        </div>
        <div class="auth-note">Just browsing? <a href="/get" style="color:var(--accent)">See the product tour ↗</a></div>
      </div>
      <div class="auth-side"><div class="auth-side-sh"></div>
        <div class="auth-side-copy">
          <h3>One diary.<br>Every app.<br>Every driver.</h3>
          <p>Accept once — blocked everywhere. Pickup codes, rider tracking links, fleet routing and demand heatmaps, UK-wide.</p>
        </div>
      </div>
    </div>
  </div>`;
  setTimeout(() => { const i = $('#loginId'); if (i) i.focus(); }, 80);
}
function showRegister() {
  closeModal();
  document.body.classList.add('auth-mode');
  $('#view').innerHTML = `
  <div class="auth-wrap">
    <div class="auth-card" style="grid-template-columns:1fr 0.9fr">
      <div class="auth-left">
        <div class="auth-brand"><img src="/icons/icon-192.png" alt="FareFlow"><div><b>FareFlow</b><span>Create your account</span></div></div>
        <h2 style="font-size:26px">Join the fleet</h2>
        <p class="muted" style="font-size:13.5px;margin:6px 0 18px">Your account also creates your driver profile — then link each app with the driver number the company gave you.</p>
        <form onsubmit="return doRegister(event)">
          <div class="form-row"><label>Full name</label><input class="input" id="regName" placeholder="Jordan Blake" required></div>
          <div class="form-row"><label>Email</label><input class="input" id="regEmail" type="email" autocomplete="email" placeholder="you@example.co.uk" required></div>
          <div class="form-row"><label>Mobile number <span class="muted">(optional — also works as your login)</span></label><input class="input" id="regPhone" type="tel" autocomplete="tel" placeholder="+44 7…"></div>
          <div class="form-row"><label>Password</label><input class="input" id="regPw" type="password" autocomplete="new-password" placeholder="6+ characters" minlength="6" required></div>
          <div class="auth-err" id="authErr"></div>
          <button class="btn primary" style="width:100%;justify-content:center;padding:13px" type="submit">Create account &amp; sign in →</button>
        </form>
        <div class="auth-switch"><a href="javascript:void(0)" onclick="showLogin()">Already have an account? <b>Sign in</b></a></div>
      </div>
      <div class="auth-side"><div class="auth-side-sh"></div>
        <div class="auth-side-copy"><h3>Zero double bookings<br>in 60 seconds.</h3><p>Sign in, link your app driver numbers, and let FareFlow keep your whole week clash-free.</p></div>
      </div>
    </div>
  </div>`;
  setTimeout(() => { const i = $('#regName'); if (i) i.focus(); }, 80);
}
function fillLogin(id, pw) { $('#loginId').value = id; $('#loginPw').value = pw; $('#authErr').textContent = ''; }
function authError(msg) {
  const e = $('#authErr');
  if (e) { e.textContent = msg; e.classList.remove('shake'); void e.offsetWidth; e.classList.add('shake'); }
}
async function doLogin(e) {
  e.preventDefault();
  try {
    const { me } = await api('/api/auth/login', 'POST', { identifier: $('#loginId').value, password: $('#loginPw').value });
    S.me = me;
    const { state, serverTime } = await api('/api/state');
    S.state = state; S.serverTimeOffset = new Date(serverTime) - Date.now();
    startAuthed();
    toast(`Welcome back, ${me.name.split(' ')[0]} 👋`, 'ok');
  } catch (err) { authError(err.message); }
  return false;
}
async function doRegister(e) {
  e.preventDefault();
  try {
    const { me } = await api('/api/auth/register', 'POST', {
      name: $('#regName').value, email: $('#regEmail').value, phone: $('#regPhone').value, password: $('#regPw').value,
    });
    S.me = me;
    const { state, serverTime } = await api('/api/state');
    S.state = state; S.serverTimeOffset = new Date(serverTime) - Date.now();
    startAuthed();
    toast(`Welcome aboard, ${me.name.split(' ')[0]} — your driver profile is ready`, 'ok');
  } catch (err) { authError(err.message); }
  return false;
}
async function logout() {
  try { await api('/api/auth/logout', 'POST'); } catch (e) {}
  location.reload();
}

/* ------------------------------------------------------ profile & help hub */
function openProfile() {
  if (!S.me) return;
  const drv = S.me.driverId ? (S.state.drivers || []).find((d) => d.id === S.me.driverId) : null;
  openModal(`
    <div class="prof-head">
      <span class="avatar" style="width:46px;height:46px;font-size:16px;background:${drv ? drv.color : '#38BDF8'}">${esc(S.me.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>
      <div>
        <div style="font-weight:900;font-size:16px">${esc(S.me.name)}</div>
        <div class="muted" style="font-size:12.5px">${esc(S.me.email || '')}${S.me.phone ? ' · ' + esc(S.me.phone) : ''}</div>
        ${drv ? `<div class="muted" style="font-size:12px">🚗 ${esc(drv.vehicle)}${drv.reg ? ' · ' + esc(drv.reg) : ''}${drv.pco ? ' · PCO ' + esc(drv.pco) : ''}</div>` : '<div class="muted" style="font-size:12px">👔 Fleet owner account</div>'}
      </div>
    </div>
    <div class="prof-menu">
      <button onclick="closeModal();location.hash='#/faq'">📘 <b>FAQ</b><span>Answers to the questions drivers ask most</span></button>
      <button onclick="closeModal();location.hash='#/howto'">🧭 <b>How-to guides</b><span>Install, connect apps, accept, verify & more</span></button>
      <button onclick="closeModal();location.hash='#/support'">🆘 <b>Help & support</b><span>Chat, phone, email or open a ticket</span></button>
      <button onclick="closeModal();location.hash='#/settings'">⚙️ <b>Settings</b><span>Auto-accept, buffer, app connections, calendar</span></button>
      <button onclick="closeModal();requestNotify()">🔔 <b>Booking alerts</b><span>System notifications on this device</span></button>
      <button class="danger" onclick="closeModal();logout()">⏻ <b>Sign out</b><span>End this session</span></button>
    </div>`);
}

const FAQ_ITEMS = [
  ['What exactly is FareFlow?', 'A channel manager for drivers — the same idea as hotel tools that stop double bookings across Booking.com and Expedia. Every job offer from every app lands in one inbox; accept once and that slot (plus your buffer) is blocked everywhere else automatically.'],
  ['How do I install it on my phone?', 'iPhone: open the app link in <b>Safari → Share → Add to Home Screen</b>. Android: open in <b>Chrome → ⋮ → Install app</b>. It then runs fullscreen like a native app. See the How-to guides for pictures-in-words.'],
  ['How do I sign in?', 'With your <b>email or mobile number</b> plus your password — either works on the same account. New here? Tap <b>Create an account</b> on the sign-in screen and your driver profile is set up automatically.'],
  ['How does FareFlow know which app jobs are mine?', 'Every company gives you a driver number (Uber ID, Bolt ID…). Link each app in <b>Settings → App connections</b> using that number, and the router only sends that app’s work to drivers linked on it.'],
  ['What is journey mode? (the 🚗 driving lock)', 'Open your booking and tap <b>▶ Start journey</b> — Google Maps opens to the pickup and FareFlow locks everything else so you can’t fiddle with the app while driving. You get a live journey clock, big tap-target navigation buttons, and only ONE thing can interrupt you: new job offers, with a 20-second countdown that declines itself if ignored. Tap <b>✓ Rider on board</b> when they get in to switch navigation to the drop-off, then <b>🏁 Complete job</b> on arrival — you’re instantly back online for the next job.'],
  ['Why did my job decline itself?', 'Two possibilities: the offer expired (offers live 40–80 seconds, like the real apps), or a clashing booking existed — clashing offers are politely declined to protect your acceptance rating.'],
  ['What is the 4-digit pickup code?', 'Every booking gets a code. The rider sees it in their confirmation text and tracking page; they show it at the door, you tap <b>Verify pickup</b> in the booking — proving identity on both sides and stopping wrong-car pickups.'],
  ['Do riders need to install anything?', 'Never. They get a text with a tracking link that opens in any browser: live ETA, your vehicle and reg, and their pickup code in big digits.'],
  ['What does the demand heatmap show?', 'Hour-by-hour demand per channel across the week — your own booking history blended with typical city rhythms. Park yourself where the ▓bright white▓ hours are.'],
  ['How do I put my diary in Google/Apple Calendar?', 'Diary → <b>⇅ Calendar feed</b> → copy your URL and subscribe from your calendar app. You can also import an .ics file the other way — school runs and MOTs then block every app automatically.'],
  ['Why do I occasionally see "Waking FareFlow up"?', 'This demo runs on free hosting that naps after ~15 quiet minutes — the first visit takes up to a minute to wake it, and the app retries automatically. On paid hosting it never happens.'],
  ['Can my dispatch office push jobs straight in?', 'Yes — each channel has an authenticated API (Channels → API in the app): push offers, cancel them, read blocks. Operator and micro-cab systems integrate there.'],
  ['Is FareFlow made by Uber or Bolt?', 'No — independent software that sits alongside the apps, like Eviivo sits alongside Booking.com. Not affiliated with or endorsed by any operator named in the app.'],
];
function renderFaq() {
  return `<div class="page-head"><div><h1 class="page-title">FAQ</h1>
    <div class="page-desc">The questions drivers ask most. Still stuck? <a href="#/support" style="color:var(--accent)">Talk to support →</a></div></div></div>
    <div class="faq-list">${FAQ_ITEMS.map(([q, a], i) => `<details class="faq-item" ${i === 0 ? 'open' : ''}><summary>${esc(q)}</summary><div class="ans">${a}</div></details>`).join('')}</div>`;
}

const HOWTO_GUIDES = [
  ['Install the app (iPhone & Android)', ['Open your FareFlow link in Safari (iPhone) or Chrome (Android).', 'iPhone: tap Share → scroll → “Add to Home Screen” → Add. Android: tap ⋮ → “Install app”.', 'Launch from the new home-screen icon — it runs fullscreen and self-updates.', 'Tap the 🔔 in the top bar once so bookings alert you even in the background.']],
  ['Connect your apps with driver numbers', ['Open Settings → App connections.', 'Pick a driver, choose the app (Uber, Bolt…), and enter the driver number that company issued you.', 'Save — the router now sends that app’s offers only to linked drivers.', 'Unlink anytime with the same panel.']],
  ['Handle an incoming job offer', ['When a job lands, a centre-screen card pops up with fare, route, time and a live expiry bar.', 'Tap ✓ Accept — the slot blocks on every other app instantly — or ✕ Decline.', 'Watch for the confirmation popup with the rider’s 4-digit pickup code.']],
  ['Drive a job with journey mode', ['Open the booking from your Diary and tap ▶ Start journey — navigation opens to the pickup.', 'The app safety-locks: everything is frozen except the journey screen and 20-second job offers you can still stack for later.', 'At the pickup, ask the rider’s 4-digit code, then tap ✓ Rider on board — navigation switches to the drop-off.', 'On arrival tap 🏁 Complete job — you’re instantly back online. Something went wrong? “End journey early” returns the job to the diary.']],
  ['Verify a rider at pickup', ['Ask the rider for their 4-digit code (in their SMS and tracking page).', 'Open the booking in the Diary → tap “Verify pickup” → enter the code.', 'The booking stamps ✓ verified — proof for both of you.']],
  ['Take a direct phone booking', ['Diary → ＋ Direct booking.', 'Enter rider, phone number, route, date/time, fare.', 'We text the rider their confirmation, tracking link and pickup code automatically — and block the apps.']],
  ['Use the demand heatmap', ['Open Demand from the tabs.', 'Each row is a channel, each column an hour — brighter = busier.', 'Plan your shifts around Friday 21:00–02:00 and airport rushes; quiet cells are good break windows.']],
  ['Run a fleet', ['Fleet tab → Add driver (name, vehicle, reg, PCO).', 'Each driver links their own app numbers in Settings → App connections.', 'The fair-share router assigns offers to the first free, linked driver — and toggling a driver off-duty stops new offers instantly.']],
  ['Sync your calendar', ['Diary → ⇅ Calendar feed → copy your personal .ics URL.', 'Google Calendar: “Other calendars +” → From URL. Apple: File → New Calendar Subscription.', 'To block time from another calendar, export it as .ics and use Import in the same panel.']],
];
function renderHowto() {
  return `<div class="page-head"><div><h1 class="page-title">How-to guides</h1>
    <div class="page-desc">Step-by-step for the everyday stuff. <a href="#/faq" style="color:var(--accent)">Read the FAQ →</a></div></div></div>
    <div class="howto-grid">${HOWTO_GUIDES.map(([t, steps], i) => `<div class="howto card"><div class="h-n">${i + 1}</div><h3>${esc(t)}</h3><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`).join('')}</div>`;
}

const BOT_KB = [
  [['install', 'download', 'home screen', 'add to home'], 'Install in 10 seconds: iPhone → open the link in Safari → Share → “Add to Home Screen”. Android → open in Chrome → ⋮ → “Install app”. Then launch it from the icon like any app.'],
  [['connect'], 'Settings → App connections: pick your driver, pick the app, enter the driver number that company issued you (e.g. UBR-4471290), save. Only linked apps will route work to that driver.'],
  [['code', 'pickup code', 'secret'], 'Every booking has a 4-digit code. The rider sees it in their text/tracking page; ask for it at the door, open the booking and tap “Verify pickup”. It proves you’re each other’s ride.'],
  [['tracking', 'track'], 'Riders follow you on a plain web page — no app. The link goes out automatically in the confirmation text (fflow.link/t/…) with live ETA, your vehicle and reg.'],
  [['decline', 'expired', 'disappear'], 'Offers live 40–80 seconds like the real apps. Expired offers vanish; clashing offers are auto-declined to protect your rating. The centre-screen popup has a live countdown bar so you always know.'],
  [['heatmap', 'demand', 'busy'], 'The Demand tab shows hour-by-hour demand per app across the week — brighter = busier. It blends your booking history with typical city rhythms.'],
  [['calendar', 'google', 'apple', 'ics'], 'Diary → ⇅ Calendar feed: copy the URL and subscribe from Google/Apple Calendar. Or import an .ics file to block every app during outside commitments.'],
  [['notification', 'alert', 'sound'], 'Tap the 🔔 in the top bar and allow notifications — bookings and requests then alert even when FareFlow is in the background.'],
  [['fleet', 'driver', 'add'], 'Fleet tab → Add driver. Then Settings → App connections to link their app driver numbers. Off-duty toggle stops new jobs instantly while keeping existing bookings.'],
  [['price', 'cost', 'free', 'pay'], 'This is a free early-access demo. Pro plans with 24/7 hosting and priority support come later — join the list on the marketing site (/get).'],
  [['wake', 'slow', 'loading', 'stuck'], 'The demo host naps after ~15 quiet minutes — first load can take up to a minute and the app retries by itself. If it’s ever stuck past that, force-close and reopen once.'],
];
function supportSay(e) {
  e.preventDefault();
  const inp = document.getElementById('chatIn');
  const t = inp.value.trim();
  if (!t) return;
  inp.value = '';
  chatMsg('you', t);
  const logD = document.getElementById('chatLog');
  const tp = document.createElement('div');
  tp.className = 'msg bot typing'; tp.textContent = 'typing…';
  logD.appendChild(tp); logD.scrollTop = logD.scrollHeight;
  setTimeout(() => { tp.remove(); chatMsg('bot', botReply(t)); }, 700 + Math.random() * 600);
}
function chatMsg(who, text) {
  const logD = document.getElementById('chatLog');
  if (!logD) return;
  const d = document.createElement('div');
  d.className = 'msg ' + who;
  d.textContent = text;
  logD.appendChild(d);
  logD.scrollTop = logD.scrollHeight;
}
function botReply(t) {
  const q = t.toLowerCase();
  for (const [ks, a] of BOT_KB) if (ks.some((k) => q.includes(k))) return a;
  return "I'm the demo helper bot and didn't quite catch that. Try asking about installing, connecting apps, pickup codes, tracking links, the heatmap, calendar, notifications or fleets — or open a ticket below and a human replies by email.";
}
async function sendTicket(e) {
  e.preventDefault();
  const subject = document.getElementById('tktSub').value.trim();
  const message = document.getElementById('tktMsg').value.trim();
  try {
    const r = await api('/api/support/tickets', 'POST', { subject, message });
    toast(`🎫 Ticket ${r.ticketNo} received — we'll reply by email within one working day`, 'ok');
    document.getElementById('tktSub').value = '';
    document.getElementById('tktMsg').value = '';
  } catch (err) { toast(err.message, 'err'); }
}
function renderSupport() {
  return `<div class="page-head"><div><h1 class="page-title">Help & support</h1>
    <div class="page-desc">Chat below, call, email, or open a ticket — whatever's fastest. <a href="#/faq" style="color:var(--accent)">FAQ →</a> · <a href="#/howto" style="color:var(--accent)">How-to →</a></div></div></div>
  <div class="support-grid">
    <div class="card chat-card">
      <div class="chat-log" id="chatLog">
        <div class="msg bot">👋 You're through to FareFlow support. Ask me anything — installing the app, connecting your apps, pickup codes, tracking links… I answer instantly.</div>
      </div>
      <form class="chat-form" onsubmit="supportSay(event)">
        <input id="chatIn" placeholder='Ask anything — e.g. "how do I connect Uber?"' autocomplete="off" maxlength="300">
        <button class="btn primary sm" type="submit">Send</button>
      </form>
    </div>
    <div class="support-side">
      <a class="card contact" href="tel:+441614960800"><div class="big-ic">📞</div><div><b>Phone us</b><span>0161 496 0800 — daily 06:00–23:00<br><em>demo line</em></span></div></a>
      <a class="card contact" href="mailto:support@fareflow.uk?subject=FareFlow%20support"><div class="big-ic">✉️</div><div><b>Email us</b><span>support@fareflow.uk<br>replies within one working day</span></div></a>
      <div class="card contact" style="cursor:default;display:block"><div style="display:flex;gap:12px;align-items:center"><div class="big-ic">🎫</div><div><b>Open a ticket</b><span>tracked &amp; answered by email</span></div></div>
        <form class="ticket-form" onsubmit="sendTicket(event)">
          <input id="tktSub" placeholder="Subject — e.g. “booking code not showing”" required maxlength="120">
          <textarea id="tktMsg" rows="3" placeholder="Tell us what happened, when, and on which screen…" required maxlength="2000"></textarea>
          <button class="btn primary sm" type="submit" style="align-self:flex-end">Submit ticket</button>
        </form>
      </div>
    </div>
  </div>`;
}

window.addEventListener('hashchange', setRoute);
(async function init() {
  setRoute();
  let tries = 0;
  for (;;) {
    try {
      const { state, serverTime, me } = await api('/api/state');
      S.state = state;
      S.me = me;
      S.serverTimeOffset = new Date(serverTime) - Date.now();
      startAuthed();
      return;
    } catch (e) {
      // signed out → show the login form (this was the stuck-on-"Loading your diary…" bug)
      if (e && e.auth) { showLogin(); return; }
      // server napping / network wobble → keep retrying with visible progress
      tries++;
      const v = document.getElementById('view');
      if (v && !S.state) {
        v.innerHTML = `<div class="loading">🚕 Waking FareFlow up…<br><span class="muted" style="font-size:13px;display:inline-block;margin-top:8px">Free hosting naps when quiet — the first load can take up to a minute.<br>Retrying automatically (${tries})…</span></div>`;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
})();
