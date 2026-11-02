import { mulberry32, dist, vnoise } from './util.js';
import { MAPS } from './maps.js';

export const GRASS = 0;
export const WATER = 1;
export const ROCK = 2;
export const BRIDGE = 3; // land units cross it, ships pass underneath

// Biomes only change how passable land looks
export const BIOME_GRASS = 0;
export const BIOME_DESERT = 1;
export const BIOME_SNOW = 2;

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

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class GameMap {
  constructor(mapId = 'random', seed = 1) {
    const def = MAPS[mapId] || MAPS.random;
    this.id = mapId;
    this.def = def;
    const size = def.size;
    this.w = size;
    this.h = size;
    const n = size * size;
    this.terrain = new Uint8Array(n);
    this.biome = new Uint8Array(n);
    this.variant = new Float32Array(n);
    this.ore = new Uint16Array(n);
    this.oreMax = new Uint16Array(n);
    this.oreTiles = [];
    this.buildingAt = new Array(n).fill(null);
    this.bridges = []; // { tiles, hp, maxHp, dead, x, y }
    this.bridgeAt = new Int16Array(n).fill(-1);
    if (def.bbox) this.generateGeo(def, seed);
    else this.generate(seed);
    for (let i = 0; i < this.ore.length; i++) if (this.oreMax[i] > 0) this.oreTiles.push(i);
    this.hasWater = this.terrain.some((t) => t === WATER);
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  isPassable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.w + x;
    return (this.terrain[i] === GRASS || this.terrain[i] === BRIDGE) && !this.buildingAt[i];
  }

  // domain: 'land' | 'sea' | 'air'
  passable(domain, x, y) {
    if (!this.inBounds(x, y)) return false;
    if (domain === 'air') return true;
    const i = y * this.w + x;
    if (this.buildingAt[i]) return false;
    const t = this.terrain[i];
    return t === BRIDGE || t === (domain === 'sea' ? WATER : GRASS);
  }

  isBuildable(x, y) {
    return this.inBounds(x, y) && this.terrain[y * this.w + x] === GRASS && !this.buildingAt[y * this.w + x];
  }

  oreAt(x, y) {
    return this.inBounds(x, y) ? this.ore[y * this.w + x] : 0;
  }

  // ---------- random skirmish map ----------
  generate(seed) {
    const rng = mulberry32(seed);
    const size = this.w;
    this.starts = [{ x: 8, y: 8 }, { x: size - 11, y: size - 11 }];
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

    // Bridge narrow water between separate pieces of land, then make sure both
    // bases are connected (cutting a land corridor if bridges weren't enough)
    this.addBridges();
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
      this.placeOre(f.x, f.y, f.r, rng);
    }
  }

  // ---------- geographic maps ----------
  // Tile -> screen-aligned unit square: u east-west, v north-south, both -1..1 over the diamond.
  tileToGeo(x, y) {
    const S = this.w, d = this.def;
    const u = (x - y) / S, v = (x + y + 1) / S - 1;
    const gx = 0.5 + u / d.k, gy = 0.5 + v / d.k;
    const [lon0, lon1, lat0, lat1] = d.bbox;
    return { lon: lon0 + gx * (lon1 - lon0), lat: lat1 - gy * (lat1 - lat0) };
  }

  geoToTile(lon, lat) {
    const S = this.w, d = this.def;
    const [lon0, lon1, lat0, lat1] = d.bbox;
    const gx = (lon - lon0) / (lon1 - lon0), gy = (lat1 - lat) / (lat1 - lat0);
    const u = (gx - 0.5) * d.k, v = (gy - 0.5) * d.k;
    return { x: ((u + v + 1) * S) / 2, y: ((v + 1 - u) * S) / 2 };
  }

  generateGeo(def, seed) {
    const rng = mulberry32(seed);
    const S = this.w;
    const [lon0, lon1, lat0, lat1] = def.bbox;
    // Coastline wobble of about one tile, so outlines don't look ruled
    const jLon = ((lon1 - lon0) / (def.k * S)) * 1.6, jLat = ((lat1 - lat0) / (def.k * S)) * 1.6;
    const any = (polys, lon, lat) => polys.some((p) => inPoly(lon, lat, p));

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = this.idx(x, y);
        const { lon, lat } = this.tileToGeo(x, y);
        const jl = lon + (vnoise(x * 0.3, y * 0.3) - 0.5) * jLon, ja = lat + (vnoise(x * 0.3 + 50, y * 0.3) - 0.5) * jLat;
        const land = any(def.land, jl, ja) && !any(def.water, jl, ja);
        let t = land ? GRASS : WATER;
        if (land) {
          for (const m of def.mountains) {
            if (inPoly(lon, lat, m.poly) && vnoise(x * 0.45 + 9, y * 0.45) < m.density) { t = ROCK; break; }
          }
          if (Math.abs(lat) > def.snowLat || any(def.snow, lon, lat)) this.biome[i] = 2;
          else if (any(def.deserts, jl, ja)) this.biome[i] = 1;
        }
        this.terrain[i] = t;
        this.variant[i] = rng();
      }
    }

    // Bases: rock cleared in a wide circle, water only right at the base
    this.starts = def.starts.map(([lon, lat]) => {
      const p = this.geoToTile(lon, lat);
      const sx = Math.round(p.x) - 1, sy = Math.round(p.y) - 1;
      for (let yy = sy - 7; yy <= sy + 9; yy++) {
        for (let xx = sx - 7; xx <= sx + 9; xx++) {
          if (!this.inBounds(xx, yy)) continue;
          const d = dist(xx + 0.5, yy + 0.5, sx + 1.5, sy + 1.5);
          const i = this.idx(xx, yy);
          if (d <= 6.5 && this.terrain[i] === ROCK) this.terrain[i] = GRASS;
          if (d <= 3.6) this.terrain[i] = GRASS;
        }
      }
      return { x: sx, y: sy };
    });

    this.addBridges();
    this.connectThroughRock(this.starts[0], this.starts[1]);

    // Ore: two fields next to each base, plus the map's contested fields
    for (const s of this.starts) {
      const spots = [];
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const fx = s.x + 1.5 + Math.cos(ang) * 10, fy = s.y + 1.5 + Math.sin(ang) * 10;
        spots.push({ ang, fx, fy, score: this.landAround(fx, fy, 3) });
      }
      spots.sort((a, b) => b.score - a.score);
      const picked = [];
      for (const sp of spots) {
        if (picked.length >= 2 || sp.score < 12) break;
        if (picked.some((p) => Math.abs(Math.atan2(Math.sin(p.ang - sp.ang), Math.cos(p.ang - sp.ang))) < 1.1)) continue;
        picked.push(sp);
        this.placeOre(sp.fx, sp.fy, 3.2, rng);
      }
    }
    for (const [lon, lat, r] of def.ore) {
      const p = this.geoToTile(lon, lat);
      this.placeOre(p.x, p.y, r, rng);
    }
  }

  landAround(cx, cy, r) {
    let n = 0;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (this.inBounds(x, y) && dist(x + 0.5, y + 0.5, cx, cy) <= r && this.terrain[this.idx(x, y)] === GRASS) n++;
      }
    }
    return n;
  }

  // If mountains cut the two bases apart, open a pass (never through water)
  connectThroughRock(a, b) {
    if (this.connected(a, b)) return;
    const S = this.w, start = this.idx(a.x, a.y), goal = this.idx(b.x, b.y);
    const prev = new Int32Array(S * S).fill(-1);
    const seen = new Uint8Array(S * S);
    // 0-1 BFS: grass costs nothing, rock costs one
    const dq = [start];
    let head = 0;
    const cost = new Float32Array(S * S).fill(Infinity);
    cost[start] = 0;
    while (head < dq.length) {
      const i = dq[head++];
      if (seen[i]) continue;
      seen[i] = 1;
      if (i === goal) break;
      const x = i % S, y = (i / S) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny), t = this.terrain[j];
        if (t === WATER) continue;
        const c = cost[i] + (t === ROCK ? 1 : 0);
        if (c < cost[j]) { cost[j] = c; prev[j] = i; dq.push(j); }
      }
    }
    for (let i = goal; i !== -1 && i !== start; i = prev[i]) {
      if (this.terrain[i] === ROCK) this.terrain[i] = GRASS;
    }
  }

  placeOre(cx, cy, r, rng) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (!this.inBounds(x, y)) continue;
        const i = this.idx(x, y);
        if (this.terrain[i] !== GRASS) continue;
        const d = dist(x + 0.5, y + 0.5, cx, cy);
        if (d > r || rng() < 0.12) continue;
        const amt = Math.round(180 + 420 * (1 - d / r) + rng() * 100);
        this.ore[i] = amt;
        this.oreMax[i] = amt;
      }
    }
  }

  fill(cx, cy, r, t) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (this.inBounds(x, y) && dist(x + 0.5, y + 0.5, cx, cy) <= r && this.bridgeAt[this.idx(x, y)] < 0) this.terrain[this.idx(x, y)] = t;
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
        if (!seen[j] && (this.terrain[j] === GRASS || this.terrain[j] === BRIDGE)) { seen[j] = 1; q.push(j); }
      }
    }
    return false;
  }

  // Up to `max` bridges, each the shortest straight water crossing (2 wide where it
  // fits) that joins two pieces of land not already connected.
  addBridges(max = 3, maxLen = 8) {
    const S = this.w, n = S * S;
    // label land pieces (grass and rock both count as land here)
    const comp = new Int32Array(n).fill(-1), size = [];
    for (let i = 0; i < n; i++) {
      if (comp[i] >= 0 || this.terrain[i] === WATER) continue;
      const id = size.length, q = [i];
      comp[i] = id;
      for (let qi = 0; qi < q.length; qi++) {
        const x = q[qi] % S, y = (q[qi] / S) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, j = ny * S + nx;
          if (this.inBounds(nx, ny) && comp[j] < 0 && this.terrain[j] !== WATER) { comp[j] = id; q.push(j); }
        }
      }
      size.push(q.length);
    }
    const run = (x, y, dx, dy) => {
      // water tiles from (x, y) in direction (dx, dy), ending on grass
      const tiles = [];
      for (let k = 1; k <= maxLen + 1; k++) {
        const nx = x + dx * k, ny = y + dy * k;
        if (!this.inBounds(nx, ny)) return null;
        const t = this.terrain[ny * S + nx];
        if (t === WATER) { tiles.push(ny * S + nx); continue; }
        return t === GRASS && tiles.length >= 2 ? { tiles, end: ny * S + nx } : null;
      }
      return null;
    };
    const cands = [];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (this.terrain[y * S + x] !== GRASS) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const r = run(x, y, dx, dy);
          if (!r) continue;
          const a = comp[y * S + x], b = comp[r.end];
          if (size[a] < 40 || size[b] < 40) continue;
          cands.push({ a, b, tiles: r.tiles, x, y, dx, dy, end: r.end });
        }
      }
    }
    cands.sort((p, q) => p.tiles.length - q.tiles.length);
    const parent = size.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    // Walking distance over land between two tiles (capped), to spot long detours
    const walk = (from, to, cap) => {
      const d = new Int32Array(n).fill(-1), q = [from];
      d[from] = 0;
      for (let qi = 0; qi < q.length; qi++) {
        const i = q[qi];
        if (i === to) return d[i];
        if (d[i] >= cap) return cap;
        const x = i % S, y = (i / S) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, j = ny * S + nx;
          if (this.inBounds(nx, ny) && d[j] < 0 && (this.terrain[j] === GRASS || this.terrain[j] === BRIDGE)) { d[j] = d[i] + 1; q.push(j); }
        }
      }
      return cap;
    };
    let checked = 0;
    for (const c of cands) {
      if (this.bridges.length >= max) break;
      if (c.tiles.some((i) => this.bridgeAt[i] >= 0)) continue;
      const mid = c.tiles[c.tiles.length >> 1], mx = mid % S, my = (mid / S) | 0;
      if (this.bridges.some((b) => dist(b.x, b.y, mx, my) < 10)) continue;
      if (find(c.a) === find(c.b)) {
        // same land: only worth it as a shortcut over a long detour
        if (checked++ > 120) continue;
        const len = c.tiles.length + 1;
        if (walk(c.y * S + c.x, c.end, len * 3 + 10) < len * 3 + 10) continue;
      }
      parent[find(c.a)] = find(c.b);
      // widen to two tiles when the neighbouring row / column has the same crossing
      const side = run(c.x + c.dy, c.y + c.dx, c.dx, c.dy);
      const tiles = [...c.tiles];
      if (this.terrain[(c.y + c.dx) * S + c.x + c.dy] === GRASS && side && side.tiles.length === c.tiles.length) tiles.push(...side.tiles);
      const id = this.bridges.length;
      for (const i of tiles) { this.terrain[i] = BRIDGE; this.bridgeAt[i] = id; }
      const cx = tiles.reduce((s2, i) => s2 + (i % S), 0) / tiles.length + 0.5;
      const cy = tiles.reduce((s2, i) => s2 + ((i / S) | 0), 0) / tiles.length + 0.5;
      this.bridges.push({ tiles, hp: 1500, maxHp: 1500, dead: false, x: cx, y: cy, dx: c.dx, dy: c.dy });
    }
  }

  // Bridge (alive or destroyed) covering this world position, or null
  bridgeOn(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!this.inBounds(tx, ty)) return null;
    const id = this.bridgeAt[ty * this.w + tx];
    return id >= 0 ? this.bridges[id] : null;
  }

  // Nearest passable tile to (x,y) for a domain, preferring ones closer to (fromX, fromY).
  nearestPassable(x, y, fromX = x, fromY = y, domain = 'land') {
    if (this.passable(domain, x, y)) return { x, y };
    for (let r = 1; r < 16; r++) {
      let best = null, bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (!this.passable(domain, nx, ny)) continue;
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
