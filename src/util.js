export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

// Rotate angle a toward b by at most maxStep radians.
export function turnToward(a, b, maxStep) {
  const d = normAngle(b - a);
  if (Math.abs(d) <= maxStep) return normAngle(b);
  return normAngle(a + Math.sign(d) * maxStep);
}

export function angleDiff(a, b) {
  return Math.abs(normAngle(b - a));
}

// Distance from a point to an entity's edge (buildings are rectangles).
export function distToEntity(x, y, e) {
  if (e.isBuilding) {
    const dx = Math.max(e.tx - x, 0, x - (e.tx + e.w));
    const dy = Math.max(e.ty - y, 0, y - (e.ty + e.h));
    return Math.hypot(dx, dy);
  }
  return Math.hypot(e.x - x, e.y - y);
}

export function hashTile(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth 2D value noise on a hashed lattice, in [0, 1)
export function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hashTile(ix, iy), b = hashTile(ix + 1, iy);
  const c = hashTile(ix, iy + 1), d = hashTile(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal sum of value noise octaves
export function fbm(x, y, octaves = 3) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(x * f + i * 17.3, y * f - i * 9.1) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Lighten (amt > 0) or darken (amt < 0) a '#rrggbb' or 'rgb(r,g,b)' color
export function shade(color, amt) {
  let r, g, b;
  if (color[0] === '#') {
    const n = parseInt(color.slice(1), 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    [r, g, b] = color.match(/\d+/g).map(Number);
  }
  if (amt >= 0) {
    r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
  } else {
    r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
