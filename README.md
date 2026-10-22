# Iron Front

A Red Alert 2–style real-time strategy game for the browser. Plain JavaScript (ES modules), HTML5 canvas, zero dependencies, and all graphics are drawn procedurally.

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

Shared structures: Construction Yard, Ore Refinery, Barracks, War Factory, Radar Tower. Prerequisites refer to *roles* (e.g. `power`), so a Tesla Reactor satisfies them just like a Power Plant does.

## What else is in it

- An isometric 64×64 map generated from a seed, with water, rock, ore fields and a shroud
- Economy: Ore Miners harvest ore and unload at refineries, and ore slowly grows back
- Power: running low on power halves production speed, takes base defenses offline and disables the radar
- RA2-style sidebar: Structures / Infantry / Vehicles tabs, build queues of up to 5 units, and building placement within range of your base
- Combat: warhead-vs-armor damage tables (bullet, shell, rocket, electric, prism), turrets that rotate, projectiles, instant Tesla bolts and Prism beams, splash damage, auto-targeting, units that fire back when attacked, and attack-move
- A* pathfinding with path smoothing, formation moves, and units pushing apart so they don't stack
- A skirmish AI that follows a build order, keeps its harvesters topped up, defends its base and sends attack waves that grow over time
- Sell, repair, rally points, control groups and a minimap
- Sound: every effect is synthesized live with the Web Audio API (guns, cannons, rockets, Tesla crackle, Prism hum, explosions, construction, chrono teleports, interface chirps). Battle sounds fade with distance from the screen center and pan left/right
- EVA announcements through the browser's speech synthesis (prefers a female English voice): "Construction complete", "Unit ready", "Our base is under attack", "Ore miner under attack", "Low power", "New construction options", "Insufficient funds", "Mission accomplished"… Toggle with M (sound) / V (EVA) or the sidebar buttons; the setting is remembered

## Controls

| Input | Action |
|---|---|
| Left click | Select / move / attack (RA2 scheme) |
| Drag | Box select |
| Right click | Deselect / cancel |
| Double click | Select all of that type on screen |
| A / S / Q | Attack-move / stop / select all combat units |
| Ctrl+1–9, 1–9 | Set / recall group (double tap to jump to it) |
| H | Jump to base |
| Arrows, screen edge, middle-drag | Scroll |
| P | Pause |
| M / V | Toggle sound effects / EVA voice |

## Code map

| File | Purpose |
|---|---|
| `src/config.js` | All game rules: units, buildings, weapons, warheads. **Start here for balance.** |
| `src/game.js` | World state and simulation loop, combat, placement, harvesting helpers |
| `src/entities.js` | `Unit` (orders, movement, attack, harvester state machine) and `Building` |
| `src/player.js` | Credits, power, production queues |
| `src/ai.js` | Skirmish AI |
| `src/map.js` | Terrain generation, ore, passability |
| `src/pathfinding.js` | A* on the tile grid plus line-of-sight smoothing |
| `src/renderer.js` | Isometric rendering, effects, shroud, minimap |
| `src/input.js` | Mouse/keyboard, selection, commands |
| `src/ui.js` | Sidebar DOM |
| `src/audio.js` | Synthesized sound recipes and EVA voice lines |

The simulation (`game.js` and everything it imports) doesn't touch the DOM, so it can run headless in Node. That's useful for AI-vs-AI balance tests.

## Roadmap ideas

- More faction units: Kirov Airship, IFV, Engineer, Spy, Tanya, V3 Launcher
- Unit voice responses ("Yes sir!", "Moving out") and music
- Sprite art (replacing the procedural shapes)
- Aircraft and naval units, walls, superweapons
- Engineers capturing buildings, veterancy
- Fog of war (re-hiding areas you can no longer see), not just the shroud
- More maps, map editor, difficulty levels
- Lockstep multiplayer (the simulation is already separate from rendering)
