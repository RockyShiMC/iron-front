import { UNITS, BUILDINGS } from './config.js';
import { Game } from './game.js';
import { Unit, Building, peekNextId, setNextId } from './entities.js';
import { Player } from './player.js';
import { MAPS } from './maps.js';

// Saved battles: the map is rebuilt from its seed, everything that changes during
// play is written out. Entities and players are stored once and referenced by id.
const VERSION = 1;
export const SLOTS = 5;
const INDEX_KEY = 'ironfront.saves';
const slotKey = (n) => `ironfront.save.${n}`;

// ---------- encoding ----------
function encoder(live) {
  const enc = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : { $num: String(v) };
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Player) return { $p: v.id };
    if (v.isUnit || v.isBuilding) {
      if (live.has(v)) return { $e: v.id };
      // something already destroyed that a unit or shot still points at
      return { $ghost: { id: v.id, owner: v.owner?.id, x: v.x, y: v.y, isUnit: !!v.isUnit, isBuilding: !!v.isBuilding, isAir: !!v.isAir } };
    }
    if (v instanceof Set) return { $set: [...v].map(enc) };
    if (v instanceof Map) return { $map: [...v].map(([k, x]) => [enc(k), enc(x)]) };
    if (ArrayBuffer.isView(v)) return { $ta: v.constructor.name, d: Array.from(v) };
    if (Array.isArray(v)) return v.map(enc);
    const o = {};
    for (const k of Object.keys(v)) o[k] = enc(v[k]);
    return o;
  };
  return enc;
}

// An object's own fields, each encoded (so an entity's flags don't turn it into a reference to itself)
const fields = (o, enc, skip = []) => Object.fromEntries(Object.entries(o).filter(([k]) => !skip.includes(k)).map(([k, v]) => [k, enc(v)]));

export function snapshot(game, renderer) {
  const live = new Set([...game.units, ...game.buildings]);
  const enc = encoder(live);
  return {
    version: VERSION,
    seed: game.seed,
    setup: game.setup,
    nextId: peekNextId(),
    camera: renderer ? renderer.toWorld(renderer.viewW / 2, renderer.viewH / 2) : null,
    state: {
      time: game.time,
      explored: enc(game.explored),
      ore: enc(game.map.ore),
      visTimer: game.visTimer,
      oreTimer: game.oreTimer,
      lastNotice: game.lastNotice,
      result: game.result,
      players: game.players.map((p) => fields(p, enc)),
      units: game.units.map((u) => fields(u, enc, ['def'])),
      buildings: game.buildings.map((b) => fields(b, enc, ['def'])),
      oreReserved: enc(game.oreReserved),
      projectiles: enc(game.projectiles),
      effects: enc(game.effects),
      ais: game.ais.map((ai) => fields(ai, enc, ['g', 'p', 'd'])),
    },
  };
}

// ---------- decoding ----------
export function restore(data) {
  if (!data || data.version !== VERSION) throw new Error('This save was made by a different version of the game');
  if (!MAPS[data.setup.map]) throw new Error('This save uses a map that no longer exists');
  const g = new Game({ ...data.setup, seed: data.seed });
  const s = data.state;
  const players = g.players;

  // First create every entity, so references between them can be resolved
  const ents = new Map();
  const shell = (raw, proto, defs) => {
    const e = Object.create(proto);
    ents.set(raw.id, { e, raw });
    e.def = defs[raw.key];
    return e;
  };
  const units = s.units.map((raw) => shell(raw, Unit.prototype, UNITS));
  const buildings = s.buildings.map((raw) => shell(raw, Building.prototype, BUILDINGS));
  const ghosts = new Map();

  const dec = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(dec);
    if ('$num' in v) return Number(v.$num);
    if ('$p' in v) return players[v.$p];
    if ('$e' in v) return ents.get(v.$e)?.e ?? null;
    if ('$ghost' in v) {
      const gh = v.$ghost;
      if (!ghosts.has(gh.id)) ghosts.set(gh.id, { ...gh, owner: players[gh.owner], dead: true, hp: 0 });
      return ghosts.get(gh.id);
    }
    if ('$set' in v) return new Set(v.$set.map(dec));
    if ('$map' in v) return new Map(v.$map.map(([k, x]) => [dec(k), dec(x)]));
    if ('$ta' in v) return new { Uint8Array, Uint16Array, Float32Array, Int32Array }[v.$ta](v.d);
    const o = {};
    for (const k of Object.keys(v)) o[k] = dec(v[k]);
    return o;
  };

  for (const { e, raw } of ents.values()) Object.assign(e, dec(raw));
  s.players.forEach((raw, i) => Object.assign(players[i], dec(raw)));
  g.ais.forEach((ai, i) => Object.assign(ai, dec(s.ais[i])));

  g.units = units;
  g.buildings = buildings;
  g.time = s.time;
  g.explored = dec(s.explored);
  g.map.ore.set(dec(s.ore));
  g.visTimer = s.visTimer;
  g.oreTimer = s.oreTimer;
  g.lastNotice = s.lastNotice;
  g.result = s.result;
  g.oreReserved = dec(s.oreReserved);
  g.projectiles = dec(s.projectiles);
  g.effects = dec(s.effects);
  g.visStamp++;

  // Building footprints live on the map grid
  g.map.buildingAt.fill(null);
  for (const b of buildings) {
    for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) g.map.buildingAt[g.map.idx(x, y)] = b;
  }
  setNextId(data.nextId);
  return { game: g, camera: data.camera };
}

// ---------- slots in localStorage ----------
export function listSaves() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}'); } catch { return {}; }
}

export function writeSave(slot, game, renderer) {
  const data = snapshot(game, renderer);
  const index = listSaves();
  const meta = {
    savedAt: Date.now(),
    time: game.time,
    faction: game.setup.faction,
    map: game.setup.map,
    difficulty: game.setup.difficulty,
  };
  localStorage.setItem(slotKey(slot), JSON.stringify(data));
  index[slot] = meta;
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  return meta;
}

export function readSave(slot) {
  const raw = localStorage.getItem(slotKey(slot));
  if (!raw) throw new Error('That save slot is empty');
  return restore(JSON.parse(raw));
}

export function deleteSave(slot) {
  const index = listSaves();
  delete index[slot];
  try {
    localStorage.removeItem(slotKey(slot));
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch { /* storage unavailable */ }
}
