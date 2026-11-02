import { BUILDINGS, FACTIONS, POWERS, UNITS, keyForRole } from './config.js';
import { dist } from './util.js';

// Build order by role; each faction maps roles to its own buildings
const BUILD_ORDER = [
  'power', 'refinery', 'barracks', 'power', 'factory', 'defense', 'radar', 'refinery', 'power',
  'repairDepot', 'airfield', 'aaDefense', 'shipyard', 'advDefense', 'power', 'power', 'superweapon',
  'defense', 'advDefense', 'aaDefense',
];

// A skirmish AI that builds up quickly, keeps every factory busy, defends its
// base, and attacks on a timer instead of waiting for a perfect army.
export class AI {
  constructor(g, player) {
    this.g = g;
    this.p = player;
    this.d = g.difficulty;
    this.timer = 2;
    this.attacking = new Set();
    this.waveCount = 0;
    this.waveSize = this.d.waveMin;
    this.lastWave = 0;
    this.lastRaid = 0;
    this.unplaceable = new Set(); // e.g. a shipyard with no water nearby
    const cy = this.conyard();
    const c = g.map.w / 2;
    if (cy) {
      const d = Math.hypot(c - cy.x, c - cy.y) || 1;
      player.rally = { x: cy.x + ((c - cy.x) / d) * 5, y: cy.y + ((c - cy.y) / d) * 5 };
    }
  }

  conyard() {
    return this.g.buildings.find((b) => b.owner === this.p && b.key === 'conyard');
  }

  tab(id) {
    return FACTIONS[this.p.faction].tabs.find((t) => t.id === id).items;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.d.think;
    for (const u of this.attacking) if (u.dead) this.attacking.delete(u);
    this.build();
    this.produce();
    this.defend();
    this.attack();
    this.raid();
    this.useJets();
    this.useNavy();
    this.useEngineers();
    this.repairUnits();
    this.usePowers();
  }

  // ---------- engineers, repairs, powers ----------
  // Keep one engineer around to grab oil derricks (neutral first, then the enemy's)
  useEngineers() {
    const g = this.g, p = this.p;
    const derricks = g.buildings.filter((b) => b.def.income && b.owner !== p);
    if (!derricks.length || !p.has('barracks')) return;
    const engineers = g.units.filter((u) => u.owner === p && u.def.engineer);
    if (!engineers.length && !p.queuedCount('engineer') && p.credits > 800) p.enqueue('engineer', g);
    for (const e of engineers) {
      if (e.order.type !== 'idle' && e.order.type !== 'move') continue;
      const pick = derricks.filter((b) => b.owner.neutral).length ? derricks.filter((b) => b.owner.neutral) : derricks;
      pick.sort((a, b) => dist(e.x, e.y, a.x, a.y) - dist(e.x, e.y, b.x, b.y));
      e.orderReach(g, 'capture', pick[0]);
    }
  }

  // Badly damaged vehicles and ships that aren't in the middle of an attack go for repairs
  repairUnits() {
    const g = this.g;
    for (const u of g.units) {
      if (u.owner !== this.p || u.isInfantry || u.isAir || u.def.harvester || u.hp > u.maxHp * 0.35) continue;
      if (u.order.type === 'repair' || u.order.type === 'attack') continue;
      if (u.orderRepair(g)) this.attacking.delete(u);
    }
  }

  usePowers() {
    const g = this.g, p = this.p;
    for (const [id, pw] of Object.entries(POWERS)) {
      const st = p.powers[id];
      if (!st || st.charge < pw.charge) continue;
      let t = null;
      if (pw.kind === 'strike' || pw.kind === 'missile') t = this.richestSpot(pw.radius);
      else if (pw.kind === 'paradrop') t = this.nearestEnemy(this.conyard() || p.rally, (e) => e.isUnit && e.def.harvester) || this.pickTarget(this.conyard() || p.rally);
      else if (pw.kind === 'reveal') t = this.nearestEnemy({ x: g.map.w / 2, y: g.map.w / 2 }, (e) => e.isBuilding);
      if (t) g.usePower(p, id, t.x, t.y);
    }
  }

  // Enemy structure whose surroundings are worth the most, for a superweapon
  richestSpot(radius) {
    let best = null, bv = 0;
    const g = this.g;
    for (const b of g.buildings) {
      if (!g.hostile(b.owner, this.p) || b.def.wall) continue;
      let v = 0;
      for (const list of [g.buildings, g.units]) {
        for (const e of list) if (g.hostile(e.owner, this.p) && dist(e.x, e.y, b.x, b.y) <= radius) v += e.def.cost;
      }
      if (v > bv) { bv = v; best = b; }
    }
    return best;
  }

  // ---------- base building ----------
  build() {
    const g = this.g, p = this.p;
    const bq = p.queues.building;
    if (bq.length && bq[0].ready) {
      const key = bq[0].key;
      const spot = this.findSpot(key);
      if (spot) g.placeBuilding(p, key, spot.x, spot.y);
      else { p.cancel(key); this.unplaceable.add(key); }
    }
    if (!bq.length) {
      const next = this.nextBuilding();
      if (next) p.enqueue(next, g);
    }
  }

  nextBuilding() {
    const g = this.g, p = this.p;
    const ok = (k) => k && !this.unplaceable.has(k) && !(BUILDINGS[k].naval && !g.map.hasWater);
    const power = keyForRole(p.faction, 'power');
    if (p.lowPower() && p.canBuild(power, g)) return power;
    const tally = {};
    for (const role of BUILD_ORDER) {
      const key = keyForRole(p.faction, role);
      if (!ok(key)) continue;
      tally[key] = (tally[key] || 0) + 1;
      if ((p.counts[key] || 0) < tally[key]) {
        if (p.canBuild(key, g)) return key;
        continue; // prerequisite missing: try the next item rather than stalling
      }
    }
    if (p.powerOut - p.powerUse < 40) return power;
    const def = keyForRole(p.faction, Math.random() < 0.5 ? 'advDefense' : 'defense');
    if (p.credits > 2500 && (p.counts.defense || 0) + (p.counts.advDefense || 0) < 10 && p.canBuild(def, g)) return def;
    return null;
  }

  // ---------- production ----------
  produce() {
    const g = this.g, p = this.p;
    const harvKey = FACTIONS[p.faction].harvester;
    const mine = g.units.filter((u) => u.owner === p);
    const harvesters = mine.filter((u) => u.def.harvester).length;
    const wantHarv = Math.min(5, (p.counts.refinery || 0) + 1);
    const needHarv = p.has('refinery') && harvesters < wantHarv;
    const q = p.queues;

    if (needHarv && p.has('factory') && !q.vehicle.some((i) => i.key === harvKey)) {
      // when broke, drop unstarted army orders so the harvester gets the money
      if (p.credits < 300) for (const it of [...q.infantry, ...q.vehicle]) if (it.key !== harvKey && it.progress === 0) p.cancel(it.key);
      p.enqueue(harvKey, g);
    }
    const reserve = needHarv ? 900 : 0;
    const spare = p.credits - reserve;
    const pick = (items) => {
      const [basic, adv] = items;
      return adv && p.canBuild(adv, g) && Math.random() < 0.4 ? adv : basic;
    };
    // Aim for a mixed force: infantry can't outnumber vehicles by too much, and
    // air / navy get a fixed share once their factories exist
    const count = (cat) => mine.filter((u) => u.def.category === cat && !u.def.harvester).length;
    const inf = count('infantry'), veh = count('vehicle'), air = count('air'), sea = count('naval');
    const ground = inf + veh;
    const share = this.d.airNavyShare;
    if (p.has('airfield') && q.air.length < 1 && air < 2 + ground * share * 0.5 && spare > 200) {
      const items = this.tab('air');
      p.enqueue(items[Math.floor(Math.random() * items.length)], g);
    }
    if (p.has('shipyard') && q.naval.length < 1 && sea < 1 + ground * share * 0.4 && spare > 200) p.enqueue(pick(this.tab('naval')), g);
    const vehicles = this.tab('vehicle').filter((k) => k !== harvKey);
    if (p.has('factory') && q.vehicle.filter((i) => i.key !== harvKey).length < 2 && spare > 500) p.enqueue(pick(vehicles), g);
    const hero = this.tab('infantry').find((k) => UNITS[k].hero);
    if (hero && p.credits > 3000 && p.canBuild(hero, g)) p.enqueue(hero, g);
    const infantryCap = p.has('factory') ? veh * 1.5 + 5 : 12;
    if (p.has('barracks') && q.infantry.length < 2 && inf < infantryCap && spare > 150) p.enqueue(pick(this.tab('infantry')), g);
  }

  // Ground units and gunships that fight in attack waves
  army() {
    return this.g.units.filter((u) => u.owner === this.p && u.weapon && !u.def.harvester && !u.isNaval && u.ammo === Infinity);
  }

  // ---------- defense ----------
  defend() {
    const g = this.g, p = this.p;
    const hurt = g.buildings.find((b) => b.owner === p && g.time - b.lastAttacked < 6 && b.lastAttacker && !b.lastAttacker.dead);
    if (!hurt) return;
    const enemy = hurt.lastAttacker;
    for (const u of this.army()) {
      if (this.attacking.has(u) || u.order.type === 'attack') continue;
      if (dist(u.x, u.y, hurt.x, hurt.y) < 25) u.orderAttack(g, enemy);
    }
  }

  // ---------- attack waves ----------
  attack() {
    const g = this.g, d = this.d;
    const ready = this.army().filter((u) => !this.attacking.has(u) && (u.order.type === 'idle' || (u.order.type === 'move' && !u.order.auto)));
    const sinceWave = g.time - this.lastWave;
    const due = g.time > d.firstAttack && (ready.length >= this.waveSize || (sinceWave > d.waveEvery && ready.length >= 3));
    if (due) {
      const t = this.pickTarget(this.conyard() || this.p.rally);
      if (t) {
        for (const u of ready) { this.attacking.add(u); u.aiRetarget = g.time + 6; }
        g.groupOrder(ready, t.x, t.y, 'attackmove');
        this.lastWave = g.time;
        this.waveCount++;
        this.waveSize = Math.min(d.waveMin + this.waveCount * 2, d.maxWave);
      }
    }
    // Attackers that ran out of things to shoot push on to the next target
    for (const u of this.attacking) {
      if (u.order.type !== 'idle' || g.time < (u.aiRetarget || 0)) continue;
      u.aiRetarget = g.time + 8; // don't re-path every second if the target is unreachable
      const t = this.pickTarget(u);
      if (t) u.orderAttackMove(g, t.x + Math.random() - 0.5, t.y + Math.random() - 0.5);
    }
  }

  // Hard AI: small fast groups go after your harvesters
  raid() {
    const g = this.g;
    if (!this.d.raids || g.time < this.d.firstAttack - 30 || g.time - this.lastRaid < 70) return;
    const prey = this.nearestEnemy(this.p.rally || this.conyard(), (e) => e.isUnit && e.def.harvester);
    if (!prey) return;
    const fast = this.army().filter((u) => !this.attacking.has(u) && u.def.speed >= 1.8).slice(0, 3);
    if (fast.length < 2) return;
    this.lastRaid = g.time;
    for (const u of fast) { this.attacking.add(u); u.aiRetarget = g.time + 10; u.orderAttack(g, prey); }
  }

  // Jets sortie from the airfield whenever they are loaded
  useJets() {
    const g = this.g;
    if (g.time < this.d.firstAttack * 0.7) return;
    for (const u of g.units) {
      if (u.owner !== this.p || u.ammo === Infinity || !u.landed || u.ammo < u.def.ammo || u.order.type !== 'idle') continue;
      const t = Math.random() < 0.5
        ? this.nearestEnemy(u, (e) => e.isUnit && !e.isAir && (e.def.harvester || e.def.category === 'vehicle'))
        : this.nearestEnemy(u, (e) => e.isBuilding);
      if (t) u.orderAttack(g, t);
    }
  }

  // Ships gather, then sail at the nearest enemy structure and shell it from the water
  useNavy() {
    const g = this.g;
    const idle = g.units.filter((u) => u.owner === this.p && u.isNaval && u.order.type === 'idle' && g.time >= (u.aiRetarget || 0));
    if (idle.length < (this.d.raids ? 1 : 2) || g.time < this.d.firstAttack * 0.8) return;
    const t = this.nearestEnemy(idle[0], (e) => e.isBuilding) || this.nearestEnemy(idle[0], () => true);
    if (!t) return;
    for (const u of idle) u.aiRetarget = g.time + 12;
    g.groupOrder(idle, t.x, t.y, 'attackmove');
  }

  nearestEnemy(from, filter) {
    if (!from) return null;
    let best = null, bd = Infinity;
    for (const list of [this.g.buildings, this.g.units]) {
      for (const e of list) {
        if (e.dead || !this.g.hostile(e.owner, this.p) || !filter(e)) continue;
        const d = dist(from.x, from.y, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  pickTarget(from) {
    const b = this.nearestEnemy(from, (e) => e.isBuilding && !e.def.wall) || this.nearestEnemy(from, (e) => e.isBuilding);
    if (b) return { x: b.x, y: b.y + b.h / 2 + 0.5 };
    const u = this.nearestEnemy(from, (e) => !e.isAir);
    return u && { x: u.x, y: u.y };
  }

  // ---------- placement ----------
  findSpot(key) {
    const g = this.g, p = this.p, m = g.map;
    const def = BUILDINGS[key];
    const cy = this.conyard() || g.buildings.find((b) => b.owner === p);
    if (!cy) return null;
    let ax = cy.x, ay = cy.y;
    const nearestTile = (test) => {
      let bd = Infinity, best = null;
      for (let y = Math.max(0, Math.floor(cy.y - 16)); y < Math.min(m.h, cy.y + 16); y++) {
        for (let x = Math.max(0, Math.floor(cy.x - 16)); x < Math.min(m.w, cy.x + 16); x++) {
          if (!test(m.idx(x, y))) continue;
          const d = dist(x + 0.5, y + 0.5, cy.x, cy.y);
          if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
        }
      }
      return best;
    };
    if (key === 'refinery') {
      const o = nearestTile((i) => m.ore[i] > 0);
      if (o) { ax = o.x; ay = o.y; }
    } else if (def.naval) {
      const w = nearestTile((i) => m.terrain[i] === 1);
      if (!w) return null;
      ax = w.x; ay = w.y;
    } else if (def.weapon && p.rally) {
      ax = p.rally.x + (Math.random() - 0.5) * 6;
      ay = p.rally.y + (Math.random() - 0.5) * 6;
    }
    let best = null, bd = Infinity;
    for (let ty = Math.floor(ay - 14); ty <= ay + 14; ty++) {
      for (let tx = Math.floor(ax - 14); tx <= ax + 14; tx++) {
        const d = dist(tx + def.w / 2, ty + def.h / 2, ax, ay);
        if (d >= bd || !g.canPlace(p, key, tx, ty)) continue;
        if (!def.weapon && !def.naval && !this.hasMargin(tx, ty, def)) continue;
        best = { x: tx, y: ty };
        bd = d;
      }
    }
    return best;
  }

  // Keep a one-tile lane around buildings so units can always get through
  hasMargin(tx, ty, def) {
    const m = this.g.map;
    for (let y = ty - 1; y <= ty + def.h; y++) {
      for (let x = tx - 1; x <= tx + def.w; x++) {
        if (m.inBounds(x, y) && m.buildingAt[m.idx(x, y)]) return false;
      }
    }
    return m.isPassable(tx + Math.floor(def.w / 2), ty + def.h);
  }
}
