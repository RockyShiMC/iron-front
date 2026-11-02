import { TILE_W, TILE_H, HALF_W, HALF_H, BUILDINGS } from './config.js';
import { settings } from './settings.js';
import { GRASS, WATER, ROCK } from './map.js';
import { shade, hashTile, clamp, mulberry32, fbm, vnoise, smoothstep, dist } from './util.js';

const CHUNK = 8; // terrain is painted in CHUNK x CHUNK tile pieces
const CHUNK_TOP = 40; // headroom above a chunk for boulders and bushes
const MAX_CHUNKS = 160;
// Chunks paint a few pixels past their diamond so neighbours overlap; otherwise
// their soft edges show as a grid when the canvas is scaled on high-DPI screens
const CHUNK_BLEED = 0.08;

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
    this.initTerrain();
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
  // The map is painted pixel by pixel from smooth noise fields, in chunks of
  // CHUNK x CHUNK tiles that are painted the first time they come into view
  // (and prefetched nearby when there's time), so even large maps start fast.
  initTerrain() {
    const m = this.g.map, S = m.w;
    const R = 4, FW = S * R + 1;
    const field = () => new Float32Array(FW * FW);
    const F = (this.fields = {
      grass: field(), dirt: field(), mott: field(), water: field(), rock: field(), desert: field(), snow: field(),
    });
    // bilinear blend of a per-tile indicator, sampled between tile centers
    const blend = (test) => (x, y) => {
      const gx = clamp(x - 0.5, 0, S - 1), gy = clamp(y - 0.5, 0, S - 1);
      const ix = Math.min(S - 2, Math.floor(gx)), iy = Math.min(S - 2, Math.floor(gy));
      const fx = gx - ix, fy = gy - iy;
      const v = (xx, yy) => (test(yy * S + xx) ? 1 : 0);
      const a = v(ix, iy), b = v(ix + 1, iy), cc = v(ix, iy + 1), d = v(ix + 1, iy + 1);
      return a + (b - a) * fx + (cc - a) * fy + (a - b - cc + d) * fx * fy;
    };
    const waterAt = blend((i) => m.terrain[i] === WATER), rockAt = blend((i) => m.terrain[i] === ROCK);
    const desertAt = blend((i) => m.biome[i] === 1), snowAt = blend((i) => m.biome[i] === 2);
    for (let j = 0; j < FW; j++) {
      for (let i = 0; i < FW; i++) {
        const x = i / R, y = j / R, k = j * FW + i;
        F.grass[k] = fbm(x * 0.28, y * 0.28, 4);
        F.dirt[k] = fbm(x * 0.17 + 40, y * 0.17 + 40, 3);
        F.mott[k] = fbm(x * 1.3, y * 1.3, 2);
        F.water[k] = waterAt(x, y) + (vnoise(x * 1.4 + 7, y * 1.4) - 0.5) * 0.32;
        F.rock[k] = rockAt(x, y) + (vnoise(x * 2 + 3, y * 2) - 0.5) * 0.3;
        F.desert[k] = desertAt(x, y) + (vnoise(x * 0.9 + 21, y * 0.9) - 0.5) * 0.4;
        F.snow[k] = snowAt(x, y) + (vnoise(x * 0.9 + 33, y * 0.9) - 0.5) * 0.4;
      }
    }
    this.fieldR = R;
    this.fieldW = FW;
    this.grain = new Uint8Array(65536);
    const rng = mulberry32(99);
    for (let i = 0; i < this.grain.length; i++) this.grain[i] = (rng() * 255) | 0;
    this.waterTiles = [];
    for (let i = 0; i < S * S; i++) if (m.terrain[i] === WATER) this.waterTiles.push(i);
    this.chunks = new Map();
    this.chunkUse = 0;
  }

  sampleField(F, x, y) {
    const R = this.fieldR, FW = this.fieldW;
    const fx = clamp(x * R, 0, FW - 1.001), fy = clamp(y * R, 0, FW - 1.001);
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, k = iy * FW + ix;
    const a = F[k], b = F[k + 1], cc = F[k + FW], d = F[k + FW + 1];
    return a + (b - a) * tx + (cc - a) * ty + (a - b - cc + d) * tx * ty;
  }

  renderChunk(cx, cy) {
    const m = this.g.map, S = m.w, F = this.fields, CH = CHUNK;
    const x0 = cx * CH, y0 = cy * CH;
    const c = document.createElement('canvas');
    c.width = CH * TILE_W;
    c.height = CH * TILE_H + CHUNK_TOP;
    const ctx = c.getContext('2d');
    const ox = CH * HALF_W;
    // global pixel offsets keep the grain seamless across chunks
    const gox = (x0 - y0) * HALF_W - ox, goy = (x0 + y0) * HALF_H - CHUNK_TOP;
    const samp = (f, x, y) => this.sampleField(f, x, y);
    const grain = this.grain;

    const G1 = [80, 112, 46], G2 = [128, 154, 70], DIRT = [138, 116, 80], ROCKG = [104, 98, 84];
    const SAND = [178, 162, 116], SHALLOW = [44, 104, 118], DEEP = [18, 48, 82], FOAM = [210, 225, 215];
    const DESERT = [204, 178, 122], SNOW = [226, 231, 236];

    const img = ctx.createImageData(c.width, c.height);
    const px = img.data;
    for (let py = 0; py < c.height; py++) {
      const Y = py - CHUNK_TOP;
      for (let pxi = 0; pxi < c.width; pxi++) {
        const X = pxi - ox;
        const lx = (X / HALF_W + Y / HALF_H) / 2, ly = (Y / HALF_H - X / HALF_W) / 2;
        if (lx < -CHUNK_BLEED || ly < -CHUNK_BLEED || lx >= CH + CHUNK_BLEED || ly >= CH + CHUNK_BLEED) continue;
        const x = x0 + lx, y = y0 + ly;
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        const o = (py * c.width + pxi) * 4;
        const gN = samp(F.grass, x, y), mott = (samp(F.mott, x, y) - 0.5) * 34;
        let r = G1[0] + (G2[0] - G1[0]) * gN + mott;
        let gg = G1[1] + (G2[1] - G1[1]) * gN + mott;
        let b = G1[2] + (G2[2] - G1[2]) * gN + mott * 0.6;
        const mix = (col, wgt, mo = 1) => { r += (col[0] + mott * mo - r) * wgt; gg += (col[1] + mott * mo - gg) * wgt; b += (col[2] + mott * mo - b) * wgt; };
        const dW = smoothstep(0.64, 0.76, samp(F.dirt, x, y)) * 0.85;
        if (dW > 0) mix(DIRT, dW);
        const deW = smoothstep(0.3, 0.6, samp(F.desert, x, y));
        if (deW > 0) mix(DESERT, deW, 0.7);
        const snW = smoothstep(0.3, 0.6, samp(F.snow, x, y));
        if (snW > 0) mix(SNOW, snW, 0.35);
        const rW = smoothstep(0.3, 0.6, samp(F.rock, x, y));
        if (rW > 0) mix(snW > 0.5 ? [170, 172, 176] : ROCKG, rW);
        const w = samp(F.water, x, y);
        if (w > 0.5) {
          const dpt = smoothstep(0.5, 0.95, w);
          const ripple = Math.sin((x * 3.1 + y * 2.3) * 2 + mott * 0.2) * 5;
          r = SHALLOW[0] + (DEEP[0] - SHALLOW[0]) * dpt + ripple;
          gg = SHALLOW[1] + (DEEP[1] - SHALLOW[1]) * dpt + ripple;
          b = SHALLOW[2] + (DEEP[2] - SHALLOW[2]) * dpt + ripple;
          const foam = 1 - smoothstep(0, 0.035, w - 0.5);
          if (foam > 0) { r += (FOAM[0] - r) * foam * 0.7; gg += (FOAM[1] - gg) * foam * 0.7; b += (FOAM[2] - b) * foam * 0.7; }
        } else if (w > 0.34) {
          mix(SAND, smoothstep(0.34, 0.46, w), 0.5);
        }
        const n = grain[((pxi + gox) * 7 + (py + goy) * 131) & 65535] / 255 - 0.5;
        const edge = 0.7 + 0.3 * smoothstep(0, 0.8, Math.min(x, y, S - x, S - y));
        px[o] = (r + n * 12) * edge;
        px[o + 1] = (gg + n * 12) * edge;
        px[o + 2] = (b + n * 10) * edge;
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // decorations, back to front
    const near = (x, y, r) => m.starts.some((s) => dist(x, y, s.x + 1.5, s.y + 1.5) < r);
    for (let s = 0; s < CH * 2; s++) {
      for (let lx = 0; lx <= s; lx++) {
        const ly = s - lx, x = x0 + lx, y = y0 + ly;
        if (lx >= CH || ly >= CH || !m.inBounds(x, y)) continue;
        const i = m.idx(x, y), t = m.terrain[i];
        const tcx = (lx - ly) * HALF_W + ox, tcy = (lx + ly) * HALF_H + HALF_H + CHUNK_TOP;
        if (t === WATER) continue;
        if (t === ROCK) { this.drawBoulders(ctx, tcx, tcy, x, y, m.biome[i] === 2); continue; }
        if (m.oreMax[i] || near(x, y, 5)) continue;
        const h = hashTile(x * 3 + 1, y * 5 + 2), biome = m.biome[i];
        if (biome === 2) continue; // bare snow
        if (biome === 1) { if (h < 0.06) this.drawPebbles(ctx, tcx, tcy, x, y); continue; }
        if (h < 0.05) this.drawBush(ctx, tcx + (hashTile(x, y) - 0.5) * 30, tcy + (hashTile(y, x) - 0.5) * 12, 3 + h * 60);
        else if (h < 0.13) this.drawTufts(ctx, tcx, tcy, x, y);
        else if (h < 0.17) this.drawPebbles(ctx, tcx, tcy, x, y);
        else if (h < 0.19) this.drawFlowers(ctx, tcx, tcy, x, y);
      }
    }
    return c;
  }

  // Tile-coordinate bounds of what's on screen (with a margin)
  visibleTiles(margin = 2) {
    const S = this.g.map.w;
    const pts = [[0, 0], [this.viewW, 0], [0, this.viewH], [this.viewW, this.viewH]].map(([x, y]) => this.toWorld(x, y));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return {
      x0: Math.max(0, Math.floor(Math.min(...xs)) - margin), x1: Math.min(S - 1, Math.ceil(Math.max(...xs)) + margin),
      y0: Math.max(0, Math.floor(Math.min(...ys)) - margin), y1: Math.min(S - 1, Math.ceil(Math.max(...ys)) + margin),
    };
  }

  drawTerrain() {
    const ctx = this.ctx, S = this.g.map.w;
    const n = Math.ceil(S / CHUNK);
    const v = this.visibleTiles(CHUNK);
    const cx0 = Math.floor(v.x0 / CHUNK), cx1 = Math.floor(v.x1 / CHUNK);
    const cy0 = Math.floor(v.y0 / CHUNK), cy1 = Math.floor(v.y1 / CHUNK);
    const visible = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const p = this.toScreen(cx * CHUNK, cy * CHUNK);
        const left = p.x - CHUNK * HALF_W, top = p.y - CHUNK_TOP;
        if (left > this.viewW || left + CHUNK * TILE_W < 0 || top > this.viewH || top + CHUNK * TILE_H + CHUNK_TOP < 0) continue;
        visible.push({ cx, cy, left, top });
      }
    }
    // back to front, so boulders poking up from a nearer chunk overlap the one behind
    visible.sort((a, b) => a.cx + a.cy - (b.cx + b.cy));
    for (const c of visible) {
      const key = c.cy * n + c.cx;
      let ch = this.chunks.get(key);
      if (!ch) { ch = { canvas: this.renderChunk(c.cx, c.cy) }; this.chunks.set(key, ch); }
      ch.used = ++this.chunkUse;
      ctx.drawImage(ch.canvas, Math.round(c.left), Math.round(c.top));
    }
    // Prefetch one neighbouring chunk per frame, and forget the least recently used ones
    for (let cy = cy0 - 1; cy <= cy1 + 1; cy++) {
      for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) {
        if (cx < 0 || cy < 0 || cx >= n || cy >= n || this.chunks.has(cy * n + cx)) continue;
        this.chunks.set(cy * n + cx, { canvas: this.renderChunk(cx, cy), used: this.chunkUse });
        cy = Infinity;
        break;
      }
    }
    if (this.chunks.size > MAX_CHUNKS) {
      const old = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.chunks.size - MAX_CHUNKS);
      for (const [k] of old) this.chunks.delete(k);
    }
  }

  drawBoulders(ctx, cx, cy, x, y, snowy = false) {
    const n = 2 + Math.floor(hashTile(x, y + 9) * 3);
    for (let k = 0; k < n; k++) {
      const bx = cx + (hashTile(x + k, y * 3) - 0.5) * 34, by = cy + (hashTile(x * 5, y + k) - 0.5) * 12 + k * 2;
      const r = 7 + hashTile(x + k * 7, y) * 9, h = r * (0.9 + hashTile(y, x + k) * 0.8);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(bx + 3, by + 1, r * 1.1, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      // dark (right) face
      ctx.fillStyle = snowy ? '#6c707a' : '#4a463e';
      ctx.beginPath();
      ctx.moveTo(bx - r, by); ctx.lineTo(bx - r * 0.4, by - h); ctx.lineTo(bx + r * 0.3, by - h * 1.05);
      ctx.lineTo(bx + r, by - h * 0.2); ctx.lineTo(bx + r * 0.6, by + r * 0.3); ctx.lineTo(bx - r * 0.5, by + r * 0.35);
      ctx.closePath(); ctx.fill();
      // lit (left/top) faces; snowy peaks get white caps
      ctx.fillStyle = snowy ? '#b9bec6' : '#7d776a';
      ctx.beginPath();
      ctx.moveTo(bx - r, by); ctx.lineTo(bx - r * 0.4, by - h); ctx.lineTo(bx + r * 0.3, by - h * 1.05); ctx.lineTo(bx - r * 0.05, by - h * 0.35);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = snowy ? '#f2f5f8' : '#9a9384';
      ctx.beginPath();
      ctx.moveTo(bx - r * 0.4, by - h); ctx.lineTo(bx + r * 0.3, by - h * 1.05); ctx.lineTo(bx + r * 0.05, by - h * 0.6);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx - r * 0.05, by - h * 0.35); ctx.lineTo(bx + r * 0.2, by + r * 0.2); ctx.stroke();
    }
  }

  drawBush(ctx, x, y, r) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(x + 3, y + 1, r * 1.4, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    const blobs = [[-0.6, -0.5, 0.75], [0.5, -0.4, 0.8], [0, -0.9, 0.85], [0, -0.3, 0.9]];
    for (const [dx, dy, s] of blobs) {
      ctx.fillStyle = '#2c4a1e';
      ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, r * s, 0, Math.PI * 2); ctx.fill();
    }
    for (const [dx, dy, s] of blobs) {
      ctx.fillStyle = '#4c7030';
      ctx.beginPath(); ctx.arc(x + dx * r - r * 0.2, y + dy * r - r * 0.25, r * s * 0.55, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawTufts(ctx, cx, cy, x, y) {
    ctx.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      const tx = cx + (hashTile(x + k, y * 2) - 0.5) * 40, ty = cy + (hashTile(x * 2, y + k) - 0.5) * 16;
      ctx.strokeStyle = k % 2 ? 'rgba(40,62,22,0.9)' : 'rgba(132,150,70,0.8)';
      ctx.beginPath();
      ctx.moveTo(tx - 2, ty); ctx.lineTo(tx - 3, ty - 4);
      ctx.moveTo(tx, ty); ctx.lineTo(tx, ty - 5);
      ctx.moveTo(tx + 2, ty); ctx.lineTo(tx + 3, ty - 4);
      ctx.stroke();
    }
  }

  drawPebbles(ctx, cx, cy, x, y) {
    for (let k = 0; k < 4; k++) {
      const tx = cx + (hashTile(x + k, y + 3) - 0.5) * 36, ty = cy + (hashTile(x + 5, y + k) - 0.5) * 14;
      const r = 1.5 + hashTile(x, k) * 2;
      ctx.fillStyle = '#5a564c';
      ctx.beginPath(); ctx.ellipse(tx, ty, r * 1.3, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a19b8c';
      ctx.beginPath(); ctx.ellipse(tx - 0.5, ty - 0.6, r * 0.7, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawFlowers(ctx, cx, cy, x, y) {
    const colors = ['#e8e0a0', '#d88aa8', '#f0f0f0', '#e6b84a'];
    for (let k = 0; k < 7; k++) {
      const tx = cx + (hashTile(x + k, y) - 0.5) * 30, ty = cy + (hashTile(x, y + k) - 0.5) * 12;
      ctx.fillStyle = colors[(x + y + k) % colors.length];
      ctx.fillRect(tx, ty, 1.5, 1.5);
    }
  }

  // Animated glints on visible water
  drawWater() {
    const ctx = this.ctx, g = this.g, S = g.map.w, m = g.map;
    const v = this.visibleTiles();
    ctx.lineWidth = 1;
    for (let y = v.y0; y <= v.y1; y++) for (let x = v.x0; x <= v.x1; x++) {
      const i = y * S + x;
      if (m.terrain[i] !== WATER || !g.explored[i]) continue;
      const h = hashTile(x, y);
      const a = Math.sin(this.time * 1.6 + h * 40);
      if (a < 0.55) continue;
      const p = this.toScreen(x + 0.3 + h * 0.4, y + 0.6 - h * 0.3);
      if (!this.onScreen(p, 20)) continue;
      ctx.strokeStyle = `rgba(200,230,240,${(a - 0.55) * 0.9})`;
      ctx.beginPath(); ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y); ctx.stroke();
    }
  }

  // ---------- main draw ----------
  draw(dt, input) {
    this.time += dt;
    const ctx = this.ctx, g = this.g;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    this.drawTerrain();

    this.drawWater();
    this.drawOre();
    this.drawGroundLayer(input);

    // Depth-sorted entities
    const list = [];
    for (const b of g.buildings) {
      if (!g.isExplored(b.x, b.y)) continue;
      list.push({ d: b.tx + b.ty + (b.w + b.h) / 2, e: b });
    }
    const air = [];
    for (const u of g.units) {
      if (u.owner !== g.human && !g.isExplored(u.x, u.y)) continue;
      // parked aircraft sit with the ground layer; flying ones go on top
      if (u.isAir && u.z > 4) air.push(u);
      else list.push({ d: u.x + u.y + (u.isAir ? 0.5 : 0), e: u });
    }
    list.sort((a, b) => a.d - b.d);
    for (const { e } of list) {
      if (e.isBuilding) this.drawBuilding(e);
      else if (this.onScreen(this.toScreen(e.x, e.y))) this.drawUnit(e);
    }
    air.sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const u of air) if (this.onScreen(this.toScreen(u.x, u.y, u.z))) this.drawAircraft(u);

    this.drawProjectiles();
    this.drawEffects();
    this.drawShroud();

    // Overlays: veterancy chevrons, selection + health bars
    for (const u of g.units) {
      if (!u.rank || (u.owner !== g.human && !g.isExplored(u.x, u.y))) continue;
      if (this.onScreen(this.toScreen(u.x, u.y))) this.drawRank(u);
    }
    if (settings.healthBars !== 'selected') {
      for (const list of [g.buildings, g.units]) {
        for (const e of list) {
          if (input.selection.includes(e) || (settings.healthBars === 'damaged' && e.hp >= e.maxHp)) continue;
          if (e.owner !== g.human && !g.isExplored(e.x, e.y)) continue;
          if (this.onScreen(this.toScreen(e.x, e.y))) this.drawHealthBar(e);
        }
      }
    }
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
      // ore-stained soil, stronger on rich tiles
      const f = Math.min(1, amt / 450);
      ctx.fillStyle = `rgba(150,112,36,${0.16 + 0.2 * f})`;
      ctx.beginPath(); ctx.ellipse(c.x, c.y, 28, 13, 0, 0, Math.PI * 2); ctx.fill();
      const n = Math.min(7, Math.ceil(amt / 95));
      // back-to-front so nearer crystals overlap farther ones
      const gems = [];
      for (let k = 0; k < n; k++) {
        const ox = (hashTile(x * 7 + k, y) - 0.5) * 0.8, oy = (hashTile(x, y * 7 + k) - 0.5) * 0.8;
        gems.push({ ox, oy, s: 2.5 + hashTile(x + k, y + k) * 3.5 * (0.6 + 0.4 * f), k });
      }
      gems.sort((a, b) => a.ox + a.oy - (b.ox + b.oy));
      for (const gm of gems) {
        const p = this.toScreen(x + 0.5 + gm.ox, y + 0.5 + gm.oy);
        this.oreCrystal(p.x, p.y, gm.s, hashTile(x * 13 + gm.k, y * 11));
      }
    }
  }

  oreCrystal(x, y, s, h) {
    const ctx = this.ctx;
    const tip = { x: x + (h - 0.5) * s * 0.6, y: y - s * 2.2 };
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x + 1.5, y + 0.5, s * 1.1, s * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    // shadowed left facet
    ctx.fillStyle = '#8c6610';
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(x - s * 0.8, y - s * 0.5); ctx.lineTo(x - s * 0.5, y + s * 0.15); ctx.lineTo(x, y + s * 0.35); ctx.closePath(); ctx.fill();
    // lit right facet
    ctx.fillStyle = '#e3b42c';
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(x, y + s * 0.35); ctx.lineTo(x + s * 0.6, y + s * 0.1); ctx.lineTo(x + s * 0.8, y - s * 0.5); ctx.closePath(); ctx.fill();
    // highlight sliver
    ctx.fillStyle = '#fff1a8';
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(x + s * 0.15, y - s * 0.2); ctx.lineTo(x + s * 0.35, y - s * 0.4); ctx.closePath(); ctx.fill();
    // occasional twinkle
    if (Math.sin(this.time * 2.5 + h * 60) > 0.985) {
      ctx.strokeStyle = 'rgba(255,255,230,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(tip.x - 4, tip.y); ctx.lineTo(tip.x + 4, tip.y); ctx.moveTo(tip.x, tip.y - 4); ctx.lineTo(tip.x, tip.y + 4); ctx.stroke();
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
          ctx.fillStyle = (x + y) % 2 ? '#5d5c55' : '#57564f';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      // drop shadow cast toward the lower right (light comes from the upper left)
      const sh = b.def.height * b.buildAnim * 0.9;
      const a = this.toScreen(b.tx, b.ty), r = this.toScreen(b.tx + b.w, b.ty);
      const cc = this.toScreen(b.tx + b.w, b.ty + b.h), d = this.toScreen(b.tx, b.ty + b.h);
      const dx = sh * 0.9, dy = sh * 0.2;
      this.poly([a, { x: a.x + dx, y: a.y + dy }, { x: r.x + dx, y: r.y + dy }, { x: cc.x + dx, y: cc.y + dy }, cc, d], 'rgba(0,0,0,0.28)');
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
      if (u.isNaval) { this.drawWake(u); continue; }
      const r = u.radius * HALF_W * 1.4;
      // aircraft shadows drift away and shrink with altitude
      const off = u.isAir ? u.z * 0.35 : 0, k = u.isAir ? 1 - u.z / 120 : 1;
      ctx.fillStyle = u.isAir ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(p.x + 2 + off, p.y + 1 + off * 0.3, r * k, r * 0.5 * k, 0, 0, Math.PI * 2);
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

  // Vertical gradient for a wall face: lighter at the top, darker at the base
  faceGradient(pts, color) {
    const ys = pts.map((p) => p.y);
    const g = this.ctx.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
    g.addColorStop(0, shade(color, 0.12));
    g.addColorStop(1, shade(color, -0.22));
    return g;
  }

  // Iso box from world rect (x0,y0)-(x1,y1), from height z0 to z1.
  // opts.windows adds a row of windows; small boxes skip the surface detail.
  box(x0, y0, x1, y1, z0, z1, top, left, right, opts = {}) {
    const ctx = this.ctx;
    const s = (x, y, z) => this.toScreen(x, y, z);
    const edge = 'rgba(0,0,0,0.4)';
    const L = [s(x0, y1, z0), s(x1, y1, z0), s(x1, y1, z1), s(x0, y1, z1)];
    const R = [s(x1, y1, z0), s(x1, y0, z0), s(x1, y0, z1), s(x1, y1, z1)];
    const T = [s(x0, y0, z1), s(x1, y0, z1), s(x1, y1, z1), s(x0, y1, z1)];
    const tall = z1 - z0 >= 10;
    this.poly(L, tall ? this.faceGradient(L, left) : left, edge);
    this.poly(R, tall ? this.faceGradient(R, right) : right, edge);
    this.poly(T, top, edge);
    if (!tall) return;

    // panel seams
    ctx.strokeStyle = 'rgba(0,0,0,0.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0 + 0.5; x < x1 - 0.1; x += 0.5) { const a = s(x, y1, z0), b = s(x, y1, z1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    for (let y = y0 + 0.5; y < y1 - 0.1; y += 0.5) { const a = s(x1, y, z0), b = s(x1, y, z1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();

    // windows
    if (opts.windows) {
      const zA = z0 + (z1 - z0) * 0.45, zB = z0 + (z1 - z0) * 0.68;
      for (let x = x0 + 0.25; x < x1 - 0.3; x += 0.42) {
        const lit = hashTile(Math.round(x * 10), Math.round(y1 * 10)) < 0.55;
        this.poly([s(x, y1, zA), s(x + 0.2, y1, zA), s(x + 0.2, y1, zB), s(x, y1, zB)], lit ? 'rgba(255,214,120,0.85)' : 'rgba(28,38,54,0.9)');
      }
      for (let y = y0 + 0.25; y < y1 - 0.3; y += 0.42) {
        const lit = hashTile(Math.round(x1 * 10), Math.round(y * 10)) < 0.4;
        this.poly([s(x1, y, zA), s(x1, y + 0.2, zA), s(x1, y + 0.2, zB), s(x1, y, zB)], lit ? 'rgba(255,214,120,0.75)' : 'rgba(40,52,70,0.9)');
      }
    }

    // parapet rim on larger roofs
    if (x1 - x0 > 0.8 && y1 - y0 > 0.8) {
      const r = 0.12;
      this.poly([s(x0 + r, y0 + r, z1), s(x1 - r, y0 + r, z1), s(x1 - r, y1 - r, z1), s(x0 + r, y1 - r, z1)], shade(top, -0.12));
    }

    // lit top edges + dark contact line at the base
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.moveTo(T[3].x, T[3].y); ctx.lineTo(T[2].x, T[2].y); ctx.lineTo(T[1].x, T[1].y); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(L[0].x, L[0].y); ctx.lineTo(L[1].x, L[1].y); ctx.lineTo(R[1].x, R[1].y); ctx.stroke();
  }

  cylinder(x, y, z, r, h, color, band) {
    const ctx = this.ctx;
    const p = this.toScreen(x, y, z);
    const ry = r * 0.5;
    // horizontal gradient gives the body a rounded look
    const grad = ctx.createLinearGradient(p.x - r, 0, p.x + r, 0);
    grad.addColorStop(0, shade(color, -0.45));
    grad.addColorStop(0.6, shade(color, 0.05));
    grad.addColorStop(1, shade(color, -0.25));
    ctx.fillStyle = grad;
    ctx.fillRect(p.x - r, p.y - h, r * 2, h);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, ry, 0, 0, Math.PI);
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
        this.box(x0, y0, x1, y1, 0, H, ROOF, shade(WALL, -0.35), shade(WALL, -0.1), { windows: true });
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
        this.box(x0, y0, x1 - 1, y0 + 1, 0, H, ROOF, shade(WALL, -0.4), shade(WALL, -0.15), { windows: true });
        this.cylinder(b.tx + 2.4, b.ty + 0.6, 0, 14, H + 10 * k, '#c9b46a', team);
        // conveyor
        this.box(x0 + 1, y1 - 0.5, x0 + 1.9, y1, 0, 8 * k, '#3a3a36', '#2a2a26', '#333');
        break;
      }
      case 'barracks': {
        this.box(x0, y0, x1, y1, 0, H, ROOF, shade(WALL, -0.35), shade(WALL, -0.1), { windows: true });
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
        this.box(x0, y0, x1, y1, 0, H, ROOF, shade(WALL, -0.35), shade(WALL, -0.1), { windows: true });
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
      case 'airfield': {
        // low apron with a runway, parking circles and a small control tower
        this.box(x0, y0, x1, y1, 0, 4 * k, '#5a5a56', '#3e3e3a', '#4a4a46');
        const run = [s(x0 + 0.2, y1 - 0.75, 4), s(x1 - 0.2, y1 - 0.75, 4), s(x1 - 0.2, y1 - 0.25, 4), s(x0 + 0.2, y1 - 0.25, 4)];
        this.poly(run, '#36363a');
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        const ra = s(x0 + 0.3, y1 - 0.5, 4), rb = s(x1 - 0.3, y1 - 0.5, 4);
        ctx.beginPath(); ctx.moveTo(ra.x, ra.y); ctx.lineTo(rb.x, rb.y); ctx.stroke();
        ctx.setLineDash([]);
        for (let n = 0; n < 4; n++) {
          const pc = s(b.tx + 0.8 + (n % 2) * 1.4, b.ty + 0.8 + Math.floor(n / 2) * 1.4 - 0.3, 4);
          ctx.strokeStyle = shade(team, 0.1);
          ctx.beginPath(); ctx.ellipse(pc.x, pc.y, 11, 5.5, 0, 0, Math.PI * 2); ctx.stroke();
        }
        this.box(x1 - 0.7, y0 + 0.05, x1 - 0.1, y0 + 0.65, 4, 30 * k, ROOF, shade(WALL, -0.35), shade(WALL, -0.1), { windows: true });
        const bea = s(x1 - 0.4, y0 + 0.35, 32 * k);
        ctx.fillStyle = Math.floor(b.anim * 2) % 2 ? '#ff5a4a' : '#7a2a22';
        ctx.fillRect(bea.x - 2, bea.y - 2, 4, 4);
        break;
      }
      case 'shipyard': {
        // concrete piers around a wet dock, with a gantry crane
        const pier = (ax0, ay0, ax1, ay1) => this.box(ax0, ay0, ax1, ay1, 0, 6 * k, '#77766e', '#4c4b45', '#5d5c55');
        pier(x0, y0, x1, y0 + 0.5);
        pier(x0, y0 + 0.5, x0 + 0.5, y1);
        pier(x1 - 0.5, y0 + 0.5, x1, y1);
        this.box(x0 + 0.05, y0 + 0.05, x0 + 1.0, y0 + 0.5, 6, 20 * k, ROOF, shade(WALL, -0.35), shade(WALL, -0.1), { windows: true });
        this.teamStripe(x0 + 0.05, y0 + 0.05, x0 + 1.0, y0 + 0.5, 20 * k, team);
        const l1 = s(x0 + 0.25, y1 - 0.2, 6), l2 = s(x1 - 0.25, y1 - 0.2, 6);
        const t1 = s(x0 + 0.25, y1 - 0.2, 6 + 34 * k), t2 = s(x1 - 0.25, y1 - 0.2, 6 + 34 * k);
        ctx.strokeStyle = '#e0b43d';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(l1.x, l1.y); ctx.lineTo(t1.x, t1.y); ctx.lineTo(t2.x, t2.y); ctx.lineTo(l2.x, l2.y); ctx.stroke();
        const hk = s(b.x + Math.sin(b.anim * 0.5) * 0.8, y1 - 0.2, 6 + 34 * k);
        ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(hk.x, hk.y); ctx.lineTo(hk.x, hk.y + 16); ctx.stroke();
        break;
      }
      case 'aaBattery': {
        // sandbagged emplacement with twin barrels pointed skyward
        const c = s(b.x, b.y, 0);
        ctx.fillStyle = '#8f8160';
        ctx.beginPath(); ctx.ellipse(c.x, c.y - 3, 19, 9.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6e6248';
        ctx.beginPath(); ctx.ellipse(c.x, c.y - 6, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
        const base = s(b.x, b.y, 10 * k);
        ctx.fillStyle = shade(team, -0.25);
        ctx.beginPath(); ctx.ellipse(base.x, base.y, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
        for (const side of [-0.07, 0.07]) {
          const cs = Math.cos(b.turretDir), sn = Math.sin(b.turretDir);
          const a = s(b.x - sn * side, b.y + cs * side, 11 * k);
          const e = s(b.x - sn * side + cs * 0.35, b.y + cs * side + sn * 0.35, 26 * k);
          ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(e.x, e.y); ctx.stroke();
        }
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
    if (u.isAir) this.drawAircraft(u);
    else if (u.isNaval) this.drawShip(u);
    else if (u.isInfantry) this.drawInfantry(u);
    else this.drawVehicle(u);
  }

  // Polygon from points in the unit's local frame (x forward, y right), at height z
  local(u, pts, z) {
    const c = Math.cos(u.dir), s = Math.sin(u.dir);
    return pts.map(([lx, ly]) => this.toScreen(u.x + lx * c - ly * s, u.y + lx * s + ly * c, z));
  }

  drawAircraft(u) {
    const ctx = this.ctx, team = u.owner.color, L = u.def.size;
    const edge = 'rgba(0,0,0,0.6)';
    const z = u.z + (u.def.look === 'heli' && !u.landed ? Math.sin(this.time * 3 + u.id) * 1.5 : 0);
    if (u.def.look === 'heli') {
      // tail boom + tail rotor
      this.poly(this.local(u, [[-L * 0.2, 0.05], [-L * 1.35, 0.03], [-L * 1.35, -0.03], [-L * 0.2, -0.05]], z + 2), shade(team, -0.3), edge);
      const tr = this.toScreen(u.x - Math.cos(u.dir) * L * 1.3, u.y - Math.sin(u.dir) * L * 1.3, z + 5);
      ctx.strokeStyle = 'rgba(30,30,30,0.6)'; ctx.lineWidth = 1.5;
      const ta = this.time * 40;
      ctx.beginPath(); ctx.moveTo(tr.x, tr.y - 4 * Math.cos(ta)); ctx.lineTo(tr.x, tr.y + 4 * Math.cos(ta)); ctx.stroke();
      // fuselage with cockpit glass
      this.poly(this.local(u, [[L * 0.7, 0], [L * 0.45, L * 0.32], [-L * 0.4, L * 0.28], [-L * 0.5, 0], [-L * 0.4, -L * 0.28], [L * 0.45, -L * 0.32]], z), shade(team, -0.15), edge);
      this.poly(this.local(u, [[L * 0.68, 0], [L * 0.42, L * 0.2], [L * 0.25, 0], [L * 0.42, -L * 0.2]], z + 2), 'rgba(40,70,100,0.9)');
      // stub wings with rocket pods
      this.poly(this.local(u, [[0.05, L * 0.3], [0.05, L * 0.6], [-0.1, L * 0.6], [-0.1, L * 0.3]], z), '#333');
      this.poly(this.local(u, [[0.05, -L * 0.3], [0.05, -L * 0.6], [-0.1, -L * 0.6], [-0.1, -L * 0.3]], z), '#333');
      // main rotor: two blurred blades
      const hub = this.toScreen(u.x, u.y, z + 7);
      const spin = u.landed && u.z < 1 ? 0.3 : this.time * 22;
      ctx.strokeStyle = 'rgba(25,25,25,0.75)'; ctx.lineWidth = 2;
      for (const a of [spin, spin + Math.PI / 2]) {
        const rx = Math.cos(a) * L * 1.5 * HALF_W, ry = Math.sin(a) * L * 1.5 * HALF_H;
        ctx.beginPath(); ctx.moveTo(hub.x - rx, hub.y - ry); ctx.lineTo(hub.x + rx, hub.y + ry); ctx.stroke();
      }
      if (!u.landed) {
        ctx.fillStyle = 'rgba(200,200,200,0.12)';
        ctx.beginPath(); ctx.ellipse(hub.x, hub.y, L * 1.5 * HALF_W, L * 1.5 * HALF_H, 0, 0, Math.PI * 2); ctx.fill();
      }
      return;
    }
    if (u.def.look === 'bomber') {
      // long fuselage, broad straight wings, four engines
      this.poly(this.local(u, [[L * 0.15, -L * 1.1], [L * 0.3, -L * 1.1], [L * 0.2, L * 1.1], [L * 0.05, L * 1.1]].map(([a, b]) => [a, -b]), z), shade(team, -0.35), edge);
      this.poly(this.local(u, [[L * 1.0, 0], [L * 0.8, L * 0.12], [-L * 0.9, L * 0.1], [-L * 1.0, 0], [-L * 0.9, -L * 0.1], [L * 0.8, -L * 0.12]], z), shade(team, -0.1), edge);
      this.poly(this.local(u, [[L * 0.3, 0], [L * 0.1, L * 1.1], [-L * 0.05, L * 1.1], [-L * 0.1, 0], [-L * 0.05, -L * 1.1], [L * 0.1, -L * 1.1]], z + 1), shade(team, -0.2), edge);
      this.poly(this.local(u, [[-L * 0.8, 0], [-L * 0.95, L * 0.4], [-L * 1.05, L * 0.4], [-L * 1.0, 0], [-L * 1.05, -L * 0.4], [-L * 0.95, -L * 0.4]], z + 1), shade(team, -0.25), edge);
      for (const sy of [-0.75, -0.4, 0.4, 0.75]) {
        const e = this.local(u, [[L * 0.2, L * sy]], z)[0];
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.ellipse(e.x, e.y, 2.5, 1.5, 0, 0, Math.PI * 2); ctx.fill();
      }
      return;
    }
    // jet: swept delta wing, twin tail fins, afterburner glow when flying
    this.poly(this.local(u, [[L * 1.1, 0], [-L * 0.2, L * 0.75], [-L * 0.55, L * 0.75], [-L * 0.75, L * 0.15], [-L * 0.75, -L * 0.15], [-L * 0.55, -L * 0.75], [-L * 0.2, -L * 0.75]], z), shade(team, -0.15), edge);
    this.poly(this.local(u, [[L * 1.1, 0], [L * 0.2, L * 0.12], [-L * 0.75, L * 0.1], [-L * 0.75, -L * 0.1], [L * 0.2, -L * 0.12]], z + 1.5), shade(team, 0.1), edge);
    this.poly(this.local(u, [[L * 0.85, 0], [L * 0.5, L * 0.07], [L * 0.35, 0], [L * 0.5, -L * 0.07]], z + 2.5), 'rgba(40,70,100,0.95)');
    for (const sy of [-0.22, 0.22]) {
      this.poly(this.local(u, [[-L * 0.45, L * sy], [-L * 0.75, L * sy], [-L * 0.8, L * sy]], z + 8).concat(this.local(u, [[-L * 0.75, L * sy]], z)), shade(team, -0.35), edge);
    }
    if (!u.landed && u.z > 10) {
      const t = this.local(u, [[-L * 0.85, 0]], z + 1)[0];
      ctx.fillStyle = `rgba(255,170,60,${0.6 + Math.random() * 0.3})`;
      ctx.beginPath(); ctx.arc(t.x, t.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawWake(u) {
    if (!u.moving) return;
    const ctx = this.ctx, L = u.def.size;
    const c = Math.cos(u.dir), s = Math.sin(u.dir);
    ctx.strokeStyle = 'rgba(230,240,245,0.55)';
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      const a = this.toScreen(u.x - c * L * 0.6 - s * L * 0.3 * side, u.y - s * L * 0.6 + c * L * 0.3 * side, 0);
      const b = this.toScreen(u.x - c * L * 1.8 - s * L * 0.9 * side, u.y - s * L * 1.8 + c * L * 0.9 * side, 0);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  drawShip(u) {
    const ctx = this.ctx, team = u.owner.color, L = u.def.size, W = L * 0.36;
    const edge = 'rgba(0,0,0,0.6)';
    const look = u.def.look;
    const hullCol = look === 'battleship' ? '#55585c' : look === 'frigate' ? '#8a9096' : '#6c7176';
    // waterline hull, then deck
    const hull = [[L, 0], [L * 0.55, W], [-L * 0.9, W * 0.92], [-L, W * 0.6], [-L, -W * 0.6], [-L * 0.9, -W * 0.92], [L * 0.55, -W]];
    this.poly(this.local(u, hull, 1), shade(hullCol, -0.35), edge);
    this.poly(this.local(u, hull.map(([a, b]) => [a * 0.94, b * 0.85]), 5), hullCol, edge);
    // team-coloured deck stripe
    this.poly(this.local(u, [[L * 0.5, W * 0.12], [-L * 0.85, W * 0.12], [-L * 0.85, -W * 0.12], [L * 0.5, -W * 0.12]], 5.5), shade(team, -0.2));
    // superstructure / bridge
    const bx = look === 'boat' ? -L * 0.15 : -L * 0.05;
    const br = [[bx + L * 0.22, W * 0.45], [bx - L * 0.25, W * 0.45], [bx - L * 0.25, -W * 0.45], [bx + L * 0.22, -W * 0.45]];
    const tall = look === 'battleship' ? 16 : look === 'frigate' ? 14 : 10;
    this.poly(this.local(u, br, tall), shade(hullCol, 0.15), edge);
    const lw = this.local(u, br, 5), up = this.local(u, br, tall);
    this.poly([lw[1], lw[2], up[2], up[1]], shade(hullCol, -0.2), edge);
    this.poly([lw[0], lw[1], up[1], up[0]], shade(hullCol, -0.05), edge);
    if (look === 'frigate') {
      // radar mast and missile cells
      const m1 = this.local(u, [[bx, 0]], tall)[0], m2 = this.local(u, [[bx, 0]], tall + 12)[0];
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();
      ctx.fillStyle = '#ddd';
      ctx.fillRect(m2.x - 4, m2.y - 1, 8, 2);
      this.poly(this.local(u, [[L * 0.62, W * 0.35], [L * 0.32, W * 0.35], [L * 0.32, -W * 0.35], [L * 0.62, -W * 0.35]], 6), '#3c4046', edge);
    }
    // gun turrets
    const turretAt = (fx, size) => {
      const tx = u.x + Math.cos(u.dir) * L * fx, ty = u.y + Math.sin(u.dir) * L * fx;
      const t = { x: tx, y: ty, turretDir: u.turretDir };
      const len = size * 0.06;
      this.gunBarrel(t, 9, len, size > 7 ? 3 : 2, '#2a2a2a', size > 7 ? 0.05 : 0);
      if (size > 7) this.gunBarrel(t, 9, len, 3, '#2a2a2a', -0.05);
      const p = this.toScreen(tx, ty, 8);
      ctx.fillStyle = shade(team, -0.1);
      ctx.beginPath(); ctx.ellipse(p.x, p.y, size, size * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
    };
    if (look === 'battleship') { turretAt(0.6, 9); turretAt(-0.65, 9); }
    else if (look === 'boat') turretAt(0.5, 5);
    else if (look !== 'frigate') turretAt(0.5, 6);
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
    this.treads(u, L, W);
    if (u.def.look === 'harvester') {
      this.drawHarvester(u, L, W, team);
      ctx.globalAlpha = 1;
      return;
    }
    const c = Math.cos(u.dir), s = Math.sin(u.dir);
    const edge = 'rgba(0,0,0,0.6)';
    // lower hull, upper deck, sloped front glacis
    this.poly(this.quad(u.x, u.y, u.dir, L * 0.92, W * 0.8, 5), shade(team, -0.5), edge);
    this.poly(this.quad(u.x - c * L * 0.04, u.y - s * L * 0.04, u.dir, L * 0.8, W * 0.7, 9), shade(team, -0.18), edge);
    this.poly(this.quad(u.x + c * L * 0.66, u.y + s * L * 0.66, u.dir, L * 0.16, W * 0.68, 8), shade(team, 0.08), edge);
    // engine grille on the rear deck
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = -0.75; t <= -0.45; t += 0.1) {
      const a = this.toScreen(u.x + c * L * t - s * W * 0.45, u.y + s * L * t + c * W * 0.45, 9);
      const b = this.toScreen(u.x + c * L * t + s * W * 0.45, u.y + s * L * t - c * W * 0.45, 9);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    if (u.def.look === 'prism') {
      const base = this.toScreen(u.x, u.y, 10);
      ctx.fillStyle = '#3a3f48';
      ctx.beginPath(); ctx.ellipse(base.x, base.y, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
      this.crystal(u.x, u.y, 10, 18, u.cooldown <= 0, this.time + u.id);
      return;
    }

    // Draw the barrel in front of the turret when it points toward the camera
    const facing = Math.cos(u.turretDir) + Math.sin(u.turretDir) > 0;
    const barrels = () => {
      if (u.def.barrels === 2) {
        this.cannon(u, 13, L * 1.3, 3, 0.09);
        this.cannon(u, 13, L * 1.3, 3, -0.09);
      } else {
        this.cannon(u, 13, L * 1.35, L > 0.45 ? 4 : 3, 0);
      }
    };
    if (!facing) barrels();
    this.turret(u, L, team);
    if (facing) barrels();
  }

  // Two tracks with segments that roll as the vehicle moves
  treads(u, L, W) {
    const ctx = this.ctx;
    const c = Math.cos(u.dir), s = Math.sin(u.dir);
    const tw = W * 0.3;
    for (const side of [-1, 1]) {
      const cx = u.x - s * W * 0.72 * side, cy = u.y + c * W * 0.72 * side;
      this.poly(this.quad(cx, cy, u.dir, L, tw, 3), '#1d1d1b', 'rgba(0,0,0,0.75)');
      ctx.strokeStyle = 'rgba(130,128,118,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const off = (u.anim * 0.12) % 0.16;
      for (let t = -L + off; t < L; t += 0.16) {
        const a = this.toScreen(cx + c * t - s * tw, cy + s * t + c * tw, 3.5);
        const b = this.toScreen(cx + c * t + s * tw, cy + s * t - c * tw, 3.5);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
  }

  turret(u, L, team) {
    const ctx = this.ctx;
    const base = this.toScreen(u.x, u.y, 10), t = this.toScreen(u.x, u.y, 13);
    const rx = 3 + L * 12, ry = rx * 0.62;
    // turret ring + body with a highlight toward the upper left
    ctx.fillStyle = shade(team, -0.55);
    ctx.beginPath(); ctx.ellipse(base.x, base.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(t.x - rx, t.y, rx * 2, base.y - t.y);
    const grad = ctx.createRadialGradient(t.x - rx * 0.35, t.y - ry * 0.4, 1, t.x, t.y, rx * 1.1);
    grad.addColorStop(0, shade(team, 0.35));
    grad.addColorStop(1, shade(team, -0.25));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.ellipse(t.x, t.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // commander's hatch, behind the gun
    const h = this.toScreen(u.x - Math.cos(u.turretDir) * L * 0.3, u.y - Math.sin(u.turretDir) * L * 0.3, 14);
    ctx.fillStyle = shade(team, -0.4);
    ctx.beginPath(); ctx.ellipse(h.x, h.y, rx * 0.32, ry * 0.32, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Gun barrel with outline and a muzzle brake at the tip
  cannon(u, z, len, width, side) {
    this.gunBarrel(u, z, len, width + 2, 'rgba(0,0,0,0.75)', side);
    this.gunBarrel(u, z, len, width, '#4a4a44', side);
    const c = Math.cos(u.turretDir), s = Math.sin(u.turretDir);
    const tip = { x: u.x + c * (len - 0.08) - s * side, y: u.y + s * (len - 0.08) + c * side, turretDir: u.turretDir };
    this.gunBarrel(tip, z, 0.1, width + 2, '#222', 0);
  }

  drawHarvester(u, L, W, team) {
    const chrono = u.def.chrono;
    const edge = 'rgba(0,0,0,0.55)';
    const body = chrono ? '#b59a52' : '#7d6c4a';
    this.poly(this.quad(u.x, u.y, u.dir, L * 0.95, W * 0.82, 5), shade(body, -0.45), edge);
    this.poly(this.quad(u.x, u.y, u.dir, L * 0.9, W * 0.8, 9), body, edge);
    // cab with a windshield facing forward
    const c = Math.cos(u.dir), s = Math.sin(u.dir);
    const cx = u.x + c * L * 0.55, cy = u.y + s * L * 0.55;
    this.poly(this.quad(cx, cy, u.dir, L * 0.35, W * 0.78, 16), shade(team, -0.1), edge);
    this.poly(this.quad(cx + c * L * 0.3, cy + s * L * 0.3, u.dir, L * 0.06, W * 0.6, 16.5), 'rgba(40,60,80,0.9)');
    // hopper with rim and ore load
    const hx = u.x - c * L * 0.3, hy = u.y - s * L * 0.3;
    this.poly(this.quad(hx, hy, u.dir, L * 0.52, W * 0.76, 15), '#4e4836', edge);
    this.poly(this.quad(hx, hy, u.dir, L * 0.44, W * 0.64, 15), '#2e2a20');
    if (u.cargo > 0) {
      const f = u.cargo / u.def.capacity;
      this.poly(this.quad(hx, hy, u.dir, L * 0.42 * f + 0.04, W * 0.6, 16), '#e3b42c');
      const p = this.toScreen(hx, hy, 17);
      this.ctx.fillStyle = 'rgba(255,240,160,0.8)';
      this.ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
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
    const gear = u.def.gear;
    const bulky = gear === 'tesla';
    const soviet = u.owner.faction === 'soviet';
    const outline = 'rgba(0,0,0,0.55)';
    // facing as a screen-space unit vector
    const c = Math.cos(u.dir), s = Math.sin(u.dir);
    let vx = (c - s) * HALF_W, vy = (c + s) * HALF_H;
    const len = Math.hypot(vx, vy) || 1;
    vx /= len; vy /= len;
    const back = vy < 0; // facing away from the camera

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1.2, 1.2);
    ctx.lineWidth = 0.8;
    // legs (boots + trousers), alternating while walking
    const uniform = soviet ? '#5a5240' : '#4b5a3a';
    for (const [lx, lift] of [[-2.5, Math.max(0, step)], [0.5, Math.max(0, -step)]]) {
      ctx.fillStyle = uniform;
      ctx.fillRect(lx, -6 + lift, 2, 4.5 - lift);
      ctx.fillStyle = '#1e1c18';
      ctx.fillRect(lx, -1.5, 2, 1.5);
    }
    // backpack (drawn first when facing the camera, so it sits behind)
    const pack = () => {
      ctx.fillStyle = gear === 'tesla' ? '#2e333b' : '#3c3a2e';
      ctx.fillRect(-2.5 - vx * 2, -11, 5, 5);
      if (gear === 'tesla') {
        ctx.fillStyle = `rgba(120,200,255,${0.6 + Math.sin(this.time * 6 + u.id) * 0.3})`;
        ctx.fillRect(-1 - vx * 2, -10, 2, 3);
      }
    };
    if (!back) pack();
    // torso
    const tw = bulky ? 8 : 6;
    ctx.fillStyle = bulky ? '#4a4f58' : shade(team, -0.15);
    ctx.fillRect(-tw / 2, -12, tw, 7);
    ctx.strokeStyle = outline;
    ctx.strokeRect(-tw / 2, -12, tw, 7);
    ctx.fillStyle = bulky ? team : 'rgba(0,0,0,0.35)';
    ctx.fillRect(-tw / 2, -7, tw, bulky ? 1.5 : 1); // belt / suit stripe
    if (back) pack();
    // head + headgear (Allies: helmet, Soviets: fur hat, Tesla: sealed helmet)
    ctx.fillStyle = '#e2b98f';
    ctx.beginPath(); ctx.arc(0, -14, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.stroke();
    if (bulky) {
      ctx.fillStyle = '#3a3e46';
      ctx.beginPath(); ctx.arc(0, -14.5, 3, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(140,210,255,0.8)';
      ctx.fillRect(-1.5 + vx, -14.5, 3, 1);
    } else if (soviet) {
      ctx.fillStyle = '#4a3b2c';
      ctx.fillRect(-2.8, -17.2, 5.6, 2.8);
      ctx.fillStyle = '#d33';
      ctx.fillRect(-0.5, -16.4, 1, 1);
    } else {
      ctx.fillStyle = shade(team, -0.4);
      ctx.beginPath(); ctx.arc(0, -14.6, 2.9, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-1.5, -16.8, 1.5, 0.8);
    }
    // arm + weapon
    ctx.strokeStyle = gear === 'rocket' ? '#5b6b3a' : gear === 'tesla' ? '#7fb8e0' : '#151515';
    ctx.lineWidth = gear === 'rifle' ? 1.4 : 2.6;
    const wl = gear === 'tesla' ? 5 : gear === 'rocket' ? 9 : 7.5;
    const sx = vx * 1.5, sy = -9.5;
    ctx.beginPath(); ctx.moveTo(sx - vx * 2, sy - vy * 2); ctx.lineTo(sx + vx * wl, sy + vy * wl); ctx.stroke();
    ctx.fillStyle = bulky ? '#4a4f58' : shade(team, -0.25);
    ctx.fillRect(sx + vx * 2 - 1, sy + vy * 2 - 1, 2, 2);
    ctx.restore();
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
      } else if (p.kind === 'bomb') {
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.ellipse(s.x, s.y, 2, 3.5, 0, 0, Math.PI * 2); ctx.fill();
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
        case 'promote': {
          ctx.globalAlpha = Math.min(1, t * 2);
          ctx.font = 'bold 11px Consolas, monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#000';
          ctx.fillText(e.rank === 2 ? 'ELITE' : 'PROMOTED', p.x + 1, p.y + 1);
          ctx.fillStyle = '#ffd94a';
          ctx.fillText(e.rank === 2 ? 'ELITE' : 'PROMOTED', p.x, p.y);
          ctx.textAlign = 'start';
          ctx.globalAlpha = 1;
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
        case 'flak': {
          // dark smoke puff with a short orange flash
          const r = 4 + (1 - t) * 8;
          ctx.fillStyle = `rgba(40,40,40,${t * 0.7})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
          if (t > 0.7) {
            ctx.fillStyle = `rgba(255,190,80,${(t - 0.7) * 3})`;
            ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.6, 0, Math.PI * 2); ctx.fill();
          }
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

  // The shroud is one pixel per tile (plus an opaque border), stretched onto the
  // isometric grid with smoothing, so its edge is a soft fade instead of tile outlines
  drawShroud() {
    const g = this.g, S = g.map.w, ctx = this.ctx;
    if (!this.fog) {
      this.fog = document.createElement('canvas');
      this.fog.width = this.fog.height = S + 2;
      this.fogStamp = -1;
    }
    if (this.fogStamp !== g.visStamp) {
      this.fogStamp = g.visStamp;
      const fctx = this.fog.getContext('2d');
      const img = fctx.createImageData(S + 2, S + 2);
      for (let y = -1; y <= S; y++) {
        for (let x = -1; x <= S; x++) {
          const inside = x >= 0 && y >= 0 && x < S && y < S;
          if (!inside || !g.explored[y * S + x]) img.data[((y + 1) * (S + 2) + x + 1) * 4 + 3] = 255;
        }
      }
      fctx.putImageData(img, 0, 0);
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.transform(HALF_W, HALF_H, -HALF_W, HALF_H, -this.cam.x, -this.cam.y);
    ctx.drawImage(this.fog, -1, -1);
    ctx.restore();
  }

  // ---------- overlays ----------
  entityRect(e) {
    if (e.isBuilding) {
      const b = this.buildingBounds(e);
      return { x: b.x, y: b.y + 14, w: b.x2 - b.x, h: b.y2 - b.y - 14 };
    }
    const p = this.toScreen(e.x, e.y, e.isAir ? e.z : 0);
    if (e.isInfantry) return { x: p.x - 7, y: p.y - 19, w: 14, h: 22 };
    if (e.isNaval) {
      const s = e.def.size * 40;
      return { x: p.x - s, y: p.y - s * 0.6 - 10, w: s * 2, h: s * 1.2 + 6 };
    }
    if (e.isAir) return { x: p.x - 20, y: p.y - 16, w: 40, h: 26 };
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
    if (e.isUnit && e.owner === this.g.human && (e.waypoints?.length || e.order.type === 'guard')) this.drawPlan(e);
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

  // Dashed line through a selected unit's current destination and its queued waypoints
  drawPlan(u) {
    const ctx = this.ctx, o = u.order;
    const COLOR = { move: 'rgba(120,255,120,0.7)', attackmove: 'rgba(255,110,110,0.7)', guard: 'rgba(110,170,255,0.8)' };
    const pts = [];
    if (o.type === 'guard') pts.push({ x: o.target ? o.target.x : o.x, y: o.target ? o.target.y : o.y, type: 'guard' });
    else if (o.x !== undefined) pts.push({ x: o.x, y: o.y, type: o.type });
    for (const w of u.waypoints || []) pts.push(w);
    let from = this.toScreen(u.x, u.y);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    for (const p of pts) {
      const to = this.toScreen(p.x, p.y);
      ctx.strokeStyle = COLOR[p.type] || COLOR.move;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.ellipse(to.x, to.y, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
      from = to;
    }
    ctx.setLineDash([]);
  }

  // Gold chevrons beside a promoted unit: one for veteran, two for elite
  drawRank(u) {
    const ctx = this.ctx;
    const r = this.entityRect(u);
    const x = r.x + r.w - 2, y = r.y + 2;
    ctx.lineWidth = 2;
    for (let n = 0; n < u.rank; n++) {
      const cy = y + n * 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath(); ctx.moveTo(x - 4, cy + 1); ctx.lineTo(x, cy + 4); ctx.lineTo(x + 4, cy + 1); ctx.stroke();
      ctx.strokeStyle = u.rank === 2 ? '#ff6a3a' : '#ffd94a';
      ctx.beginPath(); ctx.moveTo(x - 4, cy); ctx.lineTo(x, cy + 3); ctx.lineTo(x + 4, cy); ctx.stroke();
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
          const bio = m.biome[m.idx(x, y)];
          mc.fillStyle = t === WATER ? '#1d4466' : t === ROCK ? (bio === 2 ? '#9aa0a8' : '#555149')
            : bio === 1 ? '#a8925e' : bio === 2 ? '#d6dbe0' : '#3d5a2a';
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
