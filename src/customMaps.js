// Maps made in the editor. They live in the browser's storage and are added to the
// map list (as 'custom-<id>') when the page loads, so they can be played and saved
// like any other map.
//
// Format: { id, name, size, theme, terrain, ore, starts: [[x, y]...], neutrals: [{ key, x, y }] }
// terrain: run-length encoded tile types (0 grass, 1 water, 2 rock, 3 bridge)
// ore: run-length encoded ore levels per tile (0 none ... 3 rich)
import { MAPS } from './maps.js';

const KEY = 'ironfront.maps';
export const THEMES = { temperate: 0, desert: 1, snow: 2 }; // biome painted on all land
export const ORE_LEVELS = [0, 250, 450, 650];

// "0*120,1*5,0*3" <-> [0 x120, 1 x5, 0 x3]
export function encodeRLE(arr) {
  const out = [];
  for (let i = 0; i < arr.length;) {
    let j = i;
    while (j < arr.length && arr[j] === arr[i]) j++;
    out.push(`${arr[i]}*${j - i}`);
    i = j;
  }
  return out.join(',');
}

export function decodeRLE(str, n) {
  const arr = new Uint8Array(n);
  let i = 0;
  for (const run of str.split(',')) {
    const [v, c] = run.split('*').map(Number);
    arr.fill(v, i, Math.min(n, i + c));
    i += c;
  }
  return arr;
}

export function listCustomMaps() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export function saveCustomMap(data) {
  const all = listCustomMaps();
  all[data.id] = data;
  localStorage.setItem(KEY, JSON.stringify(all));
  register(data);
}

export function deleteCustomMap(id) {
  const all = listCustomMaps();
  delete all[id];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
  delete MAPS[`custom-${id}`];
}

// Check a map is playable; returns a list of problems (empty = fine)
export function validate(data) {
  const problems = [];
  if (!data.name?.trim()) problems.push('Give the map a name.');
  if (data.starts.length < 2) problems.push('Place at least two starting bases.');
  for (let i = 0; i < data.starts.length; i++) {
    for (let j = i + 1; j < data.starts.length; j++) {
      const [a, b] = [data.starts[i], data.starts[j]];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 14) problems.push(`Bases ${i + 1} and ${j + 1} are too close together.`);
    }
  }
  return problems;
}

function register(data) {
  MAPS[`custom-${data.id}`] = {
    name: data.name, size: data.size, custom: data, maxPlayers: data.starts.length,
    desc: `Custom map · ${data.starts.length} bases`,
  };
}

// Called once at startup
export function registerCustomMaps() {
  for (const data of Object.values(listCustomMaps())) register(data);
}
