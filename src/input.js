import { BUILDINGS } from './config.js';
import { settings } from './settings.js';

const EDGE = 14;
const SCROLL_SPEED = 900;

// RA2-style controls: left click selects / commands, right click deselects or cancels.
export class Input {
  constructor(canvas, game, renderer, signal) {
    this.signal = signal; // aborted when the battle ends, removing every listener
    this.canvas = canvas;
    this.g = game;
    this.r = renderer;
    this.selection = [];
    this.hover = null;
    this.dragRect = null;
    this.placing = null; // { key, tx, ty }
    this.mode = null; // 'sell' | 'repair' | 'attackmove' | 'forcefire' | 'guard' | 'power'
    this.power = null; // support power being aimed
    this.wallLine = null; // tiles of a wall being dragged out
    this.markers = [];
    this.groups = {};
    this.mouse = { x: 0, y: 0, inside: false };
    this.down = null;
    this.pan = null;
    this.keys = new Set();
    this.lastClick = { time: 0, key: null };
    this.lastGroupKey = { time: 0, n: null };
    this.paused = false;
    this.enabled = false; // set once the match starts
    this.bind();
  }

  bind() {
    const c = this.canvas;
    const opts = { signal: this.signal };
    c.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    c.addEventListener('mousedown', (e) => {
      const p = this.local(e);
      if (e.button === 0) this.down = { x: p.x, y: p.y };
      else if (e.button === 1) { e.preventDefault(); this.pan = { x: p.x, y: p.y }; }
      else if (e.button === 2) this.cancel();
    }, opts);
    window.addEventListener('mousemove', (e) => {
      const p = this.local(e);
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      this.mouse.inside = p.x >= 0 && p.y >= 0 && p.x < this.r.viewW && p.y < this.r.viewH;
      if (this.pan) {
        this.r.cam.x -= p.x - this.pan.x;
        this.r.cam.y -= p.y - this.pan.y;
        this.r.clampCam();
        this.pan = { x: p.x, y: p.y };
      }
      if (this.down && this.placing && BUILDINGS[this.placing.key].wall) this.wallLine = this.wallTiles(this.down, p);
      if (this.down && Math.hypot(p.x - this.down.x, p.y - this.down.y) > 6 && !this.placing) {
        const x = Math.min(p.x, this.down.x), y = Math.min(p.y, this.down.y);
        this.dragRect = { x, y, w: Math.abs(p.x - this.down.x), h: Math.abs(p.y - this.down.y) };
      }
    }, opts);
    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) this.pan = null;
      if (e.button !== 0 || !this.down) return;
      if (this.dragRect) this.boxSelect(this.dragRect, e.shiftKey);
      else if (this.wallLine && this.wallLine.length > 1) this.placeWalls(this.wallLine);
      else this.click(this.down.x, this.down.y, e);
      this.down = null;
      this.dragRect = null;
      this.wallLine = null;
    }, opts);
    c.addEventListener('mouseleave', () => { this.mouse.inside = false; }, opts);
    window.addEventListener('keydown', (e) => this.keyDown(e), opts);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key), opts);
    window.addEventListener('blur', () => this.keys.clear(), opts);
  }

  local(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  ownUnits() {
    return this.selection.filter((e) => e.isUnit && e.owner === this.g.human);
  }

  // The unit that answers for a group: the most expensive one
  spokesman(units) {
    let best = null;
    for (const u of units) if (!best || u.def.cost > best.def.cost) best = u;
    return best;
  }

  cancel() {
    if (this.placing) this.placing = null;
    else if (this.mode) this.mode = null;
    else this.selection = [];
  }

  startPlacing(key) {
    this.mode = null;
    this.placing = { key, tx: 0, ty: 0 };
    this.updatePlacing();
  }

  updatePlacing() {
    if (!this.placing) return;
    const def = BUILDINGS[this.placing.key];
    const w = this.r.toWorld(this.mouse.x, this.mouse.y);
    this.placing.tx = Math.floor(w.x) - Math.floor(def.w / 2);
    this.placing.ty = Math.floor(w.y) - Math.floor(def.h / 2);
  }

  // Tiles in a straight line (along whichever axis moved more) between two screen points
  wallTiles(a, b) {
    const wa = this.r.toWorld(a.x, a.y), wb = this.r.toWorld(b.x, b.y);
    const ax = Math.floor(wa.x), ay = Math.floor(wa.y), bx = Math.floor(wb.x), by = Math.floor(wb.y);
    const tiles = [];
    if (Math.abs(bx - ax) >= Math.abs(by - ay)) for (let x = ax; x !== bx + Math.sign(bx - ax || 1); x += Math.sign(bx - ax || 1)) tiles.push({ x, y: ay });
    else for (let y = ay; y !== by + Math.sign(by - ay); y += Math.sign(by - ay)) tiles.push({ x: ax, y });
    return tiles.slice(0, 16);
  }

  // The first segment uses the finished wall; each extra one is paid for on the spot
  placeWalls(tiles) {
    const g = this.g, key = this.placing.key;
    if (!g.canPlace(g.human, key, tiles[0].x, tiles[0].y)) { g.notify("Can't build there", 'warn', 1); g.sound('error'); return; }
    this.placing = null;
    g.command({ type: 'walls', key, tiles: tiles.map((t) => [t.x, t.y]) });
  }

  // Shorthand: the ids of a list of entities
  ids(list) { return list.map((e) => e.id); }

  addMarker(x, y, color) {
    this.markers.push({ x, y, color, life: 0.6 });
  }

  // ---------- picking ----------
  pick(sx, sy) {
    const g = this.g, r = this.r;
    let best = null, bd = -Infinity;
    for (const u of g.units) {
      if (u.owner !== g.human && !g.isExplored(u.x, u.y)) continue;
      if (g.hidden(u) && !g.allied(u.owner, g.human)) continue;
      const rc = r.entityRect(u);
      const depth = u.x + u.y + (u.isAir && u.z > 4 ? 1000 : 0); // flying aircraft are on top
      if (sx >= rc.x && sx <= rc.x + rc.w && sy >= rc.y && sy <= rc.y + rc.h && depth > bd) {
        bd = depth;
        best = u;
      }
    }
    if (best) return best;
    for (const b of g.buildings) {
      if (!g.isExplored(b.x, b.y)) continue;
      const H = b.def.height;
      const s = (x, y, z) => r.toScreen(x, y, z);
      const poly = [
        s(b.tx, b.ty + b.h, 0), s(b.tx + b.w, b.ty + b.h, 0), s(b.tx + b.w, b.ty, 0),
        s(b.tx + b.w, b.ty, H), s(b.tx, b.ty, H), s(b.tx, b.ty + b.h, H),
      ];
      if (pointInPoly(sx, sy, poly) && b.tx + b.ty > bd) {
        bd = b.tx + b.ty;
        best = b;
      }
    }
    return best;
  }

  boxSelect(rect, add) {
    const g = this.g;
    const picked = g.units.filter((u) => {
      if (u.owner !== g.human) return false;
      const p = this.r.toScreen(u.x, u.y, (u.isAir ? u.z : 0) + 6);
      return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
    });
    if (add) {
      for (const u of picked) if (!this.selection.includes(u)) this.selection.push(u);
    } else {
      this.selection = picked;
    }
    if (picked.length) { g.sound('select'); g.voice(this.spokesman(picked), 'select'); }
  }

  // ---------- clicking ----------
  click(sx, sy, e) {
    const g = this.g;
    const w = this.r.toWorld(sx, sy);

    if (this.placing) {
      const { key, tx, ty } = this.placing;
      if (g.canPlace(g.human, key, tx, ty)) { g.command({ type: 'place', key, x: tx, y: ty }); this.placing = null; }
      else { g.notify("Can't build there", 'warn', 1); g.sound('error'); }
      return;
    }

    const ent = this.pick(sx, sy);
    const human = g.human;

    if (this.mode === 'sell') {
      if (ent && ent.isBuilding && ent.owner === human) g.command({ type: 'sell', t: ent.id });
      return;
    }
    if (this.mode === 'repair') {
      if (ent && ent.isBuilding && ent.owner === human && ent.hp < ent.maxHp) {
        g.command({ type: 'repairBuilding', t: ent.id });
        g.sound('click');
      } else {
        g.sound('error');
      }
      return;
    }

    if (this.mode === 'power') {
      this.mode = null;
      g.command({ type: 'power', power: this.power, x: w.x, y: w.y });
      this.addMarker(w.x, w.y, '#ff4040');
      this.power = null;
      return;
    }

    const units = this.ownUnits();

    // Force fire (F, or Ctrl / Cmd + click): shoot whatever is there, even the ground
    if (units.length && (this.mode === 'forcefire' || e.ctrlKey || e.metaKey)) {
      this.mode = null;
      const target = ent && !units.includes(ent) ? ent : { isGround: true, x: w.x, y: w.y, dead: false, hp: 1, maxHp: 1 };
      const able = units.filter((u) => g.canHit(u.weapon, target));
      g.command(target.isGround ? { type: 'attack', u: this.ids(able), gx: w.x, gy: w.y } : { type: 'attack', u: this.ids(able), t: target.id });
      this.addMarker(w.x, w.y, '#ff4040');
      if (able.length) { g.sound('attack'); g.voice(this.spokesman(able), 'attack'); }
      return;
    }

    if (this.mode === 'guard') {
      this.mode = null;
      if (!units.length) return;
      const ally = ent && ent.isUnit && ent.owner === human && !units.includes(ent) ? ent : null;
      g.command({ type: 'guard', u: this.ids(units), x: w.x, y: w.y, ...(ally ? { t: ally.id } : {}) });
      this.addMarker(ally ? ally.x : w.x, ally ? ally.y : w.y, '#6ab0ff');
      g.sound('move');
      g.voice(this.spokesman(units), 'move');
      return;
    }

    if (this.mode === 'attackmove') {
      this.mode = null;
      if (!units.length) return;
      if (ent && g.hostile(ent.owner, human)) this.attack(units, ent);
      else {
        g.command({ type: 'move', mode: 'attackmove', u: this.ids(units), x: w.x, y: w.y, q: e.shiftKey });
        this.addMarker(w.x, w.y, '#ff6060');
        g.sound('attack');
        g.voice(this.spokesman(units), 'attack');
      }
      return;
    }

    if (units.length && !e.shiftKey && this.special(units, ent, w)) return;

    if (ent && ent.owner === human) {
      const harvesters = units.filter((u) => u.def.harvester);
      if (ent.key === 'refinery' && harvesters.length && !e.shiftKey) {
        g.command({ type: 'dock', u: this.ids(harvesters), t: ent.id });
        this.addMarker(ent.x, ent.y, '#e8c547');
        g.sound('move');
        g.voice(this.spokesman(harvesters), 'move');
        return;
      }
      const now = performance.now();
      if (ent.isUnit && this.lastClick.key === ent.key && now - this.lastClick.time < 350) {
        // Double click: select all of that type on screen
        this.selection = g.units.filter((u) => u.owner === human && u.key === ent.key && this.r.onScreen(this.r.toScreen(u.x, u.y), 0));
      } else if (e.shiftKey && ent.isUnit) {
        const i = this.selection.indexOf(ent);
        if (i >= 0) this.selection.splice(i, 1);
        else this.selection = [...this.selection.filter((s) => s.isUnit), ent];
      } else {
        this.selection = [ent];
      }
      this.lastClick = { time: now, key: ent.key };
      g.sound(ent.isUnit ? 'select' : 'click');
      if (ent.isUnit) g.voice(ent, 'select');
      return;
    }

    if (ent && g.hostile(ent.owner, human) && units.some((u) => g.canHit(u.weapon, ent))) {
      this.attack(units, ent);
      return;
    }

    if (units.length) {
      const tx = Math.floor(w.x), ty = Math.floor(w.y);
      const oreTile = g.map.oreAt(tx, ty) > 0 ? g.map.idx(tx, ty) : -1;
      const harvesters = oreTile >= 0 ? units.filter((u) => u.def.harvester) : [];
      if (harvesters.length) g.command({ type: 'harvest', u: this.ids(harvesters), tile: oreTile });
      const movers = units.filter((u) => !harvesters.includes(u));
      if (movers.length) g.command({ type: 'move', u: this.ids(movers), x: w.x, y: w.y, q: e.shiftKey });
      this.addMarker(w.x, w.y, harvesters.length ? '#e8c547' : '#60ff60');
      g.sound('move');
      g.voice(this.spokesman(units), 'move');
      return;
    }

    const sel = this.selection[0];
    if (this.selection.length === 1 && sel.isBuilding && sel.owner === human && sel.def.produces && sel.def.produces !== 'building') {
      g.command({ type: 'rally', t: sel.id, x: w.x, y: w.y });
      this.addMarker(w.x, w.y, '#ffffff');
      g.sound('move');
      return;
    }

    this.selection = ent ? [ent] : [];
  }

  // Context orders: engineers capture / repair, infantry garrison, commandos demolish,
  // damaged vehicles go to a depot. Returns true if the click was used.
  special(units, ent, w) {
    const g = this.g, human = g.human;
    const engineers = units.filter((u) => u.def.engineer);
    const used = [];
    const say = (list, color, line = 'move') => {
      used.push(...list);
      this.addMarker(ent ? ent.x : w.x, ent ? ent.y : w.y, color);
      g.sound('move');
      g.voice(this.spokesman(list), line);
    };
    if (!ent) {
      // engineers rebuild a destroyed bridge
      const br = g.map.bridgeOn(w.x, w.y);
      if (br && br.dead && engineers.length) {
        g.command({ type: 'fixBridge', u: [engineers[0].id], b: g.map.bridges.indexOf(br) });
        say([engineers[0]], '#e8c547');
        return true;
      }
      return false;
    }
    if (!ent.isBuilding) return false;
    if (engineers.length) {
      const enemyOrNeutral = ent.owner !== human && ent.def.capturable !== false && !ent.garrison?.length;
      const fixOwn = ent.owner === human && ent.hp < ent.maxHp && !ent.def.wall;
      if (enemyOrNeutral || fixOwn) {
        g.command({ type: 'reach', kind: 'capture', u: this.ids(engineers), t: ent.id });
        say(engineers, '#e8c547');
      }
    }
    const occupants = units.filter((u) => g.canGarrison(u, ent));
    if (occupants.length) {
      const room = ent.def.garrison - (ent.garrison?.length || 0);
      const going = occupants.slice(0, room);
      g.command({ type: 'reach', kind: 'enter', u: this.ids(going), t: ent.id });
      say(going, '#6ab0ff');
    }
    const commandos = units.filter((u) => u.def.demolish);
    if (commandos.length && g.hostile(ent.owner, human) && !ent.def.wall) {
      g.command({ type: 'reach', kind: 'demolish', u: this.ids(commandos), t: ent.id });
      say(commandos, '#ff4040', 'attack');
    }
    if (ent.owner === human && ent.def.repairs) {
      const fix = units.filter((u) => u.hp < u.maxHp && g.repairBayFor(u) && (ent.def.repairs === 'naval') === !!u.isNaval);
      if (fix.length) g.command({ type: 'repair', u: this.ids(fix), t: ent.id });
      if (fix.length) say(fix, '#60ff60');
    }
    if (!used.length) return false;
    // anyone not given a special job attacks an enemy building, or just moves there
    const rest = units.filter((u) => !used.includes(u));
    if (rest.length && g.hostile(ent.owner, human)) this.attack(rest, ent);
    return true;
  }

  attack(units, target) {
    const able = units.filter((u) => this.g.canHit(u.weapon, target));
    this.g.command({ type: 'attack', u: this.ids(able), t: target.id });
    this.addMarker(target.x, target.y, '#ff4040');
    this.g.sound('attack');
    this.g.voice(this.spokesman(able), 'attack');
  }

  // ---------- keyboard ----------
  keyDown(e) {
    if (!this.enabled || (e.target && e.target.tagName === 'INPUT')) return;
    this.keys.add(e.key);
    const g = this.g;
    const k = e.key.toLowerCase();

    if (/^[0-9]$/.test(e.key)) {
      const n = e.key;
      if (e.ctrlKey) {
        e.preventDefault();
        this.groups[n] = this.ownUnits();
        g.notify(`Group ${n} set`, 'info', 0);
      } else if (this.groups[n]) {
        this.selection = this.groups[n].filter((u) => !u.dead);
        if (this.selection.length) g.voice(this.spokesman(this.selection), 'select');
        const now = performance.now();
        if (this.lastGroupKey.n === n && now - this.lastGroupKey.time < 400 && this.selection.length) {
          this.r.centerOn(this.selection[0].x, this.selection[0].y);
        }
        this.lastGroupKey = { time: now, n };
      }
      return;
    }

    switch (k) {
      case 'escape': this.placing = null; this.mode = null; this.selection = []; break;
      case 's': if (this.ownUnits().length) g.command({ type: 'stop', u: this.ids(this.ownUnits()) }); break;
      case 'a': if (this.ownUnits().length) this.mode = 'attackmove'; break;
      case 'f': if (this.ownUnits().some((u) => u.weapon)) this.mode = 'forcefire'; break;
      case 'g': if (this.ownUnits().length) this.mode = 'guard'; break;
      case 'r': {
        // send damaged vehicles / ships to be fixed
        const fix = this.ownUnits().filter((u) => u.hp < u.maxHp && g.repairBayFor(u));
        if (fix.length) { g.command({ type: 'repair', u: this.ids(fix) }); g.sound('move'); g.voice(this.spokesman(fix), 'move'); }
        else if (this.ownUnits().some((u) => u.hp < u.maxHp)) g.notify('No repair facility', 'warn', 2);
        break;
      }
      case 'd': {
        // evacuate selected garrisoned buildings
        for (const b of this.selection) if (b.isBuilding && b.owner === g.human && b.garrison?.length) g.command({ type: 'evacuate', t: b.id });
        break;
      }
      case 'q': this.selection = g.units.filter((u) => u.owner === g.human && u.weapon && !u.def.harvester); break;
      case 'h': {
        const cy = g.buildings.find((b) => b.owner === g.human && b.key === 'conyard') || g.buildings.find((b) => b.owner === g.human);
        if (cy) this.r.centerOn(cy.x, cy.y);
        break;
      }
      case 'p': this.paused = !this.paused; break;
      case 'arrowup': case 'arrowdown': case 'arrowleft': case 'arrowright': e.preventDefault(); break;
    }
  }

  // ---------- per-frame ----------
  update(dt) {
    const g = this.g;
    this.selection = this.selection.filter((e) => !e.dead && !e.inside && !(e.isBuilding && e.owner !== g.human && !g.isExplored(e.x, e.y)));
    for (const n in this.groups) this.groups[n] = this.groups[n].filter((u) => !u.dead && !u.inside);
    for (const m of this.markers) m.life -= dt;
    this.markers = this.markers.filter((m) => m.life > 0);

    // Camera scrolling: arrow keys + screen edges
    let vx = 0, vy = 0;
    if (this.keys.has('ArrowLeft')) vx -= 1;
    if (this.keys.has('ArrowRight')) vx += 1;
    if (this.keys.has('ArrowUp')) vy -= 1;
    if (this.keys.has('ArrowDown')) vy += 1;
    if (this.enabled && this.mouse.inside && !this.down && !this.pan) {
      if (this.mouse.x < EDGE) vx -= 1;
      if (this.mouse.x > this.r.viewW - EDGE) vx += 1;
      if (this.mouse.y < EDGE) vy -= 1;
      if (this.mouse.y > this.r.viewH - EDGE) vy += 1;
    }
    if (vx || vy) {
      this.r.cam.x += vx * SCROLL_SPEED * settings.scroll * dt;
      this.r.cam.y += vy * SCROLL_SPEED * settings.scroll * dt;
      this.r.clampCam();
    }

    this.updatePlacing();
    this.hover = this.mouse.inside ? this.pick(this.mouse.x, this.mouse.y) : null;

    // Cursor feedback
    let cursor = 'default';
    const units = this.ownUnits();
    if (this.placing) cursor = 'crosshair';
    else if (this.mode === 'sell') cursor = 'cell';
    else if (this.mode === 'repair') cursor = 'help';
    else if (this.mode === 'attackmove' || this.mode === 'forcefire' || this.mode === 'power') cursor = 'crosshair';
    else if (this.mode === 'guard') cursor = 'alias';
    else if (this.hover && g.hostile(this.hover.owner, g.human) && units.some((u) => g.canHit(u.weapon, this.hover))) cursor = 'crosshair';
    else if (this.hover && this.hover.owner === g.human) cursor = 'pointer';
    else if (units.length) cursor = 'move';
    this.canvas.style.cursor = cursor;
  }
}

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
