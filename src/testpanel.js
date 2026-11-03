// Test mode: a panel of tools for trying things out in an offline battle. Everything
// that changes the battle is sent as a 'test' command, so replays and saves keep it.
import { UNITS, BUILDINGS, FACTIONS, DIFFICULTY, defOf } from './config.js';

// Computer toughness presets (Normal and Hard are the regular difficulties)
const PRESETS = {
  easy: { income: 0.7, build: 0.7, think: 2, firstAttack: 420, waveEvery: 180, waveMin: 4, maxWave: 8, raids: false },
  normal: { ...DIFFICULTY.normal },
  hard: { ...DIFFICULTY.hard },
  brutal: { income: 2, build: 1.6, think: 0.5, firstAttack: 90, waveEvery: 50, waveMin: 8, maxWave: 30, raids: true, airNavyShare: 0.45 },
};
const SWITCHES = [
  ['instant', 'Instant build', 'Everything you build finishes at once (still costs money)'],
  ['god', 'Invulnerable', 'Your units and buildings take no damage'],
  ['power', 'Unlimited power', 'Never low on power'],
  ['tech', 'Unlock everything', 'Ignore prerequisites (you still need the factory that makes it)'],
  ['anywhere', 'Build anywhere', 'Place buildings away from your base'],
];
const SPEEDS = [0.5, 1, 2, 4, 8];
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class TestPanel {
  constructor(game, input, signal) {
    this.g = game;
    this.input = input;
    this.el = document.getElementById('test-panel');
    this.badge = document.getElementById('test-badge');
    this.frames = 0;
    this.fps = 0;
    this.fpsTime = performance.now();
    this.infoTime = 0;
    this.el.addEventListener('click', (e) => this.onClick(e), { signal });
    this.el.addEventListener('change', (e) => this.onChange(e), { signal });
  }

  get available() { return !this.g.net && !this.g.replay; }
  get open() { return !this.el.hidden; }

  toggle(force = !this.open) {
    if (!this.available) return;
    this.el.hidden = !force;
    if (force) this.render();
  }

  close() { this.el.hidden = true; }

  test(op, extra = {}) {
    this.g.command({ type: 'test', op, ...extra });
  }

  // ---------- layout ----------
  render() {
    // keep the choices in the pickers when the panel is redrawn
    const keep = {};
    for (const el of this.el.querySelectorAll('.tp-row [data-k]')) keep[el.dataset.k] = el.value;
    this.draw();
    for (const [k, v] of Object.entries(keep)) { const el = this.el.querySelector(`.tp-row [data-k="${k}"]`); if (el) el.value = v; }
    this.update(true);
  }

  draw() {
    const g = this.g, h = g.human;
    const players = g.players.filter((p) => !p.neutral);
    const who = (name, sel = h.id) => `<select data-k="${name}">${players.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${p === h ? 'You' : p.name}</option>`).join('')}</select>`;
    const unitOpts = Object.keys(FACTIONS).map((f) => `<optgroup label="${FACTIONS[f].name}">${Object.entries(UNITS).filter(([, d]) => d.faction === f).map(([k, d]) => `<option value="${k}">${d.name}</option>`).join('')}</optgroup>`).join('')
      + `<optgroup label="Both sides">${Object.entries(UNITS).filter(([, d]) => !d.faction).map(([k, d]) => `<option value="${k}">${d.name}</option>`).join('')}</optgroup>`;
    const bldOpts = Object.entries(BUILDINGS).map(([k, d]) => `<option value="${k}">${d.name}${d.faction ? ` (${FACTIONS[d.faction].name})` : ''}</option>`).join('');
    const ais = g.ais.map((ai) => `
      <div class="tp-ai" data-ai="${ai.p.id}">
        <b style="color:${ai.p.color}">${ai.p.name}</b> <span class="tp-muted">${FACTIONS[ai.p.faction].name}</span>
        <div class="tp-row">${Object.keys(PRESETS).map((k) => `<button data-preset="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
        <label>Income × <input type="range" min="0.25" max="3" step="0.25" value="${ai.p.incomeMult}" data-k="income"><span>${ai.p.incomeMult}</span></label>
        <label>Build speed × <input type="range" min="0.25" max="3" step="0.25" value="${ai.p.buildMult}" data-k="build"><span>${ai.p.buildMult}</span></label>
        <label>First attack at <input type="range" min="0" max="600" step="30" value="${ai.d.firstAttack}" data-k="firstAttack"><span>${clock(ai.d.firstAttack)}</span></label>
        <label>Waves every <input type="range" min="20" max="300" step="10" value="${ai.d.waveEvery}" data-k="waveEvery"><span>${ai.d.waveEvery}s</span></label>
        <label class="tp-check"><input type="checkbox" data-k="passive" ${ai.passive ? 'checked' : ''}> Passive: only defends</label>
        <label class="tp-check"><input type="checkbox" data-k="frozen" ${ai.frozen ? 'checked' : ''}> Frozen: makes no decisions</label>
        <div class="tp-info" data-info="${ai.p.id}"></div>
      </div>`).join('');
    this.el.innerHTML = `
      <div class="tp-head"><b>Test tools</b><span class="tp-muted">F2</span><button data-act="close" title="Close">✕</button></div>

      <h4>Speed</h4>
      <div class="tp-row">${SPEEDS.map((s) => `<button data-speed="${s}">${s}×</button>`).join('')}</div>
      <div class="tp-row"><button data-act="skip">Skip ahead 1 min</button><button data-act="reveal">Reveal map</button></div>

      <h4>Money</h4>
      <div class="tp-row">${who('money')}<input type="number" data-k="amount" value="10000" min="0" step="1000"></div>
      <div class="tp-row"><button data-money="1000">+1,000</button><button data-money="10000">+10,000</button><button data-act="setmoney">Set</button><button data-act="zero">Zero</button></div>

      <h4>Your cheats</h4>
      ${SWITCHES.map(([k, label, tip]) => `<label class="tp-check" title="${tip}"><input type="checkbox" data-cheat="${k}" ${h.cheats[k] ? 'checked' : ''}> ${label}</label>`).join('')}
      <div class="tp-row"><button data-act="charge">Charge my powers</button></div>

      <h4>Spawn units</h4>
      <div class="tp-row">${who('spawnOwner')}<select data-k="count"><option>1</option><option selected>5</option><option>10</option><option>20</option></select></div>
      <div class="tp-row"><select data-k="unit">${unitOpts}</select></div>
      <div class="tp-row"><button data-act="spawn">Click map to spawn</button></div>

      <h4>Place building (free)</h4>
      <div class="tp-row">${who('placeOwner')}</div>
      <div class="tp-row"><select data-k="building">${bldOpts}</select></div>
      <div class="tp-row"><button data-act="place">Click map to place</button></div>

      <h4>Selected units / buildings</h4>
      <div class="tp-row"><button data-sel="heal">Heal</button><button data-sel="promote">Make elite</button><button data-sel="kill">Destroy</button></div>

      <h4>Computer players</h4>
      ${ais || '<p class="tp-muted">None in this battle.</p>'}

      <h4>Battle</h4>
      <div class="tp-row"><button data-result="win">Win now</button><button data-result="lose">Lose now</button></div>
      <div class="tp-info" data-info="battle"></div>
      <p class="tp-muted">Right click or Esc stops spawning / placing.</p>`;
  }

  value(k) {
    return this.el.querySelector(`[data-k="${k}"]`)?.value;
  }

  // ---------- actions ----------
  onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const g = this.g, d = b.dataset;
    if (d.act === 'close') this.close();
    if (d.speed) g.testSpeed = +d.speed;
    if (d.act === 'skip') { for (let i = 0; i < 3600 && !g.result; i++) g.step(); g.notify('Skipped 1 minute', 'info', 0); }
    if (d.act === 'reveal') this.test('reveal');
    if (d.money) this.test('credits', { player: +this.value('money'), amount: +d.money, add: true });
    if (d.act === 'setmoney') this.test('credits', { player: +this.value('money'), amount: +this.value('amount') || 0, add: false });
    if (d.act === 'zero') this.test('credits', { player: +this.value('money'), amount: 0, add: false });
    if (d.act === 'charge') this.test('charge', { player: g.human.id });
    if (d.act === 'spawn') {
      this.input.placing = null;
      this.input.mode = 'spawn';
      this.input.spawn = { key: this.value('unit'), count: +this.value('count'), player: +this.value('spawnOwner') };
    }
    if (d.act === 'place') {
      this.input.mode = null;
      this.input.startPlacing(this.value('building'));
      Object.assign(this.input.placing, { free: true, owner: +this.value('placeOwner') });
    }
    if (d.sel) {
      const ids = this.input.selection.map((x) => x.id);
      if (ids.length) this.test('entities', { t: ids, what: d.sel });
      else g.notify('Select something first', 'warn', 1);
    }
    if (d.preset) {
      const id = +b.closest('[data-ai]').dataset.ai;
      this.test('ai', { player: id, patch: PRESETS[d.preset] });
      this.later();
    }
    if (d.result) this.test('result', { result: d.result });
    this.update(true);
  }

  onChange(e) {
    const t = e.target, k = t.dataset.k;
    if (t.dataset.cheat) { this.test('cheat', { player: this.g.human.id, flag: t.dataset.cheat, on: t.checked }); return; }
    const box = t.closest('[data-ai]');
    if (!box) return;
    const player = +box.dataset.ai;
    if (k === 'passive' || k === 'frozen') this.test('ai', { player, [k]: t.checked });
    else if (['income', 'build', 'firstAttack', 'waveEvery'].includes(k)) {
      this.test('ai', { player, patch: { [k]: +t.value } });
      t.nextElementSibling.textContent = k === 'firstAttack' ? clock(+t.value) : k === 'waveEvery' ? `${t.value}s` : t.value;
    }
  }

  // Re-draw the computer settings once the command has been applied
  later() {
    setTimeout(() => { if (this.open) this.render(); }, 100);
  }

  // ---------- live readout ----------
  update(force = false) {
    const g = this.g, now = performance.now();
    this.frames++;
    if (now - this.fpsTime >= 1000) { this.fps = Math.round((this.frames * 1000) / (now - this.fpsTime)); this.frames = 0; this.fpsTime = now; }
    this.badge.hidden = !g.tested;
    if (!this.open || (!force && now - this.infoTime < 500)) return;
    this.infoTime = now;
    for (const b of this.el.querySelectorAll('[data-speed]')) b.classList.toggle('on', +b.dataset.speed === (g.testSpeed ?? 1));
    const battle = this.el.querySelector('[data-info="battle"]');
    if (battle) {
      const mine = g.units.filter((u) => u.owner === g.human).length;
      battle.textContent = `${clock(g.time)} · tick ${g.tick} · ${this.fps} fps · ${g.units.length} units (${mine} yours) · ${g.buildings.length} buildings`;
    }
    for (const ai of g.ais) {
      const el = this.el.querySelector(`[data-info="${ai.p.id}"]`);
      if (!el) continue;
      const army = ai.army().length;
      const next = Math.max(0, ai.d.firstAttack - g.time, ai.lastWave + ai.d.waveEvery - g.time);
      el.textContent = `$${Math.floor(ai.p.credits)} · army ${army} · next wave ~${ai.waveSize} units${ai.frozen ? ' · frozen' : ai.passive ? ' · passive' : ` in ${clock(next)}`}`;
    }
  }
}

// Shown in the info box while a test tool is active
export function testModeInfo(input) {
  if (input.mode === 'spawn') return `<b>Spawn ${input.spawn.count}× ${UNITS[input.spawn.key].name}:</b> click the map<br><small>Right click to stop</small>`;
  if (input.placing?.free) return `<b>Place ${defOf(input.placing.key).name} (free):</b> click the map<br><small>Right click to stop</small>`;
  return null;
}
