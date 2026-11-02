// Campaign missions. Each one starts a normal skirmish on a fixed map, then setup()
// reshapes it. Objectives are checked a few times a second; the mission is won when
// every required one is done, and lost when you're wiped out or fail() says so.
// events fire once, when their time comes (at: seconds) or their condition is met.
import { BUILDINGS } from './config.js';

// ---------- helpers for setting the scene ----------
const enemy = (g) => g.players[1];
const base = (g, p) => { const s = g.map.starts[p.seat]; return { x: s.x + 1.5, y: s.y + 1.5 }; };

// Remove everything a player starts with
function clear(g, p) {
  for (const b of g.buildings) if (b.owner === p) { b.dead = true; g.removeBuilding(b); }
  for (const u of g.units) if (u.owner === p) u.dead = true;
  g.buildings = g.buildings.filter((b) => !b.dead);
  g.units = g.units.filter((u) => !u.dead);
}

// n units in a loose cluster around (x, y)
function spawn(g, p, key, x, y, n = 1) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = k * 2.4, r = 0.6 + k * 0.25;
    const t = g.map.nearestPassable(Math.floor(x + Math.cos(a) * r), Math.floor(y + Math.sin(a) * r), x, y);
    if (t) out.push(g.addUnit(p, key, t.x + 0.5, t.y + 0.5));
  }
  return out;
}

// A building on clear ground as close to (x, y) as possible (a mission can put one
// anywhere, so the usual build-near-your-base rule doesn't apply)
function build(g, p, key, x, y) {
  const def = BUILDINGS[key], m = g.map;
  const fits = (tx, ty) => {
    for (let yy = ty; yy < ty + def.h; yy++) for (let xx = tx; xx < tx + def.w; xx++) if (!m.isBuildable(xx, yy)) return false;
    return true;
  };
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = Math.round(x - def.w / 2) + dx, ty = Math.round(y - def.h / 2) + dy;
        if (fits(tx, ty)) return g.addBuilding(p, key, tx, ty, true);
      }
    }
  }
  return null;
}

const owns = (g, p, test) => g.buildings.some((b) => b.owner === p && test(b));
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export const MISSIONS = [
  {
    id: 'first-light',
    title: 'First Light',
    faction: 'allied',
    enemies: ['soviet'],
    map: 'random',
    seed: 4127,
    difficulty: 'normal',
    ai: 'passive',
    briefing: [
      'Commander, a Soviet forward outpost has dug in across the valley. It guards the only road to our supply depots.',
      'You have a small strike team and no base. Use the tanks to break the defenses and keep your infantry behind them.',
      'Reinforcements are on their way. An engineer is with you: the oil derricks in the valley would fund the rest of the war.',
    ],
    setup(g) {
      const h = g.human, e = enemy(g), hb = base(g, h), eb = base(g, e);
      clear(g, h);
      spawn(g, h, 'grizzly', hb.x + 2, hb.y + 2, 2);
      spawn(g, h, 'gi', hb.x, hb.y + 1, 5);
      spawn(g, h, 'engineer', hb.x - 1, hb.y + 2);
      clear(g, e);
      build(g, e, 'teslaReactor', eb.x, eb.y);
      build(g, e, 'barracks', eb.x - 3, eb.y);
      build(g, e, 'radar', eb.x, eb.y - 3);
      build(g, e, 'sentryGun', eb.x - 4, eb.y - 4);
      build(g, e, 'sentryGun', eb.x - 5, eb.y + 1);
      build(g, e, 'sentryGun', eb.x + 1, eb.y - 5);
      spawn(g, e, 'conscript', eb.x - 4, eb.y - 2, 6);
      spawn(g, e, 'rhino', eb.x - 3, eb.y - 3);
    },
    objectives: [
      { id: 'outpost', text: 'Destroy every Soviet structure', check: (g) => !owns(g, enemy(g), () => true) },
      { id: 'oil', text: 'Capture an oil derrick', optional: true, check: (g) => owns(g, g.human, (b) => b.def.income) },
    ],
    events: [
      {
        at: 90,
        run(g) {
          const hb = base(g, g.human);
          spawn(g, g.human, 'grizzly', hb.x + 1, hb.y + 1, 2);
          spawn(g, g.human, 'guardianGi', hb.x, hb.y, 3);
          g.notify('Reinforcements have arrived', 'info', 0);
        },
      },
    ],
  },

  {
    id: 'iron-line',
    title: 'Iron Line',
    faction: 'soviet',
    enemies: ['allied'],
    map: 'random',
    seed: 90210,
    difficulty: 'hard',
    ai: { firstAttack: 75, waveEvery: 55, waveMin: 5 },
    briefing: [
      'Comrade General, the Allies are throwing everything they have at our line. Our orders are simple: hold.',
      'Build your defenses fast. The first wave will arrive in little more than a minute, and they will keep coming.',
      'If the Construction Yard falls, the line falls with it. Survive for ten minutes and the counter-offensive will relieve you.',
    ],
    setup(g) {
      const h = g.human, hb = base(g, h);
      h.credits = 7000;
      build(g, h, 'teslaReactor', hb.x - 3, hb.y);
      build(g, h, 'barracks', hb.x + 3, hb.y);
      spawn(g, h, 'rhino', hb.x + 3, hb.y + 4, 2);
      spawn(g, h, 'conscript', hb.x + 1, hb.y + 4, 4);
    },
    objectives: [
      { id: 'survive', text: (g) => `Hold out: ${clock(Math.max(0, 600 - g.time))} left`, check: (g) => g.time >= 600 },
      { id: 'yard', text: 'Keep your Construction Yard standing', hold: true, check: (g) => owns(g, g.human, (b) => b.key === 'conyard') },
    ],
    fail: (g) => !owns(g, g.human, (b) => b.key === 'conyard') && 'The Construction Yard was destroyed.',
    events: [
      { at: 300, run: (g) => g.notify('Halfway there. Hold the line!', 'info', 0) },
      { at: 540, run: (g) => g.notify('One minute left!', 'info', 0) },
    ],
  },

  {
    id: 'black-gold',
    title: 'Black Gold',
    faction: 'syndicate',
    enemies: ['soviet'],
    map: 'china',
    seed: 777,
    difficulty: 'normal',
    briefing: [
      'Director, the board has approved the acquisition of the western oil fields. The Soviets disagree.',
      'Two derricks stand between our holdings and theirs. Send engineers to take both; their income will pay for the campaign.',
      'Then remove the competition: destroy the Soviet Construction Yard.',
    ],
    setup(g) {
      const h = g.human, hb = base(g, h);
      spawn(g, h, 'engineer', hb.x + 1, hb.y + 3, 2);
      spawn(g, h, 'skimmer', hb.x + 3, hb.y + 3, 2);
    },
    objectives: [
      { id: 'oil', text: (g) => `Capture 2 oil derricks (${g.buildings.filter((b) => b.def.income && b.owner === g.human).length}/2)`, check: (g) => g.buildings.filter((b) => b.def.income && b.owner === g.human).length >= 2 },
      { id: 'yard', text: 'Destroy the Soviet Construction Yard', check: (g) => !owns(g, enemy(g), (b) => b.key === 'conyard') },
    ],
  },

  {
    id: 'ghost-protocol',
    title: 'Ghost Protocol',
    faction: 'syndicate',
    enemies: ['soviet'],
    map: 'random',
    seed: 31337,
    difficulty: 'normal',
    ai: 'passive',
    briefing: [
      'Specter, the Soviets have finished a missile silo. It launches in six minutes, and the target is our headquarters.',
      'You go in alone. Stay cloaked: you stay hidden until you fire, or until you get right next to an enemy or a defense.',
      'Reach the silo, plant a charge and get out. If you are lost, the mission is lost.',
    ],
    setup(g) {
      const h = g.human, e = enemy(g), hb = base(g, h), eb = base(g, e);
      clear(g, h);
      spawn(g, h, 'specter', hb.x + 1, hb.y + 1);
      build(g, e, 'teslaReactor', eb.x - 3, eb.y);
      build(g, e, 'teslaReactor', eb.x, eb.y - 3);
      build(g, e, 'radar', eb.x - 3, eb.y - 3);
      build(g, e, 'barracks', eb.x + 3, eb.y - 3);
      build(g, e, 'factory', eb.x + 3, eb.y + 1);
      build(g, e, 'missileSilo', eb.x - 1, eb.y + 3);
      build(g, e, 'teslaCoil', eb.x - 6, eb.y - 1);
      build(g, e, 'sentryGun', eb.x - 5, eb.y - 5);
      build(g, e, 'sentryGun', eb.x - 1, eb.y - 7);
      spawn(g, e, 'conscript', eb.x - 5, eb.y - 2, 4);
      spawn(g, e, 'rhino', eb.x - 2, eb.y - 5, 2);
    },
    objectives: [
      { id: 'silo', text: (g) => `Destroy the Missile Silo (launch in ${clock(Math.max(0, 360 - g.time))})`, check: (g) => !owns(g, enemy(g), (b) => b.key === 'missileSilo') },
      { id: 'specter', text: 'The Specter must survive', hold: true, check: (g) => g.units.some((u) => u.owner === g.human && u.key === 'specter') },
    ],
    fail: (g) => (!g.units.some((u) => u.owner === g.human && u.key === 'specter') && 'The Specter was lost.')
      || (g.time >= 360 && owns(g, enemy(g), (b) => b.key === 'missileSilo') && 'The missile launched.'),
  },
];

export const missionById = (id) => MISSIONS.find((m) => m.id === id);

// Which missions you've finished, kept in the browser
const KEY = 'ironfront.campaign';
export function campaignProgress() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{"done":[]}'); } catch { return { done: [] }; }
}
export function markMissionDone(id) {
  const p = campaignProgress();
  if (!p.done.includes(id)) p.done.push(id);
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}
// A mission is open once the one before it is done
export function missionUnlocked(i) {
  return i === 0 || campaignProgress().done.includes(MISSIONS[i - 1].id);
}
