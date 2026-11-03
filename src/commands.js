// Every player action is a small plain object (a command) applied at the start of a
// game tick. Replays are a list of commands; multiplayer sends commands to every
// computer so each runs the same battle. Entities are referred to by id.
//
// All commands carry p (the player's id). Handlers re-check ownership and validity,
// since a command may arrive from another computer or a replay file.
import { BUILDINGS } from './config.js';

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
};

export function applyCommand(g, c) {
  const p = g.players[c.p];
  const h = HANDLERS[c.type];
  if (!p || p.neutral || !h) return;
  h(g, p, c);
}
