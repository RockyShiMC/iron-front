// Data-driven game rules. Tweak balance here.

export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;
export const MAP_SIZE = 64;
export const SIDEBAR_W = 220;
export const START_CREDITS = 5000;

// Damage multipliers: warhead -> armor class
export const WARHEADS = {
  bullet: { infantry: 1.0, vehicle: 0.25, building: 0.2, aircraft: 0.35, ship: 0.3 },
  shell: { infantry: 0.45, vehicle: 1.0, building: 0.75, aircraft: 0, ship: 1.0 },
  rocket: { infantry: 0.35, vehicle: 1.25, building: 0.6, aircraft: 1.0, ship: 1.1 },
  electric: { infantry: 1.3, vehicle: 0.9, building: 0.45, aircraft: 0.6, ship: 1.0 },
  prism: { infantry: 0.9, vehicle: 0.8, building: 1.3, aircraft: 0.5, ship: 0.9 },
  flak: { infantry: 0.4, vehicle: 0.1, building: 0.1, aircraft: 1.6, ship: 0.2 },
  bomb: { infantry: 0.6, vehicle: 1.0, building: 1.4, aircraft: 0, ship: 1.2 },
};

// projectile: tracer | bolt | beam | flak are instant hits; shell | rocket | bomb travel.
// splash: radius (tiles) that takes 50% damage. salvo: shots per trigger pull.
// air: can hit aircraft. ground: false = anti-air only.
export const WEAPONS = {
  rifle: { damage: 14, range: 4.5, cooldown: 0.9, warhead: 'bullet', projectile: 'tracer', air: true },
  conscriptRifle: { damage: 10, range: 4, cooldown: 0.9, warhead: 'bullet', projectile: 'tracer', air: true },
  rocket: { damage: 42, range: 5.5, cooldown: 2.2, warhead: 'rocket', projectile: 'rocket', speed: 8, air: true },
  teslaBolt: { damage: 40, range: 3.5, cooldown: 1.5, warhead: 'electric', projectile: 'bolt' },
  grizzlyCannon: { damage: 36, range: 5, cooldown: 1.4, warhead: 'shell', projectile: 'shell', speed: 14 },
  rhinoCannon: { damage: 48, range: 5, cooldown: 1.6, warhead: 'shell', projectile: 'shell', speed: 13 },
  apocCannon: { damage: 50, range: 5.5, cooldown: 2.2, warhead: 'shell', projectile: 'shell', speed: 13, salvo: 2 },
  prismBeam: { damage: 55, range: 7, cooldown: 3, warhead: 'prism', projectile: 'beam', splash: 1 },
  minigun: { damage: 10, range: 4, cooldown: 0.4, warhead: 'bullet', projectile: 'tracer', air: true },
  pillboxGun: { damage: 18, range: 5.5, cooldown: 0.5, warhead: 'bullet', projectile: 'tracer', air: true },
  sentryGun: { damage: 15, range: 6, cooldown: 0.45, warhead: 'bullet', projectile: 'tracer', air: true },
  prismTowerBeam: { damage: 90, range: 7.5, cooldown: 2.5, warhead: 'prism', projectile: 'beam', splash: 1.2 },
  teslaCoilBolt: { damage: 110, range: 6.5, cooldown: 2.4, warhead: 'electric', projectile: 'bolt' },
  aaFlak: { damage: 30, range: 7.5, cooldown: 0.6, warhead: 'flak', projectile: 'flak', air: true, ground: false },
  // aircraft (ammo: shots before returning to an airfield; omitted = unlimited)
  hawkRockets: { damage: 30, range: 4.5, cooldown: 1.0, warhead: 'rocket', projectile: 'rocket', speed: 10 },
  stormCannon: { damage: 42, range: 4.5, cooldown: 1.4, warhead: 'shell', projectile: 'shell', speed: 14 },
  strikeMissile: { damage: 95, range: 3.5, cooldown: 0.35, warhead: 'rocket', projectile: 'rocket', speed: 14 },
  heavyBomb: { damage: 120, range: 1.6, cooldown: 0.3, warhead: 'bomb', projectile: 'bomb', speed: 6, splash: 1.3 },
  // ships
  patrolGun: { damage: 14, range: 5.5, cooldown: 0.4, warhead: 'bullet', projectile: 'tracer', air: true },
  frigateMissile: { damage: 55, range: 8, cooldown: 2.5, warhead: 'rocket', projectile: 'rocket', speed: 11, air: true },
  gunboatCannon: { damage: 36, range: 5.5, cooldown: 1.5, warhead: 'shell', projectile: 'shell', speed: 13, air: false },
  battleshipGuns: { damage: 60, range: 10, cooldown: 4, warhead: 'shell', projectile: 'shell', speed: 11, salvo: 2, splash: 1.2 },
};

// category: which sidebar tab / which factory produces it. faction: omitted = both sides.
// look / gear / barrels: how the renderer draws it.
export const UNITS = {
  // ---- Allied ----
  gi: {
    name: 'GI', faction: 'allied', category: 'infantry', cost: 200, time: 5, hp: 125, speed: 1.3,
    sight: 6, armor: 'infantry', weapon: 'rifle', radius: 0.15, prereq: ['barracks'], gear: 'rifle',
  },
  guardianGi: {
    name: 'Guardian GI', faction: 'allied', category: 'infantry', cost: 400, time: 7, hp: 110, speed: 1.2,
    sight: 6, armor: 'infantry', weapon: 'rocket', radius: 0.15, prereq: ['barracks'], gear: 'rocket',
  },
  grizzly: {
    name: 'Grizzly Tank', faction: 'allied', category: 'vehicle', cost: 700, time: 10, hp: 320, speed: 2.3,
    sight: 7, armor: 'vehicle', weapon: 'grizzlyCannon', turret: true, radius: 0.35, size: 0.42,
    look: 'tank', barrels: 1, prereq: ['factory'],
  },
  prismTank: {
    name: 'Prism Tank', faction: 'allied', category: 'vehicle', cost: 1200, time: 14, hp: 220, speed: 1.8,
    sight: 8, armor: 'vehicle', weapon: 'prismBeam', turret: true, radius: 0.38, size: 0.45,
    look: 'prism', prereq: ['factory', 'radar'],
  },
  chronoMiner: {
    name: 'Chrono Miner', faction: 'allied', category: 'vehicle', cost: 1400, time: 14, hp: 600, speed: 1.6,
    sight: 5, armor: 'vehicle', harvester: true, chrono: true, capacity: 450, radius: 0.4, size: 0.5,
    look: 'harvester', prereq: ['factory', 'refinery'],
  },
  // ---- Soviet ----
  conscript: {
    name: 'Conscript', faction: 'soviet', category: 'infantry', cost: 100, time: 3.5, hp: 100, speed: 1.25,
    sight: 6, armor: 'infantry', weapon: 'conscriptRifle', radius: 0.15, prereq: ['barracks'], gear: 'rifle',
  },
  teslaTrooper: {
    name: 'Tesla Trooper', faction: 'soviet', category: 'infantry', cost: 500, time: 8, hp: 150, speed: 1.0,
    sight: 6, armor: 'infantry', weapon: 'teslaBolt', radius: 0.17, prereq: ['barracks', 'radar'], gear: 'tesla',
  },
  rhino: {
    name: 'Rhino Tank', faction: 'soviet', category: 'vehicle', cost: 900, time: 12, hp: 420, speed: 1.8,
    sight: 7, armor: 'vehicle', weapon: 'rhinoCannon', turret: true, radius: 0.38, size: 0.48,
    look: 'tank', barrels: 1, prereq: ['factory'],
  },
  apocalypse: {
    name: 'Apocalypse Tank', faction: 'soviet', category: 'vehicle', cost: 1750, time: 18, hp: 800, speed: 1.2,
    sight: 7, armor: 'vehicle', weapon: 'apocCannon', turret: true, radius: 0.5, size: 0.62,
    look: 'tank', barrels: 2, selfHeal: 4, prereq: ['factory', 'radar'],
  },
  warMiner: {
    name: 'War Miner', faction: 'soviet', category: 'vehicle', cost: 1400, time: 14, hp: 900, speed: 1.6,
    sight: 5, armor: 'vehicle', harvester: true, capacity: 900, mineRate: 55, weapon: 'minigun', turret: true,
    radius: 0.42, size: 0.55, look: 'harvester', prereq: ['factory', 'refinery'],
  },

  // ---- Air (domain 'air': fly over everything, only anti-air weapons can hit them) ----
  hawkGunship: {
    name: 'Hawk Gunship', faction: 'allied', category: 'air', domain: 'air', cost: 1000, time: 12, hp: 220,
    speed: 3.6, sight: 8, armor: 'aircraft', weapon: 'hawkRockets', radius: 0.4, size: 0.45, look: 'heli',
    prereq: ['airfield'],
  },
  strikeJet: {
    name: 'Strike Jet', faction: 'allied', category: 'air', domain: 'air', cost: 1300, time: 14, hp: 180,
    speed: 6, sight: 7, armor: 'aircraft', weapon: 'strikeMissile', ammo: 2, radius: 0.4, size: 0.5, look: 'jet',
    prereq: ['airfield'],
  },
  stormGunship: {
    name: 'Storm Gunship', faction: 'soviet', category: 'air', domain: 'air', cost: 1100, time: 13, hp: 320,
    speed: 2.9, sight: 8, armor: 'aircraft', weapon: 'stormCannon', radius: 0.45, size: 0.55, look: 'heli',
    prereq: ['airfield'],
  },
  heavyBomber: {
    name: 'Heavy Bomber', faction: 'soviet', category: 'air', domain: 'air', cost: 1600, time: 16, hp: 380,
    speed: 3.8, sight: 7, armor: 'aircraft', weapon: 'heavyBomb', ammo: 4, radius: 0.55, size: 0.7, look: 'bomber',
    prereq: ['airfield'],
  },

  // ---- Navy (domain 'sea': water only) ----
  patrolBoat: {
    name: 'Patrol Boat', faction: 'allied', category: 'naval', domain: 'sea', cost: 600, time: 8, hp: 300,
    speed: 3.2, sight: 7, armor: 'ship', weapon: 'patrolGun', turret: true, radius: 0.4, size: 0.5,
    look: 'boat', prereq: ['shipyard'],
  },
  missileFrigate: {
    name: 'Missile Frigate', faction: 'allied', category: 'naval', domain: 'sea', cost: 1300, time: 14, hp: 550,
    speed: 2.2, sight: 9, armor: 'ship', weapon: 'frigateMissile', turret: true, radius: 0.55, size: 0.8,
    look: 'frigate', prereq: ['shipyard', 'radar'],
  },
  gunboat: {
    name: 'Gunboat', faction: 'soviet', category: 'naval', domain: 'sea', cost: 700, time: 9, hp: 450,
    speed: 2.6, sight: 7, armor: 'ship', weapon: 'gunboatCannon', turret: true, radius: 0.45, size: 0.55,
    look: 'boat', prereq: ['shipyard'],
  },
  battleship: {
    name: 'Battleship', faction: 'soviet', category: 'naval', domain: 'sea', cost: 2000, time: 20, hp: 1200,
    speed: 1.4, sight: 9, armor: 'ship', weapon: 'battleshipGuns', turret: true, radius: 0.7, size: 1.0,
    look: 'battleship', prereq: ['shipyard', 'radar'],
  },
};

// role: what prerequisite / AI build slot the building fills (defaults to its key).
// Unit voice responses: spoken when selected, moved, or ordered to attack.
// pitch / rate shape each unit's voice; 'male' prefers a male system voice.
export const VOICES = {
  gi: {
    pitch: 1.05, rate: 1.15, male: true,
    select: ['GI reporting.', 'Standing by.', 'Ready for action.', 'Yes sir?'],
    move: ['Moving out.', 'On my way.', 'Double time!', 'Roger that.'],
    attack: ['Engaging!', 'Open fire!', 'Light them up!', 'Taking the shot.'],
  },
  guardianGi: {
    pitch: 0.9, rate: 1.05, male: true,
    select: ['Guardian on station.', 'Anti-armor ready.', 'Point me at a tank.'],
    move: ['Repositioning.', 'Moving to cover.', 'Got it.'],
    attack: ['Rockets away!', 'Tank spotted, firing!', 'Bring it down!'],
  },
  grizzly: {
    pitch: 0.75, rate: 1.05, male: true,
    select: ['Grizzly ready.', 'Armor standing by.', 'Tank crew here.'],
    move: ['Rolling out.', 'Moving into position.', 'Treads turning.'],
    attack: ['Target acquired!', 'Fire the main gun!', 'Engaging target.'],
  },
  prismTank: {
    pitch: 1.2, rate: 1.0, male: false,
    select: ['Prism tank charged.', 'Focusing light.', 'Crystal aligned.'],
    move: ['Adjusting position.', 'Changing angle.', 'Relocating.'],
    attack: ['Beam locked on!', 'Refracting!', 'Concentrate the light!'],
  },
  chronoMiner: {
    pitch: 1.0, rate: 1.0, male: false,
    select: ['Chrono miner ready.', 'Ready to harvest.', 'Phase drive online.'],
    move: ['Proceeding.', 'Coordinates locked.', 'On it.'],
    attack: ['I am a miner, not a fighter.', 'Unarmed, sir!'],
  },
  conscript: {
    pitch: 1.15, rate: 1.2, male: true,
    select: ['Conscript reporting!', 'For the Union!', 'Orders, comrade?', 'Ready!'],
    move: ['Moving!', 'Right away, comrade!', 'Forward!', 'Da!'],
    attack: ['For the Motherland!', 'Attack!', 'Ura!', 'Fire!'],
  },
  teslaTrooper: {
    pitch: 0.55, rate: 0.9, male: true,
    select: ['Tesla trooper online.', 'Coils charged.', 'Power at maximum.'],
    move: ['Advancing.', 'Charging forward.', 'Moving out.'],
    attack: ['Electrify them!', 'Full voltage!', 'Shock and destroy!'],
  },
  rhino: {
    pitch: 0.6, rate: 1.0, male: true,
    select: ['Rhino tank ready.', 'Heavy armor here.', 'Awaiting orders, comrade.'],
    move: ['Advancing.', 'Moving out.', 'Full speed ahead.'],
    attack: ['Crush them!', 'Fire!', 'Destroy the enemy!'],
  },
  apocalypse: {
    pitch: 0.35, rate: 0.82, male: true,
    select: ['Apocalypse ready.', 'The end has come.', 'Give me a target.'],
    move: ['Unstoppable.', 'Nothing will stand in our way.', 'Rolling forward.'],
    attack: ['Annihilate them!', 'Total destruction!', 'Leave nothing standing!'],
  },
  warMiner: {
    pitch: 0.7, rate: 0.95, male: true,
    select: ['War miner operational.', 'Ore and bullets, comrade.', 'Ready to dig.'],
    move: ['Moving to ore.', 'Proceeding.', 'On the way.'],
    attack: ['Weapons free!', 'Defending the ore!', 'Open fire!'],
  },
  hawkGunship: {
    pitch: 1.0, rate: 1.15, male: true,
    select: ['Hawk on station.', 'Rotors spinning.', 'Gunship ready.'],
    move: ['Flying there now.', 'Roger, inbound.', 'Changing heading.'],
    attack: ['Rockets hot!', 'Strafing run!', 'Target in sight!'],
  },
  strikeJet: {
    pitch: 1.1, rate: 1.25, male: true,
    select: ['Strike jet, standing by.', 'Ready to scramble.', 'Fueled and armed.'],
    move: ['Afterburners on.', 'Roger that.', 'Vectoring.'],
    attack: ['Missiles away!', 'Going in hot!', 'Target locked!'],
  },
  stormGunship: {
    pitch: 0.7, rate: 1.0, male: true,
    select: ['Storm gunship ready.', 'Heavy rotor here.', 'Orders, comrade?'],
    move: ['Flying.', 'Course set.', 'Moving in.'],
    attack: ['Cannon firing!', 'Rain fire on them!', 'Attack run!'],
  },
  heavyBomber: {
    pitch: 0.5, rate: 0.9, male: true,
    select: ['Heavy bomber ready.', 'Bomb bay loaded.', 'Awaiting target.'],
    move: ['Proceeding.', 'Holding course.', 'Flying high.'],
    attack: ['Bombs away!', 'Carpet them!', 'Payload released!'],
  },
  patrolBoat: {
    pitch: 1.05, rate: 1.15, male: true,
    select: ['Patrol boat ready.', 'On the water.', 'Captain here.'],
    move: ['Full speed.', 'Setting course.', 'Aye aye.'],
    attack: ['Guns blazing!', 'Engaging!', 'Open fire!'],
  },
  missileFrigate: {
    pitch: 0.85, rate: 1.0, male: false,
    select: ['Frigate on station.', 'Missiles armed.', 'Radar sweep clear.'],
    move: ['Changing course.', 'Underway.', 'Plotting a route.'],
    attack: ['Missiles launched!', 'Target tracked!', 'Firing solution ready!'],
  },
  gunboat: {
    pitch: 0.8, rate: 1.05, male: true,
    select: ['Gunboat ready.', 'Crew at stations.', 'Orders, comrade?'],
    move: ['Sailing.', 'Ahead full.', 'Da, moving.'],
    attack: ['Fire the cannon!', 'Sink them!', 'Attack!'],
  },
  battleship: {
    pitch: 0.4, rate: 0.85, male: true,
    select: ['Battleship ready.', 'Main guns loaded.', 'The fleet awaits.'],
    move: ['All ahead.', 'Steady as she goes.', 'Coming about.'],
    attack: ['Broadside!', 'Bombard the shore!', 'Fire all guns!'],
  },
};

// Lines any unit of a side can use, mixed in with its own so responses vary more.
// 'annoyed' plays when the player keeps clicking the same unit.
export const VOICE_COMMON = {
  allied: {
    select: ['Ready.', 'Yes, commander?', 'Awaiting orders.', 'Reporting.', 'Standing by.', 'What do you need?'],
    move: ['Acknowledged.', 'Affirmative.', 'Moving.', 'You got it.', 'On the double.'],
    attack: ['Engaging.', 'Attacking.', 'Weapons hot.', 'Going in.'],
    annoyed: ['I heard you the first time.', 'Yes, yes, I am ready.', 'Is there a problem, commander?', 'Do you mind?'],
  },
  soviet: {
    select: ['Ready, comrade.', 'Da?', 'Awaiting orders.', 'Reporting for duty.', 'For the Union.', 'Yes, comrade general?'],
    move: ['Da!', 'Moving.', 'As you command.', 'Right away.', 'Understood.'],
    attack: ['Attacking!', 'For the Motherland!', 'Destroy them!', 'No mercy!'],
    annoyed: ['I am ready, comrade!', 'Enough clicking!', 'You test my patience.', 'Comrade, please.'],
  },
};

// AI toughness. think: seconds between decisions; firstAttack / waveEvery: seconds;
// income / build: multipliers on harvesting and production speed;
// trickle: credits per second so the AI never stalls completely.
export const DIFFICULTY = {
  normal: {
    name: 'Normal', think: 1.2, firstAttack: 210, waveMin: 6, waveEvery: 110, maxWave: 14,
    income: 1, build: 1, bonusCredits: 0, trickle: 3, raids: false, airNavyShare: 0.25,
  },
  hard: {
    name: 'Hard', think: 0.7, firstAttack: 140, waveMin: 7, waveEvery: 75, maxWave: 22,
    income: 1.35, build: 1.25, bonusCredits: 2500, trickle: 6, raids: true, airNavyShare: 0.4,
  },
};

export const BUILDINGS = {
  conyard: {
    name: 'Construction Yard', w: 3, h: 3, hp: 2000, cost: 3000, power: 0, sight: 7,
    height: 30, buildable: false, produces: 'building',
  },
  refinery: {
    name: 'Ore Refinery', w: 3, h: 3, hp: 1000, cost: 2000, time: 14, power: -40, sight: 6,
    height: 26, prereq: ['power'], freeHarvester: true,
  },
  barracks: {
    name: 'Barracks', w: 2, h: 2, hp: 600, cost: 500, time: 7, power: -20, sight: 5,
    height: 20, prereq: ['power'], produces: 'infantry',
  },
  factory: {
    name: 'War Factory', w: 3, h: 3, hp: 1200, cost: 2000, time: 14, power: -30, sight: 5,
    height: 30, prereq: ['refinery'], produces: 'vehicle',
  },
  radar: {
    name: 'Radar Tower', w: 2, h: 2, hp: 800, cost: 1000, time: 10, power: -50, sight: 9,
    height: 24, prereq: ['refinery'],
  },
  // ---- Allied ----
  power: {
    name: 'Power Plant', faction: 'allied', w: 2, h: 2, hp: 750, cost: 800, time: 8, power: 100, sight: 5,
    height: 22, prereq: ['conyard'],
  },
  pillbox: {
    name: 'Pillbox', faction: 'allied', role: 'defense', w: 1, h: 1, hp: 450, cost: 500, time: 7, power: -10,
    sight: 6, height: 12, weapon: 'pillboxGun', prereq: ['barracks'],
  },
  prismTower: {
    name: 'Prism Tower', faction: 'allied', role: 'advDefense', w: 1, h: 1, hp: 600, cost: 1500, time: 14,
    power: -75, sight: 8, height: 46, weapon: 'prismTowerBeam', prereq: ['radar'],
  },
  // ---- Soviet ----
  teslaReactor: {
    name: 'Tesla Reactor', faction: 'soviet', role: 'power', w: 2, h: 2, hp: 900, cost: 900, time: 9,
    power: 150, sight: 5, height: 22, prereq: ['conyard'],
  },
  sentryGun: {
    name: 'Sentry Gun', faction: 'soviet', role: 'defense', w: 1, h: 1, hp: 450, cost: 500, time: 7, power: -10,
    sight: 6, height: 14, weapon: 'sentryGun', prereq: ['barracks'],
  },
  teslaCoil: {
    name: 'Tesla Coil', faction: 'soviet', role: 'advDefense', w: 1, h: 1, hp: 650, cost: 1500, time: 14,
    power: -75, sight: 7, height: 44, weapon: 'teslaCoilBolt', prereq: ['radar'],
  },
  // ---- Shared: air, sea, anti-air ----
  airfield: {
    name: 'Airfield', w: 3, h: 3, hp: 1000, cost: 1500, time: 14, power: -40, sight: 6,
    height: 8, prereq: ['radar'], produces: 'air',
  },
  shipyard: {
    name: 'Shipyard', w: 3, h: 3, hp: 1200, cost: 1500, time: 14, power: -30, sight: 6,
    height: 22, prereq: ['refinery'], produces: 'naval', naval: true, // must be built on water
  },
  aaBattery: {
    name: 'AA Battery', role: 'aaDefense', w: 1, h: 1, hp: 500, cost: 700, time: 9, power: -20, sight: 8,
    height: 14, weapon: 'aaFlak', prereq: ['barracks'],
  },
};

export const FACTIONS = {
  allied: {
    name: 'Allies',
    color: '#3d82e0',
    blurb: 'Fast, high-tech forces. Prism weaponry and teleporting Chrono Miners.',
    harvester: 'chronoMiner',
    start: { tank: 'grizzly', infantry: 'gi' },
    tabs: [
      { id: 'building', label: 'Base', items: ['power', 'refinery', 'barracks', 'factory', 'radar', 'airfield', 'shipyard', 'pillbox', 'prismTower', 'aaBattery'] },
      { id: 'infantry', label: 'Infantry', items: ['gi', 'guardianGi'] },
      { id: 'vehicle', label: 'Vehicles', items: ['grizzly', 'prismTank', 'chronoMiner'] },
      { id: 'air', label: 'Air', items: ['hawkGunship', 'strikeJet'] },
      { id: 'naval', label: 'Navy', items: ['patrolBoat', 'missileFrigate'] },
    ],
  },
  soviet: {
    name: 'Soviets',
    color: '#d8392b',
    blurb: 'Heavy armor and Tesla technology. Cheap infantry, armed War Miners.',
    harvester: 'warMiner',
    start: { tank: 'rhino', infantry: 'conscript' },
    tabs: [
      { id: 'building', label: 'Base', items: ['teslaReactor', 'refinery', 'barracks', 'factory', 'radar', 'airfield', 'shipyard', 'sentryGun', 'teslaCoil', 'aaBattery'] },
      { id: 'infantry', label: 'Infantry', items: ['conscript', 'teslaTrooper'] },
      { id: 'vehicle', label: 'Vehicles', items: ['rhino', 'apocalypse', 'warMiner'] },
      { id: 'air', label: 'Air', items: ['stormGunship', 'heavyBomber'] },
      { id: 'naval', label: 'Navy', items: ['gunboat', 'battleship'] },
    ],
  },
};

// Look up the faction's building that fills a role (e.g. 'power' -> 'teslaReactor').
export function keyForRole(faction, role) {
  for (const [k, d] of Object.entries(BUILDINGS)) {
    if ((d.role || k) === role && (!d.faction || d.faction === faction)) return k;
  }
  return null;
}

export function defOf(key) {
  return UNITS[key] || BUILDINGS[key];
}
