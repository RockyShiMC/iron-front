// Grid A* with 8-way movement (no corner cutting) plus line-of-sight smoothing.

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

class MinHeap {
  constructor() { this.items = []; this.keys = []; }
  get size() { return this.items.length; }
  push(item, key) {
    const it = this.items, k = this.keys;
    it.push(item); k.push(key);
    let i = it.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [it[p], it[i]] = [it[i], it[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop() {
    const it = this.items, k = this.keys;
    const top = it[0];
    const lastI = it.pop(), lastK = k.pop();
    if (it.length) {
      it[0] = lastI; k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < it.length && k[l] < k[m]) m = l;
        if (r < it.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [it[m], it[i]] = [it[i], it[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}

export class Pathfinder {
  constructor(map) {
    this.map = map;
    const n = map.w * map.h;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.run = 0;
  }

  // Returns an array of world-space waypoints (excluding the start), or null.
  // domain: 'land' (ground units) or 'sea' (ships).
  find(sx, sy, gx, gy, maxNodes = 20000, domain = 'land') {
    const m = this.map;
    const W = m.w;
    this.domain = domain;
    const pass = (x, y) => m.passable(domain, x, y);
    const sxi = Math.floor(sx), syi = Math.floor(sy);
    let gxi = Math.floor(gx), gyi = Math.floor(gy);
    let exactGoal = true;
    if (!pass(gxi, gyi)) {
      const p = m.nearestPassable(gxi, gyi, sxi, syi, domain);
      if (!p) return null;
      gxi = p.x; gyi = p.y; exactGoal = false;
    }
    if (sxi === gxi && syi === gyi) return [{ x: exactGoal ? gx : gxi + 0.5, y: exactGoal ? gy : gyi + 0.5 }];

    const run = ++this.run;
    const start = syi * W + sxi, goal = gyi * W + gxi;
    const h = (x, y) => {
      const dx = Math.abs(x - gxi), dy = Math.abs(y - gyi);
      return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };
    const open = new MinHeap();
    this.g[start] = 0; this.stamp[start] = run; this.parent[start] = -1;
    open.push(start, h(sxi, syi));
    let best = start, bestH = h(sxi, syi), expanded = 0;

    while (open.size) {
      const cur = open.pop();
      if (this.closed[cur] === run) continue;
      this.closed[cur] = run;
      if (cur === goal) { best = cur; break; }
      if (++expanded > maxNodes) break;
      const cx = cur % W, cy = (cur / W) | 0;
      const ch = h(cx, cy);
      if (ch < bestH) { bestH = ch; best = cur; }
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!pass(nx, ny)) continue;
        if (dx && dy && (!pass(cx + dx, cy) || !pass(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (this.closed[ni] === run) continue;
        const ng = this.g[cur] + cost;
        if (this.stamp[ni] !== run || ng < this.g[ni]) {
          this.stamp[ni] = run;
          this.g[ni] = ng;
          this.parent[ni] = cur;
          open.push(ni, ng + h(nx, ny) * 1.001);
        }
      }
    }

    const tiles = [];
    for (let i = best; i !== -1 && i !== start; i = this.parent[i]) tiles.push(i);
    tiles.reverse();
    if (!tiles.length) return null;
    const pts = tiles.map((i) => ({ x: (i % W) + 0.5, y: ((i / W) | 0) + 0.5 }));
    if (best === goal && exactGoal) pts[pts.length - 1] = { x: gx, y: gy };
    return this.smooth(sx, sy, pts);
  }

  smooth(sx, sy, pts) {
    const out = [];
    let ax = sx, ay = sy, i = 0;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && this.lineClear(ax, ay, pts[j + 1].x, pts[j + 1].y)) j++;
      out.push(pts[j]);
      ax = pts[j].x; ay = pts[j].y;
      i = j + 1;
    }
    return out;
  }

  lineClear(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay);
    if (d < 0.01) return true;
    const steps = Math.ceil(d / 0.2);
    const px = (-(by - ay) / d) * 0.3, py = ((bx - ax) / d) * 0.3;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (!this.map.passable(this.domain, Math.floor(x + px), Math.floor(y + py))) return false;
      if (!this.map.passable(this.domain, Math.floor(x - px), Math.floor(y - py))) return false;
    }
    return true;
  }
}
