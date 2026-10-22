import { BUILDINGS, FACTIONS, keyForRole } from './config.js';
import { dist } from './util.js';

// Build order by role; each faction maps roles to its own buildings
const BUILD_ORDER = [
  'power', 'refinery', 'barracks', 'power', 'factory', 'defense', 'radar',
  'power', 'refinery', 'advDefense', 'power', 'defense', 'advDefense',
];
const FIRST_ATTACK = 240; // seconds of peace before the first wave

// A simple skirmish AI: follows a build order, keeps harvesters up,
// trains a mixed army, defends its base and sends growing attack waves.
export class AI {
  constructor(g, player) {
    this.g = g;
    this.p = player;
    this.timer = 2;
    this.waveSize = 6;
    this.attacking = new Set();
    const cy = this.conyard();
    const c = g.map.w / 2;
    if (cy) {
      const d = Math.hypot(c - cy.x, c - cy.y);
      player.rally = { x: cy.x + ((c - cy.x) / d) * 5, y: cy.y + ((c - cy.y) / d) * 5 };
    }
  }

  conyard() {
    return this.g.buildings.find((b) => b.owner === this.p && b.key === 'conyard');
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1;
    this.think();
  }

  think() {
    const g = this.g, p = this.p;

    // --- base building ---
    const bq = p.queues.building;
    if (bq.length && bq[0].ready) {
      const spot = this.findSpot(bq[0].key);
      if (spot) g.placeBuilding(p, bq[0].key, spot.x, spot.y);
      else p.cancel(bq[0].key);
    }
    if (!bq.length) {
      const next = this.nextBuilding();
      if (next) p.enqueue(next, g);
    }

    // --- production ---
    const fac = FACTIONS[p.faction];
    const harvKey = fac.harvester;
    const [basicInf, advInf] = fac.tabs[1].items;
    const [basicVeh, advVeh] = fac.tabs[2].items;
    const mine = g.units.filter((u) => u.owner === p);
    const harvesters = mine.filter((u) => u.def.harvester).length;
    const wantHarv = Math.min(4, (p.counts.refinery || 0) + 1);
    const vq = p.queues.vehicle, iq = p.queues.infantry;
    // Economy first: while short on harvesters, don't spend on the army
    const needHarv = p.has('refinery') && harvesters < wantHarv;
    if (needHarv && p.has('factory')) {
      for (const it of [...iq, ...vq]) if (it.key !== harvKey && it.progress === 0) p.cancel(it.key);
      if (!vq.some((i) => i.key === harvKey)) p.enqueue(harvKey, g);
    } else if (!needHarv) {
      if (p.has('factory') && vq.length < 2 && p.credits > 900) {
        p.enqueue(p.canBuild(advVeh, g) && Math.random() < 0.4 ? advVeh : basicVeh, g);
      }
      if (p.has('barracks') && iq.length < 2 && p.credits > 400) {
        p.enqueue(p.canBuild(advInf, g) && Math.random() < 0.4 ? advInf : basicInf, g);
      }
    }

    // --- defense ---
    for (const u of this.attacking) if (u.dead) this.attacking.delete(u);
    const army = mine.filter((u) => u.weapon && !u.def.harvester && !this.attacking.has(u));
    const hurt = g.buildings.find((b) => b.owner === p && g.time - b.lastAttacked < 5 && b.lastAttacker && !b.lastAttacker.dead);
    if (hurt) {
      for (const u of army) if (u.order.type !== 'attack') u.orderAttack(g, hurt.lastAttacker);
    }

    // --- attack waves ---
    const ready = army.filter((u) => u.order.type === 'idle');
    if (g.time > FIRST_ATTACK && ready.length >= this.waveSize) {
      const t = this.pickTarget();
      if (t) {
        for (const u of ready) this.attacking.add(u);
        g.groupOrder(ready, t.x, t.y, 'attackmove');
        this.waveSize = Math.min(this.waveSize + 2, 16);
      }
    }
    // Attackers that reached their destination push on to the next target
    for (const u of this.attacking) {
      if (u.order.type !== 'idle') continue;
      const t = this.pickTarget(u);
      if (t) u.orderAttackMove(g, t.x + Math.random() - 0.5, t.y + Math.random() - 0.5);
    }
  }

  pickTarget(from) {
    const g = this.g;
    const o = from || this.conyard() || this.p.rally || { x: g.map.w / 2, y: g.map.h / 2 };
    let best = null, bd = Infinity;
    for (const b of g.buildings) {
      if (b.owner === this.p) continue;
      const d = dist(o.x, o.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) return { x: best.x, y: best.y + best.h / 2 + 0.5 };
    for (const u of g.units) {
      if (u.owner === this.p) continue;
      const d = dist(o.x, o.y, u.x, u.y);
      if (d < bd) { bd = d; best = u; }
    }
    return best && { x: best.x, y: best.y };
  }

  nextBuilding() {
    const g = this.g, p = this.p;
    const power = keyForRole(p.faction, 'power');
    if (p.lowPower() && p.canBuild(power, g)) return power;
    const tally = {};
    for (const role of BUILD_ORDER) {
      const key = keyForRole(p.faction, role);
      tally[key] = (tally[key] || 0) + 1;
      if ((p.counts[key] || 0) < tally[key]) return p.canBuild(key, g) ? key : null;
    }
    if (p.powerOut - p.powerUse < 40) return power;
    const defense = keyForRole(p.faction, p.has('radar') && Math.random() < 0.5 ? 'advDefense' : 'defense');
    if (p.credits > 2500 && (p.counts.defense || 0) + (p.counts.advDefense || 0) < 8) return defense;
    return null;
  }

  findSpot(key) {
    const g = this.g, p = this.p, m = g.map;
    const def = BUILDINGS[key];
    const cy = this.conyard() || g.buildings.find((b) => b.owner === p);
    if (!cy) return null;
    let ax = cy.x, ay = cy.y;
    if (key === 'refinery') {
      let bd = Infinity;
      for (const i of m.oreTiles) {
        if (!m.ore[i]) continue;
        const x = (i % m.w) + 0.5, y = ((i / m.w) | 0) + 0.5;
        const d = dist(x, y, cy.x, cy.y);
        if (d < bd) { bd = d; ax = x; ay = y; }
      }
    } else if (def.weapon && p.rally) {
      ax = p.rally.x + (Math.random() - 0.5) * 6;
      ay = p.rally.y + (Math.random() - 0.5) * 6;
    }
    let best = null, bd = Infinity;
    for (let ty = Math.floor(ay - 14); ty <= ay + 14; ty++) {
      for (let tx = Math.floor(ax - 14); tx <= ax + 14; tx++) {
        const d = dist(tx + def.w / 2, ty + def.h / 2, ax, ay);
        if (d >= bd || !g.canPlace(p, key, tx, ty)) continue;
        if (!def.weapon && !this.hasMargin(tx, ty, def)) continue;
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
