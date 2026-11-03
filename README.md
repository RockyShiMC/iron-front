# Iron Front

A classic-style real-time strategy game for the browser. Plain JavaScript (ES modules), HTML5 canvas, zero dependencies, and all graphics are drawn procedurally.

## Run

```bash
npm start
```

Then open http://localhost:8080. You only need Node; there is nothing to install. The page has to be served over HTTP because ES modules don't load from `file://`.

## Factions

Pick a side on the start screen; the AI plays a rival one.

**Syndicate** (third side): corporate mercenaries with laser weapons, hover vehicles and electronic warfare.

| | Syndicate |
|---|---|
| Power | Fusion Core (+200) |
| Infantry | Operative (fast, cheap SMG), Lancer (laser rifle, anti-armor), Specter (hero: cloaked until it fires or an enemy gets close, plants charges) |
| Vehicles | Skimmer (fast hover tank), Rail Platform (long-range railgun), Drone Miner (fast, armed) |
| Air | Wasp Drone (laser gunship), Interceptor (anti-air missile jet) |
| Navy | Hydrofoil, Laser Cruiser |
| Defenses | Laser Turret, Rail Cannon |
| Powers | EMP Burst from the Radar (shuts down enemy vehicles, aircraft and defenses for 12 s), Kinetic Strike superweapon (a salvo of orbital rods) |

## Campaign

Four short missions, each unlocking the next (progress is kept in the browser). Every mission opens with a briefing, shows its objectives in the top-left corner, and ends with a "Next mission" button when won.

| # | Mission | Side | Goal |
|---|---|---|---|
| 1 | First Light | Allies | No base: take a strike team through a Soviet outpost (reinforcements arrive at 1:30). Bonus: capture an oil derrick |
| 2 | Iron Line | Soviets | Hold out for 10 minutes against relentless Allied waves, and keep your Construction Yard alive |
| 3 | Black Gold | Syndicate | Capture both oil derricks with engineers, then destroy the Soviet Construction Yard |
| 4 | Ghost Protocol | Syndicate | Alone with the cloaked Specter: destroy the Missile Silo before it launches at 6:00 |

## Touch screens

On a tablet the game plays by touch, and a command bar appears for the keyboard-only orders (it can be forced on or off in Settings):

| Gesture | Action |
|---|---|
| Tap | Select / move / attack (like a left click) |
| One-finger drag | Scroll the map (while placing a building: move it) |
| Hold, then drag | Box select |
| Two-finger tap | Cancel / deselect (like a right click) |
| Drag on the minimap | Move the view |
| Hold a sidebar item | Cancel it |
| Command bar | Army (select all combat units), Attack-move, Force fire, Guard, Stop, Repair, Evacuate, Queue (next orders become waypoints) |

The layout is made for landscape tablets; phone screens are too small for the sidebar.

## Online play

`npm start` also runs the online relay. Press **Online** on the start screen:

1. One player picks a name and presses **Host a game**, and gets a 4-letter code
2. The others open the game from the **same server** and press **Join** with that code. On your home network, use the host computer's address that the server prints when it starts (for example `http://192.168.1.20:8080`)
3. The host picks the map, mode (1 vs 1 up to free for all) and computer difficulty. Everyone picks a side; any seat can be taken with **Sit here**; empty seats are played by the computer
4. The host presses **Start battle**

Battles are lockstep: only orders travel over the network (about 0.3 s from click to action), and every browser runs the identical battle. They compare fingerprints of their battles every few seconds and warn if they ever differ. If someone leaves, the battle carries on without them. Online battles can't be paused or saved; minimizing the game makes the other players wait until you're back. To play over the internet rather than a home network, the server has to be reachable by everyone (port forwarding or hosting it somewhere).

## Test mode

Tick **Test mode** on the start screen to open the test tools as soon as a battle starts, or press **F2** (or use **Test tools** in the pause menu) in any offline battle. They aren't available online or in replays; a "TEST MODE" badge shows once any tool has been used.

- **Speed**: 0.5× to 8×, skip ahead a minute, reveal the map
- **Money**: add or set credits for you or any computer player
- **Your cheats**: instant build (still paid for), invulnerable, unlimited power, unlock everything, build anywhere; charge your support powers
- **Spawn units**: any unit from any side, 1–20 at a time, for you or a computer player; click the map as often as you like
- **Place building**: any building, free and finished, for anyone
- **Selected**: heal, make elite, or destroy whatever is selected
- **Computer players**: Easy / Normal / Hard / Brutal presets, or adjust income, build speed, first attack time and wave interval live; make one passive (only defends) or frozen (makes no decisions). A readout shows its money, army size and next wave
- **Battle**: win or lose instantly (handy for campaign testing), plus time, tick, FPS and unit counts

Test actions are commands like any other, so replays and saves include them.

## Replays

Every battle you start (not loaded from a save) is recorded, and the last 10 are kept: open **Replays** on the start screen. Watch at 1×–8× with the whole map revealed, export a replay as a file, or import one. A replay is only the battle's seed plus your commands, so it stays small however long the battle ran.

This works because the simulation is deterministic: it advances in fixed 1/60 s ticks, all its randomness comes from the battle's seed, and every player action is a command applied at the start of a tick. The same groundwork lets online play run the same battle on every computer.

## Map editor

Open **Map editor** on the start screen. The map is shown as an isometric diamond, laid out like the game with north at the top.

- Start from a blank map (48, 64, 88 or 112 tiles) or a freshly generated random one, and pick a look: grassland, desert or snow
- Paint grass, water, rock and bridges (brush 1–5), add or clear ore
- Place 2–4 starting bases, oil derricks and civilian buildings; click one again to remove it. The number of bases decides which modes the map can host
- Save (kept in the browser), Save & play (starts a 1 vs 1 on it), Export / Import as a `.ironmap.json` file to share
- Saved maps appear in the Battlefield list with a dashed border

## Modes

| Mode | Players |
|---|---|
| 1 vs 1 | You against one computer |
| 1 vs 2 | You against two computers on the same team |
| 2 vs 2 | You and a computer ally against two computers; your ally starts next to you and you share vision |
| Free for all | Four sides, each on its own |

Random Skirmish grows to 88×88 for 3–4 players. World, China and USA have four bases; Korea only fits 1 vs 1. You lose when all your own forces are gone, and win when only your team is left.

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

It also reads your army: it builds whatever counters what you field (anti-tank infantry against armor, rifles against infantry, anti-air when you go heavy on aircraft, plus AA defenses), pulls nearly-dead attackers back for repairs, and splits bigger waves into a main assault and a flanking group that goes for your economy.

## What else is in it

- Isometric maps (random or geographic) with water, rock, desert and snow, ore fields and a shroud
- Economy: Ore Miners harvest ore and unload at refineries, and ore slowly grows back
- Power: running low on power halves production speed, takes base defenses offline and disables the radar
- Sidebar with Base / Infantry / Vehicles / Air / Navy tabs, build queues of up to 5 units, and building placement within range of your base
- Combat: warhead-vs-armor damage tables (bullet, shell, rocket, electric, prism), turrets that rotate, projectiles, instant Tesla bolts and Prism beams, splash damage, auto-targeting, units that fire back when attacked, and attack-move
- A* pathfinding with path smoothing, formation moves, and units pushing apart so they don't stack
- Terrain painted lazily in 8×8-tile chunks, so even the 120×120 World map starts in well under a second
- Sell, repair, rally points, control groups and a minimap
- Engineers (both sides) capture enemy buildings and the map's neutral Oil Derricks (steady income), fully repair your own buildings, and rebuild destroyed bridges
- Civilian buildings in the middle of the map: up to 5 infantry can occupy one and fire from inside (D or the Evacuate button to leave). If it collapses they bail out hurt
- Bridges across narrow water and lake shortcuts. Force fire destroys them (and whatever is on them); an engineer rebuilds them
- Walls: drag to lay a line; extra segments cost $50 each
- Service Depot repairs vehicles (the Shipyard repairs ships, airfields patch up aircraft). Click the depot with units selected, or press R
- Superweapons on a long timer, shown to both players: Allied Orbital Strike, Soviet Missile Strike. Support powers from the Radar: Allied Recon Sweep, Soviet Paradrop
- Heroes, one at a time: Allied Commando (sniper that kills infantry in one shot, plants demolition charges on buildings) and Soviet Iron Major (heavy machine gun, very tough). Both repair themselves
- Veterancy: units earn experience from what they destroy. Veterans (one chevron) and elites (two) deal more damage, take less, reload faster, and elites repair themselves
- Orders: Shift-click to queue waypoints, force fire on anything including the ground, and guard a spot or escort another unit
- Settings: game speed, scroll speed, sound and voice volume, and when to show health bars; remembered between battles
- Battle menu (Esc or the Menu button): pause, save, load, restart the same map, or quit to the main menu
- Save and load: five save slots kept in the browser's local storage. A save holds the whole battle (units, buildings, orders, build queues, ore, shroud, AI plans); the map itself is rebuilt from its seed. Saved battles can also be loaded from the start screen
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
| Shift + click | Queue waypoints |
| F, or Ctrl / ⌘ + click | Force fire at a target or the ground |
| G | Guard: click a unit to escort it, or a spot to hold |
| R | Send damaged vehicles / ships to be repaired |
| D | Evacuate a selected garrisoned building |
| Ctrl+1–9, 1–9 | Set / recall group (double tap to jump to it) |
| Esc | Battle menu (pause / save / load / restart / quit) |
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
| `src/missions.js` | Campaign missions, objectives and progress |
| `src/editor.js` | Map editor |
| `src/customMaps.js` | Storing, encoding and registering custom maps |
| `src/commands.js` | Player actions as commands (the only way players change the battle) |
| `src/replays.js` | Recording, storing, exporting and importing replays |
| `src/net.js` | Online lockstep: turns, waiting, desync checks |
| `src/testpanel.js` | Test mode tools |
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
