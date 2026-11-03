// Online play, lockstep style. Time is cut into turns of TURN ticks (0.1 s). What you
// order during turn T is sent to everyone as part of turn T + DELAY, and nobody
// simulates a turn until every player's commands for it have arrived. Each browser
// then applies the same commands on the same tick, so all of them run the same battle.
// Every so often players also send a fingerprint of their battle to catch a desync.
export const TURN = 6;
export const DELAY = 3; // turns between an order and its execution (~0.3 s)
const HASH_EVERY = 50; // turns

export class Net {
  static base = ''; // server address; empty = the one that served the page

  constructor(code, token) {
    this.code = code;
    this.token = token;
  }

  static async request(path, body) {
    const res = await fetch(`${Net.base}/api/rooms${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server said ${res.status}`);
    return data;
  }

  // code: the one the host chose, or empty for a made-up one
  static async host(name, code = '') {
    const { code: got, token } = await Net.request('', { name, code });
    return new Net(got, token);
  }

  static async join(code, name) {
    const { token } = await Net.request(`/${encodeURIComponent(code.trim().toUpperCase())}/join`, { name });
    return new Net(code.trim().toUpperCase(), token);
  }

  // Lobby and game messages arrive here
  listen(onMessage) {
    this.es = new EventSource(`${Net.base}/api/rooms/${this.code}/events?token=${this.token}`);
    this.es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.k === 'turn') this.receive(msg);
      else if (msg.k === 'left') this.gone?.add(msg.slot);
      onMessage(msg);
    };
    this.es.onerror = () => onMessage({ k: 'error' });
  }

  act(body) {
    return Net.request(`/${this.code}/act`, { token: this.token, ...body }).catch((err) => console.warn('online:', err.message));
  }

  close() {
    this.es?.close();
    this.es = null;
  }

  // ---------- in battle ----------
  begin(game, you, humans) {
    this.g = game;
    this.slot = you;
    this.humans = humans; // seats played by people
    this.gone ||= new Set();
    this.turns = new Map(); // turn -> Map(seat -> commands)
    this.hashes = new Map(); // turn -> Map(seat -> fingerprint)
    this.out = []; // our orders since the last turn went out
    this.desync = false;
  }

  send(c) {
    this.out.push(c);
  }

  receive(msg) {
    if (!this.turns) return;
    if (!this.turns.has(msg.turn)) this.turns.set(msg.turn, new Map());
    this.turns.get(msg.turn).set(msg.slot, msg.cmds);
    if (msg.hash !== undefined) {
      const at = msg.turn - DELAY;
      if (!this.hashes.has(at)) this.hashes.set(at, new Map());
      const hs = this.hashes.get(at);
      hs.set(msg.slot, msg.hash);
      if ([...hs.values()].some((h) => h !== hs.values().next().value)) this.desync = true;
    }
  }

  // Can the battle advance past this tick, or are we still waiting for someone?
  ready(tick) {
    if (tick % TURN) return true;
    const t = tick / TURN;
    if (t < DELAY) return true;
    const got = this.turns.get(t);
    return [...this.humans].every((s) => this.gone.has(s) || got?.has(s));
  }

  // Called once per tick, only when ready(): sends our next turn and hands back
  // everyone's commands for this one, in seat order
  commandsAt(tick) {
    if (tick % TURN) return [];
    const t = tick / TURN;
    const hash = t % HASH_EVERY === 0 && !this.g.result ? this.g.hash() : undefined;
    this.act({ act: 'turn', turn: t + DELAY, cmds: this.out, ...(hash !== undefined ? { hash } : {}) });
    this.out = [];
    const got = this.turns.get(t);
    this.turns.delete(t);
    if (!got) return [];
    const list = [];
    for (const s of [...got.keys()].sort((a, b) => a - b)) for (const c of got.get(s)) list.push({ ...c, p: s });
    return list;
  }

  // Seats whose players we're waiting on
  waitingFor(tick) {
    const t = Math.floor(tick / TURN), got = this.turns.get(t);
    return [...this.humans].filter((s) => !this.gone.has(s) && !got?.has(s));
  }
}
