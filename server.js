/*
 * FareFlow — channel manager for UK ride-hailing & private hire DRIVERS & FLEETS
 * Dependency-free Node server: static hosting + JSON API + SSE + simulators.
 *
 * Simulated integrations:
 *  - Channel adapters (Uber, Bolt, FREE NOW, Gett, Veezu, Addison Lee): latency + reliability
 *  - SMS/WhatsApp gateway: queued -> sent -> delivered receipts
 *  - iCalendar export (subscribable feed) + import (two-way sync)
 * Channel APIs in the real world would plug into the same sync engine via webhooks.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
// Hosts with persistent disks (Render/VPS/HF Spaces) can point this at a mount; defaults to local file.
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data.json');

/* ------------------------------------------------------------------ helpers */
const uid = (p = 'id') => `${p}_${crypto.randomBytes(5).toString('hex')}`;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const now = () => new Date();
const iso = (d) => d.toISOString();
const addMin = (d, m) => new Date(d.getTime() + m * 60000);
const overlaps = (aS, aE, bS, bE) => new Date(aS) < new Date(bE) && new Date(aE) > new Date(bS);
const fmtTime = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtDate = (d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + d.getDate();
const pin4 = () => String(randi(1000, 9999));
const hashPw = (salt, pw) => crypto.createHash('sha256').update(salt + '::' + pw).digest('hex');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const normPhone = (p) => String(p || '').replace(/[^\d+]/g, '');

/* ------------------------------------------------------- channel catalogue */
const CHANNEL_CATALOG = {
  uber:       { id: 'uber',       name: 'Uber',        color: '#06C167', latency: [500, 1400],  reliability: 0.97, weight: 30, mult: 1.00 },
  bolt:       { id: 'bolt',       name: 'Bolt',        color: '#34D186', latency: [600, 1900],  reliability: 0.96, weight: 26, mult: 0.95 },
  freenow:    { id: 'freenow',    name: 'FREE NOW',    color: '#E4FF54', latency: [700, 2100],  reliability: 0.95, weight: 14, mult: 1.05 },
  gett:       { id: 'gett',       name: 'Gett',        color: '#FFC531', latency: [900, 2600],  reliability: 0.93, weight: 12, mult: 1.15 },
  veezu:      { id: 'veezu',      name: 'Veezu',       color: '#9D6CFF', latency: [1200, 4200], reliability: 0.90, weight: 10, mult: 0.95 },
  addisonlee: { id: 'addisonlee', name: 'Addison Lee', color: '#FF7A1A', latency: [800, 2400],  reliability: 0.965, weight: 8,  mult: 1.30 },
  direct:     { id: 'direct',     name: 'Direct',      color: '#38BDF8', latency: [0, 0],       reliability: 1.0,  weight: 0,  mult: 1.35 },
};
const APP_CHANNELS = Object.keys(CHANNEL_CATALOG).filter((c) => c !== 'direct');

/* ------------------------------------------------------------- UK geography */
const P = (n, pc, lat, lng) => ({ n, pc, lat, lng });
const PLACES = [
  P('King’s Cross Station', 'N1 9AL', 51.5308, -0.1238), P('Paddington Station', 'W2 1HQ', 51.5165, -0.1760),
  P('Euston Station', 'NW1 2RT', 51.5282, -0.1337), P('Waterloo Station', 'SE1 7LY', 51.5031, -0.1132),
  P('Victoria Coach Station', 'SW1W 9TP', 51.4928, -0.1487), P('Canary Wharf', 'E14 5AB', 51.5054, -0.0235),
  P('The O2 Arena', 'SE10 0DX', 51.5030, 0.0032), P('Wembley Stadium', 'HA9 0WS', 51.5560, -0.2796),
  P('Westfield Stratford City', 'E20 1EJ', 51.5426, -0.0018), P('ExCeL London', 'E16 1XL', 51.5075, 0.0298),
  P('Shoreditch High St', 'E1 6PJ', 51.5234, -0.0755), P('Camden Market', 'NW1 8AH', 51.5416, -0.1464),
  P('Heathrow Terminal 5', 'TW6 2GA', 51.4700, -0.4874), P('Heathrow Terminal 2', 'TW6 1EW', 51.4696, -0.4494),
  P('Gatwick South Terminal', 'RH6 0NP', 51.1537, -0.1821), P('Luton Airport', 'LU2 9LY', 51.8747, -0.3683),
  P('Stansted Airport', 'CM24 1RW', 51.8850, 0.2350), P('London City Airport', 'E16 2PX', 51.5053, 0.0553),
  P('Manchester Piccadilly', 'M1 2PB', 53.4774, -2.2309), P('Manchester Airport T1', 'M90 1QX', 53.3650, -2.2726),
  P('Etihad Stadium', 'M11 3FF', 53.4831, -2.2004), P('Old Trafford', 'M16 0RA', 53.4631, -2.2913),
  P('Birmingham New Street', 'B2 4QA', 52.4778, -1.8988), P('Bullring Birmingham', 'B5 4BU', 52.4768, -1.8937),
  P('Leeds Station', 'LS1 4DY', 53.7957, -1.5474), P('Liverpool Lime Street', 'L1 1JD', 53.4073, -2.9784),
  P('Albert Dock, Liverpool', 'L3 4AF', 53.3996, -2.9919), P('Newcastle Central Station', 'NE1 5DL', 54.9680, -1.6172),
  P('Bristol Temple Meads', 'BS1 6QF', 51.4494, -2.5816), P('Cardiff Central', 'CF10 1EP', 51.4757, -3.1786),
  P('Edinburgh Waverley', 'EH1 1BB', 55.9521, -3.1893), P('Glasgow Central', 'G1 3SQ', 55.8590, -4.2580),
  P('Sheffield Station', 'S1 2BP', 53.3781, -1.4624), P('Brighton Pier', 'BN2 1TW', 50.8169, -0.1359),
  P('Clapham Junction', 'SW11 2QP', 51.4652, -0.1708), P('Greenwich Market', 'SE10 9HZ', 51.4815, -0.0100),
];
const CITIES = {
  london:     { key: 'london',     name: 'London',     lat: 51.5074, lng: -0.1278 },
  manchester: { key: 'manchester', name: 'Manchester', lat: 53.4839, lng: -2.2446 },
  birmingham: { key: 'birmingham', name: 'Birmingham', lat: 52.4862, lng: -1.8904 },
  leeds:      { key: 'leeds',      name: 'Leeds',      lat: 53.8008, lng: -1.5491 },
  liverpool:  { key: 'liverpool',  name: 'Liverpool',  lat: 53.4084, lng: -2.9916 },
  newcastle:  { key: 'newcastle',  name: 'Newcastle',  lat: 54.9783, lng: -1.6178 },
  bristol:    { key: 'bristol',    name: 'Bristol',    lat: 51.4545, lng: -2.5879 },
  sheffield:  { key: 'sheffield',  name: 'Sheffield',  lat: 53.3811, lng: -1.4701 },
  cardiff:    { key: 'cardiff',    name: 'Cardiff',    lat: 51.4816, lng: -3.1791 },
  glasgow:    { key: 'glasgow',    name: 'Glasgow',    lat: 55.8642, lng: -4.2518 },
  edinburgh:  { key: 'edinburgh',  name: 'Edinburgh',  lat: 55.9533, lng: -3.1883 },
  brighton:   { key: 'brighton',   name: 'Brighton',   lat: 50.8225, lng: -0.1372 },
};
const RIDERS = ['Aisha Khan','Oliver Smith','Priya Patel','Jack Wilson','Amelia Jones','Mohammed Ahmed','Sophie Taylor','George Brown','Chloe Davies','Daniel Evans','Emily Walker','Harry Thomas','Grace Roberts','Liam Johnson','Ruby Wilson','Noah Clarke','Freya Lewis','Charlie Hall','Isla Young','Alfie Wright','Maya Edwards','Joshua Green','Ava Baker','Leo Adams','Ella Nelson','Oscar Hill','Poppy Moore','Archie Scott','Daisy King','Henry Baker','Niamh O’Brien','Tom Hughes','Fatima Ali','Ben Carter'];
const NOTES = [null, null, null, '2 passengers + 1 large case', 'Meet at arrivals — flight BA2490', 'Child seat requested', 'Assist passenger to door', 'Quiet ride preferred', '3 passengers', 'Running 5 mins late', 'NHS hospital appointment', null, 'Pet (small dog, carrier)', 'Wheelchair access requested'];
const DRIVER_COLORS = ['#38BDF8', '#A3E635', '#F472B6', '#FBBF24', '#C084FC', '#34D399', '#FB7185', '#F97316'];

/* ---------------------------------------------------------------- state */
function mkUser(id, name, email, phone, pw, driverId) {
  const salt = uid('s');
  return { id, name, email: email ? normEmail(email) : null, phone: phone ? normPhone(phone) : null, passwordHash: hashPw(salt, pw), salt, driverId, createdAt: iso(now()) };
}
function defaultUsers() {
  return [
    mkUser('usr_admin', 'Farrah Fleet', 'admin@fareflow.uk', null, 'fareflow2026', null),
    mkUser('usr_alex', 'Alex Turner',  'alex@fareflow.uk', '+44 7700 900001', 'driver123', 'drv_alex'),
    mkUser('usr_sam',  'Sam Okafor',   'sam@fareflow.uk',  '+44 7700 900002', 'driver123', 'drv_sam'),
    mkUser('usr_zara', 'Zara Hussain', 'zara@fareflow.uk', '+44 7700 900003', 'driver123', 'drv_zara'),
    mkUser('usr_mo',   'Mo Rahman',    'mo@fareflow.uk',   '+44 7700 900004', 'driver123', 'drv_mo'),
  ];
}
function defaultConnections() {
  const lt = iso(now());
  const C = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { ref: v, linkedAt: lt }]));
  return {
    drv_alex: C({ uber: 'UBR-4471290', bolt: 'BLT-0088314', freenow: 'FN-209931' }),
    drv_sam:  C({ bolt: 'BLT-5522091', gett: 'GTT-70144', veezu: 'VZ-33920' }),
    drv_zara: C({ uber: 'UBR-9022331', veezu: 'VZ-77102', addisonlee: 'AL-51403' }),
    drv_mo:   C({ gett: 'GTT-81230', freenow: 'FN-318802' }),
  };
}
function freshState() {
  const channels = {};
  for (const c of Object.values(CHANNEL_CATALOG)) {
    channels[c.id] = { ...c, apiKey: crypto.randomBytes(12).toString('hex'), status: 'connected', lastSyncAt: null, connectedSince: iso(now()) };
  }
  const conns = defaultConnections();
  return {
    createdAt: iso(now()),
    settings: {
      bufferMin: 15, autoDeclineOverlap: true, autoAccept: false, minPerMile: 2.2,
      feedToken: crypto.randomBytes(8).toString('hex'),
    },
    drivers: [
      { id: 'drv_alex', name: 'Alex Turner',  vehicle: 'Toyota Prius',       reg: 'LD23 XQT', pco: 'PCO-223118', color: '#38BDF8', status: 'online', home: CITIES.london,     connections: conns.drv_alex },
      { id: 'drv_sam',  name: 'Sam Okafor',   vehicle: 'Kia Niro EV',        reg: 'MW72 HJD', pco: 'PCO-198650', color: '#A3E635', status: 'online', home: CITIES.birmingham, connections: conns.drv_sam },
      { id: 'drv_zara', name: 'Zara Hussain', vehicle: 'Skoda Octavia',      reg: 'MJ71 PVN', pco: 'PCO-204377', color: '#F472B6', status: 'online', home: CITIES.manchester, connections: conns.drv_zara },
      { id: 'drv_mo',   name: 'Mo Rahman',    vehicle: 'Tesla Model 3',      reg: 'LS22 EFA', pco: 'PCO-176204', color: '#FBBF24', status: 'offline', home: CITIES.london,     connections: conns.drv_mo },
    ],
    cities: CITIES,
    users: defaultUsers(), sessions: {},
    channels, requests: {}, requestOrder: [], blocks: {}, messages: [], logs: [], webhookLog: [],
  };
}
let state = null;
function load() {
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const c of Object.values(CHANNEL_CATALOG)) {
      if (!state.channels[c.id]) state.channels[c.id] = { ...c, status: 'connected', lastSyncAt: null, connectedSince: iso(now()) };
    }
    if (!state.drivers) state.drivers = freshState().drivers; // legacy migration
    if (!state.messages) state.messages = [];
    if (!state.cities) state.cities = CITIES;
    if (!state.settings.feedToken) state.settings.feedToken = crypto.randomBytes(8).toString('hex');
    if (!state.webhookLog) state.webhookLog = [];
    for (const c of Object.values(state.channels)) if (!c.apiKey) c.apiKey = crypto.randomBytes(12).toString('hex');
    for (const b of Object.values(state.blocks)) if (b.kind === 'booking' && !b.trackingToken) b.trackingToken = uid('trk');
    if (!state.users || !state.users.length) state.users = defaultUsers();
    if (!state.supportTickets) state.supportTickets = [];
    if (!state.sessions) state.sessions = {};
    { // driver connections migration
      const defs = defaultConnections();
      for (const d of state.drivers) {
        if (!d.connections) d.connections = defs[d.id] ? { ...defs[d.id] } : {};
      }
    }
    // legacy migration: request expiry was minutes instead of seconds — expire the zombies
    for (const r of Object.values(state.requests || {})) {
      if (r.status === 'pending' && (new Date(r.expiresAt) - new Date(r.createdAt)) > 400 * 1000) {
        r.status = 'expired';
      }
    }
    log('sys', 'Loaded saved diary from disk');
  } catch {
    state = freshState();
    seed();
  }
}
const driverById = (id) => state.drivers.find((d) => d.id === id);
const onlineDrivers = () => state.drivers.filter((d) => d.status === 'online');
const driverLinked = (d, channelId) => channelId === 'direct' || !!(d.connections && d.connections[channelId]);
function publicState() {
  const clone = JSON.parse(JSON.stringify(state));
  delete clone.sessions;
  delete clone._promoRecent;
  if (clone.users) for (const u of clone.users) { delete u.passwordHash; delete u.salt; }
  return clone;
}
function parseCookies(req) {
  const h = req.headers.cookie || '';
  const out = {};
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionUser(req) {
  const tok = parseCookies(req).ff_session;
  if (!tok || !state.sessions[tok]) return null;
  return state.users.find((u) => u.id === state.sessions[tok].userId) || null;
}
function startSession(res, user) {
  const tok = crypto.randomBytes(24).toString('hex');
  state.sessions[tok] = { userId: user.id, createdAt: iso(now()) };
  res.setHeader('Set-Cookie', `ff_session=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 1)); } catch (e) { console.error('save failed', e); }
  }, 400);
}

/* --------------------------------------------------------------- SSE hub */
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch {} }
}
setInterval(() => { for (const res of clients) { try { res.write(': hb\n\n'); } catch {} } }, 25000);

/* -------------------------------------------- real-time booking popups */
const placeName = (p) => p == null ? '' : (typeof p === 'string' ? p : (p.n || p.name || ''));
function notifyBooking(block, via) {
  const ch = state.channels[block.channelId] || CHANNEL_CATALOG[block.channelId] || { name: block.channelId, color: '#38BDF8' };
  const drv = driverById(block.driverId);
  broadcast('booking', {
    id: block.id, via: via || 'accepted',
    rider: block.rider, fare: block.fare, code: block.code,
    channelId: block.channelId, channel: ch.name, color: ch.color,
    driverId: block.driverId, driver: drv ? drv.name.split(' ')[0] : 'Driver',
    pickup: placeName(block.pickup), dropoff: placeName(block.dropoff),
    start: block.start, durationMin: block.durationMin, distanceMi: block.distanceMi,
  });
}
/* pop an incoming request on every connected screen the moment it lands */
function notifyRequest(req) {
  const ch = state.channels[req.channelId] || CHANNEL_CATALOG[req.channelId] || { name: req.channelId, color: '#38BDF8' };
  const drv = driverById(req.driverId);
  broadcast('request', {
    id: req.id, via: req.via || 'live',
    rider: req.rider, fare: req.fare, code: req.code,
    channelId: req.channelId, channel: ch.name, color: ch.color,
    driverId: req.driverId, driver: drv ? drv.name.split(' ')[0] : 'Driver',
    pickup: placeName(req.pickup), dropoff: placeName(req.dropoff),
    pickupAt: req.pickupAt, expiresAt: req.expiresAt,
    durationMin: req.durationMin, distanceMi: req.distanceMi, asap: !!req.asap,
  });
}

/* ------------------------------------------------------------------ logs */
function log(level, msg) {
  const entry = { t: iso(now()), level, msg };
  state.logs.unshift(entry);
  if (state.logs.length > 260) state.logs.length = 260;
  broadcast('log', entry);
  save();
}
function wlog(channel, event, status, detail) {
  state.webhookLog.unshift({ t: iso(now()), channel, event, status, detail: String(detail || '').slice(0, 140) });
  if (state.webhookLog.length > 80) state.webhookLog.length = 80;
  save();
}

/* ----------------------------------------------------- SMS/WhatsApp gateway */
/* Simulated gateway: queued -> sent -> delivered, with receipts surfacing live. */
function sendMessage({ blockId, to, body, type = 'sms', kind = 'confirmation' }) {
  const m = { id: uid('msg'), t: iso(now()), blockId, to, body, type, kind, status: 'queued' };
  state.messages.unshift(m);
  if (state.messages.length > 150) state.messages.length = 150;
  broadcast('state'); save();
  setTimeout(() => {
    if (m.status !== 'queued') return;
    m.status = 'sent'; m.sentAt = iso(now());
    broadcast('state'); save();
    setTimeout(() => {
      m.status = 'delivered'; m.deliveredAt = iso(now());
      broadcast('state'); save();
    }, rand(1800, 4500));
  }, rand(900, 2400));
  log('info', `${type === 'whatsapp' ? 'WhatsApp' : 'SMS'} ${kind} queued → ${to}`);
  return m;
}
const msgTemplates = {
  confirmation: (b, d) =>
    `FareFlow: Booking confirmed — ${fmtDate(new Date(b.start))} ${fmtTime(b.start)} pickup at ${b.pickup.n}. ` +
    `Driver: ${d.name.split(' ')[0]} · ${d.vehicle} (${d.reg}). ${b.fare ? 'Quoted fare: £' + b.fare.toFixed(2) + '. ' : ''}` +
    `Your secret pickup code: ${b.code}. Only share it with your driver at pickup.\n` +
    `Follow your driver live: fflow.link/t/${b.trackingToken}`,
  reminder: (b, d) =>
    `FareFlow reminder: ${d.name.split(' ')[0]} (${d.vehicle}, ${d.reg}) picks you up at ${fmtTime(b.start)} from ${b.pickup.n}. ` +
    `Have pickup code ${b.code} ready. Track: fflow.link/t/${b.trackingToken}`,
  cancelled: (b) =>
    `FareFlow: We're sorry — your booking on ${fmtDate(new Date(b.start))} at ${fmtTime(b.start)} was cancelled. Rebook any time.`,
};

/* ------------------------------------------------------- fleet / clash/routing */
function blocksForDriver(driverId) {
  return Object.values(state.blocks).filter((b) =>
    (b.driverId === driverId || b.driverId === 'all') &&
    (b.status === 'confirmed' || b.status === 'in-progress'));
}
function driverClash(driverId, start, end) {
  return blocksForDriver(driverId).find((b) => overlaps(start, end, b.start, b.end));
}
function routeToDriver(start, end, channelId) {
  /* only online drivers LINKED on this app (via their operator driver number) can take its jobs */
  const candidates = onlineDrivers().filter((d) => driverLinked(d, channelId) && !driverClash(d.id, start, end));
  if (!candidates.length) return null;
  const today = now().toDateString();
  const score = (d) => Object.values(state.blocks).filter((b) =>
    b.driverId === d.id && (b.status === 'confirmed' || b.status === 'in-progress') &&
    new Date(b.start).toDateString() === today).length;
  return candidates.sort((a, b2) => score(a) - score(b2) || Math.random() - 0.5)[0];
}

/* ----------------------------------------------------------- sync engine */
function syncBlockToChannels(block, onlyChannel = null) {
  const targets = APP_CHANNELS.filter((c) => c !== block.channelId && (!onlyChannel || c === onlyChannel));
  let pushed = 0;
  for (const cid of targets) {
    const chan = state.channels[cid];
    if (!chan || chan.status !== 'connected') continue;
    const existing = block.holds[cid];
    if (existing && (existing.state === 'blocked' || existing.state === 'syncing')) continue;
    block.holds[cid] = { state: 'syncing', at: iso(now()) };
    pushed++;
    scheduleHoldAck(block.id, cid, 1);
  }
  if (pushed > 0) log('info', `Blocking ${fmtTime(block.start)}–${fmtTime(block.end)} on ${pushed} other app${pushed > 1 ? 's' : ''}…`);
  broadcast('state'); save();
}
function scheduleHoldAck(blockId, cid, attempt) {
  const chCat = CHANNEL_CATALOG[cid];
  setTimeout(() => {
    const block = state.blocks[blockId];
    const chan = state.channels[cid];
    if (!block || !chan || block.status === 'cancelled') return;
    const ok = Math.random() < chCat.reliability;
    const entry = block.holds[cid];
    if (!entry || entry.state !== 'syncing') return;
    if (ok) {
      block.holds[cid] = { state: 'blocked', at: iso(now()) };
      chan.lastSyncAt = iso(now());
      log('ok', `${chan.name}: slot ${fmtTime(block.start)} blocked ✓`);
    } else if (attempt < 2) {
      log('warn', `${chan.name}: block push failed — retrying…`);
      scheduleHoldAck(blockId, cid, attempt + 1);
    } else {
      block.holds[cid] = { state: 'failed', at: iso(now()), error: 'API timeout' };
      log('err', `${chan.name}: failed to block slot ${fmtTime(block.start)} — tap Retry in the diary`);
    }
    broadcast('state'); save();
  }, rand(chCat.latency[0], chCat.latency[1]));
}
function releaseHolds(block) {
  for (const [cid, h] of Object.entries(block.holds)) {
    if (['blocked', 'syncing', 'failed'].includes(h.state)) {
      setTimeout(() => {
        const b = state.blocks[block.id];
        if (b && b.holds[cid]) { b.holds[cid] = { state: 'released', at: iso(now()) }; broadcast('state'); save(); }
      }, rand(CHANNEL_CATALOG[cid].latency[0], CHANNEL_CATALOG[cid].latency[1]));
    }
  }
}

/* ------------------------------------------------------------- seed data */
function seed() {
  const s = state;
  const drvIds = s.drivers.map((d) => d.id);
  for (let d = 6; d >= 1; d--) {
    const day = addMin(now(), -d * 24 * 60);
    for (let i = 0; i < randi(4, 8); i++) {
      const chId = pick(APP_CHANNELS);
      const driverId = pick(drvIds);
      const start = new Date(day); start.setHours(randi(7, 20), pick([0, 15, 30, 45]), 0, 0);
      const dist = +rand(1.4, 18).toFixed(1);
      const dur = Math.max(8, Math.round(dist / rand(13, 22) * 60) + randi(2, 8));
      const fare = +((3 + dist * rand(1.85, 2.35)) * CHANNEL_CATALOG[chId].mult).toFixed(2);
      const id = uid('blk');
      s.blocks[id] = {
        id, kind: 'booking', channelId: chId, driverId, rider: pick(RIDERS), code: pin4(),
        pickup: pick(PLACES), dropoff: pick(PLACES), start: iso(start), end: iso(addMin(start, dur)),
        durationMin: dur, distanceMi: dist, fare, status: 'completed',
        pickupVerifiedAt: Math.random() < 0.8 ? iso(addMin(start, -2)) : null,
        holds: {}, createdAt: iso(addMin(start, -90)),
      };
    }
  }
  for (let i = 0; i < 3; i++) { // completed earlier today
    const chId = pick(APP_CHANNELS);
    const driverId = drvIds[i % drvIds.length];
    const start = addMin(now(), -randi(200, 480));
    const dist = +rand(2, 9).toFixed(1);
    const dur = randi(12, 38);
    const fare = +((3 + dist * rand(1.9, 2.3)) * CHANNEL_CATALOG[chId].mult).toFixed(2);
    const id = uid('blk');
    s.blocks[id] = { id, kind: 'booking', channelId: chId, driverId, rider: pick(RIDERS), code: pin4(), pickupVerifiedAt: iso(addMin(start, -1)), pickup: pick(PLACES), dropoff: pick(PLACES), start: iso(start), end: iso(addMin(start, dur)), durationMin: dur, distanceMi: dist, fare, status: 'completed', holds: {}, createdAt: iso(addMin(start, -120)) };
  }
  const mkUpcoming = (channelId, driverId, inMin, dur, label) => {
    const id = uid('blk');
    const start = addMin(now(), inMin);
    const dist = +rand(3, 20).toFixed(1);
    const fare = +((3 + dist * rand(1.9, 2.3)) * (CHANNEL_CATALOG[channelId]?.mult || 1)).toFixed(2);
    const holds = {};
    for (const c of APP_CHANNELS) if (c !== channelId) holds[c] = { state: 'blocked', at: iso(now()) };
    s.blocks[id] = {
      id, kind: 'booking', channelId, driverId, rider: label || pick(RIDERS), code: pin4(), trackingToken: uid('trk'),
      pickup: pick(PLACES), dropoff: pick(PLACES), start: iso(start), end: iso(addMin(start, dur)),
      durationMin: dur, distanceMi: dist, fare, status: 'confirmed', holds, createdAt: iso(now()),
    };
    return s.blocks[id];
  };
  mkUpcoming('uber', 'drv_alex', 150, 55, 'Sana Malik');
  mkUpcoming('addisonlee', 'drv_zara', 60 * 26, 85, 'Exec airport run — Heathrow T5');
  mkUpcoming('veezu', 'drv_sam', 60 * 50, 40);
  const direct = mkUpcoming('direct', 'drv_alex', 60 * 7, 45, 'Mrs Patel — Heathrow drop');
  direct.riderPhone = '+44 7700 900123';
  direct.fare = 52.5;
  const dAlex = driverById('drv_alex');
  const m1 = { id: uid('msg'), t: iso(addMin(now(), -30)), blockId: direct.id, to: direct.riderPhone, body: msgTemplates.confirmation(direct, dAlex), type: 'whatsapp', kind: 'confirmation', status: 'delivered', sentAt: iso(addMin(now(), -29)), deliveredAt: iso(addMin(now(), -27)) };
  s.messages.unshift(m1);
  const mid = uid('blk');
  {
    const start = addMin(now(), 60 * 25);
    const holds = {}; for (const c of APP_CHANNELS) holds[c] = { state: 'blocked', at: iso(now()) };
    s.blocks[mid] = { id: mid, kind: 'manual', channelId: 'manual', driverId: 'drv_alex', rider: 'School run — Amelie', pickup: { n: 'Home', pc: '' }, dropoff: { n: 'St Mary’s School', pc: '' }, start: iso(start), end: iso(addMin(start, 45)), durationMin: 45, status: 'confirmed', holds, createdAt: iso(now()) };
  }
  log('ok', 'FareFlow started — fleet of ' + s.drivers.length + ', ' + APP_CHANNELS.length + ' app channels synced');
}

/* ---------------------------------------------------------- booking generator */
function weightedChannel() {
  const pool = APP_CHANNELS.filter((c) => state.channels[c].status === 'connected');
  if (!pool.length) return null;
  const total = pool.reduce((s2, c) => s2 + CHANNEL_CATALOG[c].weight, 0);
  let r = Math.random() * total;
  for (const c of pool) { r -= CHANNEL_CATALOG[c].weight; if (r <= 0) return c; }
  return pool[0];
}
/* One request pipeline for the simulator AND operator webhooks. */
function createRequest(o) {
  const chCat = CHANNEL_CATALOG[o.channelId];
  const pickupAt = new Date(o.pickupAt);
  const windowEnd = addMin(pickupAt, o.durationMin + state.settings.bufferMin);
  const id = uid('req');
  const req = {
    id, channelId: o.channelId, rider: o.rider || pick(RIDERS), pickup: o.pickup || pick(PLACES), dropoff: o.dropoff || pick(PLACES),
    note: o.note !== undefined ? o.note : pick(NOTES), pickupAt: iso(pickupAt), asap: !!o.asap,
    distanceMi: o.distanceMi, durationMin: o.durationMin, fare: o.fare,
    code: pin4(), externalId: o.externalId || null, source: o.source || 'sim',
    createdAt: iso(now()), expiresAt: iso(new Date(Date.now() + (o.ttlSec || randi(40, 80)) * 1000)), status: 'pending', driverId: null,
  };
  const driver = routeToDriver(pickupAt, windowEnd, o.channelId);
  const via = req.source === 'api' ? ' [API]' : '';
  if (!driver) {
    const linkedN = onlineDrivers().filter((d) => driverLinked(d, o.channelId)).length;
    if (state.settings.autoDeclineOverlap) {
      req.status = 'auto-declined';
      log('warn', `Auto-declined ${chCat.name}${via} (${fmtTime(req.pickupAt)}) — ${linkedN === 0 ? 'no online driver linked on this app' : 'no driver free in that slot'}`);
    } else {
      log('warn', `${chCat.name}${via} request — no ${linkedN === 0 ? 'linked' : 'free'} online driver, assign manually`);
    }
  } else {
    req.driverId = driver.id;
    log('info', `${chCat.name}${via} → ${driver.name.split(' ')[0]}: ${req.rider}, £${req.fare.toFixed(2)} at ${fmtTime(req.pickupAt)}`);
  }
  state.requests[id] = req;
  state.requestOrder.unshift(id);
  if (state.requestOrder.length > 60) {
    for (const tid of state.requestOrder.splice(60)) delete state.requests[tid];
  }
  broadcast('state'); save();

  if (req.status === 'pending') notifyRequest(req);
  if (req.status === 'pending' && req.driverId && state.settings.autoAccept) {
    const ppm = req.fare / req.distanceMi;
    if (ppm >= state.settings.minPerMile) {
      const delay = randi(3500, 8000);
      log('info', `Auto-accept rule matched (£${ppm.toFixed(2)}/mi) — accepting in ${Math.round(delay / 1000)}s`);
      setTimeout(() => {
        const r = state.requests[id];
        if (r && r.status === 'pending' && new Date(r.expiresAt) > now()) acceptRequest(r, true);
      }, delay);
    }
  }
  return req;
}
function genRequest() {
  const channelId = weightedChannel();
  if (!channelId) return;
  const pendingCount = Object.values(state.requests).filter((r) => r.status === 'pending').length;
  if (pendingCount >= 5) return;

  const asap = Math.random() < 0.3;
  let pickupAt;
  if (asap) {
    pickupAt = addMin(now(), randi(15, 75));
  } else {
    let dayOff = Math.random() < 0.35 ? 0 : Math.random() < 0.65 ? 1 : 2;
    if (dayOff === 0) {
      pickupAt = addMin(now(), randi(60, 300));
      pickupAt.setSeconds(0, 0);
      if (pickupAt.getHours() > 22) dayOff = 1;
    }
    if (dayOff > 0) {
      pickupAt = addMin(now(), dayOff * 24 * 60);
      pickupAt.setHours(randi(6, 22), pick([0, 5, 10, 15, 30, 40, 45, 50]), 0, 0);
    }
  }
  const roll = Math.random();
  const dist = +(roll < 0.6 ? rand(1.5, 6) : roll < 0.85 ? rand(6, 14) : rand(15, 27)).toFixed(1);
  const dur = Math.max(7, Math.round(dist / rand(13, 22) * 60) + randi(2, 8));
  const fare = +((3 + dist * rand(1.85, 2.35)) * CHANNEL_CATALOG[channelId].mult).toFixed(2);
  createRequest({ channelId, pickupAt, asap, distanceMi: dist, durationMin: dur, fare });
}
function acceptRequest(req, auto = false) {
  if (!req.driverId) return null;
  req.status = 'accepted';
  const start = new Date(req.pickupAt);
  const end = addMin(start, req.durationMin + state.settings.bufferMin);
  const id = uid('blk');
  const block = {
    id, kind: 'booking', bookingId: req.id, channelId: req.channelId, driverId: req.driverId,
    rider: req.rider, code: req.code, trackingToken: uid('trk'), pickup: req.pickup, dropoff: req.dropoff, note: req.note,
    start: iso(start), end: iso(end), durationMin: req.durationMin,
    distanceMi: req.distanceMi, fare: req.fare, status: 'confirmed', holds: {}, createdAt: iso(now()),
  };
  state.blocks[id] = block;
  const drv = driverById(req.driverId);
  log('ok', `${auto ? 'Auto-accepted' : 'Accepted'} ${state.channels[req.channelId].name} job for ${drv ? drv.name.split(' ')[0] : '?'} — ${req.rider}, £${req.fare.toFixed(2)} ${fmtDate(start)} ${fmtTime(start)}`);
  syncBlockToChannels(block);
  broadcast('state'); save();
  notifyBooking(block, auto ? 'auto' : 'accepted');
  return block;
}

/* ------------------------------------------------------------ iCalendar */
const icsEsc = (s) => String(s ?? '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
const icsDate = (ts) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function buildICS(driverFilter) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FareFlow//Driver Diary//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:FareFlow Diary', 'X-PUBLISHED-TTL:PT15M'];
  for (const b of Object.values(state.blocks)) {
    if (b.status === 'cancelled') continue;
    if (driverFilter && b.driverId !== driverFilter && b.driverId !== 'all') continue;
    const chName = b.channelId === 'manual' ? 'Manual' : (CHANNEL_CATALOG[b.channelId]?.name || b.channelId);
    const drv = driverById(b.driverId);
    const desc = [
      `Driver: ${drv ? drv.name : 'Fleet'}`,
      b.code ? `Pickup code: ${b.code}` : null,
      b.pickup ? `Pickup: ${b.pickup.n}` : null,
      b.dropoff ? `Drop-off: ${b.dropoff.n}` : null,
      b.fare ? `Fare: £${b.fare.toFixed(2)}` : null,
      'Status: ' + b.status,
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${b.id}@fareflow`,
      `DTSTAMP:${icsDate(now())}`,
      `DTSTART:${icsDate(b.start)}`,
      `DTEND:${icsDate(b.end)}`,
      `SUMMARY:${icsEsc('[' + chName + '] ' + (b.rider || 'Booking'))}`,
      `DESCRIPTION:${icsEsc(desc)}`,
      `CATEGORIES:${icsEsc(chName)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function parseICS(text) {
  const raw = String(text).replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  for (const l of raw) { if (/^[ \t]/.test(l) && lines.length) lines[lines.length - 1] += l.slice(1); else lines.push(l); }
  const parseDt = (v) => {
    let m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
    if (m) {
      const [, y, mo, d, h, mi, s, z] = m;
      return z === 'Z' ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)) : new Date(+y, +mo - 1, +d, +h, +mi, +s);
    }
    m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 9, 0, 0);
    return null;
  };
  const events = [];
  let cur = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') cur = {};
    else if (l === 'END:VEVENT') { if (cur && cur.start) events.push(cur); cur = null; }
    else if (cur) {
      const m = l.match(/^([A-Za-z-]+)(;[^:]*)?:(.*)$/);
      if (!m) continue;
      const k = m[1].toUpperCase(), v = m[3];
      if (k === 'DTSTART') cur.start = parseDt(v);
      else if (k === 'DTEND') cur.end = parseDt(v);
      else if (k === 'SUMMARY') cur.summary = v.replace(/\\(.)/g, '$1');
      else if (k === 'UID') cur.uid = v;
    }
  }
  return events;
}

/* ------------------------------------------------------- simulator loops */
let genTimer = null;
function scheduleNextGen(first = false) {
  clearTimeout(genTimer);
  genTimer = setTimeout(() => { genRequest(); scheduleNextGen(); }, first ? 4500 : rand(10000, 24000));
}
setInterval(() => {
  let changed = false;
  for (const req of Object.values(state.requests)) {
    if (req.status === 'pending' && new Date(req.expiresAt) <= now()) {
      req.status = 'expired';
      log('info', `${state.channels[req.channelId].name} request expired (no answer) — ${req.rider}`);
      changed = true;
    }
  }
  for (const b of Object.values(state.blocks)) {
    const t = now();
    if (b.status === 'confirmed' && new Date(b.start) <= t && new Date(b.end) > t) {
      b.status = 'in-progress'; changed = true;
    } else if ((b.status === 'confirmed' || b.status === 'in-progress') && new Date(b.end) <= t) {
      b.status = 'completed'; changed = true;
      if (b.fare) log('ok', `Trip completed — £${b.fare.toFixed(2)} from ${state.channels[b.channelId]?.name || 'manual'}`);
    }
    // pickup reminder ~60 min ahead for direct bookings with a phone number
    if (b.kind === 'booking' && b.channelId === 'direct' && b.riderPhone && b.status === 'confirmed' && !b.reminderSent) {
      const minsOut = (new Date(b.start) - t) / 60000;
      if (minsOut > 50 && minsOut <= 70) {
        b.reminderSent = true;
        const d = driverById(b.driverId) || state.drivers[0];
        sendMessage({ blockId: b.id, to: b.riderPhone, body: msgTemplates.reminder(b, d), type: b.msgType || 'sms', kind: 'reminder' });
        changed = true;
      }
    }
  }
  if (changed) { broadcast('state'); save(); }
}, 2000);
setInterval(() => { // occasional rider cancellations
  if (Math.random() > 0.12) return;
  const candidates = Object.values(state.blocks).filter((b) =>
    b.kind === 'booking' && b.channelId !== 'direct' && b.status === 'confirmed' && new Date(b.start) > addMin(now(), 30));
  if (!candidates.length) return;
  const b = pick(candidates);
  b.status = 'cancelled';
  releaseHolds(b);
  log('warn', `Rider cancelled — ${state.channels[b.channelId]?.name || b.channelId} ${fmtDate(new Date(b.start))} ${fmtTime(b.start)}. Slot released on all apps.`);
  broadcast('state'); save();
}, 22000);

/* ------------------------------------------------- demand model (heatmap) */
function strHash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let demandCache = { t: 0, data: null };
function buildDemand() {
  if (Date.now() - demandCache.t < 5 * 60000 && demandCache.data) return demandCache.data;
  const model = (cid) => {
    const rnd = mulberry(strHash(cid));
    const g = [];
    for (let d = 0; d < 7; d++) {
      const row = [];
      for (let h = 0; h < 24; h++) {
        let v;
        if (d < 5) {
          v = (h >= 7 && h <= 9) ? 62 : (h >= 16 && h <= 19) ? 78 : (h >= 11 && h <= 14) ? 45
            : (h >= 20 && h <= 22) ? 40 : (h >= 0 && h <= 5) ? 10 : 26;
          if (d === 4 && (h >= 20 || h <= 2)) v = 90;   // Friday night out
        } else {
          v = (h >= 10 && h <= 17) ? 44 : 22;
          if (d === 5 && (h >= 21 || h <= 1)) v = 84;   // Saturday night
        }
        row.push(Math.round(Math.min(100, v * (0.8 + rnd() * 0.5))));
      }
      g.push(row);
    }
    return g;
  };
  const observed = []; for (let d = 0; d < 7; d++) observed.push(new Array(24).fill(0));
  let maxObs = 1;
  for (const b of Object.values(state.blocks)) {
    if (b.status === 'cancelled') continue;
    const dd = new Date(b.start); observed[(dd.getDay() + 6) % 7][dd.getHours()]++;
  }
  for (const r of Object.values(state.requests)) {
    const dd = new Date(r.createdAt); observed[(dd.getDay() + 6) % 7][dd.getHours()]++;
  }
  observed.forEach((r2) => r2.forEach((v) => { if (v > maxObs) maxObs = v; }));
  const byChannel = {}, all = []; for (let d = 0; d < 7; d++) all.push(new Array(24).fill(0));
  for (const cid of [...APP_CHANNELS, 'direct']) {
    const m = model(cid); const grid = [];
    for (let d = 0; d < 7; d++) {
      const row = [];
      for (let h = 0; h < 24; h++) {
        const val = Math.round(m[d][h] * 0.55 + (observed[d][h] / maxObs) * 100 * 0.45);
        row.push(val); all[d][h] += val;
      }
      grid.push(row);
    }
    byChannel[cid] = grid;
  }
  const nch = APP_CHANNELS.length + 1;
  const allNorm = all.map((r2) => r2.map((v) => Math.min(100, Math.round(v / nch * 1.6))));
  const data = { byChannel, all: allNorm, observed, maxObs, generatedAt: iso(now()) };
  demandCache = { t: Date.now(), data };
  return data;
}

/* --------------------------------------------- rider tracking (public) */
function trackingPayload(token) {
  const b = Object.values(state.blocks).find((x) => x.trackingToken === token);
  if (!b) return null;
  const d = driverById(b.driverId);
  const t = now();
  const etaM = Math.max(0, Math.round((new Date(b.start) - t) / 60000));
  let phase;
  if (b.status === 'cancelled') phase = 'cancelled';
  else if (b.status === 'completed') phase = 'completed';
  else if (b.pickupVerifiedAt) phase = 'verified';
  else if (b.status === 'in-progress') phase = 'arriving';
  else if (etaM > 60) phase = 'scheduled';
  else if (etaM > 4) phase = 'enroute';
  else phase = 'arriving';
  let pos = null, frac = null;
  if (b.pickup && b.pickup.lat != null) {
    let h = 0; for (const c2 of b.trackingToken) h = (h * 31 + c2.charCodeAt(0)) >>> 0;
    const ang = (h % 360) * Math.PI / 180;
    const oLat = b.pickup.lat + Math.sin(ang) * 8 * 0.0145;
    const oLng = b.pickup.lng + Math.cos(ang) * 8 * 0.0145 / Math.max(0.2, Math.cos(b.pickup.lat * Math.PI / 180));
    frac = phase === 'scheduled' ? 0 : phase === 'enroute' ? Math.min(1, Math.max(0, 1 - etaM / 60)) : 0.97;
    const wob = Math.sin(frac * 10) * 0.35;
    pos = {
      lat: +(b.pickup.lat + (oLat - b.pickup.lat) * (1 - frac) + wob * 0.003 * -Math.sin(ang)).toFixed(6),
      lng: +(b.pickup.lng + (oLng - b.pickup.lng) * (1 - frac) + wob * 0.003 * Math.cos(ang)).toFixed(6),
    };
  }
  return {
    found: true, phase, etaMin: etaM, frac, pos,
    pickup: { n: (b.pickup && b.pickup.n) || 'Pickup', lat: b.pickup?.lat ?? null, lng: b.pickup?.lng ?? null },
    dropoff: { n: (b.dropoff && b.dropoff.n) || null }, pickupAt: b.start, fare: b.fare || null,
    via: b.channelId === 'manual' ? 'Direct' : (CHANNEL_CATALOG[b.channelId]?.name || 'Direct'),
    driver: d ? { name: d.name, vehicle: d.vehicle, reg: d.reg, color: d.color } : { name: 'Your driver', vehicle: '', reg: '', color: '#38BDF8' },
    code: b.code || null, verifiedAt: b.pickupVerifiedAt || null,
  };
}

/* --------------------------------------------------------------- HTTP API */
function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e5) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.ics': 'text/calendar; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const user = sessionUser(req);
  const gate = () => { if (!user) { send(res, 401, { error: 'auth' }); return true; } return false; };
  try {
    if (p === '/api/events' && req.method === 'GET') {
      if (gate()) return;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/state' && req.method === 'GET') {
      if (gate()) return;
      return send(res, 200, { state: publicState(), serverTime: iso(now()), me: { id: user.id, name: user.name, email: user.email, phone: user.phone, driverId: user.driverId } });
    }
    if (p === '/api/health') return send(res, 200, { ok: true });
    if (p === '/api/demand' && req.method === 'GET') { if (gate()) return; return send(res, 200, buildDemand()); }

    /* ---- public rider tracking ---- */
    let mt = p.match(/^\/api\/track\/([\w-]+)$/);
    if (mt && req.method === 'GET') {
      const payload = trackingPayload(mt[1]);
      return payload ? send(res, 200, payload) : send(res, 404, { error: 'Tracking link not found or booking removed' });
    }

    /* ---- operator dispatch API (inbound webhooks) ---- */
    function integAuth(cid) {
      if (!APP_CHANNELS.includes(cid)) return { err: 'unknown channel', code: 404 };
      const c = state.channels[cid];
      if ((req.headers['x-fareflow-key'] || '') !== c.apiKey) {
        wlog(cid, 'auth', 401, 'Rejected call with bad X-FareFlow-Key');
        return { err: 'invalid or missing X-FareFlow-Key header', code: 401 };
      }
      return { channel: c };
    }
    let mi2 = p.match(/^\/api\/integrations\/([\w-]+)\/blocks$/);
    if (mi2 && req.method === 'GET') {
      const a = integAuth(mi2[1]);
      if (a.err) return send(res, a.code, { error: a.err });
      const cid = mi2[1];
      const jobs = Object.values(state.blocks)
        .filter((b) => b.channelId === cid && (b.status === 'confirmed' || b.status === 'in-progress'))
        .sort((x, y) => new Date(x.start) - new Date(y.start))
        .slice(0, 50)
        .map((b) => ({
          blockId: b.id, start: b.start, end: b.end, status: b.status, rider: b.rider,
          pickup: b.pickup?.n || null, dropoff: b.dropoff?.n || null,
          driver: driverById(b.driverId)?.name || null, vehicle: driverById(b.driverId)?.vehicle || null,
          fare: b.fare || null, trackingUrl: `/t/${b.trackingToken}`,
        }));
      wlog(cid, 'blocks.list', 200, `${jobs.length} upcoming job(s) returned`);
      return send(res, 200, { channel: cid, count: jobs.length, jobs });
    }

    /* ---- subscribable iCal feed ---- */
    let mi = p.match(/^\/api\/calendar\/([\w-]+)\.ics$/);
    if (mi && req.method === 'GET') {
      if (mi[1] !== state.settings.feedToken) return send(res, 404, { error: 'unknown feed' });
      const driverF = url.searchParams.get('driver');
      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': 'inline; filename="fareflow.ics"',
      });
      return res.end(buildICS(driverF));
    }

    if (req.method === 'POST') {
      const body = await readBody(req);

      /* ---- authentication: email OR phone + password ---- */
      if (p === '/api/auth/login') {
        const idf = String(body.identifier || '').trim();
        const pw = String(body.password || '');
        const u = state.users.find((x) =>
          (idf.includes('@') && x.email === normEmail(idf)) ||
          (!idf.includes('@') && x.phone && x.phone === normPhone(idf)));
        if (!u || u.passwordHash !== hashPw(u.salt, pw)) {
          return send(res, 401, { error: 'Those details don’t match an account — check the email/number and password' });
        }
        startSession(res, u);
        log('info', `${u.name} signed in`);
        save();
        return send(res, 200, { ok: true, me: { id: u.id, name: u.name, email: u.email, phone: u.phone, driverId: u.driverId } });
      }
      if (p === '/api/support/tickets') {
        const subject = String(body.subject || '').trim().slice(0, 120);
        const message = String(body.message || '').trim().slice(0, 2000);
        if (!subject || !message) return send(res, 400, { error: 'A subject and message are required' });
        const me = sessionUser(req);
        const no = 1000 + state.supportTickets.length + 1;
        state.supportTickets.unshift({ id: uid('tkt'), no, subject, message, from: me ? { name: me.name, email: me.email, phone: me.phone } : null, t: iso(now()), status: 'open' });
        if (state.supportTickets.length > 200) state.supportTickets.length = 200;
        log('info', `Support ticket FF-${no} opened${me ? ` by ${me.name}` : ''}`);
        save();
        return send(res, 200, { ok: true, ticketNo: `FF-${no}` });
      }
      if (p === '/api/auth/register') {
        const name = String(body.name || '').trim();
        const email = normEmail(body.email);
        const phone = body.phone ? normPhone(body.phone) : null;
        const pw = String(body.password || '');
        if (!name) return send(res, 400, { error: 'Your name is required' });
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'A valid email is required' });
        if (!pw || pw.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters' });
        if (state.users.some((x) => x.email === email)) return send(res, 409, { error: 'An account with that email already exists — sign in instead' });
        if (phone && state.users.some((x) => x.phone === phone)) return send(res, 409, { error: 'An account with that number already exists' });
        const drvId = uid('drv');
        state.drivers.push({
          id: drvId, name: name.slice(0, 60), vehicle: String(body.vehicle || 'Update your vehicle in Fleet').slice(0, 60), reg: '', pco: '',
          color: DRIVER_COLORS[state.drivers.length % DRIVER_COLORS.length], status: 'online', home: CITIES.london, connections: {},
        });
        const u = mkUser(uid('usr'), name, email, phone, pw, drvId);
        state.users.push(u);
        startSession(res, u);
        log('ok', `${name} created an account and joined the fleet — link their app driver numbers in Settings`);
        broadcast('state'); save();
        return send(res, 200, { ok: true, me: { id: u.id, name: u.name, email: u.email, phone: u.phone, driverId: u.driverId } });
      }
      if (p === '/api/auth/logout') {
        const tok = parseCookies(req).ff_session;
        if (tok) delete state.sessions[tok];
        res.setHeader('Set-Cookie', 'ff_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
        save();
        return send(res, 200, { ok: true });
      }

      /* ---- operator dispatch API: offer injection ---- */
      let mo = p.match(/^\/api\/integrations\/([\w-]+)\/offers$/);
      if (mo) {
        const a = integAuth(mo[1]);
        if (a.err) return send(res, a.code, { error: a.err });
        const cid = mo[1];
        const dist = Math.max(0.5, +body.distanceMi || +rand(2, 10).toFixed(1));
        const dur = Math.max(5, parseInt(body.durationMin, 10) || Math.round(dist / 17 * 60) + 4);
        const pickupAt = body.pickupAt ? new Date(body.pickupAt) : addMin(now(), randi(45, 240));
        if (isNaN(pickupAt)) return send(res, 400, { error: 'pickupAt must be an ISO datetime' });
        const reqObj = createRequest({
          channelId: cid, source: 'api', externalId: body.externalId || null,
          rider: String(body.rider || 'API rider').slice(0, 60),
          pickup: body.pickupLat != null && body.pickupLng != null
            ? { n: String(body.pickupName || 'Pickup').slice(0, 80), pc: '', lat: +body.pickupLat, lng: +body.pickupLng }
            : { n: String(body.pickupName || pick(PLACES).n).slice(0, 80), pc: '' },
          dropoff: { n: String(body.dropoffName || pick(PLACES).n).slice(0, 80), pc: '' },
          pickupAt, distanceMi: dist, durationMin: dur,
          fare: Math.max(3, +body.fare || +((3 + dist * rand(1.9, 2.3)) * CHANNEL_CATALOG[cid].mult).toFixed(2)),
          ttlSec: Math.min(900, Math.max(30, parseInt(body.ttlSec, 10) || 300)),
        });
        wlog(cid, 'offer.created', 202, `${reqObj.rider} £${reqObj.fare.toFixed(2)} ${fmtTime(reqObj.pickupAt)} → routed ${reqObj.driverId ? driverById(reqObj.driverId).name : 'UNASSIGNED'}`);
        return send(res, 202, {
          requestId: reqObj.id, status: reqObj.status, assignedDriver: reqObj.driverId,
          expiresAt: reqObj.expiresAt, pickupCode: reqObj.code,
        });
      }
      mo = p.match(/^\/api\/integrations\/([\w-]+)\/offers\/([\w-]+)\/cancel$/);
      if (mo) {
        const a = integAuth(mo[1]);
        if (a.err) return send(res, a.code, { error: a.err });
        const extReq = Object.values(state.requests).find((r) => r.channelId === mo[1] && r.externalId === mo[2]);
        if (!extReq) { wlog(mo[1], 'offer.cancelled', 404, mo[2]); return send(res, 404, { error: 'external offer id not found' }); }
        if (extReq.status === 'pending') extReq.status = 'cancelled';
        if (extReq.status === 'accepted') {
          const blk = Object.values(state.blocks).find((b) => b.bookingId === extReq.id);
          if (blk && (blk.status === 'confirmed' || blk.status === 'in-progress')) { blk.status = 'cancelled'; releaseHolds(blk); }
        }
        wlog(mo[1], 'offer.cancelled', 200, `${extReq.rider} — slot released`);
        log('warn', `Operator cancelled ${state.channels[mo[1]].name} job (${extReq.rider}) via API — slot released on all apps`);
        broadcast('state'); save();
        return send(res, 200, { ok: true });
      }
      mo = p.match(/^\/api\/integrations\/([\w-]+)\/test$/);
      if (mo) {
        const a = integAuth(mo[1]);
        if (a.err) return send(res, a.code, { error: a.err });
        const reqObj = createRequest({ channelId: mo[1], source: 'api', externalId: 'test-' + uid('x').slice(2, 8), pickupAt: addMin(now(), randi(60, 300)) });
        wlog(mo[1], 'offer.created', 202, `Test offer fired → ${reqObj.rider}`);
        return send(res, 202, { ok: true, requestId: reqObj.id });
      }
      mo = p.match(/^\/api\/integrations\/([\w-]+)\/rotate$/);
      if (mo) {
        if (!APP_CHANNELS.includes(mo[1])) return send(res, 404, { error: 'unknown channel' });
        state.channels[mo[1]].apiKey = crypto.randomBytes(12).toString('hex');
        wlog(mo[1], 'key.rotated', 200, 'API key rotated from console');
        log('warn', `${state.channels[mo[1]].name} API key rotated — update the operator adapter`);
        broadcast('state'); save();
        return send(res, 200, { ok: true, apiKey: state.channels[mo[1]].apiKey });
      }

      /* everything below requires a signed-in session (auth/*, integrations and promo are public/keyed) */
      const publicPost = p.startsWith('/api/auth/') || p === '/api/promo/link';
      if (!publicPost && gate()) return;

      let m = p.match(/^\/api\/requests\/([\w-]+)\/accept$/);
      if (m) {
        const r = state.requests[m[1]];
        if (!r) return send(res, 404, { error: 'not found' });
        if (r.status !== 'pending') return send(res, 409, { error: 'request is no longer pending' });
        if (!r.driverId) return send(res, 409, { error: 'Assign a driver first' });
        acceptRequest(r);
        return send(res, 200, { ok: true });
      }
      m = p.match(/^\/api\/requests\/([\w-]+)\/decline$/);
      if (m) {
        const r = state.requests[m[1]];
        if (!r) return send(res, 404, { error: 'not found' });
        if (r.status !== 'pending') return send(res, 409, { error: 'request is no longer pending' });
        r.status = 'declined';
        log('info', `Declined ${state.channels[r.channelId].name} request — ${r.rider}`);
        broadcast('state'); save();
        return send(res, 200, { ok: true });
      }
      m = p.match(/^\/api\/requests\/([\w-]+)\/assign$/);
      if (m) {
        const r = state.requests[m[1]];
        if (!r) return send(res, 404, { error: 'not found' });
        if (r.status !== 'pending') return send(res, 409, { error: 'request is no longer pending' });
        const d = driverById(body.driverId);
        if (!d) return send(res, 400, { error: 'unknown driver' });
        if (d.status !== 'online') return send(res, 409, { error: d.name + ' is off duty' });
        if (!driverLinked(d, r.channelId)) return send(res, 409, { error: `${d.name.split(' ')[0]} isn't linked on ${state.channels[r.channelId].name} — add their driver number in Settings → App connections` });
        const end = addMin(new Date(r.pickupAt), r.durationMin + state.settings.bufferMin);
        const clash = driverClash(d.id, r.pickupAt, end);
        if (clash) return send(res, 409, { error: `${d.name.split(' ')[0]} already has a job at ${fmtTime(clash.start)} — overlaps` });
        r.driverId = d.id;
        log('info', `${state.channels[r.channelId].name} request reassigned → ${d.name}`);
        broadcast('state'); save();
        return send(res, 200, { ok: true });
      }

      if (p === '/api/bookings/direct') {
        const start = new Date(`${body.date}T${body.time}:00`);
        if (isNaN(start)) return send(res, 400, { error: 'invalid date/time' });
        const d = driverById(body.driverId) || onlineDrivers()[0] || state.drivers[0];
        if (!d) return send(res, 400, { error: 'no drivers on the fleet yet' });
        if (driverClash(d.id, start, addMin(start, (parseInt(body.durationMin, 10) || 30) + state.settings.bufferMin))) {
          return send(res, 409, { error: `${d.name.split(' ')[0]} has a clashing job then — pick another driver or time` });
        }
        const dur = Math.max(5, parseInt(body.durationMin, 10) || 30);
        const phone = String(body.phone || '').trim();
        if (phone && !/^\+?[\d\s()-]{7,18}$/.test(phone)) return send(res, 400, { error: 'invalid phone number' });
        const id = uid('blk');
        const block = {
          id, kind: 'booking', channelId: 'direct', driverId: d.id,
          rider: String(body.rider || 'Direct booking').slice(0, 60), riderPhone: phone || null,
          msgType: body.msgType === 'whatsapp' ? 'whatsapp' : 'sms',
          pickup: { n: String(body.pickup || 'Pickup').slice(0, 80), pc: '' },
          dropoff: { n: String(body.dropoff || 'Drop-off').slice(0, 80), pc: '' },
          start: iso(start), end: iso(addMin(start, dur + state.settings.bufferMin)), durationMin: dur,
          distanceMi: body.distanceMi ? +body.distanceMi : null, fare: body.fare ? +body.fare : null,
          code: pin4(), trackingToken: uid('trk'), status: 'confirmed', holds: {}, createdAt: iso(now()),
        };
        state.blocks[id] = block;
        log('ok', `Direct booking — ${block.rider} with ${d.name.split(' ')[0]}, ${fmtDate(start)} ${fmtTime(start)}. Blocking all apps…`);
        syncBlockToChannels(block);
        if (phone) sendMessage({ blockId: id, to: phone, body: msgTemplates.confirmation(block, d), type: block.msgType, kind: 'confirmation' });
        broadcast('state'); save();
        notifyBooking(block, 'direct');
        return send(res, 200, { ok: true, id });
      }
      if (p === '/api/blocks') {
        const start = new Date(`${body.date}T${body.time}:00`);
        if (isNaN(start)) return send(res, 400, { error: 'invalid date/time' });
        const driverId = driverById(body.driverId) ? body.driverId : 'all';
        const dur = Math.max(5, parseInt(body.durationMin, 10) || 60);
        const id = uid('blk');
        const block = {
          id, kind: 'manual', channelId: 'manual', driverId,
          rider: String(body.note || 'Blocked time').slice(0, 80),
          pickup: null, dropoff: null, start: iso(start), end: iso(addMin(start, dur)),
          durationMin: dur, status: 'confirmed', holds: {}, createdAt: iso(now()),
        };
        state.blocks[id] = block;
        log('ok', `Manual block (${driverId === 'all' ? 'whole fleet' : driverById(driverId).name.split(' ')[0]}) — ${fmtDate(start)} ${fmtTime(start)}: ${block.rider}`);
        syncBlockToChannels(block);
        broadcast('state'); save();
        return send(res, 200, { ok: true, id });
      }
      m = p.match(/^\/api\/blocks\/([\w-]+)\/cancel$/);
      if (m) {
        const b = state.blocks[m[1]];
        if (!b) return send(res, 404, { error: 'not found' });
        if (b.kind === 'manual') {
          releaseHolds(b);
          delete state.blocks[m[1]];
          log('info', 'Manual block removed — slots released on all apps');
        } else {
          b.status = 'cancelled';
          releaseHolds(b);
          const req2 = b.bookingId && state.requests[b.bookingId];
          if (req2) req2.status = 'driver-cancelled';
          if (b.riderPhone) sendMessage({ blockId: b.id, to: b.riderPhone, body: msgTemplates.cancelled(b), type: b.msgType || 'sms', kind: 'cancelled' });
          log('warn', `You cancelled the ${fmtTime(b.start)} job — slot released on all apps`);
        }
        broadcast('state'); save();
        return send(res, 200, { ok: true });
      }
      m = p.match(/^\/api\/blocks\/([\w-]+)\/verify$/);
      if (m) {
        const b = state.blocks[m[1]];
        if (!b) return send(res, 404, { error: 'not found' });
        if (!b.code) return send(res, 400, { error: 'no code on this booking' });
        if (b.pickupVerifiedAt) return send(res, 409, { error: 'already verified at ' + fmtTime(b.pickupVerifiedAt) });
        b.verifyAttempts = (b.verifyAttempts || 0) + 1;
        if (String(body.code || '').trim() !== b.code) {
          if (b.verifyAttempts >= 3) log('err', `3 failed pickup-code attempts for ${b.rider} (${fmtTime(b.start)}) — rider support would be notified`);
          else log('warn', `Wrong pickup code for ${b.rider} (attempt ${b.verifyAttempts})`);
          broadcast('state'); save();
          return send(res, 403, { error: 'Code does not match — ask the rider to check their confirmation message' });
        }
        b.pickupVerifiedAt = iso(now());
        log('ok', `Pickup verified ✓ ${b.rider} (${fmtTime(b.start)}) — code matched, identities confirmed both ways`);
        broadcast('state'); save();
        return send(res, 200, { ok: true });
      }
      if (p === '/api/holds/retry') {
        const b = state.blocks[body.blockId];
        if (!b) return send(res, 404, { error: 'not found' });
        const cid = body.channelId;
        if (!APP_CHANNELS.includes(cid)) return send(res, 400, { error: 'bad channel' });
        b.holds[cid] = { state: 'syncing', at: iso(now()) };
        log('info', `Retrying block push to ${state.channels[cid].name}…`);
        scheduleHoldAck(b.id, cid, 1);
        broadcast('state'); save();
        return send(res, 200, { ok: true });
      }
      if (p === '/api/messages/resend') {
        const b = state.blocks[body.blockId];
        if (!b || !b.riderPhone) return send(res, 404, { error: 'no rider phone number on this booking' });
        const d = driverById(b.driverId) || state.drivers[0];
        sendMessage({ blockId: b.id, to: b.riderPhone, body: msgTemplates.confirmation(b, d), type: b.msgType || 'sms', kind: 'confirmation' });
        return send(res, 200, { ok: true });
      }

      /* ---- fleet management ---- */
      if (p === '/api/drivers') {
        const name = String(body.name || '').trim();
        if (!name) return send(res, 400, { error: 'name required' });
        const city = CITIES[body.city] || CITIES.london;
        const d = {
          id: uid('drv'), name: name.slice(0, 60),
          vehicle: String(body.vehicle || 'Saloon').slice(0, 60),
          reg: String(body.reg || '').slice(0, 12).toUpperCase(),
          pco: String(body.pco || '').slice(0, 24),
          color: DRIVER_COLORS[state.drivers.length % DRIVER_COLORS.length],
          status: 'online', home: city,
        };
        state.drivers.push(d);
        log('ok', `${name} joined the fleet (${city.name}) — their diary is now being managed`);
        broadcast('state'); save();
        return send(res, 200, { ok: true, id: d.id });
      }
      m = p.match(/^\/api\/drivers\/([\w-]+)\/edit$/);
      if (m) {
        const d = driverById(m[1]);
        if (!d) return send(res, 404, { error: 'not found' });
        if (body.name != null) d.name = String(body.name).slice(0, 60);
        if (body.vehicle != null) d.vehicle = String(body.vehicle).slice(0, 60);
        if (body.reg != null) d.reg = String(body.reg).slice(0, 12).toUpperCase();
        if (body.pco != null) d.pco = String(body.pco).slice(0, 24);
        if (body.city && CITIES[body.city]) d.home = CITIES[body.city];
        log('ok', `${d.name}'s profile updated`);
        broadcast('state'); save();
        return send(res, 200, { ok: true });
      }
      m = p.match(/^\/api\/drivers\/([\w-]+)\/toggle$/);
      if (m) {
        const d = driverById(m[1]);
        if (!d) return send(res, 404, { error: 'not found' });
        d.status = d.status === 'online' ? 'offline' : 'online';
        log(d.status === 'online' ? 'ok' : 'warn', `${d.name} is now ${d.status === 'online' ? 'ONLINE and taking routed jobs' : 'off duty (keeps existing bookings)'}`);
        broadcast('state'); save();
        return send(res, 200, { ok: true });
      }

      m = p.match(/^\/api\/drivers\/([\w-]+)\/connection$/);
      if (m) {
        const d = driverById(m[1]);
        if (!d) return send(res, 404, { error: 'not found' });
        const cid = body.channelId;
        if (!APP_CHANNELS.includes(cid)) return send(res, 400, { error: 'unknown app channel' });
        d.connections = d.connections || {};
        if (body.remove) {
          if (!d.connections[cid]) return send(res, 409, { error: 'Not linked on that app' });
          const had = d.connections[cid].ref;
          delete d.connections[cid];
          log('warn', `${d.name.split(' ')[0]} unlinked from ${state.channels[cid].name} (${had}) — can no longer take its jobs`);
        } else {
          const ref = String(body.ref || '').toUpperCase().replace(/\s+/g, '');
          if (!/^[A-Z0-9-]{4,20}$/.test(ref)) return send(res, 400, { error: 'Enter the driver number exactly as the company issued it (4–20 letters/digits)' });
          d.connections[cid] = { ref, linkedAt: iso(now()) };
          log('ok', `${d.name.split(' ')[0]} linked to ${state.channels[cid].name} as ${ref} — its jobs can now route there`);
        }
        broadcast('state'); save();
        return send(res, 200, { ok: true });
      }

      m = p.match(/^\/api\/channels\/([\w-]+)$/);
      if (m) {
        const cid = m[1];
        const chState = state.channels[cid];
        if (!chState) return send(res, 404, { error: 'not found' });
        if (cid === 'direct') return send(res, 400, { error: 'Direct channel cannot be paused' });
        const next = body.status === 'paused' ? 'paused' : 'connected';
        chState.status = next;
        if (next === 'paused') {
          log('warn', `${chState.name} paused — fleet offline there. Existing blocks stay blocked.`);
        } else {
          log('ok', `${chState.name} connected — catching up sync…`);
          let n = 0;
          for (const b of Object.values(state.blocks)) {
            if ((b.status === 'confirmed' || b.status === 'in-progress') && new Date(b.end) > now() && b.channelId !== cid) {
              const h = b.holds[cid];
              if (!h || h.state === 'failed' || h.state === 'released') {
                b.holds[cid] = { state: 'syncing', at: iso(now()) };
                scheduleHoldAck(b.id, cid, 1); n++;
              }
            }
          }
          if (n) log('info', `Re-syncing ${n} upcoming block${n > 1 ? 's' : ''} to ${chState.name}`);
          scheduleNextGen(true);
        }
        broadcast('state'); save();
        return send(res, 200, { ok: true });
      }
      if (p === '/api/master') {
        const online = !!body.online;
        for (const cid of APP_CHANNELS) state.channels[cid].status = online ? 'connected' : 'paused';
        log(online ? 'ok' : 'warn', online ? 'Back online — all apps connected' : 'Fleet went OFFLINE on all apps');
        if (online) {
          for (const cid of APP_CHANNELS) {
            for (const b of Object.values(state.blocks)) {
              if ((b.status === 'confirmed' || b.status === 'in-progress') && new Date(b.end) > now() && b.channelId !== cid) {
                const h = b.holds[cid];
                if (!h || h.state === 'failed' || h.state === 'released') {
                  b.holds[cid] = { state: 'syncing', at: iso(now()) };
                  scheduleHoldAck(b.id, cid, 1);
                }
              }
            }
          }
          scheduleNextGen(true);
        }
        broadcast('state'); save();
        return send(res, 200, { ok: true });
      }

      if (p === '/api/calendar/import') {
        const events = parseICS(body.ics || '');
        if (!events.length) return send(res, 400, { error: 'No VEVENT entries found — paste the full iCal/ICS file content' });
        const driverId = driverById(body.driverId) ? body.driverId : 'all';
        let imported = 0, skipped = 0;
        for (const ev of events) {
          if (ev.uid && Object.values(state.blocks).some((b) => b.icalUid === ev.uid)) { skipped++; continue; }
          const start = ev.start;
          const end = ev.end && ev.end > start ? ev.end : addMin(start, 60);
          if (end < now()) { skipped++; continue; }
          const id = uid('blk');
          const block = {
            id, kind: 'manual', channelId: 'manual', driverId, icalUid: ev.uid || null,
            rider: String(ev.summary || 'Calendar event').slice(0, 80),
            pickup: null, dropoff: null, start: iso(start), end: iso(end),
            durationMin: Math.round((end - start) / 60000), status: 'confirmed', holds: {}, createdAt: iso(now()),
          };
          state.blocks[id] = block;
          syncBlockToChannels(block);
          imported++;
        }
        log('ok', `Calendar import: ${imported} event${imported === 1 ? '' : 's'} blocked across all apps${skipped ? ` (${skipped} skipped)` : ''}`);
        broadcast('state'); save();
        return send(res, 200, { ok: true, imported, skipped });
      }

      if (p === '/api/promo/link') {
        const phone = String(body.phone || '').trim();
        if (!/^\+?[\d\s()-]{7,18}$/.test(phone)) return send(res, 400, { error: 'Enter a valid mobile number' });
        state._promoRecent = state._promoRecent || {};
        const last = state._promoRecent[phone] || 0;
        if (Date.now() - last < 60000) return send(res, 429, { error: 'Link already sent to that number — try again in a minute' });
        state._promoRecent[phone] = Date.now();
        const url = /^https?:\/\/[^\s]{5,220}$/.test(String(body.link || '')) ? String(body.link) : 'fareflow.app/get';
        sendMessage({
          blockId: null, to: phone,
          body: `FareFlow — the channel manager for UK drivers. Install free: ${url}\nOne diary for Uber, Bolt, FREE NOW, Gett, Veezu & Addison Lee — accept once, blocked everywhere. Reply STOP to opt out.`,
          type: 'sms', kind: 'promo',
        });
        return send(res, 200, { ok: true });
      }

      if (p === '/api/settings') {
        const s = state.settings;        if (body.bufferMin != null) s.bufferMin = Math.min(60, Math.max(0, parseInt(body.bufferMin, 10) || 0));
        if (body.autoDeclineOverlap != null) s.autoDeclineOverlap = !!body.autoDeclineOverlap;
        if (body.autoAccept != null) s.autoAccept = !!body.autoAccept;
        if (body.minPerMile != null) s.minPerMile = Math.min(10, Math.max(0.5, +body.minPerMile || 0));
        if (body.regenFeed) {
          s.feedToken = crypto.randomBytes(8).toString('hex');
          log('warn', 'Calendar feed URL regenerated — old links are dead');
        }
        log('ok', 'Settings saved');
        broadcast('state'); save();
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'unknown endpoint' });
    }

    /* static (rider tracking page is public, keyless; marketing site at /get) */
    let filePath = p === '/' ? '/index.html'
      : p.startsWith('/t/') ? '/track.html'
      : (p === '/get' || p === '/site') ? '/site.html' : p;
    const abs = path.normalize(path.join(PUB, filePath));
    if (!abs.startsWith(PUB)) return send(res, 403, { error: 'forbidden' });
    fs.readFile(abs, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'server error' });
  }
});

load();
for (const [id, b] of Object.entries(state.blocks)) {
  if ((b.status === 'completed' || b.status === 'cancelled') && new Date(b.end) < addMin(now(), -14 * 24 * 60)) delete state.blocks[id];
}
save();
scheduleNextGen(true);
server.listen(PORT, '0.0.0.0', () => console.log(`FareFlow listening on http://0.0.0.0:${PORT}`));
process.on('SIGINT', () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 1)); } catch {} process.exit(0); });
