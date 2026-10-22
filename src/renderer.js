import { TILE_W, TILE_H, HALF_W, HALF_H, BUILDINGS } from './config.js';
import { GRASS, WATER, ROCK } from './map.js';
import { shade, hashTile, clamp, mulberry32 } from './util.js';

// Allied structures are pale concrete, Soviet ones dark rust-brown
const STYLE = {
  allied: { wall: '#9b9a90', roof: '#76766e' },
  soviet: { wall: '#8a7466', roof: '#584b44' },
};

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.g = game;
    this.cam = { x: 0, y: 0 };
    this.viewW = 0;
    this.viewH = 0;
    this.time = 0;
    this.terrain = this.prerenderTerrain();
    this.miniTerrain = null;
    this.miniTimer = 0;
  }

  resize(w, h) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = w;
    this.viewH = h;
    this.clampCam();
  }

  // ---------- coordinates ----------
  toScreen(x, y, z = 0) {
    return { x: (x - y) * HALF_W - this.cam.x, y: (x + y) * HALF_H - z - this.cam.y };
  }

  toWorld(sx, sy) {
    const X = sx + this.cam.x, Y = sy + this.cam.y;
    return { x: (X / HALF_W + Y / HALF_H) / 2, y: (Y / HALF_H - X / HALF_W) / 2 };
  }

  centerOn(x, y) {
    this.cam.x = (x - y) * HALF_W - this.viewW / 2;
    this.cam.y = (x + y) * HALF_H - this.viewH / 2;
    this.clampCam();
  }

  clampCam() {
    const S = this.g.map.w;
    this.cam.x = clamp(this.cam.x, -S * HALF_W, S * HALF_W - this.viewW);
    this.cam.y = clamp(this.cam.y, -TILE_H, S * TILE_H - this.viewH + TILE_H);
  }

  onScreen(p, margin = 80) {
    return p.x > -margin && p.y > -margin && p.x < this.viewW + margin && p.y < this.viewH + margin * 1.5;
  }

  // ---------- terrain ----------
  prerenderTerrain() {
    const m = this.g.map, S = m.w;
    const c = document.createElement('canvas');
    c.width = S * TILE_W;
    c.height = S * TILE_H + TILE_H;
    const ctx = c.getContext('2d');
    const ox = S * HALF_W;
    const rng = mulberry32(1234);
    const diamond = (x, y, fill) => {
      const cx = (x - y) * HALF_W + ox, cy = (x + y) * HALF_H;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 0.5);
      ctx.lineTo(cx + HALF_W + 0.5, cy + HALF_H);
      ctx.lineTo(cx, cy + TILE_H + 0.5);
      ctx.lineTo(cx - HALF_W - 0.5, cy + HALF_H);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      return { cx, cy: cy + HALF_H };
    };
    const isWater = (x, y) => m.inBounds(x, y) && m.terrain[m.idx(x, y)] === WATER;

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = m.idx(x, y);
        const v = m.variant[i];
        const t = m.terrain[i];
        if (t === WATER) {
          const shore = !isWater(x + 1, y) || !isWater(x - 1, y) || !isWater(x, y + 1) || !isWater(x, y - 1);
          diamond(x, y, shore ? `hsl(200, 45%, ${30 + v * 4}%)` : `hsl(210, 55%, ${20 + v * 5}%)`);
        } else {
          const { cx, cy } = diamond(x, y, `hsl(${84 + v * 16}, ${30 + v * 10}%, ${27 + v * 6}%)`);
          for (let k = 0; k < 4; k++) {
            ctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,200,0.07)';
            ctx.fillRect(cx + (rng() - 0.5) * HALF_W, cy + (rng() - 0.5) * HALF_H, 2, 1);
          }
        }
      }
    }
    // Rocks get drawn as raised lumps, back to front
    for (let s = 0; s < S * 2; s++) {
      for (let x = 0; x <= s; x++) {
        const y = s - x;
        if (!m.inBounds(x, y) || m.terrain[m.idx(x, y)] !== ROCK) continue;
        const cx = (x - y) * HALF_W + ox, cy = (x + y) * HALF_H + HALF_H;
        const v = m.variant[m.idx(x, y)];
        const h = 10 + v * 14;
        ctx.fillStyle = '#4c4a44';
        ctx.beginPath();
        ctx.moveTo(cx - HALF_W + 2, cy);
        ctx.lineTo(cx - 8, cy - h);
        ctx.lineTo(cx + 6, cy - h - 4);
        ctx.lineTo(cx + HALF_W - 2, cy);
        ctx.lineTo(cx, cy + HALF_H - 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#6e6b62';
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy - h);
        ctx.lineTo(cx + 6, cy - h - 4);
        ctx.lineTo(cx + HALF_W - 2, cy);
        ctx.lineTo(cx + 2, cy - 2);
        ctx.closePath();
        ctx.fill();
      }
    }
    return c;
  }

  // ---------- main draw ----------
  draw(dt, input) {
    this.time += dt;
    const ctx = this.ctx, g = this.g;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    const S = g.map.w;
    ctx.drawImage(this.terrain, -S * HALF_W - this.cam.x, -this.cam.y);

    this.drawOre();
    this.drawGroundLayer(input);

    // Depth-sorted entities
    const list = [];
    for (const b of g.buildings) {
      if (!g.isExplored(b.x, b.y)) continue;
      list.push({ d: b.tx + b.ty + (b.w + b.h) / 2, e: b });
    }
    for (const u of g.units) {
      if (u.owner !== g.human && !g.isExplored(u.x, u.y)) continue;
      list.push({ d: u.x + u.y, e: u });
    }
    list.sort((a, b) => a.d - b.d);
    for (const { e } of list) {
      if (e.isBuilding) this.drawBuilding(e);
      else if (this.onScreen(this.toScreen(e.x, e.y))) this.drawUnit(e);
    }

    this.drawProjectiles();
    this.drawEffects();
    this.drawShroud();

    // Overlays: selection + health bars
    for (const e of input.selection) this.drawSelection(e);
    if (input.hover && !input.selection.includes(input.hover) && g.isExplored(input.hover.x, input.hover.y)) this.drawHealthBar(input.hover);
    if (input.dragRect) {
      const r = input.dragRect;
      ctx.strokeStyle = '#7dff7d';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
      ctx.fillStyle = 'rgba(125,255,125,0.08)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  tilePath(x, y, inset = 0) {
    const ctx = this.ctx;
    const a = this.toScreen(x + inset, y + inset), b = this.toScreen(x + 1 - inset, y + inset);
    const c = this.toScreen(x + 1 - inset, y + 1 - inset), d = this.toScreen(x + inset, y + 1 - inset);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath();
  }

  drawOre() {
    const g = this.g, m = g.map, ctx = this.ctx;
    for (const i of m.oreTiles) {
      const amt = m.ore[i];
      if (!amt || !g.explored[i]) continue;
      const x = i % m.w, y = (i / m.w) | 0;
      const c = this.toScreen(x + 0.5, y + 0.5);
      if (!this.onScreen(c, 40)) continue;
      const n = Math.min(6, Math.ceil(amt / 110));
      for (let k = 0; k < n; k++) {
        const ox = (hashTile(x * 7 + k, y) - 0.5) * 0.8, oy = (hashTile(x, y * 7 + k) - 0.5) * 0.8;
        const p = this.toScreen(x + 0.5 + ox, y + 0.5 + oy);
        const s = 3 + hashTile(x + k, y + k) * 3;
        ctx.fillStyle = '#8a6a12';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s * 1.6); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s * 0.5); ctx.lineTo(p.x - s, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f0cf4a';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s * 1.6); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y - s * 0.2);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  drawGroundLayer(input) {
    const ctx = this.ctx, g = this.g;
    // Concrete pads + dock/exit markers
    for (const b of g.buildings) {
      if (!g.isExplored(b.x, b.y)) continue;
      for (let y = b.ty; y < b.ty + b.h; y++) {
        for (let x = b.tx; x < b.tx + b.w; x++) {
          this.tilePath(x, y);
          ctx.fillStyle = '#55554f';
          ctx.fill();
        }
      }
      if (b.key === 'refinery' || b.def.produces === 'vehicle') {
        const ex = b.tx + Math.floor(b.w / 2), ey = b.ty + b.h;
        if (g.map.isPassable(ex, ey)) {
          this.tilePath(ex, ey, 0.08);
          ctx.fillStyle = 'rgba(70,70,64,0.85)';
          ctx.fill();
          ctx.strokeStyle = b.key === 'refinery' ? '#d8b23a' : 'rgba(255,255,255,0.25)';
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    // Shadows + selection ellipses for units
    for (const u of g.units) {
      if (u.owner !== g.human && !g.isExplored(u.x, u.y)) continue;
      const p = this.toScreen(u.x, u.y);
      if (!this.onScreen(p)) continue;
      const r = u.radius * HALF_W * 1.4;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(p.x + 2, p.y + 1, r, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Building placement preview
    if (input.placing) {
      const pl = input.placing;
      const def = BUILDINGS[pl.key];
      const ok = g.canPlace(g.human, pl.key, pl.tx, pl.ty);
      for (let y = pl.ty; y < pl.ty + def.h; y++) {
        for (let x = pl.tx; x < pl.tx + def.w; x++) {
          this.tilePath(x, y, 0.04);
          const tileOk = g.map.isBuildable(x, y);
          ctx.fillStyle = ok ? 'rgba(80,255,80,0.35)' : tileOk ? 'rgba(255,200,60,0.35)' : 'rgba(255,60,60,0.45)';
          ctx.fill();
          ctx.strokeStyle = ok ? 'rgba(160,255,160,0.8)' : 'rgba(255,120,120,0.8)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
    // Rally / move target markers
    for (const m of input.markers) {
      const p = this.toScreen(m.x, m.y);
      const t = m.life / 0.6;
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = t;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 12 * t + 3, (12 * t + 3) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // ---------- buildings ----------
  poly(points, fill, stroke) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // Iso box from world rect (x0,y0)-(x1,y1), from height z0 to z1
  box(x0, y0, x1, y1, z0, z1, top, left, right) {
    const s = (x, y, z) => this.toScreen(x, y, z);
    this.poly([s(x0, y1, z0), s(x1, y1, z0), s(x1, y1, z1), s(x0, y1, z1)], left, 'rgba(0,0,0,0.35)');
    this.poly([s(x1, y1, z0), s(x1, y0, z0), s(x1, y0, z1), s(x1, y1, z1)], right, 'rgba(0,0,0,0.35)');
    this.poly([s(x0, y0, z1), s(x1, y0, z1), s(x1, y1, z1), s(x0, y1, z1)], top, 'rgba(0,0,0,0.35)');
  }

  cylinder(x, y, z, r, h, color, band) {
    const ctx = this.ctx;
    const p = this.toScreen(x, y, z);
    const ry = r * 0.5;
    ctx.fillStyle = shade(color, -0.3);
    ctx.fillRect(p.x - r, p.y - h, r * 2, h);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, ry, 0, 0, Math.PI);
    ctx.fill();
    // lit side
    ctx.fillStyle = shade(color, -0.1);
    ctx.fillRect(p.x, p.y - h, r, h);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, ry, 0, 0, Math.PI / 2);
    ctx.lineTo(p.x, p.y);
    ctx.fill();
    if (band) {
      ctx.fillStyle = band;
      ctx.fillRect(p.x - r, p.y - h * 0.55, r * 2, 3);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - h, r, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
  }

  buildingBounds(b) {
    const H = b.def.height;
    const pts = [
      this.toScreen(b.tx, b.ty, H + 20), this.toScreen(b.tx + b.w, b.ty, 0),
      this.toScreen(b.tx + b.w, b.ty + b.h, 0), this.toScreen(b.tx, b.ty + b.h, 0),
      this.toScreen(b.tx + b.w, b.ty, H), this.toScreen(b.tx, b.ty + b.h, H),
    ];
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }

  drawBuilding(b) {
    const bb = this.buildingBounds(b);
    if (bb.x2 < -20 || bb.x > this.viewW + 20 || bb.y2 < -20 || bb.y > this.viewH + 20) return;
    const ctx = this.ctx;
    const def = b.def, team = b.owner.color;
    const { wall: WALL, roof: ROOF } = STYLE[b.owner.faction];
    const powered = b.owner.hasPower();
    const k = b.buildAnim;
    const H = def.height * k;
    const i = 0.08;
    const x0 = b.tx + i, y0 = b.ty + i, x1 = b.tx + b.w - i, y1 = b.ty + b.h - i;
    const damaged = b.hp / b.maxHp < 0.5;

    if (k < 1) ctx.globalAlpha = 0.5 + k * 0.5;
    const s = (x, y, z) => this.toScreen(x, y, z);

    switch (b.key) {
      case 'conyard': {
        this.box(x0, y0, x1, y1, 0, H, ROOF, shade(WALL, -0.35), shade(WALL, -0.1));
        this.teamStripe(x0, y0, x1, y1, H, team);
        this.box(x0 + 0.2, y0 + 0.2, x0 + 1.3, y0 + 1.3, H, H + 12 * k, shade(team, -0.1), shade(team, -0.5), shade(team, -0.3));
        // crane
        const base = s(x1 - 0.5, y0 + 0.5, H), top = s(x1 - 0.5, y0 + 0.5, H + 34 * k);
        const arm = s(x0 + 0.6, y1 - 0.4, H + 34 * k);
        ctx.strokeStyle = '#e0b43d';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.lineTo(arm.x, arm.y); ctx.stroke();
        const hookY = arm.y + 12 + Math.sin(b.anim * 1.5) * 4;
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(arm.x, arm.y); ctx.lineTo(arm.x, hookY); ctx.stroke();
        break;
      }
      case 'power': {
        this.box(x0, y0, x1, y1, 0, H, ROOF, shade(WALL, -0.35), shade(WALL, -0.1));
        this.teamStripe(x0, y0, x1, y1, H, team);
        this.cylinder(b.tx + 0.6, b.ty + 0.7, H, 9, 16 * k, '#b9b8ae', team);
        this.cylinder(b.tx + 1.35, b.ty + 1.4, H, 9, 16 * k, '#b9b8ae', team);
        if (b.owner.hasPower()) {
          const p = s(b.tx + 1.4, b.ty + 0.5, H + 2);
          ctx.fillStyle = `rgba(120,220,255,${0.5 + Math.sin(b.anim * 4) * 0.3})`;
          ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
        }
        break;
      }
      case 'refinery': {
        this.box(x0, y0 + 1, x1, y1, 0, H * 0.7, ROOF, shade(WALL, -0.35), shade(WALL, -0.1));
        this.teamStripe(x0, y0 + 1, x1, y1, H * 0.7, team);
        this.box(x0, y0, x1 - 1, y0 + 1, 0, H, ROOF, shade(WALL, -0.4), shade(WALL, -0.15));
        this.cylinder(b.tx + 2.4, b.ty + 0.6, 0, 14, H + 10 * k, '#c9b46a', team);
        // conveyor
        this.box(x0 + 1, y1 - 0.5, x0 + 1.9, y1, 0, 8 * k, '#3a3a36', '#2a2a26', '#333');
        break;
      }
      case 'barracks': {
        this.box(x0, y0, x1, y1, 0, H, ROOF, shade(WALL, -0.35), shade(WALL, -0.1));
        if (b.owner.faction === 'soviet') {
          this.teamStripe(x0, y0, x1, y1, H, team);
          this.cylinder(x1 - 0.45, y0 + 0.45, H, 5, 18 * k, '#5a504a', team);
        } else {
          const apex = s((x0 + x1) / 2, (y0 + y1) / 2, H + 16 * k);
          this.poly([s(x0, y1, H), s(x1, y1, H), apex], shade(team, -0.45), 'rgba(0,0,0,0.4)');
          this.poly([s(x1, y1, H), s(x1, y0, H), apex], shade(team, -0.2), 'rgba(0,0,0,0.4)');
        }
        // door
        this.poly([s(x0 + 0.6, y1, 0), s(x0 + 1.2, y1, 0), s(x0 + 1.2, y1, 12 * k), s(x0 + 0.6, y1, 12 * k)], '#222');
        // flag
        const fp = s(x0 + 0.2, y0 + 0.2, H), ft = s(x0 + 0.2, y0 + 0.2, H + 26 * k);
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(fp.x, fp.y); ctx.lineTo(ft.x, ft.y); ctx.stroke();
        const wave = Math.sin(b.anim * 5) * 2;
        ctx.fillStyle = team;
        ctx.beginPath(); ctx.moveTo(ft.x, ft.y); ctx.lineTo(ft.x + 12, ft.y + 3 + wave); ctx.lineTo(ft.x, ft.y + 7); ctx.fill();
        break;
      }
      case 'factory': {
        this.box(x0, y0, x1, y1, 0, H, ROOF, shade(WALL, -0.35), shade(WALL, -0.1));
        this.teamStripe(x0, y0, x1, y1, H, team);
        // big door on the front-left face
        this.poly([s(x0 + 0.7, y1, 0), s(x1 - 0.7, y1, 0), s(x1 - 0.7, y1, H * 0.65), s(x0 + 0.7, y1, H * 0.65)], '#262624', 'rgba(255,255,255,0.15)');
        for (let n = 1; n < 4; n++) {
          const a = s(x0 + 0.7, y1, H * 0.65 * n / 4), c = s(x1 - 0.7, y1, H * 0.65 * n / 4);
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
        }
        this.box(x0 + 0.3, y0 + 0.3, x0 + 1.1, y0 + 1.1, H, H + 8 * k, '#5d5d57', '#444', '#4f4f4a');
        this.box(x1 - 1.1, y0 + 0.3, x1 - 0.3, y0 + 1.1, H, H + 8 * k, '#5d5d57', '#444', '#4f4f4a');
        break;
      }
      case 'radar': {
        this.box(x0, y0, x1, y1, 0, H, ROOF, shade(WALL, -0.35), shade(WALL, -0.1));
        this.teamStripe(x0, y0, x1, y1, H, team);
        const c = s(b.tx + 1, b.ty + 1, H), d = s(b.tx + 1, b.ty + 1, H + 18 * k);
        ctx.strokeStyle = '#555'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
        const spin = b.owner.hasPower() ? b.anim * 1.5 : 0;
        const rx = Math.abs(Math.cos(spin)) * 16 + 3;
        ctx.fillStyle = '#d6d6cc';
        ctx.beginPath(); ctx.ellipse(d.x, d.y, rx, 12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = shade(team, -0.2); ctx.lineWidth = 2; ctx.stroke();
        break;
      }
      case 'teslaReactor': {
        this.box(x0, y0, x1, y1, 0, H, ROOF, shade(WALL, -0.35), shade(WALL, -0.1));
        this.teamStripe(x0, y0, x1, y1, H, team);
        // central coil with glowing core
        this.cylinder(b.x, b.y, H, 11, 10 * k, '#3b3f46', null);
        for (let n = 0; n < 3; n++) {
          const r = s(b.x, b.y, H + 12 + n * 5);
          ctx.strokeStyle = '#b87333';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(r.x, r.y, 9 - n * 2, 4 - n, 0, 0, Math.PI * 2); ctx.stroke();
        }
        const core = s(b.x, b.y, H + 30 * k);
        const glow = powered ? 0.6 + Math.sin(b.anim * 6) * 0.3 : 0.15;
        ctx.fillStyle = `rgba(120,200,255,${glow})`;
        ctx.beginPath(); ctx.arc(core.x, core.y, 6, 0, Math.PI * 2); ctx.fill();
        if (powered && Math.random() < 0.1) this.g.effects.push({ type: 'arc', x: b.x, y: b.y, z: H + 30, r: 0.5, life: 0.12, max: 0.12 });
        break;
      }
      case 'pillbox': {
        // low concrete dome with a firing slit
        const c = s(b.x, b.y, 0);
        const r = 20 * (0.6 + 0.4 * k);
        ctx.fillStyle = shade(WALL, -0.15);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, r, r / 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = WALL;
        ctx.beginPath(); ctx.ellipse(c.x, c.y - 4, r * 0.8, H * k, 0, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = team; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(c.x, c.y - 4, r * 0.8, H * k, 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
        this.gunBarrel(b, H * 0.6, 0.6, 2, '#222');
        break;
      }
      case 'sentryGun': {
        this.box(x0 + 0.2, y0 + 0.2, x1 - 0.2, y1 - 0.2, 0, H * 0.6, ROOF, shade(WALL, -0.35), shade(WALL, -0.1));
        const c = s(b.x, b.y, H);
        ctx.fillStyle = shade(team, -0.2);
        ctx.beginPath(); ctx.ellipse(c.x, c.y, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
        this.gunBarrel(b, H, 0.55, 2, '#1a1a1a', 0.06);
        this.gunBarrel(b, H, 0.55, 2, '#1a1a1a', -0.06);
        break;
      }
      case 'prismTower': {
        // slender tapered tower topped with a crystal
        const bot = 0.32, top = 0.14;
        this.poly([s(b.x - bot, b.y + bot, 0), s(b.x + bot, b.y + bot, 0), s(b.x + top, b.y + top, H), s(b.x - top, b.y + top, H)], shade(WALL, -0.35), 'rgba(0,0,0,0.35)');
        this.poly([s(b.x + bot, b.y + bot, 0), s(b.x + bot, b.y - bot, 0), s(b.x + top, b.y - top, H), s(b.x + top, b.y + top, H)], shade(WALL, -0.1), 'rgba(0,0,0,0.35)');
        this.teamStripe(b.x - bot * 0.7, b.y - bot * 0.7, b.x + bot * 0.7, b.y + bot * 0.7, H * 0.45, team);
        this.crystal(b.x, b.y, H, 16 * k, powered, b.anim);
        break;
      }
      case 'teslaCoil': {
        this.box(x0 + 0.15, y0 + 0.15, x1 - 0.15, y1 - 0.15, 0, 8, ROOF, shade(WALL, -0.35), shade(WALL, -0.1));
        const base = s(b.x, b.y, 8), tip = s(b.x, b.y, H * k);
        ctx.strokeStyle = '#3b3f46'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
        // copper coil rings, narrowing toward the top
        for (let n = 0; n < 6; n++) {
          const z = 10 + (H * k - 14) * (n / 5);
          const r = s(b.x, b.y, z);
          const rad = 11 - n * 1.2;
          ctx.strokeStyle = n % 2 ? '#c27c3a' : '#9a5c26';
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, rad * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = powered ? '#bfe6ff' : '#555b66';
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = team; ctx.lineWidth = 1.5; ctx.stroke();
        if (powered && Math.random() < 0.08) this.g.effects.push({ type: 'arc', x: b.x, y: b.y, z: H, r: 0.6, life: 0.12, max: 0.12 });
        break;
      }
      default:
        this.box(x0, y0, x1, y1, 0, H, ROOF, shade(WALL, -0.35), shade(WALL, -0.1));
    }
    ctx.globalAlpha = 1;

    if (damaged && Math.random() < 0.15) {
      const fx = b.tx + Math.random() * b.w, fy = b.ty + Math.random() * b.h;
      this.g.effects.push({ type: 'smoke', x: fx, y: fy, z: H, vx: 0, vy: 0, vz: 18, life: 1.2, max: 1.2, dark: true });
    }
    if (b.repairing) {
      const p = s(b.x, b.y, def.height + 24);
      ctx.fillStyle = '#ffd84a';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      if (Math.floor(this.time * 3) % 2) ctx.fillText('🔧', p.x, p.y);
    }
  }

  // Barrel from an entity's center along its turret direction (side: sideways offset in tiles)
  gunBarrel(e, z, len, width, color, side = 0) {
    const ctx = this.ctx;
    const c = Math.cos(e.turretDir), s = Math.sin(e.turretDir);
    const ox = -s * side, oy = c * side;
    const a = this.toScreen(e.x + ox, e.y + oy, z), b = this.toScreen(e.x + ox + c * len, e.y + oy + s * len, z);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // Faceted glowing prism crystal sitting at height z
  crystal(x, y, z, h, lit, t) {
    const ctx = this.ctx;
    const p = this.toScreen(x, y, z);
    const w = h * 0.45;
    const glow = lit ? 0.75 + Math.sin(t * 4) * 0.2 : 0.35;
    ctx.fillStyle = `rgba(120,210,255,${glow})`;
    ctx.beginPath(); ctx.moveTo(p.x, p.y - h); ctx.lineTo(p.x - w, p.y - h * 0.45); ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = `rgba(210,245,255,${glow})`;
    ctx.beginPath(); ctx.moveTo(p.x, p.y - h); ctx.lineTo(p.x + w, p.y - h * 0.45); ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(40,90,130,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y - h); ctx.lineTo(p.x - w, p.y - h * 0.45); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x + w, p.y - h * 0.45); ctx.closePath(); ctx.stroke();
  }

  teamStripe(x0, y0, x1, y1, H, team) {
    const ctx = this.ctx;
    const s = (x, y, z) => this.toScreen(x, y, z);
    ctx.strokeStyle = team;
    ctx.lineWidth = 3;
    ctx.beginPath();
    const a = s(x0, y1, H - 3), b = s(x1, y1, H - 3), c = s(x1, y0, H - 3);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }

  // ---------- units ----------
  drawUnit(u) {
    if (u.isInfantry) this.drawInfantry(u);
    else this.drawVehicle(u);
  }

  quad(x, y, dir, halfL, halfW, z) {
    const c = Math.cos(dir), s = Math.sin(dir);
    const pts = [[halfL, halfW], [halfL, -halfW], [-halfL, -halfW], [-halfL, halfW]];
    return pts.map(([lx, ly]) => this.toScreen(x + lx * c - ly * s, y + lx * s + ly * c, z));
  }

  drawVehicle(u) {
    const ctx = this.ctx;
    const team = u.owner.color;
    const L = u.def.size, W = L * 0.68;
    // Chrono Miner flickers while charging its teleport
    if (u.hstate === 'chrono') ctx.globalAlpha = 0.3 + Math.random() * 0.5;
    // treads
    this.poly(this.quad(u.x, u.y, u.dir, L, W, 2), '#262624', 'rgba(0,0,0,0.6)');
    if (u.def.look === 'harvester') {
      this.drawHarvester(u, L, W, team);
      ctx.globalAlpha = 1;
      return;
    }
    this.poly(this.quad(u.x, u.y, u.dir, L * 0.9, W * 0.85, 7), shade(team, -0.25), 'rgba(0,0,0,0.55)');
    // front highlight
    const fx = u.x + Math.cos(u.dir) * L * 0.6, fy = u.y + Math.sin(u.dir) * L * 0.6;
    this.poly(this.quad(fx, fy, u.dir, L * 0.25, W * 0.8, 8), shade(team, -0.05));
    if (u.def.look === 'prism') {
      this.crystal(u.x, u.y, 9, 18, u.cooldown <= 0, this.time + u.id);
      return;
    }
    // turret + barrel(s)
    if (u.def.barrels === 2) {
      this.gunBarrel(u, 12, L * 1.3, 3, '#222', 0.09);
      this.gunBarrel(u, 12, L * 1.3, 3, '#222', -0.09);
    } else {
      this.gunBarrel(u, 12, L * 1.35, L > 0.45 ? 4 : 3, '#222');
    }
    const t = this.toScreen(u.x, u.y, 12);
    const rx = 3 + L * 12;
    ctx.fillStyle = shade(team, 0.1);
    ctx.beginPath();
    ctx.ellipse(t.x, t.y, rx, rx * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawHarvester(u, L, W, team) {
    const chrono = u.def.chrono;
    this.poly(this.quad(u.x, u.y, u.dir, L * 0.95, W * 0.9, 9), chrono ? '#b59a52' : '#7d6c4a', 'rgba(0,0,0,0.5)');
    // cab
    const cx = u.x + Math.cos(u.dir) * L * 0.55, cy = u.y + Math.sin(u.dir) * L * 0.55;
    this.poly(this.quad(cx, cy, u.dir, L * 0.35, W * 0.8, 15), shade(team, -0.1), 'rgba(0,0,0,0.5)');
    // hopper with ore load
    const hx = u.x - Math.cos(u.dir) * L * 0.3, hy = u.y - Math.sin(u.dir) * L * 0.3;
    this.poly(this.quad(hx, hy, u.dir, L * 0.5, W * 0.75, 14), '#6b6347', 'rgba(0,0,0,0.5)');
    if (u.cargo > 0) {
      const f = u.cargo / u.def.capacity;
      this.poly(this.quad(hx, hy, u.dir, L * 0.45 * f + 0.05, W * 0.65, 15), '#e8c547');
    }
    if (chrono) {
      // blue chrono emitter on the cab roof
      const p = this.toScreen(cx, cy, 17);
      this.ctx.fillStyle = `rgba(120,200,255,${0.6 + Math.sin(this.time * 5 + u.id) * 0.3})`;
      this.ctx.beginPath(); this.ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); this.ctx.fill();
    } else if (u.weapon) {
      // War Miner's machine gun
      this.gunBarrel(u, 17, 0.45, 2, '#111');
      const p = this.toScreen(u.x, u.y, 17);
      this.ctx.fillStyle = shade(team, -0.3);
      this.ctx.beginPath(); this.ctx.ellipse(p.x, p.y, 4, 2.5, 0, 0, Math.PI * 2); this.ctx.fill();
    }
  }

  drawInfantry(u) {
    const ctx = this.ctx;
    const p = this.toScreen(u.x, u.y);
    const team = u.owner.color;
    const step = u.moving ? Math.sin(u.anim * 3) : 0;
    // legs
    ctx.fillStyle = '#2b2b25';
    ctx.fillRect(p.x - 2.5, p.y - 5 + Math.max(0, step), 2, 5 - Math.max(0, step));
    ctx.fillRect(p.x + 0.5, p.y - 5 + Math.max(0, -step), 2, 5 - Math.max(0, -step));
    const gear = u.def.gear;
    const bulky = gear === 'tesla';
    // body (Tesla Troopers wear heavy armor suits)
    ctx.fillStyle = bulky ? '#4a4f58' : shade(team, -0.15);
    ctx.fillRect(p.x - (bulky ? 4 : 3), p.y - 11, bulky ? 8 : 6, 7);
    if (bulky) {
      ctx.fillStyle = team;
      ctx.fillRect(p.x - 4, p.y - 8, 8, 1.5);
      ctx.fillStyle = `rgba(120,200,255,${0.6 + Math.sin(this.time * 6 + u.id) * 0.3})`;
      ctx.fillRect(p.x - 1.5, p.y - 12, 3, 2);
    }
    // head + helmet (Soviets: fur hat)
    ctx.fillStyle = '#e2b98f';
    ctx.beginPath(); ctx.arc(p.x, p.y - 13, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = bulky ? '#3a3e46' : u.owner.faction === 'soviet' ? '#4a3b2c' : shade(team, -0.4);
    ctx.fillRect(p.x - 2.5, p.y - (bulky ? 16 : 15.5), 5, bulky ? 3 : 2);
    // weapon, in screen-space direction of facing
    const c = Math.cos(u.dir), s = Math.sin(u.dir);
    let vx = (c - s) * HALF_W, vy = (c + s) * HALF_H;
    const len = Math.hypot(vx, vy) || 1;
    vx /= len; vy /= len;
    ctx.strokeStyle = gear === 'rocket' ? '#5b6b3a' : gear === 'tesla' ? '#7fb8e0' : '#111';
    ctx.lineWidth = gear === 'rifle' ? 1.5 : 3;
    const wl = gear === 'tesla' ? 5 : 8;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 9);
    ctx.lineTo(p.x + vx * wl, p.y - 9 + vy * wl);
    ctx.stroke();
  }

  // ---------- projectiles / effects ----------
  drawProjectiles() {
    const ctx = this.ctx;
    for (const p of this.g.projectiles) {
      const sh = this.toScreen(p.x, p.y, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(sh.x - 1.5, sh.y - 1, 3, 2);
      const s = this.toScreen(p.x, p.y, p.z);
      if (p.kind === 'rocket') {
        ctx.fillStyle = '#ffb347';
        ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff3c0';
        ctx.beginPath(); ctx.arc(s.x, s.y, 1.2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = '#ffe9a0';
        ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawEffects() {
    const ctx = this.ctx;
    for (const e of this.g.effects) {
      const t = e.life / e.max;
      const p = this.toScreen(e.x, e.y, e.z);
      if (!this.onScreen(p)) continue;
      switch (e.type) {
        case 'flash': {
          ctx.fillStyle = `rgba(${e.color || '255,230,140'},${t})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, e.size * (0.5 + t * 0.5), 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'bolt': {
          const q = this.toScreen(e.x2, e.y2, e.z2);
          this.lightning(p, q, t);
          break;
        }
        case 'arc': {
          // small idle discharge around a coil tip
          const a = Math.random() * Math.PI * 2;
          const q = this.toScreen(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, e.z - 10 - Math.random() * 10);
          this.lightning(p, q, t);
          break;
        }
        case 'beam': {
          const q = this.toScreen(e.x2, e.y2, e.z2);
          ctx.lineCap = 'round';
          ctx.strokeStyle = `rgba(90,180,255,${t * 0.5})`;
          ctx.lineWidth = 8 * t + 2;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          ctx.strokeStyle = `rgba(235,250,255,${t})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          ctx.lineCap = 'butt';
          break;
        }
        case 'chrono': {
          for (let n = 0; n < 3; n++) {
            const r = 6 + ((1 - t) * 30 + n * 8) % 30;
            ctx.strokeStyle = `rgba(130,210,255,${t * 0.8})`;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
          }
          break;
        }
        case 'tracer': {
          const q = this.toScreen(e.x2, e.y2, e.z2);
          ctx.strokeStyle = `rgba(255,240,150,${t})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          break;
        }
        case 'spark': {
          ctx.fillStyle = `rgba(255,200,80,${t})`;
          ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
          break;
        }
        case 'boom': {
          const r = e.size * 34 * (1.2 - t * 0.6);
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          grd.addColorStop(0, `rgba(255,250,200,${t})`);
          grd.addColorStop(0.4, `rgba(255,150,40,${t * 0.9})`);
          grd.addColorStop(1, 'rgba(120,30,0,0)');
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'smoke': {
          const r = (e.small ? 2 : 5) + (1 - t) * (e.small ? 4 : 12);
          const c = e.dark ? 40 : 110;
          ctx.fillStyle = `rgba(${c},${c},${c},${t * 0.45})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'debris': {
          ctx.fillStyle = `rgba(40,30,20,${Math.min(1, t * 2)})`;
          ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
          break;
        }
      }
    }
  }

  // Jagged electric arc between two screen points, re-randomized every frame
  lightning(a, b, alpha) {
    const ctx = this.ctx;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const segs = Math.max(3, Math.round(d / 10));
    const nx = -(b.y - a.y) / (d || 1), ny = (b.x - a.x) / (d || 1);
    const pts = [a];
    for (let i = 1; i < segs; i++) {
      const f = i / segs, j = (Math.random() - 0.5) * Math.min(14, d * 0.2);
      pts.push({ x: a.x + (b.x - a.x) * f + nx * j, y: a.y + (b.y - a.y) * f + ny * j });
    }
    pts.push(b);
    for (const [w, col] of [[6, `rgba(80,150,255,${alpha * 0.4})`], [2, `rgba(220,240,255,${alpha})`]]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
  }

  drawShroud() {
    const g = this.g, m = g.map, ctx = this.ctx;
    const S = m.w;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        if (g.explored[i]) {
          // soften the shroud edge
          const edge = !(g.explored[i - 1] ?? 1) || !(g.explored[i + 1] ?? 1) || !(g.explored[i - S] ?? 1) || !(g.explored[i + S] ?? 1);
          if (!edge) continue;
          const c = this.toScreen(x + 0.5, y + 0.5);
          if (!this.onScreen(c, 40)) continue;
          this.tilePath(x, y, -0.02);
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fill();
          continue;
        }
        const c = this.toScreen(x + 0.5, y + 0.5);
        if (!this.onScreen(c, 40)) continue;
        this.tilePath(x, y, -0.03);
        ctx.fillStyle = '#000';
        ctx.fill();
      }
    }
  }

  // ---------- overlays ----------
  entityRect(e) {
    if (e.isBuilding) {
      const b = this.buildingBounds(e);
      return { x: b.x, y: b.y + 14, w: b.x2 - b.x, h: b.y2 - b.y - 14 };
    }
    const p = this.toScreen(e.x, e.y);
    if (e.isInfantry) return { x: p.x - 7, y: p.y - 19, w: 14, h: 22 };
    return { x: p.x - 16, y: p.y - 22, w: 32, h: 30 };
  }

  drawSelection(e) {
    const ctx = this.ctx;
    const r = this.entityRect(e);
    const L = Math.min(8, r.w / 3);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]]) {
      ctx.moveTo(cx + dx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * L);
    }
    ctx.stroke();
    this.drawHealthBar(e);
    if (e.isBuilding && e.rally) {
      const a = this.toScreen(e.x, e.y), b = this.toScreen(e.rally.x, e.rally.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = e.owner.color;
      ctx.fillRect(b.x, b.y - 14, 8, 5);
      ctx.fillStyle = '#ddd';
      ctx.fillRect(b.x - 1, b.y - 14, 1.5, 14);
    }
  }

  drawHealthBar(e) {
    const ctx = this.ctx;
    const r = this.entityRect(e);
    const f = Math.max(0, e.hp / e.maxHp);
    const w = Math.max(18, Math.min(r.w, 60));
    const x = r.x + (r.w - w) / 2, y = r.y - 6;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = f > 0.6 ? '#4ee04e' : f > 0.3 ? '#f0d040' : '#ee4040';
    ctx.fillRect(x, y, w * f, 3);
    if (e.def.harvester) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x - 1, y + 4, w + 2, 4);
      ctx.fillStyle = '#e8c547';
      ctx.fillRect(x, y + 5, w * (e.cargo / e.def.capacity), 2);
    }
  }

  // ---------- minimap ----------
  drawMinimap(canvas, enabled, reason) {
    this.miniTimer -= 1;
    if (this.miniTimer > 0) return;
    this.miniTimer = 4; // every few frames is plenty
    const ctx = canvas.getContext('2d');
    const W = canvas.width, Hc = canvas.height;
    const g = this.g, m = g.map, S = m.w;
    const k = (W - 4) / (2 * S);
    const ox = W / 2, oy = (Hc - S * k) / 2;
    this.mini = { k, ox, oy };
    const mp = (x, y) => ({ x: (x - y) * k + ox, y: (x + y) * k * 0.5 + oy });
    ctx.fillStyle = '#05080a';
    ctx.fillRect(0, 0, W, Hc);
    if (!enabled) {
      ctx.fillStyle = '#1b2a1b';
      for (let n = 0; n < 300; n++) ctx.fillRect(Math.random() * W, Math.random() * Hc, 2, 1);
      ctx.fillStyle = '#6c9';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(reason, W / 2, Hc / 2 + 4);
      return;
    }
    if (!this.miniTerrain) {
      const c = document.createElement('canvas');
      c.width = W; c.height = Hc;
      const mc = c.getContext('2d');
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const t = m.terrain[m.idx(x, y)];
          mc.fillStyle = t === WATER ? '#1d4466' : t === ROCK ? '#555149' : '#3d5a2a';
          const p = mp(x, y);
          mc.fillRect(p.x - k, p.y, k * 2 + 0.5, k + 0.5);
        }
      }
      this.miniTerrain = c;
    }
    ctx.drawImage(this.miniTerrain, 0, 0);
    ctx.fillStyle = '#d8b23a';
    for (const i of m.oreTiles) {
      if (!m.ore[i]) continue;
      const p = mp(i % S, (i / S) | 0);
      ctx.fillRect(p.x - 1, p.y, 2, 1.5);
    }
    for (const b of g.buildings) {
      if (!g.isExplored(b.x, b.y)) continue;
      ctx.fillStyle = b.owner.color;
      const p = mp(b.x, b.y);
      ctx.fillRect(p.x - b.w * k * 0.7, p.y - b.h * k * 0.35, b.w * k * 1.4, b.h * k * 0.7 + 1);
    }
    for (const u of g.units) {
      if (u.owner !== g.human && !g.isExplored(u.x, u.y)) continue;
      ctx.fillStyle = u.owner.color;
      const p = mp(u.x, u.y);
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
    ctx.fillStyle = '#000';
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (g.explored[y * S + x]) continue;
        const p = mp(x, y);
        ctx.fillRect(p.x - k, p.y, k * 2 + 0.5, k + 0.5);
      }
    }
    // Camera viewport
    const corners = [[0, 0], [this.viewW, 0], [this.viewW, this.viewH], [0, this.viewH]]
      .map(([sx, sy]) => { const w = this.toWorld(sx, sy); return mp(w.x, w.y); });
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    corners.forEach((p, n) => (n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
  }

  minimapToWorld(mx, my) {
    if (!this.mini) return null;
    const { k, ox, oy } = this.mini;
    const a = (mx - ox) / k, b = (my - oy) / (k * 0.5);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }
}
