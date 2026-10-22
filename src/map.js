import { mulberry32, dist } from './util.js';

export const GRASS = 0;
export const WATER = 1;
export const ROCK = 2;

function valueNoise(rng, size, cell) {
  const gw = Math.ceil(size / cell) + 2;
  const grid = new Float32Array(gw * gw);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const u = s(fx - ix), v = s(fy - iy);
    const a = grid[iy * gw + ix], b = grid[iy * gw + ix + 1];
    const c = grid[(iy + 1) * gw + ix], d = grid[(iy + 1) * gw + ix + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export class GameMap {
  constructor(size, seed) {
    this.w = size;
    this.h = size;
    const n = size * size;
    this.terrain = new Uint8Array(n);
    this.variant = new Float32Array(n);
    this.ore = new Uint16Array(n);
    this.oreMax = new Uint16Array(n);
    this.oreTiles = [];
    this.buildingAt = new Array(n).fill(null);
    this.starts = [
      { x: 8, y: 8 },
      { x: size - 11, y: size - 11 },
    ];
    this.generate(seed);
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  isPassable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.w + x;
    return this.terrain[i] === GRASS && !this.buildingAt[i];
  }

  isBuildable(x, y) {
    return this.isPassable(x, y);
  }

  oreAt(x, y) {
    return this.inBounds(x, y) ? this.ore[y * this.w + x] : 0;
  }

  generate(seed) {
    const rng = mulberry32(seed);
    const size = this.w;
    const n1 = valueNoise(rng, size, 9);
    const n2 = valueNoise(rng, size, 4);
    const n3 = valueNoise(rng, size, 6);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = this.idx(x, y);
        const water = n1(x, y) * 0.75 + n2(x, y) * 0.25;
        let t = GRASS;
        if (water < 0.27) t = WATER;
        else if (n3(x, y) > 0.74 && water > 0.4) t = ROCK;
        this.terrain[i] = t;
        this.variant[i] = rng();
      }
    }

    // Clear base areas
    for (const s of this.starts) this.fill(s.x + 1.5, s.y + 1.5, 9, GRASS);

    // Make sure both bases are connected by land
    if (!this.connected(this.starts[0], this.starts[1])) {
      const a = this.starts[0], b = this.starts[1];
      const steps = Math.ceil(dist(a.x, a.y, b.x, b.y));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        this.fill(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + Math.sin(t * 6) * 4, 1.8, GRASS);
      }
    }

    // Ore fields: one near each base, two contested ones in the middle
    const c = size / 2;
    const fields = [
      { x: this.starts[0].x + 11, y: this.starts[0].y + 1, r: 3.6 },
      { x: this.starts[0].x + 1, y: this.starts[0].y + 11, r: 3.0 },
      { x: this.starts[1].x - 9, y: this.starts[1].y + 1, r: 3.6 },
      { x: this.starts[1].x + 1, y: this.starts[1].y - 9, r: 3.0 },
      { x: c - 6, y: c + 6, r: 4.2 },
      { x: c + 6, y: c - 6, r: 4.2 },
    ];
    for (const f of fields) {
      this.fill(f.x, f.y, f.r + 1, GRASS);
      for (let y = Math.floor(f.y - f.r); y <= f.y + f.r; y++) {
        for (let x = Math.floor(f.x - f.r); x <= f.x + f.r; x++) {
          if (!this.inBounds(x, y)) continue;
          const d = dist(x + 0.5, y + 0.5, f.x, f.y);
          if (d > f.r || rng() < 0.12) continue;
          const i = this.idx(x, y);
          const amt = Math.round(180 + 420 * (1 - d / f.r) + rng() * 100);
          this.ore[i] = amt;
          this.oreMax[i] = amt;
        }
      }
    }
    for (let i = 0; i < this.ore.length; i++) if (this.oreMax[i] > 0) this.oreTiles.push(i);
  }

  fill(cx, cy, r, t) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (this.inBounds(x, y) && dist(x + 0.5, y + 0.5, cx, cy) <= r) this.terrain[this.idx(x, y)] = t;
      }
    }
  }

  connected(a, b) {
    const seen = new Uint8Array(this.w * this.h);
    const q = [this.idx(a.x, a.y)];
    seen[q[0]] = 1;
    const target = this.idx(b.x, b.y);
    while (q.length) {
      const i = q.pop();
      if (i === target) return true;
      const x = i % this.w, y = (i / this.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (!seen[j] && this.terrain[j] === GRASS) { seen[j] = 1; q.push(j); }
      }
    }
    return false;
  }

  // Nearest passable tile to (x,y), preferring ones closer to (fromX, fromY).
  nearestPassable(x, y, fromX = x, fromY = y) {
    if (this.isPassable(x, y)) return { x, y };
    for (let r = 1; r < 12; r++) {
      let best = null, bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (!this.isPassable(nx, ny)) continue;
          const d = dist(nx, ny, x, y) * 2 + dist(nx, ny, fromX, fromY) * 0.1;
          if (d < bestD) { bestD = d; best = { x: nx, y: ny }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  regrowOre(amount) {
    for (const i of this.oreTiles) {
      if (this.ore[i] < this.oreMax[i] && !this.buildingAt[i]) {
        this.ore[i] = Math.min(this.oreMax[i], this.ore[i] + amount);
      }
    }
  }
}
