# Iron Front

A classic-style real-time strategy game for the browser. Plain JavaScript (ES modules), HTML5 canvas, zero dependencies, and all graphics are drawn procedurally.

## Run

```bash
npm start
```

Then open http://localhost:8080. You only need Node; there is nothing to install. The page has to be served over HTTP because ES modules don't load from `file://`.

## Factions

Pick a side on the start screen; the AI plays the other one.

| | Allies | Soviets |
|---|---|---|
| Power | Power Plant (+100) | Tesla Reactor (+150) |
| Infantry | GI, Guardian GI (anti-armor rockets) | Conscript (cheap), Tesla Trooper (needs radar) |
| Vehicles | Grizzly Tank, Prism Tank (long-range beam, splash; needs radar) | Rhino Tank, Apocalypse Tank (twin cannons, self-repairs; needs radar) |
| Harvester | Chrono Miner: teleports back to the refinery, smaller loads | War Miner: armed with a machine gun, big loads, tough |
| Defenses | Pillbox (anti-infantry), Prism Tower (needs radar) | Sentry Gun (anti-infantry), Tesla Coil (needs radar) |

| Air (Airfield) | Hawk Gunship (hovers, rockets), Strike Jet (2 missiles, rearms at the airfield) | Storm Gunship (cannon, tough), Heavy Bomber (4 bombs, rearms) |
| Navy (Shipyard) | Patrol Boat (fast, anti-air guns), Missile Frigate (long range, anti-air) | Gunboat (armored), Battleship (very long-range shore bombardment) |

Shared structures: Construction Yard, Ore Refinery, Barracks, War Factory, Radar Tower, Airfield, Shipyard (built on water), AA Battery. Prerequisites refer to *roles* (e.g. `power`), so a Tesla Reactor satisfies them just like a Power Plant does.

Aircraft can only be hit by anti-air weapons: rifles and machine guns (weakly), rockets, AA Batteries (flak) and the Allied ships.

## Maps and difficulty

| Map | Size | Setup |
|---|---|---|
| Random Skirmish | 64×64 | A new noise-generated battlefield each time |
| World | 120×120 | Europe against East Asia; the Americas, Africa and Australia hold extra ore, reachable by sea or air |
| China | 96×96 | The western deserts against the east coast, with the Tian Shan, Gobi and the Tibetan plateau in between |
| Korea | 80×80 | North against south on a mountainous peninsula between two seas |
| USA | 96×96 | West coast against east coast, across the Rockies and the Great Plains |

The geographic maps are stylized outlines (coastlines, lakes, mountain ranges, deserts, snow) defined as lon/lat polygons in `src/maps.js` and rasterized with north at the top of the screen.

| Enemy | Behavior |
|---|---|
| Normal | First attack around 3½ minutes, then a wave roughly every 2 minutes |
| Hard | Attacks from about 2 minutes and every 75 s, raids your harvesters, harvests 35% more, builds 25% faster, starts with extra credits |

At both levels the AI rebuilds lost structures, keeps all its factories producing, defends its base, uses aircraft and ships, and gets a small credit trickle so it can't stall completely.

## What else is in it

- Isometric maps (random or geographic) with water, rock, desert and snow, ore fields and a shroud
- Economy: Ore Miners harvest ore and unload at refineries, and ore slowly grows back
- Power: running low on power halves production speed, takes base defenses offline and disables the radar
- Sidebar with Base / Infantry / Vehicles / Air / Navy tabs, build queues of up to 5 units, and building placement within range of your base
- Combat: warhead-vs-armor damage tables (bullet, shell, rocket, electric, prism), turrets that rotate, projectiles, instant Tesla bolts and Prism beams, splash damage, auto-targeting, units that fire back when attacked, and attack-move
- A* pathfinding with path smoothing, formation moves, and units pushing apart so they don't stack
- Terrain painted lazily in 8×8-tile chunks, so even the 120×120 World map starts in well under a second
- Sell, repair, rally points, control groups and a minimap
- Sound: every effect is synthesized live with the Web Audio API (guns, cannons, rockets, Tesla crackle, Prism hum, explosions, construction, chrono teleports, interface chirps). Battle sounds fade with distance from the screen center and pan left/right
- Procedural textures: the map is painted per pixel from noise (grass tones, dirt patches, sandy shores with foam, deep/shallow water with glints, rocky ground, faceted boulders, bushes, tufts, flowers); buildings have shaded walls, panel seams, windows, parapets and drop shadows; tanks have rolling treads, two-tier hulls, shaded turrets and muzzle brakes; ore is faceted crystal on stained soil
- Unit voice responses: every unit type has its own lines, pitch and speed for selection, move and attack orders (e.g. Conscript "For the Union!", Apocalypse "Annihilate them!"). EVA outranks unit chatter
- EVA announcements through the browser's speech synthesis (prefers a female English voice): "Construction complete", "Unit ready", "Our base is under attack", "Ore miner under attack", "Low power", "New construction options", "Insufficient funds", "Mission accomplished"… Toggle with M (sound) / V (EVA) or the sidebar buttons; the setting is remembered

## Controls

| Input | Action |
|---|---|
| Left click | Select / move / attack |
| Drag | Box select |
| Right click | Deselect / cancel |
| Double click | Select all of that type on screen |
| A / S / Q | Attack-move / stop / select all combat units |
| Ctrl+1–9, 1–9 | Set / recall group (double tap to jump to it) |
| H | Jump to base |
| Arrows, screen edge, middle-drag | Scroll |
| P | Pause |
| M / V / U | Toggle sound effects / EVA / unit voices |

## Code map

| File | Purpose |
|---|---|
| `src/config.js` | All game rules: units, buildings, weapons, warheads. **Start here for balance.** |
| `src/game.js` | World state and simulation loop, combat, placement, harvesting helpers |
| `src/entities.js` | `Unit` (orders, movement, attack, harvester state machine) and `Building` |
| `src/player.js` | Credits, power, production queues |
| `src/ai.js` | Skirmish AI |
| `src/maps.js` | Map catalog: geographic outlines, mountains, deserts, starts, ore |
| `src/map.js` | Terrain generation (random and geographic), ore, land/sea/air passability |
| `src/pathfinding.js` | A* on the tile grid plus line-of-sight smoothing |
| `src/renderer.js` | Isometric rendering, effects, shroud, minimap |
| `src/input.js` | Mouse/keyboard, selection, commands |
| `src/ui.js` | Sidebar DOM |
| `src/audio.js` | Synthesized sound recipes and EVA voice lines |

The simulation (`game.js` and everything it imports) doesn't touch the DOM, so it can run headless in Node. That's useful for AI-vs-AI balance tests.

## Roadmap ideas

- Original faction identities and names (replacing the ones inspired by classic games)
- Music
- Sprite art (replacing the procedural shapes)
- Walls, superweapons, engineers capturing buildings, veterancy
- Fog of war (re-hiding areas you can no longer see), not just the shroud
- More maps (Europe, Middle East…), a map editor, 3–4 player games
- Lockstep multiplayer (the simulation is already separate from rendering)
