// Zero-dependency server: `node server.js` then open http://localhost:8080
// Serves the game's files, and relays online games between players:
//   POST /api/rooms                 create a room          -> { code, token }
//   POST /api/rooms/CODE/join       join one               -> { token }
//   GET  /api/rooms/CODE/events     Server-Sent Events: lobby updates, game start, turns
//   POST /api/rooms/CODE/act        lobby changes, start, and each player's turns
// The server never simulates anything: every browser runs the same battle from the
// same seed, and the server only passes their commands around in one agreed order.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

// ---------- online rooms ----------
// Seats per mode and their teams (mirrors MODES in src/config.js)
const MODE_TEAMS = { '1v1': [0, 1], '1v2': [0, 1, 1], '2v2': [0, 0, 1, 1], ffa: [0, 1, 2, 3] };
const FACTIONS = ['allied', 'soviet', 'syndicate'];
const MAPS = ['random', 'world', 'china', 'korea', 'usa']; // built-in maps only: custom ones live in one browser
const rooms = new Map();

const newCode = () => {
  let code;
  do code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join('');
  while (rooms.has(code));
  return code;
};
const newToken = () => crypto.randomBytes(12).toString('hex');

function makeSlots(mode, old = []) {
  return MODE_TEAMS[mode].map((team, i) => ({ team, human: old[i]?.human ?? null, faction: old[i]?.faction ?? FACTIONS[i % 2] }));
}

function lobbyState(room, member) {
  return {
    k: 'lobby',
    code: room.code,
    settings: room.settings,
    host: member.token === room.host,
    you: member.slot,
    started: room.started,
    slots: room.slots.map((s) => ({ team: s.team, faction: s.faction, name: s.human ? room.members.get(s.human)?.name : null })),
  };
}

function send(member, msg) {
  if (member.stream) member.stream.write(`data: ${JSON.stringify(msg)}\n\n`);
}

function broadcastLobby(room) {
  for (const m of room.members.values()) send(m, lobbyState(room, m));
}

function seat(room, token) {
  // first free seat, preferring the team with fewest people on it
  const counts = {};
  for (const s of room.slots) if (s.human) counts[s.team] = (counts[s.team] || 0) + 1;
  const free = room.slots.map((s, i) => ({ s, i })).filter(({ s }) => !s.human);
  free.sort((a, b) => (counts[a.s.team] || 0) - (counts[b.s.team] || 0));
  if (!free.length) return -1;
  free[0].s.human = token;
  return free[0].i;
}

function act(room, member, body) {
  const isHost = member.token === room.host;
  switch (body.act) {
    case 'turn':
      // one player's commands for one turn, passed to everyone in arrival order
      if (!room.started || typeof body.turn !== 'number' || !Array.isArray(body.cmds)) return 400;
      for (const m of room.members.values()) send(m, { k: 'turn', slot: member.slot, turn: body.turn, cmds: body.cmds, hash: body.hash });
      return 200;
    case 'sit': {
      const s = room.slots[body.slot];
      if (room.started || !s || s.human) return 409;
      room.slots[member.slot].human = null;
      s.human = member.token;
      member.slot = body.slot;
      break;
    }
    case 'faction': {
      const s = room.slots[body.slot];
      if (room.started || !s || !FACTIONS.includes(body.faction)) return 400;
      if (s.human !== member.token && !(isHost && !s.human)) return 403;
      s.faction = body.faction;
      break;
    }
    case 'settings': {
      const { map, mode, difficulty } = body;
      if (!isHost || room.started || !MAPS.includes(map) || !MODE_TEAMS[mode] || !['normal', 'hard'].includes(difficulty)) return 400;
      const humans = [...room.members.values()];
      if (humans.length > MODE_TEAMS[mode].length) return 409;
      room.settings = { map, mode, difficulty };
      room.slots = makeSlots(mode);
      for (const m of humans) m.slot = m.token === room.host ? 0 : -1;
      room.slots[0].human = room.host;
      for (const m of humans) if (m.slot < 0) m.slot = seat(room, m.token);
      break;
    }
    case 'start': {
      if (!isHost || room.started) return 403;
      room.started = true;
      const setup = {
        ...room.settings,
        seed: crypto.randomInt(1e9),
        players: room.slots.map((s) => ({ faction: s.faction, ai: !s.human, name: s.human ? room.members.get(s.human).name : null })),
      };
      for (const m of room.members.values()) send(m, { k: 'start', setup, you: m.slot });
      return 200;
    }
    default:
      return 400;
  }
  broadcastLobby(room);
  return 200;
}

function leave(room, member) {
  room.members.delete(member.token);
  if (!room.started) {
    if (member.token === room.host || !room.members.size) {
      for (const m of room.members.values()) send(m, { k: 'closed' });
      rooms.delete(room.code);
      return;
    }
    if (room.slots[member.slot]) room.slots[member.slot].human = null;
    broadcastLobby(room);
  } else {
    for (const m of room.members.values()) send(m, { k: 'left', slot: member.slot, name: member.name });
    if (!room.members.size) rooms.delete(room.code);
  }
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 65536) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); } });
  });
}

const json = (res, code, body) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
const cleanName = (n) => String(n || 'Commander').replace(/[<>&"]/g, '').trim().slice(0, 20) || 'Commander';

async function api(req, res, parts, query) {
  if (parts.length === 0 && req.method === 'POST') {
    const body = await readJson(req);
    const code = newCode(), token = newToken();
    const room = { code, host: token, members: new Map(), settings: { map: 'random', mode: '1v1', difficulty: 'normal' }, started: false, created: Date.now() };
    room.slots = makeSlots('1v1');
    room.slots[0].human = token;
    room.members.set(token, { token, name: cleanName(body?.name), slot: 0, stream: null });
    rooms.set(code, room);
    return json(res, 200, { code, token });
  }
  const room = rooms.get(String(parts[0]).toUpperCase());
  if (!room) return json(res, 404, { error: 'No game with that code' });
  const what = parts[1];
  if (what === 'join' && req.method === 'POST') {
    const body = await readJson(req);
    if (room.started) return json(res, 409, { error: 'That game has already started' });
    const token = newToken();
    const slot = seat(room, token);
    if (slot < 0) return json(res, 409, { error: 'That game is full' });
    room.members.set(token, { token, name: cleanName(body?.name), slot, stream: null });
    broadcastLobby(room);
    return json(res, 200, { token });
  }
  const member = room.members.get(query.get('token'));
  if (what === 'events' && req.method === 'GET') {
    if (!member) return json(res, 403, { error: 'Not in this game' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    member.stream = res;
    send(member, lobbyState(room, member));
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); if (member.stream === res) leave(room, member); });
    return;
  }
  if (what === 'act' && req.method === 'POST') {
    const body = await readJson(req);
    const m = body && room.members.get(body.token);
    if (!m) return json(res, 403, { error: 'Not in this game' });
    const code = act(room, m, body);
    return json(res, code, code === 200 ? { ok: true } : { error: 'Not allowed' });
  }
  json(res, 404, { error: 'Unknown request' });
}

// Forget rooms nobody is connected to
setInterval(() => {
  for (const [code, room] of rooms) {
    const connected = [...room.members.values()].some((m) => m.stream);
    if (!connected && Date.now() - room.created > 60000) rooms.delete(code);
  }
}, 30000);

// ---------- files ----------
http
  .createServer((req, res) => {
    const [urlPath, qs = ''] = req.url.split('?');
    if (urlPath.startsWith('/api/rooms')) {
      const parts = urlPath.slice('/api/rooms'.length).split('/').filter(Boolean);
      api(req, res, parts, new URLSearchParams(qs)).catch(() => json(res, 500, { error: 'Server error' }));
      return;
    }
    const file = path.normalize(path.join(ROOT, decodeURIComponent(urlPath === '/' ? 'index.html' : urlPath)));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`Iron Front running at http://localhost:${PORT}`);
    // other computers on the same network can join through one of these
    for (const list of Object.values(require('os').networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  on your network: http://${a.address}:${PORT}`);
    }
  });
