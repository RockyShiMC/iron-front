// Map editor: paint terrain and ore on an isometric view laid out like the game,
// place starting bases, oil derricks and civilian buildings, then save, play,
// export or import the map.
import { Game } from './game.js';
import { BUILDINGS, PLAYER_COLORS } from './config.js';
import { GRASS, WATER, ROCK, BRIDGE } from './map.js';
import { encodeRLE, decodeRLE, listCustomMaps, saveCustomMap, deleteCustomMap, validate } from './customMaps.js';

const TERRAIN_TOOLS = { grass: GRASS, water: WATER, rock: ROCK, bridge: BRIDGE };
const COLORS = { [GRASS]: '#4f7a35', [WATER]: '#1d4466', [ROCK]: '#6b6458', [BRIDGE]: '#c08a4a' };
const THEME_GRASS = { temperate: '#4f7a35', desert: '#b59f6a', snow: '#d2d8de' };
const NEUTRALS = { derrick: 'oilDerrick', civ: 'civBuilding' };

export class Editor {
  constructor({ onClose, onSaved, onPlay }) {
    this.root = document.getElementById('editor');
    this.canvas = document.getElementById('editor-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.note = document.getElementById('ed-note');
    this.on = { onClose, onSaved, onPlay };
    this.tool = 'grass';
    this.brush = 2;
    this.hover = null;
    this.blank(64);
    this.bind();
  }

  // ---------- map data ----------
  blank(size) {
    this.data = {
      id: null, name: '', size, theme: document.getElementById('ed-theme').value || 'temperate',
      terrain: new Uint8Array(size * size), ore: new Uint8Array(size * size), starts: [], neutrals: [],
    };
    this.syncFields();
  }

  // Start from a freshly generated random map (2 bases at 64x64, 4 at 88x88)
  randomize(size) {
    const players = size >= 88 ? 4 : 2;
    const g = new Game({ map: 'random', mode: players === 4 ? 'ffa' : '1v1', seed: (Math.random() * 1e9) | 0 });
    const m = g.map, n = m.w * m.w;
    this.data = {
      id: null, name: '', size: m.w, theme: this.data.theme,
      terrain: Uint8Array.from(m.terrain),
      ore: Uint8Array.from({ length: n }, (_, i) => (m.oreMax[i] >= 550 ? 3 : m.oreMax[i] >= 350 ? 2 : m.oreMax[i] > 0 ? 1 : 0)),
      starts: m.starts.map((s) => [s.x, s.y]),
      neutrals: g.buildings.filter((b) => b.owner.neutral).map((b) => ({ key: b.key, x: b.tx, y: b.ty })),
    };
    this.syncFields();
  }

  syncFields() {
    document.getElementById('ed-name').value = this.data.name;
    document.getElementById('ed-theme').value = this.data.theme;
    document.getElementById('ed-size').value = String(this.data.size);
    this.refreshList();
    this.dirty = true;
  }

  encoded() {
    const d = this.data;
    return {
      id: d.id, name: d.name.trim(), size: d.size, theme: d.theme,
      terrain: encodeRLE(d.terrain), ore: encodeRLE(d.ore), starts: d.starts, neutrals: d.neutrals,
    };
  }

  load(data) {
    const n = data.size * data.size;
    this.data = { ...data, terrain: decodeRLE(data.terrain, n), ore: decodeRLE(data.ore, n), starts: [...data.starts], neutrals: [...data.neutrals] };
    this.syncFields();
  }

  // ---------- UI ----------
  open() {
    this.root.hidden = false;
    this.resize();
    this.refreshList();
    this.loop();
  }

  close() {
    this.root.hidden = true;
    cancelAnimationFrame(this.raf);
    this.on.onClose();
  }

  refreshList() {
    const sel = document.getElementById('ed-maps');
    const maps = Object.values(listCustomMaps());
    sel.innerHTML = maps.length ? maps.map((m) => `<option value="${m.id}" ${m.id === this.data.id ? 'selected' : ''}>${m.name} (${m.size}×${m.size})</option>`).join('')
      : '<option value="">No saved maps yet</option>';
  }

  say(text, bad = false) {
    this.note.textContent = text;
    this.note.classList.toggle('bad', bad);
  }

  bind() {
    const panel = document.getElementById('editor-panel');
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tool) this.tool = b.dataset.tool;
      if (b.dataset.brush) this.brush = +b.dataset.brush;
      if (b.dataset.ed) this.action(b.dataset.ed);
      this.highlight();
    });
    document.getElementById('ed-name').addEventListener('input', (e) => { this.data.name = e.target.value; });
    document.getElementById('ed-theme').addEventListener('change', (e) => { this.data.theme = e.target.value; this.dirty = true; });
    document.getElementById('ed-file').addEventListener('change', (e) => this.importFile(e.target.files[0]));
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => { this.painting = true; this.lastTile = null; this.paint(e, true); });
    c.addEventListener('mousemove', (e) => { this.hover = this.tileAt(e); this.dirty = true; if (this.painting) this.paint(e, false); });
    c.addEventListener('mouseleave', () => { this.hover = null; this.dirty = true; });
    window.addEventListener('mouseup', () => { this.painting = false; });
    window.addEventListener('resize', () => { if (!this.root.hidden) this.resize(); });
    this.highlight();
  }

  highlight() {
    for (const b of document.querySelectorAll('#editor-panel [data-tool]')) b.classList.toggle('on', b.dataset.tool === this.tool);
    for (const b of document.querySelectorAll('#editor-panel [data-brush]')) b.classList.toggle('on', +b.dataset.brush === this.brush);
  }

  action(name) {
    const size = +document.getElementById('ed-size').value;
    if (name === 'new') { this.blank(size); this.say('New blank map.'); }
    if (name === 'random') { this.randomize(size); this.say(size >= 88 ? 'Random 88×88 map with four bases.' : 'Random 64×64 map with two bases.'); }
    if (name === 'load') {
      const id = document.getElementById('ed-maps').value, data = listCustomMaps()[id];
      if (data) { this.load(data); this.say(`Loaded ${data.name}.`); }
    }
    if (name === 'delete') {
      const id = document.getElementById('ed-maps').value, data = listCustomMaps()[id];
      if (!data) return;
      if (this.confirmDelete !== id) { this.confirmDelete = id; this.say(`Press Delete again to remove ${data.name}.`, true); return; }
      deleteCustomMap(id);
      this.confirmDelete = null;
      if (this.data.id === id) this.data.id = null;
      this.refreshList();
      this.on.onSaved();
      this.say(`Deleted ${data.name}.`);
    }
    if (name === 'save' || name === 'play') {
      if (!this.save()) return;
      if (name === 'play') { this.root.hidden = true; cancelAnimationFrame(this.raf); this.on.onPlay(`custom-${this.data.id}`); }
    }
    if (name === 'export') this.exportFile();
    if (name === 'import') document.getElementById('ed-file').click();
    if (name === 'close') this.close();
    this.confirmDelete = name === 'delete' ? this.confirmDelete : null;
  }

  save() {
    const data = this.encoded();
    const problems = validate(data);
    if (problems.length) { this.say(problems.join(' '), true); return false; }
    data.id ||= Date.now().toString(36);
    this.data.id = data.id;
    try { saveCustomMap(data); } catch { this.say("Couldn't save: browser storage is full.", true); return false; }
    this.refreshList();
    this.on.onSaved();
    this.say(`Saved ${data.name}. It's in the battlefield list now.`);
    return true;
  }

  exportFile() {
    const data = this.encoded();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `${(data.name || 'map').replace(/[^\w-]+/g, '_')}.ironmap.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.say('Exported. Share the file; anyone can import it here.');
  }

  async importFile(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (![48, 64, 88, 112].includes(data.size) || typeof data.terrain !== 'string' || !Array.isArray(data.starts)) throw new Error('not a map file');
      this.load({ ...data, id: null, neutrals: (data.neutrals || []).filter((nb) => BUILDINGS[nb.key]) });
      this.say(`Imported ${data.name}. Press Save to keep it.`);
    } catch (err) {
      this.say(`Couldn't import: ${err.message}.`, true);
    }
    document.getElementById('ed-file').value = '';
  }

  // ---------- view ----------
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = w;
    this.viewH = h;
    this.dirty = true;
  }

  // Diamond layout: tile (x, y) sits like it does in the game, north at the top
  layout() {
    const S = this.data.size;
    const tw = Math.min((this.viewW - 20) / S, ((this.viewH - 20) * 2) / S);
    this.hw = tw / 2;
    this.hh = tw / 4;
    this.ox = this.viewW / 2;
    this.oy = (this.viewH - S * tw / 2) / 2;
  }

  toScreen(x, y) {
    return { x: this.ox + (x - y) * this.hw, y: this.oy + (x + y) * this.hh };
  }

  tileAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const X = (e.clientX - r.left - this.ox) / this.hw, Y = (e.clientY - r.top - this.oy) / this.hh;
    const x = Math.floor((X + Y) / 2), y = Math.floor((Y - X) / 2);
    return x >= 0 && y >= 0 && x < this.data.size && y < this.data.size ? { x, y } : null;
  }

  diamond(x, y, w = 1, h = 1) {
    const ctx = this.ctx;
    const a = this.toScreen(x, y), b = this.toScreen(x + w, y), c = this.toScreen(x + w, y + h), d = this.toScreen(x, y + h);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
  }

  loop() {
    if (this.dirty) { this.dirty = false; this.draw(); }
    this.raf = requestAnimationFrame(() => this.loop());
  }

  draw() {
    const ctx = this.ctx, d = this.data, S = d.size;
    this.layout();
    ctx.fillStyle = '#0b0e10';
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x, t = d.terrain[i];
        this.diamond(x, y);
        ctx.fillStyle = t === GRASS ? THEME_GRASS[d.theme] : COLORS[t];
        ctx.fill();
        if (d.ore[i] && t === GRASS) {
          const c = this.toScreen(x + 0.5, y + 0.5), r = this.hw * (0.25 + d.ore[i] * 0.12);
          ctx.fillStyle = '#e8c547';
          ctx.beginPath(); ctx.moveTo(c.x, c.y - r / 2); ctx.lineTo(c.x + r, c.y); ctx.lineTo(c.x, c.y + r / 2); ctx.lineTo(c.x - r, c.y); ctx.fill();
        }
      }
    }
    // neutral buildings and starting bases
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.max(9, this.hw * 0.9)}px sans-serif`;
    for (const nb of d.neutrals) {
      const def = BUILDINGS[nb.key];
      this.diamond(nb.x, nb.y, def.w, def.h);
      ctx.fillStyle = nb.key === 'oilDerrick' ? '#3a3027' : '#7d7466';
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
      const c = this.toScreen(nb.x + def.w / 2, nb.y + def.h / 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(nb.key === 'oilDerrick' ? '$' : 'C', c.x, c.y + 4);
    }
    d.starts.forEach(([x, y], k) => {
      this.diamond(x, y, 3, 3);
      ctx.fillStyle = PLAYER_COLORS[k].color;
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      const c = this.toScreen(x + 1.5, y + 1.5);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(k + 1), c.x, c.y + 4);
    });
    ctx.textAlign = 'start';
    // brush outline
    if (this.hover) {
      const { x, y, w, h } = this.footprint(this.hover);
      this.diamond(x, y, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  // The tiles the current tool covers around a tile
  footprint(t) {
    if (this.tool === 'start') return { x: t.x - 1, y: t.y - 1, w: 3, h: 3 };
    if (NEUTRALS[this.tool]) return { x: t.x, y: t.y, w: 2, h: 2 };
    if (this.tool === 'erase') return { x: t.x, y: t.y, w: 1, h: 1 };
    const o = Math.floor((this.brush - 1) / 2);
    return { x: t.x - o, y: t.y - o, w: this.brush, h: this.brush };
  }

  // ---------- painting ----------
  paint(e, first) {
    const t = this.tileAt(e);
    if (!t) return;
    const key = `${t.x},${t.y}`;
    if (key === this.lastTile) return;
    // fill in every tile between this mouse position and the last, so fast strokes have no gaps
    const prev = !first && this.lastPos;
    this.lastTile = key;
    this.lastPos = t;
    if (prev) {
      const n = Math.max(Math.abs(t.x - prev.x), Math.abs(t.y - prev.y));
      for (let k = 1; k < n; k++) this.apply({ x: Math.round(prev.x + ((t.x - prev.x) * k) / n), y: Math.round(prev.y + ((t.y - prev.y) * k) / n) }, false);
    }
    this.apply(t, first);
  }

  apply(t, first) {
    const d = this.data, S = d.size;
    const objects = this.tool === 'start' || NEUTRALS[this.tool] || this.tool === 'erase';
    if (objects && !first) return; // objects are placed one click at a time
    if (this.tool === 'erase' || this.tool === 'start' || NEUTRALS[this.tool]) {
      const hit = (x, y, w, h) => t.x >= x && t.x < x + w && t.y >= y && t.y < y + h;
      const si = d.starts.findIndex(([x, y]) => hit(x, y, 3, 3));
      const ni = d.neutrals.findIndex((nb) => hit(nb.x, nb.y, BUILDINGS[nb.key].w, BUILDINGS[nb.key].h));
      if (si >= 0 && this.tool !== 'derrick' && this.tool !== 'civ') { d.starts.splice(si, 1); this.say('Base removed.'); }
      else if (ni >= 0) { d.neutrals.splice(ni, 1); this.say('Building removed.'); }
      else if (this.tool === 'start') {
        if (d.starts.length >= 4) this.say('Four bases is the most a map can have.', true);
        else { d.starts.push([Math.max(0, Math.min(S - 3, t.x - 1)), Math.max(0, Math.min(S - 3, t.y - 1))]); this.say(`Base ${d.starts.length} placed.`); }
      } else if (NEUTRALS[this.tool]) {
        d.neutrals.push({ key: NEUTRALS[this.tool], x: Math.min(S - 2, t.x), y: Math.min(S - 2, t.y) });
      }
      this.dirty = true;
      return;
    }
    const { x, y, w, h } = this.footprint(t);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
        const i = yy * S + xx;
        if (this.tool in TERRAIN_TOOLS) {
          d.terrain[i] = TERRAIN_TOOLS[this.tool];
          if (d.terrain[i] !== GRASS) d.ore[i] = 0;
        } else if (this.tool === 'ore' && d.terrain[i] === GRASS) {
          d.ore[i] = Math.min(3, Math.max(d.ore[i], xx === t.x && yy === t.y ? 3 : 2));
        } else if (this.tool === 'unore') {
          d.ore[i] = 0;
        }
      }
    }
    this.dirty = true;
  }
}

