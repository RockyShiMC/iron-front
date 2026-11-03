import { UNITS, BUILDINGS, FACTIONS, START_CREDITS, POWERS, defOf } from './config.js';

export const CATEGORIES = ['building', 'infantry', 'vehicle', 'air', 'naval'];
const MAX_QUEUE = 5;

export function categoryOf(key) {
  return UNITS[key] ? UNITS[key].category : 'building';
}

export class Player {
  constructor(id, faction, isAI) {
    this.id = id;
    this.faction = faction;
    this.name = FACTIONS[faction].name;
    this.color = FACTIONS[faction].color;
    this.isAI = isAI;
    this.credits = START_CREDITS;
    this.queues = { building: [], infantry: [], vehicle: [], air: [], naval: [] };
    // Difficulty handicaps (AI only): harvesting payout and production speed
    this.incomeMult = 1;
    this.buildMult = 1;
    this.powerOut = 0;
    this.powerUse = 0;
    this.counts = {};
    this.defeated = false;
    this.powers = {}; // support power id -> { charge, announced }
    this.cheats = {}; // test mode switches: instant, god, power, tech, anywhere
    this.team = id; // players on the same team don't fight
    this.seat = id; // which of the map's bases this player starts on
  }

  // The civilians: own the map's oil derricks and town until someone takes them
  static neutral(id) {
    const p = new Player(id, 'allied', false);
    p.neutral = true;
    p.name = 'Civilians';
    p.color = '#a89f8c';
    p.credits = 0;
    return p;
  }

  // Support powers charge while their building stands (and, for most, while powered)
  updatePowers(dt, g) {
    if (this.neutral) return;
    for (const [id, pw] of Object.entries(POWERS)) {
      if (pw.faction !== this.faction) continue;
      const has = this.has(pw.building);
      const st = (this.powers[id] ||= { charge: 0, announced: false });
      if (!has) { st.charge = 0; st.announced = false; continue; }
      if (this.lowPower() || st.charge >= pw.charge) continue;
      st.charge = Math.min(pw.charge, st.charge + dt);
      if (st.charge >= pw.charge && !st.announced) {
        st.announced = true;
        if (this === g.human) g.notify(`${pw.name} ready`, 'info', 0);
        else if (pw.superweapon && g.hostile(this, g.human)) g.notify('Warning: enemy superweapon ready', 'alert', 0);
      }
    }
  }

  lowPower() { return !this.cheats?.power && this.powerUse > this.powerOut; }
  hasPower() { return !this.lowPower(); }
  has(key) { return (this.counts[key] || 0) > 0; }

  prereqsMet(key) {
    if (this.cheats?.tech) return true; // test mode: everything unlocked
    const def = defOf(key);
    return (def.prereq || []).every((k) => this.has(k));
  }

  producerFor(category, g) {
    let found = null;
    for (const b of g.buildings) {
      if (b.owner === this && !b.dead && b.def.produces === category) {
        if (b.primary) return b;
        found ??= b;
      }
    }
    return found;
  }

  canBuild(key, g) {
    const def = defOf(key);
    if (def.buildable === false) return false;
    if (def.faction && def.faction !== this.faction) return false;
    // heroes: one at a time
    if (def.unique && (this.queuedCount(key) || g.units.some((u) => u.owner === this && u.key === key) ||
      g.buildings.some((b) => b.owner === this && b.garrison?.some((u) => u.key === key)))) return false;
    return this.prereqsMet(key) && !!this.producerFor(categoryOf(key), g);
  }

  queuedCount(key) {
    return this.queues[categoryOf(key)].filter((it) => it.key === key).length;
  }

  enqueue(key, g) {
    if (!this.canBuild(key, g)) return false;
    const cat = categoryOf(key);
    const q = this.queues[cat];
    if (cat === 'building' ? q.length >= 1 : q.length >= MAX_QUEUE) return false;
    q.push({ key, progress: 0, spent: 0, ready: false });
    return true;
  }

  // Removes the most recently queued item of this kind and refunds what was spent.
  cancel(key) {
    const q = this.queues[categoryOf(key)];
    for (let i = q.length - 1; i >= 0; i--) {
      if (q[i].key === key) {
        this.credits += q[i].spent;
        q.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  updateProduction(dt, g) {
    for (const cat of CATEGORIES) {
      const q = this.queues[cat];
      if (!q.length) continue;
      const item = q[0];
      if (item.ready) continue;
      const def = defOf(item.key);
      if (!this.producerFor(cat, g) || !this.prereqsMet(item.key)) continue; // on hold
      // test mode's instant build finishes in one tick (still paid for)
      const rate = this.cheats?.instant ? 1e6 : ((this.lowPower() ? 0.5 : 1) * this.buildMult) / def.time;
      const dp = Math.min(rate * dt, 1 - item.progress);
      const cost = def.cost * dp;
      if (this.credits < cost) {
        if (this === g.human) g.notify('Insufficient funds', 'warn', 20);
        continue;
      }
      this.credits -= cost;
      item.spent += cost;
      item.progress += dp;
      if (item.progress >= 1 - 1e-6) {
        item.progress = 1;
        if (cat === 'building') {
          item.ready = true;
          if (this === g.human) g.notify('Construction complete');
        } else {
          g.spawnUnit(this, item.key);
          q.shift();
          if (this === g.human) g.notify('Unit ready');
        }
      }
    }
  }

  recount(g) {
    const wasLow = this.lowPower();
    this.counts = {};
    this.powerOut = 0;
    this.powerUse = 0;
    for (const b of g.buildings) {
      if (b.owner !== this || b.dead) continue;
      this.counts[b.key] = (this.counts[b.key] || 0) + 1;
      // Prerequisites refer to roles, so a Tesla Reactor also counts as 'power'
      const role = BUILDINGS[b.key].role;
      if (role && role !== b.key) this.counts[role] = (this.counts[role] || 0) + 1;
      const p = BUILDINGS[b.key].power;
      if (p > 0) this.powerOut += p;
      else this.powerUse -= p;
    }
    if (this !== g.human) return;
    if (!wasLow && this.lowPower()) g.notify('Low power', 'alert', 0);
    // Announce when a new building unlocks things we couldn't build before
    const unlocked = new Set(FACTIONS[this.faction].tabs.flatMap((t) => t.items).filter((k) => this.prereqsMet(k)));
    if (this.unlocked && [...unlocked].some((k) => !this.unlocked.has(k))) g.notify('New construction options', 'info', 0);
    this.unlocked = unlocked;
  }
}
