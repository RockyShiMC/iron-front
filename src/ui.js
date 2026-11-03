import { FACTIONS, POWERS, defOf } from './config.js';
import { settings } from './settings.js';
import { categoryOf } from './player.js';

export class UI {
  constructor(game, input, renderer, audio, signal) {
    this.g = game;
    this.input = input;
    this.r = renderer;
    this.audio = audio;
    this.tab = 'building';
    this.tabs = FACTIONS[game.human.faction].tabs;
    document.body.dataset.faction = game.human.faction;
    this.el = {
      credits: document.getElementById('credits'),
      minimap: document.getElementById('minimap'),
      powerFill: document.getElementById('power-fill'),
      powerText: document.getElementById('power-text'),
      tabs: document.getElementById('tabs'),
      items: document.getElementById('items'),
      sell: document.getElementById('btn-sell'),
      repair: document.getElementById('btn-repair'),
      info: document.getElementById('selinfo'),
      messages: document.getElementById('messages'),
      sfx: document.getElementById('btn-sfx'),
      voice: document.getElementById('btn-voice'),
      units: document.getElementById('btn-units'),
      powers: document.getElementById('powers'),
      timers: document.getElementById('sw-timers'),
    };
    this.signal = signal;
    this.buttons = [];
    this.tabButtons = {};
    this.shownMessages = 0;
    this.buildTabs();
    this.bindMinimap();
    this.el.sell.addEventListener('click', () => { this.input.placing = null; this.input.mode = this.input.mode === 'sell' ? null : 'sell'; this.g.sound('click'); }, { signal: this.signal });
    this.el.repair.addEventListener('click', () => { this.input.placing = null; this.input.mode = this.input.mode === 'repair' ? null : 'repair'; this.g.sound('click'); }, { signal: this.signal });
    this.el.sfx.addEventListener('click', () => this.audio.setSfx(!this.audio.sfxOn), { signal: this.signal });
    this.el.voice.addEventListener('click', () => this.audio.setVoice(!this.audio.voiceOn), { signal: this.signal });
    this.el.units.addEventListener('click', () => this.audio.setUnitVoice(!this.audio.unitVoiceOn), { signal: this.signal });
    for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => this.g.sound('click'));
    // mousedown, because the panel is redrawn whenever HP changes and that can swallow a click
    this.el.info.addEventListener('mousedown', (e) => {
      if (e.target.dataset.act !== 'evacuate') return;
      for (const b of this.input.selection) if (b.isBuilding && b.garrison?.length) this.g.command({ type: 'evacuate', t: b.id });
    }, { signal: this.signal });
    this.bindTouchBar();
    this.el.powers.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = btn.dataset.power, st = this.g.human.powers[id];
      if (!st || st.charge < POWERS[id].charge) { this.g.sound('error'); return; }
      this.input.placing = null;
      this.input.mode = 'power';
      this.input.power = id;
      this.g.sound('click');
      this.g.notify('Select target', 'info', 0.5);
    }, { signal: this.signal });
  }

  // Buttons for the keyboard commands, for touch screens
  bindTouchBar() {
    const bar = document.getElementById('touch-bar');
    const on = settings.touch === 'on' || (settings.touch !== 'off' && window.matchMedia('(pointer: coarse)').matches);
    bar.hidden = !on || !!this.g.replay;
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.key) this.input.keyDown({ key: b.dataset.key, target: document.body, preventDefault() {} });
      if (b.dataset.toggle === 'queue') this.input.queueToggle = !this.input.queueToggle;
      this.g.sound('click');
    }, { signal: this.signal });
    this.touchBar = bar;
  }

  // Clear everything this battle put in the sidebar (listeners go with the abort signal)
  destroy() {
    for (const k of ['tabs', 'items', 'messages', 'info', 'powers', 'timers']) this.el[k].innerHTML = '';
  }

  buildTabs() {
    for (const t of this.tabs) {
      const b = document.createElement('button');
      b.textContent = t.label;
      b.addEventListener('click', () => { this.tab = t.id; });
      this.el.tabs.appendChild(b);
      this.tabButtons[t.id] = b;
      for (const key of t.items) {
        const def = defOf(key);
        const btn = document.createElement('button');
        btn.className = 'item';
        btn.innerHTML = `<span class="prog"></span><span class="name">${def.name}</span><span class="cost">$${def.cost}</span><span class="count"></span><span class="state"></span>`;
        btn.addEventListener('click', () => this.itemClick(key));
        btn.addEventListener('contextmenu', (e) => { e.preventDefault(); this.itemCancel(key); });
        // touch: press and hold to cancel (some tablets never send a contextmenu)
        let hold = null, held = false;
        btn.addEventListener('touchstart', () => { held = false; hold = setTimeout(() => { held = true; this.itemCancel(key); navigator.vibrate?.(15); }, 550); }, { passive: true });
        btn.addEventListener('touchend', (e) => { clearTimeout(hold); if (held) e.preventDefault(); });
        btn.addEventListener('touchmove', () => clearTimeout(hold), { passive: true });
        btn.title = `${def.name} — $${def.cost}${def.prereq ? `\nRequires: ${def.prereq.map((k) => defOf(k).name).join(', ')}` : ''}\nLeft click: build · Right click: cancel`;
        this.el.items.appendChild(btn);
        this.buttons.push({ key, tab: t.id, btn, prog: btn.querySelector('.prog'), count: btn.querySelector('.count'), state: btn.querySelector('.state') });
      }
    }
  }

  bindMinimap() {
    const mm = this.el.minimap;
    let dragging = false;
    const go = (e) => {
      if (!this.minimapOn) return;
      const rect = mm.getBoundingClientRect();
      const w = this.r.minimapToWorld((e.clientX - rect.left) * (mm.width / rect.width), (e.clientY - rect.top) * (mm.height / rect.height));
      if (!w) return;
      if (e.button === 2 || e.buttons === 2) return;
      this.r.centerOn(w.x, w.y);
    };
    mm.addEventListener('mousedown', (e) => { dragging = true; go(e); }, { signal: this.signal });
    mm.addEventListener('mousemove', (e) => { if (dragging) go(e); }, { signal: this.signal });
    window.addEventListener('mouseup', () => { dragging = false; }, { signal: this.signal });
    mm.addEventListener('contextmenu', (e) => e.preventDefault(), { signal: this.signal });
    // drag a finger across the minimap to move the view
    const touchGo = (e) => { e.preventDefault(); go({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY, button: 0, buttons: 1 }); };
    mm.addEventListener('touchstart', touchGo, { signal: this.signal, passive: false });
    mm.addEventListener('touchmove', touchGo, { signal: this.signal, passive: false });
  }

  itemClick(key) {
    const g = this.g, p = g.human;
    const cat = categoryOf(key);
    const q = p.queues[cat];
    g.sound('click');
    if (cat === 'building' && q.length && q[0].key === key && q[0].ready) {
      this.input.startPlacing(key);
      return;
    }
    if (!p.canBuild(key, g)) return;
    if (cat === 'building' && q.length) {
      g.notify('Unable to comply, building in progress', 'warn', 1);
      return;
    }
    if (cat !== 'building' && q.length >= 5) return;
    g.command({ type: 'build', key });
    g.notify(cat === 'building' ? 'Building' : 'Training', 'info', 0.5);
  }

  itemCancel(key) {
    const g = this.g;
    if (g.human.queuedCount(key)) {
      g.command({ type: 'cancel', key });
      if (this.input.placing && this.input.placing.key === key) this.input.placing = null;
      g.notify('Canceled', 'info', 0.5);
    }
  }

  // Support power buttons (ours) and superweapon countdowns (everyone's)
  updatePowers() {
    const g = this.g, p = g.human;
    const mine = Object.entries(POWERS).filter(([, pw]) => pw.faction === p.faction && p.has(pw.building));
    const sig = mine.map(([id]) => id).join();
    if (this.powerSig !== sig) {
      this.powerSig = sig;
      this.el.powers.innerHTML = mine.map(([id, pw]) => `<button data-power="${id}"><span class="bar"></span><span>${pw.name}</span><span class="pct"></span></button>`).join('');
    }
    for (const btn of this.el.powers.children) {
      const id = btn.dataset.power, pw = POWERS[id], st = p.powers[id] || { charge: 0 };
      const f = st.charge / pw.charge;
      btn.querySelector('.bar').style.width = `${f * 100}%`;
      btn.querySelector('.pct').textContent = f >= 1 ? 'READY' : p.lowPower() ? 'LOW POWER' : `${Math.floor(f * 100)}%`;
      btn.classList.toggle('ready', f >= 1);
      btn.classList.toggle('aiming', this.input.mode === 'power' && this.input.power === id);
    }
    let html = '';
    for (const pl of g.players) {
      for (const [id, pw] of Object.entries(POWERS)) {
        const st = pl.powers[id];
        if (!pw.superweapon || !st || !pl.has(pw.building)) continue;
        const left = Math.max(0, pw.charge - st.charge);
        const t = left > 0 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : 'READY';
        html += `<div style="border-color:${pl.color}">${pw.name}${pl === p ? '' : g.allied(pl, p) ? ' (ally)' : ' (enemy)'} ${t}</div>`;
      }
    }
    // campaign objectives above the timers
    if (g.mission) {
      const st = g.missionState;
      const rows = g.mission.objectives.map((o) => {
        const text = typeof o.text === 'function' ? o.text(g) : o.text;
        const mark = o.hold ? '◆' : st.done[o.id] ? '✔' : '○';
        return `<div class="obj${st.done[o.id] ? ' done' : ''}${o.optional ? ' opt' : ''}">${mark} ${text}${o.optional ? ' <i>(bonus)</i>' : ''}</div>`;
      });
      html = `<div class="obj-title">${g.mission.title}</div>${rows.join('')}${html}`;
    }
    if (this.el.timers.innerHTML !== html) this.el.timers.innerHTML = html;
  }

  update() {
    const g = this.g, p = g.human;
    this.el.credits.textContent = `$ ${Math.floor(p.credits)}`;

    const out = p.powerOut, use = p.powerUse;
    const frac = out ? Math.min(1, use / out) : use ? 1 : 0;
    this.el.powerFill.style.width = `${frac * 100}%`;
    this.el.powerFill.className = use > out ? 'low' : frac > 0.85 ? 'warn' : '';
    this.el.powerText.textContent = `Power ${use} / ${out}${use > out ? '  LOW' : ''}`;

    this.minimapOn = p.has('radar') && p.hasPower();
    this.r.drawMinimap(this.el.minimap, this.minimapOn, p.has('radar') ? 'LOW POWER' : 'BUILD RADAR TOWER');

    // Tabs: highlight active, flash when a building is ready to place
    const readyBuilding = p.queues.building[0]?.ready;
    for (const t of this.tabs) {
      const b = this.tabButtons[t.id];
      b.classList.toggle('active', t.id === this.tab);
      b.classList.toggle('flash', t.id === 'building' && readyBuilding && Math.floor(performance.now() / 400) % 2 === 0);
    }

    for (const it of this.buttons) {
      const visible = it.tab === this.tab;
      it.btn.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const cat = categoryOf(it.key);
      const q = p.queues[cat];
      const can = p.canBuild(it.key, g);
      const active = q[0] && q[0].key === it.key ? q[0] : null;
      const n = p.queuedCount(it.key);
      it.btn.classList.toggle('disabled', !can && !n);
      it.btn.classList.toggle('ready', !!(active && active.ready));
      it.btn.classList.toggle('placing', !!(this.input.placing && this.input.placing.key === it.key));
      it.prog.style.height = active ? `${(1 - active.progress) * 100}%` : '0%';
      it.count.textContent = n > 1 ? n : '';
      let state = '';
      if (active && active.ready) state = 'READY';
      else if (active && (!p.producerFor(cat, g) || !p.prereqsMet(it.key))) state = 'ON HOLD';
      else if (!can && !n) state = cat === 'building' || p.producerFor(cat, g) ? 'LOCKED' : 'NO FACTORY';
      it.state.textContent = state;
    }

    this.el.sfx.textContent = `Sound: ${this.audio.sfxOn ? 'On' : 'Off'}`;
    this.el.voice.textContent = `EVA: ${this.audio.voiceOn ? 'On' : 'Off'}`;
    this.el.units.textContent = `Units: ${this.audio.unitVoiceOn ? 'On' : 'Off'}`;
    if (this.touchBar && !this.touchBar.hidden) {
      for (const b of this.touchBar.querySelectorAll('[data-mode]')) b.classList.toggle('on', this.input.mode === b.dataset.mode);
      this.touchBar.querySelector('[data-toggle=queue]').classList.toggle('on', this.input.queueToggle);
    }
    this.el.sell.classList.toggle('active', this.input.mode === 'sell');
    this.el.repair.classList.toggle('active', this.input.mode === 'repair');

    this.updatePowers();

    // Selection info
    const sel = this.input.selection;
    let info = '';
    if (sel.length === 1) {
      const e = sel[0];
      const tag = e.owner.neutral ? ' <span class="muted">(civilian)</span>'
        : e.owner === p ? '' : g.allied(e.owner, p) ? ` <span style="color:${e.owner.color}">(ally)</span>` : ' <span class="enemy">(enemy)</span>';
      info = `<b>${e.def.name}</b>${tag}<br>HP ${Math.ceil(e.hp)} / ${e.maxHp}`;
      if (e.rank) info += ` · ${e.rank === 2 ? 'Elite' : 'Veteran'}`;
      if (e.def.harvester) info += `<br>Ore ${Math.floor(e.cargo)} / ${e.def.capacity}`;
      if (e.def.garrison) {
        info += `<br>Garrison ${e.garrison?.length || 0} / ${e.def.garrison}`;
        if (e.owner === p && e.garrison?.length) info += '<br><button data-act="evacuate">Evacuate (D)</button>';
        else if (!e.garrison?.length) info += '<br><small>Click it with infantry to occupy</small>';
      }
      if (e.def.income) info += `<br><small>+$${e.def.income} every ${e.def.incomeEvery}s${e.owner.neutral ? ' — capture with an Engineer' : ''}</small>`;
      if (e.def.engineer && e.owner === p) info += '<br><small>Click a building to capture or fix it, or a broken bridge</small>';
      if (e.def.demolish && e.owner === p) info += '<br><small>Click an enemy building to plant a charge</small>';
      if (e.isBuilding && e.def.produces && e.def.produces !== 'building' && e.owner === p) info += '<br><small>Click ground to set rally point</small>';
    } else if (sel.length > 1) {
      const counts = {};
      for (const e of sel) counts[e.def.name] = (counts[e.def.name] || 0) + 1;
      info = Object.entries(counts).map(([n, c]) => `${c}× ${n}`).join('<br>');
    }
    if (this.input.mode === 'attackmove') info = '<b>Attack-move:</b> click a destination';
    if (this.input.mode === 'forcefire') info = '<b>Force fire:</b> click a target or the ground';
    if (this.input.mode === 'guard') info = '<b>Guard:</b> click a unit to escort, or a spot to hold';
    if (this.input.mode === 'power') info = `<b>${POWERS[this.input.power].name}:</b> click a target<br><small>Right click to cancel</small>`;
    if (this.input.mode === 'sell') info = '<b>Sell mode:</b> click one of your structures';
    if (this.input.mode === 'repair') info = '<b>Repair mode:</b> click a damaged structure';
    if (this.input.placing) info = `<b>Place ${defOf(this.input.placing.key).name}</b><br><small>Right click to cancel</small>`;
    if (this.el.info.innerHTML !== info) this.el.info.innerHTML = info;

    // EVA-style messages
    while (this.shownMessages < g.messages.length) {
      const m = g.messages[this.shownMessages++];
      this.audio.announce(m.text);
      const div = document.createElement('div');
      div.className = `msg ${m.kind}`;
      div.textContent = m.text;
      this.el.messages.appendChild(div);
      setTimeout(() => div.classList.add('fade'), 2500);
      setTimeout(() => div.remove(), 3200);
      while (this.el.messages.children.length > 5) this.el.messages.firstChild.remove();
    }
  }
}
