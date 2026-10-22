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

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
  } else {
    r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
