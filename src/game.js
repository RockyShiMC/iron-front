import { BUILDINGS, WARHEADS, FACTIONS, DIFFICULTY } from './config.js';
import { GameMap, WATER } from './map.js';
import { Pathfinder } from './pathfinding.js';
import { Unit, Building } from './entities.js';
import { Player, categoryOf } from './player.js';
import { AI } from './ai.js';
import { dist, distToEntity } from './util.js';

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
    ];
    this.human = this.players[0];
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
      const s = this.map.starts[i];
      this.addBuilding(p, 'conyard', s.x, s.y, true);
      const ex = s.x + 1.5, ey = s.y + 4.5;
      const { tank, infantry } = FACTIONS[p.faction].start;
      this.addUnit(p, tank, ex + 1, ey);
      this.addUnit(p, infantry, ex - 0.6, ey + 0.4);
      this.addUnit(p, infantry, ex - 0.2, ey + 0.8);
      this.addUnit(p, infantry, ex + 0.2, ey + 0.4);
    });
    this.ais = this.players.filter((p) => p.isAI).map((p) => new AI(this, p));
    this.updateVisibility();
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
      if (b.owner !== owner || b.dead) continue;
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
  groupOrder(units, x, y, type = 'move') {
    const sorted = [...units].sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y));
    const slot = { land: 0, sea: 0, air: 0 }; // each domain fills its own formation
    for (const u of sorted) {
      let sx = x, sy = y;
      while (slot[u.domain] < FORMATION.length) {
        const f = FORMATION[slot[u.domain]++];
        const px = x + f.x * (u.isNaval ? 1.6 : 1), py = y + f.y * (u.isNaval ? 1.6 : 1);
        if (this.map.passable(u.domain, Math.floor(px), Math.floor(py))) { sx = px; sy = py; break; }
      }
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
  findTarget(e, range) {
    let best = null, bd = Infinity;
    const w = e.weapon;
    for (const u of this.units) {
      if (u.dead || u.owner === e.owner || !this.canHit(w, u)) continue;
      const d = dist(e.x, e.y, u.x, u.y);
      if (d <= range && d < bd) { bd = d; best = u; }
    }
    if (best || w.ground === false) return best;
    for (const b of this.buildings) {
      if (b.dead || b.owner === e.owner) continue;
      const d = distToEntity(e.x, e.y, b);
      if (d <= range && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  fire(shooter, target) {
    const w = shooter.weapon;
    shooter.cooldown = w.cooldown;
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
    if (!target.dead) this.damage(target, w.damage, w.warhead, attacker);
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
    const mult = WARHEADS[warhead][target.armor] ?? 1;
    target.hp -= amount * mult;
    target.lastAttacker = attacker;
    target.lastAttacked = this.time;
    if (target.owner === this.human && target.isBuilding) this.notify('Our base is under attack!', 'alert', 20);
    if (target.owner === this.human && target.def.harvester) this.notify('Ore miner under attack', 'alert', 20);
    if (target.isUnit && attacker && attacker.owner !== target.owner) target.retaliate(this, attacker);
    if (target.hp <= 0) this.kill(target);
  }

  kill(e) {
    e.dead = true;
    e.hp = 0;
    if (e.isBuilding) {
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

  // ---------- simulation ----------
  update(dt) {
    if (this.result) return;
    this.time += dt;

    for (const p of this.players) p.updateProduction(dt, this);
    // A small trickle keeps the AI from stalling for good if its economy is wiped out
    for (const ai of this.ais) ai.p.credits += this.difficulty.trickle * dt;
    for (const ai of this.ais) ai.update(dt);
    for (const b of this.buildings) if (!b.dead) b.update(dt, this);
    for (const u of this.units) if (!u.dead) u.update(dt, this);
    this.separateUnits();
    this.updateProjectiles(dt);
    this.updateEffects(dt);

    this.units = this.units.filter((u) => !u.dead);
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
      if (p.defeated) continue;
      const alive = this.buildings.some((b) => b.owner === p) || this.units.some((u) => u.owner === p && !u.def.harvester);
      if (!alive) p.defeated = true;
    }
    if (this.human.defeated) this.result = 'lose';
    else if (this.players.every((p) => p === this.human || p.defeated)) this.result = 'win';
    if (this.result) this.notify(this.result === 'win' ? 'Mission accomplished' : 'Mission failed', 'alert', 0);
  }
}
