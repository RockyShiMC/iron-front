import { UNITS, BUILDINGS, WEAPONS } from './config.js';
import { dist, distToEntity, turnToward, angleDiff } from './util.js';

let nextId = 1;

// Saved games carry the id counter so new entities never reuse a loaded id
export function peekNextId() { return nextId; }
export function setNextId(n) { nextId = n; }

class Entity {
  constructor(key, def, owner) {
    this.id = nextId++;
    this.key = key;
    this.def = def;
    this.owner = owner;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.dead = false;
    this.cooldown = 0;
    this.scanTimer = Math.random() * 0.4;
    this.target = null;
    this.lastAttacker = null;
    this.lastAttacked = -99;
  }

  get weapon() { return this.def.weapon ? WEAPONS[this.def.weapon] : null; }
  get armor() { return this.def.armor || 'building'; }

  // Aim and fire at a target that is already in range. Returns true if aimed.
  aimAndFire(dt, g, t) {
    const c = g.entityCenter(t);
    const ang = Math.atan2(c.y - this.y, c.x - this.x);
    if (this.isBuilding || this.def.turret) {
      this.turretDir = turnToward(this.turretDir, ang, 5 * dt);
      if (angleDiff(this.turretDir, ang) > 0.12) return false;
    } else {
      this.dir = ang;
    }
    if (this.cooldown <= 0) g.fire(this, t);
    return true;
  }
}

export class Unit extends Entity {
  constructor(key, owner, x, y) {
    super(key, UNITS[key], owner);
    this.isUnit = true;
    this.isInfantry = this.def.category === 'infantry';
    this.x = x;
    this.y = y;
    this.dir = Math.PI / 4;
    this.turretDir = this.dir;
    this.path = [];
    this.order = { type: 'idle' };
    this.repathTimer = 0;
    this.moving = false;
    this.anim = Math.random() * 10;
    this.stuckTimer = 0;
    this.lastX = x;
    this.lastY = y;
    // 'land' | 'sea' | 'air'. Aircraft start parked on their airfield.
    this.domain = this.def.domain || 'land';
    this.isAir = this.domain === 'air';
    this.isNaval = this.domain === 'sea';
    this.z = 0;
    this.landed = this.isAir;
    this.ammo = this.def.ammo ?? Infinity;
    this.reloadTimer = 0;
    if (this.def.harvester) {
      this.cargo = 0;
      this.hstate = 'seek';
      this.mineTimer = 0;
      this.oreTile = -1;
      this.preferTile = -1;
      this.dockRef = null;
      this.waitTimer = 0;
    }
  }

  get radius() { return this.def.radius; }

  // ---------- orders ----------
  orderMove(g, x, y) {
    this.order = { type: 'move', x, y };
    this.target = null;
    this.setPath(g, x, y);
  }

  orderAttackMove(g, x, y) {
    if (!this.weapon) return this.orderMove(g, x, y);
    this.order = { type: 'attackmove', x, y };
    this.target = null;
    this.setPath(g, x, y);
  }

  orderAttack(g, target, extra = {}) {
    if (!this.weapon || !g.canHit(this.weapon, target)) return;
    if (this.ammo <= 0) return this.orderRearm(g);
    this.order = { type: 'attack', target, ...extra };
    this.target = target;
    this.path = [];
    this.repathTimer = 0;
  }

  orderStop() {
    this.order = { type: 'idle' };
    this.path = [];
    this.target = null;
  }

  orderHarvest(g, tile = -1) {
    if (!this.def.harvester) return;
    g.releaseOre(this);
    this.order = { type: 'harvest' };
    this.hstate = this.cargo >= this.def.capacity ? 'return' : 'seek';
    this.preferTile = tile;
    this.path = [];
  }

  orderDock(g, refinery) {
    if (!this.def.harvester) return;
    g.releaseOre(this);
    this.order = { type: 'harvest' };
    this.hstate = 'return';
    this.dockRef = refinery;
    this.path = [];
  }

  // Jets fly back to an airfield, land and reload their ammo
  orderRearm(g) {
    const field = g.nearestBuilding(this.owner, 'airfield', this.x, this.y);
    if (!field) { this.orderStop(); return; }
    // spread parked aircraft over the airfield
    const slot = this.id % 4;
    const px = field.tx + 0.8 + (slot % 2) * 1.4, py = field.ty + 0.8 + Math.floor(slot / 2) * 1.4;
    this.order = { type: 'rearm', field, x: px, y: py };
    this.target = null;
    this.setPath(g, px, py);
  }

  setPath(g, x, y) {
    if (this.isAir) {
      // aircraft fly in a straight line, anywhere on the map
      const S = g.map.w;
      this.path = [{ x: Math.min(S - 0.5, Math.max(0.5, x)), y: Math.min(S - 0.5, Math.max(0.5, y)) }];
      this.landed = false;
    } else {
      this.path = g.pathfinder.find(this.x, this.y, x, y, 20000, this.domain) || [];
    }
    this.stuckTimer = 0;
    this.lastX = this.x;
    this.lastY = this.y;
  }

  // ---------- update ----------
  update(dt, g) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.def.selfHeal && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.def.selfHeal * dt);
    this.moving = false;
    if (this.isAir) this.updateFlight(dt, g);
    const o = this.order;
    switch (o.type) {
      case 'idle':
        this.scan(dt, g);
        break;
      case 'rearm':
        this.updateRearm(dt, g, o);
        break;
      case 'move':
        if (this.followPath(dt, g)) this.order = { type: 'idle' };
        break;
      case 'attackmove':
        this.scan(dt, g);
        if (this.order === o && this.followPath(dt, g)) this.order = { type: 'idle' };
        break;
      case 'attack':
        this.updateAttack(dt, g, o);
        break;
      case 'harvest':
        this.updateHarvest(dt, g);
        if (this.weapon) this.guard(dt, g);
        break;
    }
    if (this.def.turret && !this.target) this.turretDir = turnToward(this.turretDir, this.dir, 3 * dt);
  }

  // Climb / descend, and send jets home when they are empty or idle away from base
  updateFlight(dt, g) {
    const cruise = this.def.look === 'heli' ? 34 : 46;
    const want = this.landed ? 0 : cruise;
    this.z += Math.sign(want - this.z) * Math.min(Math.abs(want - this.z), 45 * dt);
    if (this.ammo !== Infinity && this.order.type !== 'rearm') {
      const idleAway = this.order.type === 'idle' && !this.landed && this.ammo < this.def.ammo;
      if (this.ammo <= 0 || idleAway) this.orderRearm(g);
    }
  }

  updateRearm(dt, g, o) {
    if (o.field.dead || o.field.owner !== this.owner) { this.orderRearm(g); return; }
    if (!this.followPath(dt, g)) return;
    this.landed = true;
    if (this.z > 1) return;
    this.reloadTimer += dt;
    if (this.reloadTimer >= 1.5) {
      this.reloadTimer = 0;
      this.ammo = Math.min(this.def.ammo, this.ammo + 1);
      if (this.ammo >= this.def.ammo) this.order = { type: 'idle' };
    }
  }

  // Look for enemies nearby; switch to an automatic attack that resumes the current order.
  scan(dt, g) {
    if (!this.weapon) return;
    if (this.landed || this.ammo <= 0) return; // parked jets wait for orders
    this.scanTimer -= dt;
    if (this.scanTimer > 0) return;
    this.scanTimer = 0.4;
    const t = g.findTarget(this, this.def.sight);
    if (!t) return;
    const o = this.order;
    if (o.type === 'attackmove') {
      this.orderAttack(g, t, { auto: true, resume: { type: 'attackmove', x: o.x, y: o.y } });
    } else {
      this.orderAttack(g, t, { auto: true, home: { x: this.x, y: this.y }, resume: { type: 'move', x: this.x, y: this.y } });
    }
  }

  // Shoot at anything in range without leaving the current order (armed harvesters)
  guard(dt, g) {
    const w = this.weapon;
    if (this.target && (this.target.dead || distToEntity(this.x, this.y, this.target) > w.range)) this.target = null;
    this.scanTimer -= dt;
    if (!this.target && this.scanTimer <= 0) {
      this.scanTimer = 0.4;
      this.target = g.findTarget(this, w.range);
    }
    if (this.target) this.aimAndFire(dt, g, this.target);
  }

  retaliate(g, attacker) {
    if (!this.weapon || this.order.type !== 'idle' || !attacker || attacker.dead) return;
    this.orderAttack(g, attacker, { auto: true, home: { x: this.x, y: this.y }, resume: { type: 'move', x: this.x, y: this.y } });
  }

  finishAttack(g, o) {
    this.target = null;
    const r = o.resume;
    if (!r) this.order = { type: 'idle' };
    else if (r.type === 'attackmove') this.orderAttackMove(g, r.x, r.y);
    else if (dist(this.x, this.y, r.x, r.y) > 0.6) this.orderMove(g, r.x, r.y);
    else this.orderStop();
  }

  updateAttack(dt, g, o) {
    const t = o.target;
    if (!t || t.dead) return this.finishAttack(g, o);
    // Don't chase forever when the attack was automatic
    if (o.home && dist(this.x, this.y, o.home.x, o.home.y) > this.def.sight + 2) return this.finishAttack(g, o);
    const w = this.weapon;
    const d = distToEntity(this.x, this.y, t);
    if (d <= w.range) {
      this.path = [];
      this.aimAndFire(dt, g, t);
    } else {
      this.repathTimer -= dt;
      if (this.repathTimer <= 0 || !this.path.length) {
        this.repathTimer = 1;
        const c = g.entityCenter(t);
        this.setPath(g, c.x, c.y);
      }
      this.followPath(dt, g);
      if (this.def.turret) {
        const c = g.entityCenter(t);
        this.turretDir = turnToward(this.turretDir, Math.atan2(c.y - this.y, c.x - this.x), 4 * dt);
      }
    }
  }

  // Returns true once the path is exhausted.
  followPath(dt, g) {
    if (!this.path.length) return true;
    const p = this.path[0];
    const dx = p.x - this.x, dy = p.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.06) {
      this.path.shift();
      return this.path.length === 0;
    }
    const ang = Math.atan2(dy, dx);
    let speed = this.def.speed;
    if (this.isAir) {
      // aircraft bank around quickly and never collide with anything
      this.dir = turnToward(this.dir, ang, 4 * dt);
      const s = Math.min(speed * dt, d);
      this.x += (dx / d) * s;
      this.y += (dy / d) * s;
      this.moving = true;
      this.anim += dt * speed * 5;
      return false;
    }
    if (this.isInfantry) {
      this.dir = ang;
    } else {
      this.dir = turnToward(this.dir, ang, 5 * dt);
      const diff = angleDiff(this.dir, ang);
      speed *= diff > 0.7 ? 0.1 : 1 - diff / 1.1;
    }
    const s = Math.min(speed * dt, d);
    const nx = this.x + (dx / d) * s, ny = this.y + (dy / d) * s;
    const sameTile = Math.floor(nx) === Math.floor(this.x) && Math.floor(ny) === Math.floor(this.y);
    if (sameTile || g.map.passable(this.domain, Math.floor(nx), Math.floor(ny))) {
      this.x = nx;
      this.y = ny;
    } else {
      // Something (e.g. a new building) blocks the way: repath to the final destination
      const last = this.path[this.path.length - 1];
      this.setPath(g, last.x, last.y);
      return this.path.length === 0;
    }
    this.moving = true;
    this.anim += dt * speed * 5;

    this.stuckTimer += dt;
    if (this.stuckTimer > 1.5) {
      const last = this.path[this.path.length - 1];
      if (dist(this.x, this.y, this.lastX, this.lastY) < 0.25) {
        if (dist(this.x, this.y, last.x, last.y) < 1.5) { this.path = []; return true; }
        this.setPath(g, last.x, last.y);
      }
      this.stuckTimer = 0;
      this.lastX = this.x;
      this.lastY = this.y;
    }
    return false;
  }

  updateHarvest(dt, g) {
    const cap = this.def.capacity;
    const W = g.map.w;
    switch (this.hstate) {
      case 'seek': {
        if (this.cargo >= cap) { this.hstate = 'return'; break; }
        if (this.waitTimer > 0) { this.waitTimer -= dt; break; }
        const t = g.findOre(this, this.preferTile);
        this.preferTile = -1;
        if (t < 0) {
          if (this.cargo > 0) this.hstate = 'return';
          else this.waitTimer = 3;
          break;
        }
        g.reserveOre(this, t);
        this.setPath(g, (t % W) + 0.5, ((t / W) | 0) + 0.5);
        this.hstate = 'toOre';
        break;
      }
      case 'toOre':
        if (g.map.ore[this.oreTile] === 0) { this.hstate = 'seek'; break; }
        if (this.followPath(dt, g)) {
          const tx = (this.oreTile % W) + 0.5, ty = ((this.oreTile / W) | 0) + 0.5;
          this.hstate = dist(this.x, this.y, tx, ty) < 0.9 ? 'mine' : 'seek';
        }
        break;
      case 'mine': {
        this.mineTimer -= dt;
        this.dir += dt * 0.6; // slow rotation while mining, purely cosmetic
        if (this.mineTimer > 0) break;
        this.mineTimer = 0.5;
        const ore = g.map.ore;
        const take = Math.min(this.def.mineRate || 35, ore[this.oreTile], cap - this.cargo);
        ore[this.oreTile] -= take;
        this.cargo += take;
        if (this.cargo >= cap) { g.releaseOre(this); this.hstate = 'return'; }
        else if (ore[this.oreTile] === 0) this.hstate = 'seek';
        break;
      }
      case 'return': {
        let ref = this.dockRef;
        if (!ref || ref.dead || ref.owner !== this.owner) ref = g.nearestBuilding(this.owner, 'refinery', this.x, this.y);
        if (!ref) { this.dockRef = null; break; }
        this.dockRef = ref;
        if (this.def.chrono) {
          // Chrono Miner: charge up, then teleport straight to the refinery
          this.path = [];
          this.chronoTimer = 1.2;
          this.hstate = 'chrono';
          g.effects.push({ type: 'chrono', x: this.x, y: this.y, z: 6, life: 1.2, max: 1.2 });
          g.sound('chrono', this.x, this.y);
          break;
        }
        const dp = g.dockPoint(ref);
        this.setPath(g, dp.x, dp.y);
        this.hstate = 'toDock';
        break;
      }
      case 'chrono': {
        if (!this.dockRef || this.dockRef.dead) { this.hstate = 'return'; this.dockRef = null; break; }
        this.chronoTimer -= dt;
        if (this.chronoTimer > 0) break;
        const dp = g.dockPoint(this.dockRef);
        this.x = dp.x;
        this.y = dp.y;
        g.effects.push({ type: 'chrono', x: dp.x, y: dp.y, z: 6, life: 0.6, max: 0.6 });
        this.hstate = 'unload';
        break;
      }
      case 'toDock':
        if (!this.dockRef || this.dockRef.dead) { this.hstate = 'return'; this.dockRef = null; break; }
        if (this.followPath(dt, g)) {
          const dp = g.dockPoint(this.dockRef);
          this.hstate = dist(this.x, this.y, dp.x, dp.y) < 1.2 ? 'unload' : 'return';
        }
        break;
      case 'unload': {
        const amt = Math.min(this.cargo, 400 * dt);
        this.cargo -= amt;
        this.owner.credits += amt * this.owner.incomeMult;
        if (this.cargo <= 0.01) {
          this.cargo = 0;
          this.hstate = 'seek';
          this.dockRef = null;
        }
        break;
      }
    }
  }
}

export class Building extends Entity {
  constructor(key, owner, tx, ty) {
    super(key, BUILDINGS[key], owner);
    this.isBuilding = true;
    this.tx = tx;
    this.ty = ty;
    this.w = this.def.w;
    this.h = this.def.h;
    this.x = tx + this.w / 2;
    this.y = ty + this.h / 2;
    this.turretDir = Math.PI * 0.75;
    this.repairing = false;
    this.buildAnim = 0;
    this.anim = Math.random() * 10;
    this.rally = null;
  }

  update(dt, g) {
    this.anim += dt;
    if (this.buildAnim < 1) this.buildAnim = Math.min(1, this.buildAnim + dt / 1.2);
    if (this.cooldown > 0) this.cooldown -= dt;

    if (this.repairing) {
      if (this.hp >= this.maxHp) {
        this.repairing = false;
      } else {
        const heal = Math.min(this.maxHp * 0.04 * dt, this.maxHp - this.hp);
        const cost = (heal / this.maxHp) * this.def.cost * 0.5;
        if (this.owner.credits >= cost) {
          this.owner.credits -= cost;
          this.hp += heal;
        }
      }
    }

    // Base defenses go offline on low power, like in RA2
    if (this.weapon && this.owner.hasPower()) {
      if (this.target && (this.target.dead || distToEntity(this.x, this.y, this.target) > this.weapon.range)) this.target = null;
      this.scanTimer -= dt;
      if (!this.target && this.scanTimer <= 0) {
        this.scanTimer = 0.4;
        this.target = g.findTarget(this, this.weapon.range);
      }
      if (this.target) this.aimAndFire(dt, g, this.target);
    }
  }
}
