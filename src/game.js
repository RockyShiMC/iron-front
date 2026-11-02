import { BUILDINGS, UNITS, WARHEADS, FACTIONS, DIFFICULTY, RANKS, POWERS } from './config.js';
import { GameMap, WATER, BRIDGE } from './map.js';
import { Pathfinder } from './pathfinding.js';
import { Unit, Building } from './entities.js';
import { Player, categoryOf } from './player.js';
import { AI } from './ai.js';
import { dist, distToEntity, mulberry32 } from './util.js';

const FIRE_SOUND = { tracer: 'gun', shell: 'cannon', rocket: 'rocket', bolt: 'tesla', beam: 'prism', flak: 'flak', bomb: 'bomb' };
const INSTANT = new Set(['tracer', 'bolt', 'beam', 'flak']);

// Formation slot offsets around a move target, nearest first
const FORMATION = [];
for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) FORMATION.push({ x: x * 0.85, y: y * 0.85 });
FORMATION.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));

export class Game {
  constructor({ seed = (Math.random() * 1e9) | 0, faction = 'allied', map = 'random', difficulty = 'normal' } = {}) {
    // Kept so a battle can be restarted on the same map, and so saves can rebuild the terrain
    this.seed = seed;
    this.setup = { faction, map, difficulty };
    this.map = new GameMap(map, seed);
    this.pathfinder = new Pathfinder(this.map);
    this.players = [
      new Player(0, faction, false),
      new Player(1, faction === 'allied' ? 'soviet' : 'allied', true),
      Player.neutral(2),
    ];
    this.human = this.players[0];
    this.neutral = this.players[2];
    this.difficulty = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    for (const p of this.players) {
      if (!p.isAI) continue;
      p.incomeMult = this.difficulty.income;
      p.buildMult = this.difficulty.build;
      p.credits += this.difficulty.bonusCredits;
    }
    this.units = [];
    this.buildings = [];
    this.projectiles = [];
    this.effects = [];
    this.strikes = []; // support powers on their way down: { power, owner, x, y, t }
    this.terrainStamp = 0; // bumped when a bridge falls or is rebuilt
    this.time = 0;
    this.explored = new Uint8Array(this.map.w * this.map.h);
    this.visStamp = 0; // bumped whenever more of the map is revealed
    this.visTimer = 0;
    this.oreTimer = 0;
    this.oreReserved = new Map(); // tile -> harvester
    this.messages = [];
    this.lastNotice = {};
    this.result = null; // 'win' | 'lose'
    // Sound events for the browser to play; off by default so headless runs don't queue them
    this.soundEnabled = false;
    this.soundEvents = [];

    this.players.forEach((p, i) => {
      if (p.neutral) return;
      const s = this.map.starts[i];
      this.addBuilding(p, 'conyard', s.x, s.y, true);
      const ex = s.x + 1.5, ey = s.y + 4.5;
      const { tank, infantry } = FACTIONS[p.faction].start;
      this.addUnit(p, tank, ex + 1, ey);
      this.addUnit(p, infantry, ex - 0.6, ey + 0.4);
      this.addUnit(p, infantry, ex - 0.2, ey + 0.8);
      this.addUnit(p, infantry, ex + 0.2, ey + 0.4);
    });
    this.placeNeutrals();
    this.ais = this.players.filter((p) => p.isAI).map((p) => new AI(this, p));
    this.updateVisibility();
  }

  // Oil derricks and a few civilian buildings in the contested middle of the map
  placeNeutrals() {
    const m = this.map, S = m.w;
    const rng = mulberry32(this.seed ^ 0x5eed);
    const [a, b] = this.map.starts.map((s) => ({ x: s.x + 1.5, y: s.y + 1.5 }));
    const len = dist(a.x, a.y, b.x, b.y) || 1;
    const px = -(b.y - a.y) / len, py = (b.x - a.x) / len; // perpendicular to the line between bases
    const at = (t, off) => ({ x: a.x + (b.x - a.x) * t + px * off, y: a.y + (b.y - a.y) * t + py * off });
    const spread = Math.min(S * 0.2, len * 0.35);
    const derricks = [at(0.5, spread), at(0.5, -spread)];
    if (S >= 100) derricks.push(at(0.3, spread * 0.6), at(0.7, -spread * 0.6));
    for (const p of derricks) {
      const spot = this.findOpenSpot(p.x, p.y, 2, 2, 14);
      if (spot) this.addBuilding(this.neutral, 'oilDerrick', spot.x, spot.y, true);
    }
    const town = at(0.5, (rng() - 0.5) * spread * 0.6);
    const n = 3 + Math.floor(rng() * 2);
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2 + rng();
      const spot = this.findOpenSpot(town.x + Math.cos(ang) * 3.5, town.y + Math.sin(ang) * 3.5, 2, 2, 10);
      if (spot) this.addBuilding(this.neutral, 'civBuilding', spot.x, spot.y, true);
    }
  }

  // Nearest top-left tile where a w x h footprint (plus a one-tile margin) fits on
  // clear land away from ore and the starting bases
  findOpenSpot(cx, cy, w, h, maxR) {
    const m = this.map;
    const ok = (tx, ty) => {
      for (let y = ty - 1; y <= ty + h; y++) {
        for (let x = tx - 1; x <= tx + w; x++) {
          if (!m.isBuildable(x, y) || m.ore[m.idx(x, y)] > 0) return false;
        }
      }
      return m.starts.every((s) => dist(tx + w / 2, ty + h / 2, s.x + 1.5, s.y + 1.5) > 12);
    };
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = Math.round(cx - w / 2) + dx, ty = Math.round(cy - h / 2) + dy;
          if (ok(tx, ty)) return { x: tx, y: ty };
        }
      }
    }
    return null;
  }

  // Do a and b fight each other on their own? (civilians are left alone)
  hostile(a, b) {
    return a !== b && !a.neutral && !b.neutral;
  }

  // ---------- entity management ----------
  addUnit(owner, key, x, y) {
    const u = new Unit(key, owner, x, y);
    this.units.push(u);
    return u;
  }

  addBuilding(owner, key, tx, ty, instant = false) {
    const b = new Building(key, owner, tx, ty);
    if (instant) b.buildAnim = 1;
    for (let y = ty; y < ty + b.h; y++) {
      for (let x = tx; x < tx + b.w; x++) {
        const i = this.map.idx(x, y);
        this.map.buildingAt[i] = b;
        this.map.ore[i] = 0;
      }
    }
    this.buildings.push(b);
    owner.recount(this);
    // Units caught under a new footprint get nudged out
    for (const u of this.units) {
      if (u.isAir) continue;
      if (this.map.buildingAt[this.map.idx(Math.floor(u.x), Math.floor(u.y))] === b) {
        const p = this.map.nearestPassable(Math.floor(u.x), Math.floor(u.y), Math.floor(u.x), Math.floor(u.y), u.domain);
        if (p) { u.x = p.x + 0.5; u.y = p.y + 0.5; u.path = []; }
      }
    }
    return b;
  }

  // Can this weapon hit this target? Aircraft need anti-air; flak can't hit the ground.
  canHit(w, t) {
    if (!w) return false;
    return t.isUnit && t.isAir ? !!w.air : w.ground !== false;
  }

  removeBuilding(b) {
    for (let y = b.ty; y < b.ty + b.h; y++) {
      for (let x = b.tx; x < b.tx + b.w; x++) this.map.buildingAt[this.map.idx(x, y)] = null;
    }
    b.owner.recount(this);
  }

  entityCenter(e) {
    return { x: e.x, y: e.y };
  }

  nearestBuilding(owner, key, x, y) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== owner || b.key !== key) continue;
      const d = dist(x, y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  exitPoint(b, domain = 'land') {
    const ex = b.tx + Math.floor(b.w / 2), ey = b.ty + b.h;
    const p = this.map.nearestPassable(ex, ey, ex, ey, domain) || { x: b.tx, y: b.ty + b.h };
    return { x: p.x + 0.5, y: p.y + 0.5 };
  }

  dockPoint(ref) {
    return this.exitPoint(ref);
  }

  spawnUnit(owner, key) {
    const prod = owner.producerFor(categoryOf(key), this);
    if (!prod) return null;
    const domain = categoryOf(key) === 'naval' ? 'sea' : 'land';
    const p = categoryOf(key) === 'air' ? { x: prod.x, y: prod.y } : this.exitPoint(prod, domain);
    const u = this.addUnit(owner, key, p.x, p.y);
    u.dir = Math.PI / 2;
    if (u.def.harvester) {
      u.orderHarvest(this);
    } else if (u.ammo !== Infinity) {
      u.orderRearm(this); // jets park on the airfield until ordered out
    } else {
      const r = prod.rally || owner.rally || { x: p.x + 0.5 + Math.random(), y: p.y + 1.5 + Math.random() };
      u.orderMove(this, r.x, r.y);
    }
    return u;
  }

  // ---------- building placement ----------
  canPlace(owner, key, tx, ty) {
    const def = BUILDINGS[key];
    const m = this.map;
    for (let y = ty; y < ty + def.h; y++) {
      for (let x = tx; x < tx + def.w; x++) {
        // shipyards go on open water, everything else on clear land
        const ok = def.naval ? m.inBounds(x, y) && m.terrain[m.idx(x, y)] === WATER && !m.buildingAt[m.idx(x, y)] : m.isBuildable(x, y);
        if (!ok) return false;
      }
    }
    for (const u of this.units) {
      const ux = Math.floor(u.x), uy = Math.floor(u.y);
      if (ux >= tx && ux < tx + def.w && uy >= ty && uy < ty + def.h && u.owner !== owner) return false;
    }
    // Must be within 3 tiles of one of our own buildings
    for (const b of this.buildings) {
      if (b.owner !== owner || b.dead || (b.def.wall && !def.wall) || b.def.garrison) continue;
      const dx = Math.max(b.tx - (tx + def.w), tx - (b.tx + b.w), 0);
      const dy = Math.max(b.ty - (ty + def.h), ty - (b.ty + b.h), 0);
      if (Math.max(dx, dy) <= 3) return true;
    }
    return false;
  }

  placeBuilding(owner, key, tx, ty) {
    const q = owner.queues.building;
    if (!q.length || q[0].key !== key || !q[0].ready) return null;
    if (!this.canPlace(owner, key, tx, ty)) return null;
    q.shift();
    const b = this.addBuilding(owner, key, tx, ty);
    this.sound('place', b.x, b.y);
    const def = BUILDINGS[key];
    if (def.freeHarvester) {
      const p = this.exitPoint(b);
      const u = this.addUnit(owner, FACTIONS[owner.faction].harvester, p.x, p.y);
      u.orderHarvest(this);
    }
    return b;
  }

  sell(b) {
    if (b.dead) return;
    b.owner.credits += Math.floor(b.def.cost * 0.5 * (b.hp / b.maxHp));
    b.dead = true;
    this.removeBuilding(b);
    this.sound('sell', b.x, b.y);
    this.spawnExplosion(b.x, b.y, 0.4, false);
  }

  // ---------- orders ----------
  // queue: add to each unit's waypoints (Shift) instead of replacing its orders
  groupOrder(units, x, y, type = 'move', queue = false) {
    const sorted = [...units].sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y));
    const slot = { land: 0, sea: 0, air: 0 }; // each domain fills its own formation
    for (const u of sorted) {
      let sx = x, sy = y;
      while (slot[u.domain] < FORMATION.length) {
        const f = FORMATION[slot[u.domain]++];
        const px = x + f.x * (u.isNaval ? 1.6 : 1), py = y + f.y * (u.isNaval ? 1.6 : 1);
        if (this.map.passable(u.domain, Math.floor(px), Math.floor(py))) { sx = px; sy = py; break; }
      }
      if (queue && (u.order.type !== 'idle' || u.waypoints?.length)) { (u.waypoints ||= []).push({ type, x: sx, y: sy }); continue; }
      u.waypoints = [];
      if (type === 'attackmove') u.orderAttackMove(this, sx, sy);
      else u.orderMove(this, sx, sy);
    }
  }

  // ---------- harvesting ----------
  findOre(h, prefer = -1) {
    const m = this.map;
    if (prefer >= 0 && m.ore[prefer] > 0) return prefer;
    const W = m.w;
    const start = m.idx(Math.floor(h.x), Math.floor(h.y));
    const seen = new Uint8Array(W * m.h);
    const q = [start];
    seen[start] = 1;
    let fallback = -1;
    for (let qi = 0; qi < q.length && qi < 6000; qi++) {
      const i = q[qi];
      if (m.ore[i] > 0) {
        const r = this.oreReserved.get(i);
        if (!r || r === h || r.dead) return i;
        if (fallback < 0) fallback = i;
      }
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!m.isPassable(nx, ny)) continue;
        const j = ny * W + nx;
        if (!seen[j]) { seen[j] = 1; q.push(j); }
      }
    }
    return fallback;
  }

  reserveOre(h, tile) {
    this.releaseOre(h);
    h.oreTile = tile;
    this.oreReserved.set(tile, h);
  }

  releaseOre(h) {
    if (h.oreTile >= 0 && this.oreReserved.get(h.oreTile) === h) this.oreReserved.delete(h.oreTile);
  }

  // ---------- combat ----------
  // Nearest enemy within range of (x, y), which defaults to the shooter's own position
  findTarget(e, range, x = e.x, y = e.y) {
    let best = null, bd = Infinity;
    const w = e.weapon;
    for (const u of this.units) {
      if (u.dead || !this.hostile(u.owner, e.owner) || !this.canHit(w, u)) continue;
      const d = dist(x, y, u.x, u.y);
      if (d <= range && d < bd) { bd = d; best = u; }
    }
    if (best || w.ground === false) return best;
    let wall = null, wd = Infinity;
    for (const b of this.buildings) {
      if (b.dead || !this.hostile(b.owner, e.owner)) continue;
      const d = distToEntity(x, y, b);
      if (d > range) continue;
      // walls are only shot at when nothing better is around
      if (b.def.wall) { if (d < wd) { wd = d; wall = b; } continue; }
      if (d < bd) { bd = d; best = b; }
    }
    return best || wall;
  }

  fire(shooter, target) {
    const w = shooter.weapon;
    shooter.cooldown = w.cooldown * RANKS[shooter.rank || 0].reload;
    const c = this.entityCenter(target);
    const aim = shooter.turretDir ?? shooter.dir;
    const reach = shooter.isInfantry ? 0.2 : shooter.isBuilding ? 0.45 : 0.5;
    const sx = shooter.x + Math.cos(aim) * reach;
    const sy = shooter.y + Math.sin(aim) * reach;
    const sz = shooter.isBuilding ? shooter.def.height + 6
      : shooter.isAir ? shooter.z - 2
      : shooter.isInfantry ? 9 : shooter.def.look === 'prism' ? 18 : 12;
    const tz = this.targetHeight(target);
    const kind = w.projectile;
    if (shooter.ammo !== undefined && shooter.ammo !== Infinity) shooter.ammo--;
    this.sound(FIRE_SOUND[kind], sx, sy);
    const flashColor = kind === 'bolt' ? '140,200,255' : kind === 'beam' ? '200,240,255' : '255,230,140';
    if (kind !== 'bomb') this.effects.push({ type: 'flash', x: sx, y: sy, z: sz, life: 0.1, max: 0.1, size: kind === 'tracer' ? 4 : 9, color: flashColor });

    if (INSTANT.has(kind)) {
      if (kind === 'flak') {
        // shells burst around the aircraft
        const jx = (Math.random() - 0.5) * 0.5, jy = (Math.random() - 0.5) * 0.5;
        this.effects.push({ type: 'flak', x: c.x + jx, y: c.y + jy, z: tz + (Math.random() - 0.3) * 10, life: 0.5, max: 0.5 });
        this.hit(target, w, shooter, c.x, c.y);
        return;
      }
      const jx = kind === 'tracer' ? (Math.random() - 0.5) * 0.2 : 0, jy = kind === 'tracer' ? (Math.random() - 0.5) * 0.2 : 0;
      const life = kind === 'tracer' ? 0.07 : kind === 'bolt' ? 0.25 : 0.35;
      this.effects.push({ type: kind, x: sx, y: sy, z: sz, x2: c.x + jx, y2: c.y + jy, z2: tz, life, max: life });
      if (kind !== 'tracer') this.effects.push({ type: 'flash', x: c.x, y: c.y, z: tz, life: 0.25, max: 0.25, size: 14, color: flashColor });
      this.hit(target, w, shooter, c.x, c.y);
      if (kind === 'tracer' && !target.dead) this.effects.push({ type: 'spark', x: c.x + jx, y: c.y + jy, z: tz, life: 0.15, max: 0.15 });
      return;
    }
    const salvo = w.salvo || 1;
    for (let n = 0; n < salvo; n++) {
      // Spread twin barrels sideways
      const off = salvo > 1 ? (n - (salvo - 1) / 2) * 0.22 : 0;
      const ox = -Math.sin(aim) * off, oy = Math.cos(aim) * off;
      const d = dist(sx, sy, c.x, c.y);
      this.projectiles.push({
        kind, x: sx + ox, y: sy + oy, z: sz, sx: sx + ox, sy: sy + oy, sz, tx: c.x, ty: c.y, tz,
        t: -n * 0.08, dur: Math.max(0.05, d / w.speed),
        // shells lob, rockets curve a little; anything fired from the air flies straight
        arc: shooter.isAir || target.isAir ? 0 : kind === 'shell' ? d * 3 : d * 1.5,
        target, weapon: w, attacker: shooter,
      });
    }
  }

  // Where shots aim on a target, in screen pixels above the ground
  targetHeight(t) {
    if (t.isBuilding) return t.def.height * 0.6;
    if (t.isAir) return t.z + 4;
    return t.isInfantry ? 6 : 8;
  }

  // Apply a weapon hit at (x, y), including splash damage to nearby enemies.
  hit(target, w, attacker, x, y) {
    if (!target.dead && !target.isGround) this.damage(target, w.damage, w.warhead, attacker);
    if (target.isGround) {
      const br = this.map.bridgeOn(x, y);
      if (br && !br.dead) this.damageBridge(br, w.damage * (WARHEADS[w.warhead].building ?? 1) * RANKS[attacker?.rank || 0].damage);
    }
    if (!w.splash) return;
    const owner = attacker.owner;
    for (const list of [this.units, this.buildings]) {
      for (const e of list) {
        if (e === target || e.dead || e.owner === owner) continue;
        if (distToEntity(x, y, e) <= w.splash) this.damage(e, w.damage * 0.5, w.warhead, attacker);
      }
    }
  }

  damage(target, amount, warhead, attacker) {
    if (target.dead) return;
    const mult = (WARHEADS[warhead][target.armor] ?? 1) * RANKS[attacker?.rank || 0].damage * RANKS[target.rank || 0].armor;
    target.hp -= amount * mult;
    target.lastAttacker = attacker;
    target.lastAttacked = this.time;
    if (target.owner === this.human && target.isBuilding) this.notify('Our base is under attack!', 'alert', 20);
    if (target.owner === this.human && target.def.harvester) this.notify('Ore miner under attack', 'alert', 20);
    if (target.isUnit && attacker && attacker.owner !== target.owner) target.retaliate(this, attacker);
    if (target.hp <= 0) this.kill(target, attacker);
  }

  kill(e, killer = null) {
    e.dead = true;
    e.hp = 0;
    if (killer && killer.isUnit && !killer.dead && killer.owner !== e.owner) this.gainXp(killer, e.def.cost);
    if (e.isBuilding) {
      if (e.garrison?.length) this.evacuate(e, 0.5);
      this.removeBuilding(e);
      this.spawnExplosion(e.x, e.y, 1 + e.w * 0.4, true);
      if (e.owner === this.human) this.notify('Structure lost', 'alert', 6);
    } else {
      if (e.def.harvester) this.releaseOre(e);
      // aircraft crash to the ground; ships and vehicles burst in place
      this.spawnExplosion(e.x, e.y, e.isInfantry ? 0.25 : e.isNaval ? 0.9 : 0.7, !e.isInfantry);
      if (e.owner === this.human) this.notify('Unit lost', 'warn', 8);
    }
  }

  // Experience for destroying something worth `value` credits; may promote the unit
  gainXp(u, value) {
    u.xp = (u.xp || 0) + value;
    const before = u.rank || 0;
    while ((u.rank || 0) < RANKS.length - 1 && u.xp >= RANKS[(u.rank || 0) + 1].xp * u.def.cost) u.rank = (u.rank || 0) + 1;
    if (u.rank === before) return;
    this.effects.push({ type: 'promote', x: u.x, y: u.y, z: u.isAir ? u.z + 20 : 20, vx: 0, vy: 0, vz: 22, life: 1.4, max: 1.4, rank: u.rank });
    if (u.owner === this.human) {
      this.notify('Unit promoted', 'info', 2);
      this.voice(u, 'promoted');
    }
  }

  spawnExplosion(x, y, size, debris) {
    this.sound(size >= 1 ? 'bigboom' : size >= 0.5 ? 'boom' : 'die', x, y);
    this.effects.push({ type: 'boom', x, y, z: 6, life: 0.5 + size * 0.2, max: 0.5 + size * 0.2, size });
    const n = Math.round(6 + size * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (0.5 + Math.random()) * size * 1.6;
      this.effects.push({
        type: debris ? 'debris' : 'smoke', x, y, z: 6, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        vz: 20 + Math.random() * 50 * size, life: 0.6 + Math.random() * 0.8, max: 1.4,
      });
    }
  }

  // x/y in world tiles for positional sounds; omit for interface sounds
  sound(name, x, y) {
    if (this.soundEnabled) this.soundEvents.push({ name, x, y });
  }

  // A unit of ours answers: line is 'select' | 'move' | 'attack'
  voice(unit, line) {
    if (this.soundEnabled && unit && unit.owner === this.human) this.soundEvents.push({ name: 'voice', unit: unit.key, id: unit.id, line });
  }

  notify(text, kind = 'info', throttle = 3) {
    const last = this.lastNotice[text] ?? -999;
    if (this.time - last < throttle) return;
    this.lastNotice[text] = this.time;
    this.messages.push({ text, kind, time: performance.now() });
  }

  // ---------- capture, garrison, repair ----------
  // Engineers take over enemy or neutral structures
  capture(b, owner) {
    const old = b.owner;
    if (old === owner) return;
    b.owner = owner;
    b.repairing = false;
    b.rally = null;
    b.primary = false;
    old.recount(this);
    owner.recount(this);
    this.effects.push({ type: 'flash', x: b.x, y: b.y, z: b.def.height, life: 0.5, max: 0.5, size: 30, color: '255,255,255' });
    this.sound('place', b.x, b.y);
    if (owner === this.human) this.notify('Building captured', 'info', 0);
    else if (old === this.human) this.notify('Our building has been captured', 'alert', 0);
  }

  // Infantry moves into a civilian building; the building fights for its occupants' side
  enterGarrison(u, b) {
    if (b.dead || u.dead || !this.canGarrison(u, b)) return false;
    b.garrison ||= [];
    b.garrison.push(u);
    u.inside = b;
    u.path = [];
    u.order = { type: 'idle' };
    if (b.owner !== u.owner) {
      const old = b.owner;
      b.owner = u.owner;
      old.recount(this);
      u.owner.recount(this);
    }
    this.sound('select', b.x, b.y);
    return true;
  }

  canGarrison(u, b) {
    return !!(b.def.garrison && u.isInfantry && u.weapon && !u.def.hero && !u.def.engineer &&
      (b.owner.neutral || b.owner === u.owner) && (b.garrison?.length || 0) < b.def.garrison);
  }

  // Everyone out. hpFrac < 1 when the building collapses around them.
  evacuate(b, hpFrac = 1) {
    const occupants = b.garrison || [];
    b.garrison = [];
    for (const u of occupants) {
      const p = this.map.nearestPassable(b.tx + Math.floor(b.w / 2), b.ty + b.h, b.x, b.y + b.h) || { x: b.tx, y: b.ty + b.h };
      u.x = p.x + 0.3 + Math.random() * 0.4;
      u.y = p.y + 0.3 + Math.random() * 0.4;
      u.inside = null;
      u.hp = Math.max(1, u.hp * hpFrac);
      u.order = { type: 'idle' };
      this.units.push(u);
    }
    if (!b.dead && !b.owner.neutral) {
      const old = b.owner;
      b.owner = this.neutral;
      old.recount(this);
    }
  }

  // Building with a garrison: every occupant shoots from the roof
  updateGarrison(b, dt) {
    const shooters = b.garrison.filter((u) => u.weapon);
    for (const u of b.garrison) { u.x = b.x; u.y = b.y; if (u.cooldown > 0) u.cooldown -= dt; }
    if (!shooters.length) return;
    const reach = Math.max(...shooters.map((u) => u.weapon.range)) + 1 + b.w / 2;
    if (b.target && (b.target.dead || distToEntity(b.x, b.y, b.target) > reach)) b.target = null;
    b.scanTimer -= dt;
    if (!b.target && b.scanTimer <= 0) {
      b.scanTimer = 0.4;
      b.target = this.findTarget(shooters[0], reach);
    }
    const t = b.target;
    if (!t) return;
    const d = distToEntity(b.x, b.y, t);
    for (const u of shooters) {
      if (u.cooldown > 0 || !this.canHit(u.weapon, t) || d > u.weapon.range + 1 + b.w / 2) continue;
      u.dir = Math.atan2(t.y - b.y, t.x - b.x);
      this.fire(u, t);
    }
  }

  // The building that can fix this unit, nearest first (vehicles: depot, ships: shipyard)
  repairBayFor(u) {
    const kind = u.isNaval ? 'naval' : u.isAir || u.isInfantry ? null : 'vehicle';
    if (!kind) return null;
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (b.owner !== u.owner || b.dead || b.def.repairs !== kind) continue;
      const d = dist(u.x, u.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // ---------- bridges ----------
  damageBridge(br, amount) {
    if (br.dead) return;
    br.hp -= amount;
    if (br.hp <= 0) this.destroyBridge(br);
  }

  destroyBridge(br) {
    const m = this.map, S = m.w;
    br.dead = true;
    br.hp = 0;
    for (const i of br.tiles) m.terrain[i] = WATER;
    this.terrainStamp++;
    for (const i of br.tiles) {
      const x = (i % S) + 0.5, y = ((i / S) | 0) + 0.5;
      if (Math.random() < 0.5) this.spawnExplosion(x, y, 0.7, true);
    }
    // anything standing on it falls into the water
    for (const u of this.units) {
      if (u.dead || u.domain !== 'land') continue;
      if (m.bridgeAt[m.idx(Math.floor(u.x), Math.floor(u.y))] === m.bridges.indexOf(br)) this.kill(u);
    }
    if (this.isExplored(br.x, br.y)) this.notify('Bridge destroyed', 'warn', 2);
  }

  repairBridge(br) {
    for (const i of br.tiles) this.map.terrain[i] = BRIDGE;
    br.dead = false;
    br.hp = br.maxHp;
    this.terrainStamp++;
    this.sound('place', br.x, br.y);
    if (this.isExplored(br.x, br.y)) this.notify('Bridge repaired', 'info', 2);
  }

  // A tile next to one end of a bridge, where an engineer can reach it
  bridgeEnd(br, from) {
    const m = this.map, S = m.w;
    let best = null, bd = Infinity;
    for (const i of br.tiles) {
      const x = i % S, y = (i / S) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!m.inBounds(nx, ny) || m.terrain[ny * S + nx] !== 0 || m.buildingAt[ny * S + nx]) continue;
        const d = dist(nx + 0.5, ny + 0.5, from.x, from.y);
        if (d < bd) { bd = d; best = { x: nx + 0.5, y: ny + 0.5 }; }
      }
    }
    return best;
  }

  // ---------- support powers ----------
  usePower(player, id, x, y) {
    const pw = POWERS[id], st = player.powers?.[id];
    if (!pw || !st || st.charge < pw.charge) return false;
    st.charge = 0;
    st.announced = false;
    const S = this.map.w;
    x = Math.max(0.5, Math.min(S - 0.5, x));
    y = Math.max(0.5, Math.min(S - 0.5, y));
    if (pw.kind === 'reveal') {
      if (player === this.human) {
        for (let ty = Math.floor(y - pw.radius); ty <= y + pw.radius; ty++) {
          for (let tx = Math.floor(x - pw.radius); tx <= x + pw.radius; tx++) {
            if (this.map.inBounds(tx, ty) && dist(tx + 0.5, ty + 0.5, x, y) <= pw.radius) this.explored[this.map.idx(tx, ty)] = 1;
          }
        }
        this.visStamp++;
      }
      this.effects.push({ type: 'sweep', x, y, z: 0, r: pw.radius, life: 1.5, max: 1.5 });
      this.sound('chrono', x, y);
      return true;
    }
    this.strikes.push({ power: id, owner: player, x, y, t: pw.delay || 0 });
    if (pw.superweapon) {
      this.notify(player === this.human ? `${pw.name} launched` : 'Warning: enemy superweapon launched', 'alert', 0);
      this.sound('chrono');
    }
    return true;
  }

  updateStrikes(dt) {
    for (const s of this.strikes) {
      s.t -= dt;
      if (s.t > 0) continue;
      s.done = true;
      const pw = POWERS[s.power];
      if (pw.kind === 'paradrop') {
        for (let k = 0; k < pw.count; k++) {
          const a = (k / pw.count) * Math.PI * 2;
          const p = this.map.nearestPassable(Math.floor(s.x + Math.cos(a) * 1.2), Math.floor(s.y + Math.sin(a) * 1.2), s.x, s.y);
          if (!p) continue;
          this.addUnit(s.owner, pw.unit, p.x + 0.5, p.y + 0.5);
          this.effects.push({ type: 'chute', x: p.x + 0.5, y: p.y + 0.5, z: 60, vx: 0, vy: 0, vz: -40, life: 1.5, max: 1.5 });
        }
        this.sound('place', s.x, s.y);
        continue;
      }
      this.blast(s.x, s.y, pw.radius, pw.damage, s.owner);
    }
    this.strikes = this.strikes.filter((s) => !s.done);
  }

  // Superweapon impact: damage falls off from the center, bridges included
  blast(x, y, radius, damage, owner) {
    this.spawnExplosion(x, y, 3, true);
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius * 0.8;
      this.spawnExplosion(x + Math.cos(a) * r, y + Math.sin(a) * r, 1.2, true);
    }
    const attacker = { owner, rank: 0, dead: true }; // superweapons earn no experience
    for (const list of [this.units, this.buildings]) {
      for (const e of [...list]) {
        if (e.dead) continue;
        const d = distToEntity(x, y, e);
        if (d <= radius) this.damage(e, damage * (1 - (d / radius) * 0.6), 'super', attacker);
      }
    }
    for (const br of this.map.bridges) if (!br.dead && dist(br.x, br.y, x, y) <= radius + 1) this.damageBridge(br, damage);
  }

  // Commando plants a charge; the building blows a few seconds later
  plantCharge(b, unit) {
    if (b.dead || b.charge) return;
    b.charge = { t: 4, by: unit };
    this.sound('click', b.x, b.y);
  }

  // ---------- simulation ----------
  update(dt) {
    if (this.result) return;
    this.time += dt;

    for (const p of this.players) { p.updateProduction(dt, this); p.updatePowers(dt, this); }
    this.updateStrikes(dt);
    // A small trickle keeps the AI from stalling for good if its economy is wiped out
    for (const ai of this.ais) ai.p.credits += this.difficulty.trickle * dt;
    for (const ai of this.ais) ai.update(dt);
    for (const b of this.buildings) if (!b.dead) b.update(dt, this);
    for (const u of this.units) if (!u.dead) u.update(dt, this);
    this.separateUnits();
    this.updateProjectiles(dt);
    this.updateEffects(dt);

    this.units = this.units.filter((u) => !u.dead && !u.inside);
    this.buildings = this.buildings.filter((b) => !b.dead);

    this.oreTimer += dt;
    if (this.oreTimer > 2) { this.oreTimer = 0; this.map.regrowOre(3); }

    this.visTimer -= dt;
    if (this.visTimer <= 0) { this.visTimer = 0.25; this.updateVisibility(); this.checkVictory(); }
  }

  separateUnits() {
    const us = this.units;
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j];
        if (a.domain !== b.domain) continue; // aircraft pass over ground units, ships over nothing
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.radius + b.radius;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        const push = (min - d) * 0.25;
        const nx = d > 1e-4 ? dx / d : Math.random() - 0.5, ny = d > 1e-4 ? dy / d : Math.random() - 0.5;
        // Moving units shove idle ones out of the way more than the reverse
        const wa = a.moving && !b.moving ? 0.2 : 1, wb = b.moving && !a.moving ? 0.2 : 1;
        this.nudge(a, -nx * push * wa, -ny * push * wa);
        this.nudge(b, nx * push * wb, ny * push * wb);
      }
    }
  }

  nudge(u, dx, dy) {
    const nx = u.x + dx, ny = u.y + dy;
    if (this.map.passable(u.domain, Math.floor(nx), Math.floor(ny))) { u.x = nx; u.y = ny; }
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (!p.target.dead) {
        const c = this.entityCenter(p.target);
        p.tx = c.x; p.ty = c.y;
        if (p.target.isAir) p.tz = this.targetHeight(p.target);
      }
      p.t += dt;
      const f = Math.max(0, Math.min(1, p.t / p.dur));
      p.x = p.sx + (p.tx - p.sx) * f;
      p.y = p.sy + (p.ty - p.sy) * f;
      p.z = p.sz + (p.tz - p.sz) * f + Math.sin(f * Math.PI) * p.arc;
      if (p.kind === 'rocket' && Math.random() < 0.8) {
        this.effects.push({ type: 'smoke', x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 8, life: 0.5, max: 0.5, small: true });
      }
      if (f >= 1) {
        p.done = true;
        this.hit(p.target, p.weapon, p.attacker, p.x, p.y);
        this.sound('impact', p.x, p.y);
        this.effects.push({ type: 'boom', x: p.x, y: p.y, z: p.tz, life: 0.35, max: 0.35, size: 0.35 });
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.done);
  }

  updateEffects(dt) {
    for (const e of this.effects) {
      e.life -= dt;
      if (e.vx !== undefined) {
        e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
        if (e.type === 'debris') { e.vz -= 160 * dt; if (e.z < 0) { e.z = 0; e.vx *= 0.5; e.vy *= 0.5; e.vz = 0; } }
      }
    }
    this.effects = this.effects.filter((e) => e.life > 0);
  }

  updateVisibility() {
    const m = this.map;
    let changed = false;
    const reveal = (x, y, r) => {
      for (let ty = Math.floor(y - r); ty <= y + r; ty++) {
        for (let tx = Math.floor(x - r); tx <= x + r; tx++) {
          if (!m.inBounds(tx, ty) || dist(tx + 0.5, ty + 0.5, x, y) > r) continue;
          const i = m.idx(tx, ty);
          if (!this.explored[i]) { this.explored[i] = 1; changed = true; }
        }
      }
    };
    for (const u of this.units) if (u.owner === this.human) reveal(u.x, u.y, u.def.sight);
    for (const b of this.buildings) if (b.owner === this.human) reveal(b.x, b.y, b.def.sight + b.w / 2);
    if (changed) this.visStamp++;
  }

  isExplored(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    return this.map.inBounds(tx, ty) && this.explored[this.map.idx(tx, ty)] === 1;
  }

  checkVictory() {
    for (const p of this.players) {
      if (p.defeated || p.neutral) continue;
      const alive = this.buildings.some((b) => b.owner === p && !b.def.wall) || this.units.some((u) => u.owner === p && !u.def.harvester);
      if (!alive) p.defeated = true;
    }
    if (this.human.defeated) this.result = 'lose';
    else if (this.players.every((p) => p === this.human || p.defeated || p.neutral)) this.result = 'win';
    if (this.result) this.notify(this.result === 'win' ? 'Mission accomplished' : 'Mission failed', 'alert', 0);
  }
}
