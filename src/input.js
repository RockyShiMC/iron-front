import { BUILDINGS } from './config.js';

const EDGE = 14;
const SCROLL_SPEED = 900;

// RA2-style controls: left click selects / commands, right click deselects or cancels.
export class Input {
  constructor(canvas, game, renderer) {
    this.canvas = canvas;
    this.g = game;
    this.r = renderer;
    this.selection = [];
    this.hover = null;
    this.dragRect = null;
    this.placing = null; // { key, tx, ty }
    this.mode = null; // 'sell' | 'repair' | 'attackmove'
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
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', (e) => {
      const p = this.local(e);
      if (e.button === 0) this.down = { x: p.x, y: p.y };
      else if (e.button === 1) { e.preventDefault(); this.pan = { x: p.x, y: p.y }; }
      else if (e.button === 2) this.cancel();
    });
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
      if (this.down && Math.hypot(p.x - this.down.x, p.y - this.down.y) > 6 && !this.placing) {
        const x = Math.min(p.x, this.down.x), y = Math.min(p.y, this.down.y);
        this.dragRect = { x, y, w: Math.abs(p.x - this.down.x), h: Math.abs(p.y - this.down.y) };
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) this.pan = null;
      if (e.button !== 0 || !this.down) return;
      if (this.dragRect) this.boxSelect(this.dragRect, e.shiftKey);
      else this.click(this.down.x, this.down.y, e);
      this.down = null;
      this.dragRect = null;
    });
    c.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());
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

  addMarker(x, y, color) {
    this.markers.push({ x, y, color, life: 0.6 });
  }

  // ---------- picking ----------
  pick(sx, sy) {
    const g = this.g, r = this.r;
    let best = null, bd = -Infinity;
    for (const u of g.units) {
      if (u.owner !== g.human && !g.isExplored(u.x, u.y)) continue;
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
      if (g.placeBuilding(g.human, key, tx, ty)) this.placing = null;
      else { g.notify("Can't build there", 'warn', 1); g.sound('error'); }
      return;
    }

    const ent = this.pick(sx, sy);
    const human = g.human;

    if (this.mode === 'sell') {
      if (ent && ent.isBuilding && ent.owner === human) g.sell(ent);
      return;
    }
    if (this.mode === 'repair') {
      if (ent && ent.isBuilding && ent.owner === human && ent.hp < ent.maxHp) {
        ent.repairing = !ent.repairing;
        g.sound('click');
      } else {
        g.sound('error');
      }
      return;
    }

    const units = this.ownUnits();

    if (this.mode === 'attackmove') {
      this.mode = null;
      if (!units.length) return;
      if (ent && ent.owner !== human) this.attack(units, ent);
      else {
        g.groupOrder(units, w.x, w.y, 'attackmove');
        this.addMarker(w.x, w.y, '#ff6060');
        g.sound('attack');
        g.voice(this.spokesman(units), 'attack');
      }
      return;
    }

    if (ent && ent.owner === human) {
      const harvesters = units.filter((u) => u.def.harvester);
      if (ent.key === 'refinery' && harvesters.length && !e.shiftKey) {
        for (const h of harvesters) h.orderDock(g, ent);
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

    if (ent && ent.owner !== human && units.some((u) => g.canHit(u.weapon, ent))) {
      this.attack(units, ent);
      return;
    }

    if (units.length) {
      const tx = Math.floor(w.x), ty = Math.floor(w.y);
      const oreTile = g.map.oreAt(tx, ty) > 0 ? g.map.idx(tx, ty) : -1;
      const harvesters = oreTile >= 0 ? units.filter((u) => u.def.harvester) : [];
      for (const h of harvesters) h.orderHarvest(g, oreTile);
      const movers = units.filter((u) => !harvesters.includes(u));
      if (movers.length) g.groupOrder(movers, w.x, w.y, 'move');
      this.addMarker(w.x, w.y, harvesters.length ? '#e8c547' : '#60ff60');
      g.sound('move');
      g.voice(this.spokesman(units), 'move');
      return;
    }

    const sel = this.selection[0];
    if (this.selection.length === 1 && sel.isBuilding && sel.owner === human && sel.def.produces && sel.def.produces !== 'building') {
      sel.rally = { x: w.x, y: w.y };
      this.addMarker(w.x, w.y, '#ffffff');
      g.sound('move');
      return;
    }

    this.selection = ent ? [ent] : [];
  }

  attack(units, target) {
    const able = units.filter((u) => this.g.canHit(u.weapon, target));
    for (const u of able) u.orderAttack(this.g, target);
    this.addMarker(target.x, target.y, '#ff4040');
    this.g.sound('attack');
    this.g.voice(this.spokesman(able), 'attack');
  }

  // ---------- keyboard ----------
  keyDown(e) {
    if (e.target && e.target.tagName === 'INPUT') return;
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
      case 's': for (const u of this.ownUnits()) u.orderStop(); break;
      case 'a': if (this.ownUnits().length) this.mode = 'attackmove'; break;
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
    this.selection = this.selection.filter((e) => !e.dead);
    for (const n in this.groups) this.groups[n] = this.groups[n].filter((u) => !u.dead);
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
      this.r.cam.x += vx * SCROLL_SPEED * dt;
      this.r.cam.y += vy * SCROLL_SPEED * dt;
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
    else if (this.mode === 'attackmove') cursor = 'crosshair';
    else if (this.hover && this.hover.owner !== g.human && units.some((u) => g.canHit(u.weapon, this.hover))) cursor = 'crosshair';
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
