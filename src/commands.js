// Every player action is a small plain object (a command) applied at the start of a
// game tick. Replays are a list of commands; multiplayer sends commands to every
// computer so each runs the same battle. Entities are referred to by id.
//
// All commands carry p (the player's id). Handlers re-check ownership and validity,
// since a command may arrive from another computer or a replay file.
import { BUILDINGS, UNITS, POWERS, RANKS } from './config.js';

const ent = (g, id) => {
  const e = g.byId.get(id);
  return e && !e.dead && !e.inside ? e : null;
};
// The units in a command that the commanding player really owns
const units = (g, p, ids) => (ids || []).map((id) => ent(g, id)).filter((u) => u?.isUnit && u.owner === p);
const building = (g, p, id) => { const b = ent(g, id); return b?.isBuilding && b.owner === p ? b : null; };
const clearQueue = (list) => { for (const u of list) u.waypoints = []; };

const HANDLERS = {
  // { u, x, y, mode: 'move' | 'attackmove', q: queue as waypoints }
  move(g, p, c) {
    g.groupOrder(units(g, p, c.u), c.x, c.y, c.mode === 'attackmove' ? 'attackmove' : 'move', !!c.q);
  },
  // { u, tile } harvesters to an ore tile
  harvest(g, p, c) {
    for (const u of units(g, p, c.u)) if (u.def.harvester) { u.waypoints = []; u.orderHarvest(g, c.tile); }
  },
  // { u, t } harvesters to a specific refinery
  dock(g, p, c) {
    const ref = building(g, p, c.t);
    if (ref) for (const u of units(g, p, c.u)) if (u.def.harvester) u.orderDock(g, ref);
  },
  // { u, t } or { u, gx, gy } for force fire on the ground
  attack(g, p, c) {
    const target = c.t !== undefined ? ent(g, c.t) : { isGround: true, x: c.gx, y: c.gy, dead: false, hp: 1, maxHp: 1 };
    if (!target) return;
    const list = units(g, p, c.u).filter((u) => g.canHit(u.weapon, target));
    clearQueue(list);
    for (const u of list) u.orderAttack(g, target);
  },
  // { u, x, y, t } guard a spot, or escort unit t
  guard(g, p, c) {
    const ally = c.t !== undefined ? ent(g, c.t) : null;
    const list = units(g, p, c.u);
    clearQueue(list);
    for (const u of list) u.orderGuard(g, c.x, c.y, ally?.owner === p ? ally : null);
  },
  stop(g, p, c) {
    const list = units(g, p, c.u);
    clearQueue(list);
    for (const u of list) u.orderStop();
  },
  // { u, kind: 'capture' | 'enter' | 'demolish', t }
  reach(g, p, c) {
    const b = ent(g, c.t);
    if (!b?.isBuilding || !['capture', 'enter', 'demolish'].includes(c.kind)) return;
    const list = units(g, p, c.u);
    clearQueue(list);
    for (const u of list) u.orderReach(g, c.kind, b);
  },
  // { u: [engineer], b: bridge index }
  fixBridge(g, p, c) {
    const br = g.map.bridges[c.b];
    const [u] = units(g, p, c.u);
    if (br?.dead && u?.def.engineer) { u.waypoints = []; u.orderFixBridge(g, br); }
  },
  // { u, t? } go to repair bay t, or the nearest one
  repair(g, p, c) {
    const bay = c.t !== undefined ? building(g, p, c.t) : null;
    for (const u of units(g, p, c.u)) { u.waypoints = []; u.orderRepair(g, bay || g.repairBayFor(u)); }
  },
  build(g, p, c) { p.enqueue(c.key, g); },
  cancel(g, p, c) { p.cancel(c.key); },
  // { key, x, y } place a finished building
  place(g, p, c) {
    if (!g.placeBuilding(p, c.key, c.x, c.y) && p === g.human) { g.notify("Can't build there", 'warn', 1); g.sound('error'); }
  },
  // { key, tiles: [[x, y]...] } a dragged-out wall line: the first segment uses the
  // finished wall, the others are paid for on the spot
  walls(g, p, c) {
    const def = BUILDINGS[c.key];
    if (!def?.wall || !c.tiles?.length) return;
    const [[x0, y0], ...rest] = c.tiles.slice(0, 16);
    if (!g.placeBuilding(p, c.key, x0, y0)) return;
    for (const [x, y] of rest) {
      if (p.credits < def.cost) { if (p === g.human) g.notify('Insufficient funds', 'warn', 20); break; }
      if (!g.canPlace(p, c.key, x, y)) continue;
      p.credits -= def.cost;
      g.addBuilding(p, c.key, x, y);
    }
  },
  sell(g, p, c) { const b = building(g, p, c.t); if (b) g.sell(b); },
  repairBuilding(g, p, c) { const b = building(g, p, c.t); if (b && b.hp < b.maxHp) b.repairing = !b.repairing; },
  rally(g, p, c) { const b = building(g, p, c.t); if (b) b.rally = { x: c.x, y: c.y }; },
  power(g, p, c) { g.usePower(p, c.power, c.x, c.y); },
  evacuate(g, p, c) { const b = building(g, p, c.t); if (b?.garrison?.length) g.evacuate(b); },

  // Test mode (offline only). { op, ... } — see TEST_OPS
  test(g, p, c) {
    if (g.net) return; // never online
    g.tested = true;
    TEST_OPS[c.op]?.(g, c);
  },
};

const playerAt = (g, i) => (g.players[i] && !g.players[i].neutral ? g.players[i] : null);

// Test-mode actions. They can affect any player, so they name the one they mean.
const TEST_OPS = {
  // { player, amount, add: true = add, false = set }
  credits(g, c) {
    const pl = playerAt(g, c.player);
    if (pl) pl.credits = Math.max(0, (c.add ? pl.credits : 0) + c.amount);
  },
  // { player, flag: 'instant' | 'god' | 'power' | 'tech' | 'anywhere', on }
  cheat(g, c) {
    const pl = playerAt(g, c.player);
    if (!pl || !['instant', 'god', 'power', 'tech', 'anywhere'].includes(c.flag)) return;
    pl.cheats = { ...pl.cheats, [c.flag]: !!c.on };
    pl.recount(g);
  },
  // { player, key, x, y, count } units appear around (x, y), ships on the nearest water
  spawn(g, c) {
    const pl = playerAt(g, c.player), def = UNITS[c.key];
    if (!pl || !def) return;
    const domain = def.domain || 'land';
    for (let k = 0; k < Math.min(50, c.count || 1); k++) {
      const a = k * 2.4, r = Math.sqrt(k) * 0.7;
      const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
      const t = domain === 'air' ? { x: Math.floor(x), y: Math.floor(y) } : g.map.nearestPassable(Math.floor(x), Math.floor(y), x, y, domain);
      if (!t || !g.map.inBounds(t.x, t.y)) continue;
      const u = g.addUnit(pl, c.key, t.x + 0.5, t.y + 0.5);
      if (u.isAir) { u.landed = false; u.z = 40; }
    }
  },
  // { player, key, x, y } a finished building, free, anywhere the ground allows
  place(g, c) {
    const pl = playerAt(g, c.player), def = BUILDINGS[c.key];
    if (!pl || !def || !g.fits(pl, c.key, c.x, c.y)) return;
    g.addBuilding(pl, c.key, c.x, c.y, true);
    g.sound('place', c.x + def.w / 2, c.y + def.h / 2);
  },
  // { t: [ids], what: 'heal' | 'kill' | 'promote' } on any units / buildings
  entities(g, c) {
    for (const id of c.t || []) {
      const e = g.byId.get(id);
      if (!e || e.dead || e.inside) continue;
      if (c.what === 'heal') e.hp = e.maxHp;
      else if (c.what === 'kill') g.kill(e);
      else if (c.what === 'promote' && e.isUnit) { e.xp = 3 * e.def.cost; e.rank = RANKS.length - 1; }
    }
  },
  // { player } every support power whose building the player has is ready now
  charge(g, c) {
    const pl = playerAt(g, c.player);
    if (!pl) return;
    for (const [id, pw] of Object.entries(POWERS)) if (pw.faction === pl.faction && pl.has(pw.building)) pl.powers[id] = { charge: pw.charge, announced: false };
  },
  // { player, patch: { income, build, think, firstAttack, waveEvery, waveMin, maxWave, raids }, passive, frozen }
  ai(g, c) {
    const ai = g.ais.find((a) => a.p.id === c.player);
    if (!ai) return;
    if (c.patch) {
      const { income, build, ...rest } = c.patch;
      if (income !== undefined) ai.p.incomeMult = income;
      if (build !== undefined) ai.p.buildMult = build;
      ai.tune(rest);
    }
    if (c.passive !== undefined) ai.passive = !!c.passive;
    if (c.frozen !== undefined) ai.frozen = !!c.frozen;
  },
  reveal(g) {
    g.explored.fill(1);
    g.visStamp++;
  },
  // { result: 'win' | 'lose' } end the battle now (handy for campaign testing)
  result(g, c) {
    if (c.result === 'win' || c.result === 'lose') { g.result = c.result; g.notify(c.result === 'win' ? 'Mission accomplished' : 'Mission failed', 'alert', 0); }
  },
};

export function applyCommand(g, c) {
  const p = g.players[c.p];
  const h = HANDLERS[c.type];
  if (!p || p.neutral || !h) return;
  h(g, p, c);
}
