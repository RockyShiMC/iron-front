import { SIDEBAR_W, FACTIONS, MODES } from './config.js';
import { Game, mapSupports } from './game.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { AudioSystem } from './audio.js';
import { MAPS } from './maps.js';
import { SLOTS, listSaves, writeSave, readSave, deleteSave } from './save.js';
import { settings, saveSettings } from './settings.js';
import { MISSIONS, missionById, missionUnlocked, markMissionDone, campaignProgress } from './missions.js';

const canvas = document.getElementById('game');
const audio = new AudioSystem();
const overlay = document.getElementById('overlay');
const setupPanel = document.getElementById('setup-panel');
const statusPanel = document.getElementById('status-panel');
const pauseEl = document.getElementById('paused');
const menuEl = document.getElementById('menu');
const menuPanel = menuEl.querySelector('.panel');

// The battle in progress: { game, renderer, input, ui, ac }
let session = null;
let running = false;
let menu = null; // the open menu view, or null
let last = performance.now();

function startGame(setup, loaded = null) {
  audio.unlock();
  endGame();
  const ac = new AbortController();
  const game = loaded ? loaded.game : new Game(setup);
  game.soundEnabled = true;
  const renderer = new Renderer(canvas, game);
  const input = new Input(canvas, game, renderer, ac.signal);
  const ui = new UI(game, input, renderer, audio, ac.signal);
  session = { game, renderer, input, ui, ac };
  resize();
  if (loaded?.camera) {
    renderer.centerOn(loaded.camera.x, loaded.camera.y);
  } else {
    const home = game.buildings.find((b) => b.owner === game.human) || game.units.find((u) => u.owner === game.human);
    if (home) renderer.centerOn(home.x, home.y + 2);
  }

  closeMenu();
  overlay.style.display = 'none';
  running = !game.result;
  input.enabled = running;
  if (loaded) game.notify('Battle loaded', 'info', 0);
  else game.notify(game.setup.faction === 'soviet' ? 'Welcome, Comrade General' : 'Battle control online');

  // Expose for debugging in the console
  Object.assign(window, { game, renderer, input, ui, audio });
  last = performance.now();
}

// Tear the current battle down so another can start without reloading the page
function endGame() {
  if (!session) return;
  session.ac.abort();
  session.ui.destroy();
  session = null;
  running = false;
  pauseEl.style.display = 'none';
}

function resize() {
  session?.renderer.resize(window.innerWidth - SIDEBAR_W, window.innerHeight);
}
window.addEventListener('resize', resize);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!session) return;
  const { game, renderer, input, ui } = session;
  const paused = input.paused || !!menu;
  // Faster game speeds run extra simulation steps rather than one big one
  const step = dt * settings.speed;
  if (running && !paused) for (let left = step; left > 1e-6; left -= 0.05) game.update(Math.min(0.05, left));
  input.update(dt);
  renderer.draw(paused ? 0 : step, input);
  ui.update();
  playSounds();
  pauseEl.style.display = input.paused && !menu ? 'flex' : 'none';

  if (game.result && running) {
    running = false;
    input.enabled = false;
    showResult(game.result);
  }
}
requestAnimationFrame(frame);

// Battle sounds fade with distance from the screen center and pan left/right
function playSounds() {
  const { game, renderer } = session;
  const w = renderer.viewW, h = renderer.viewH;
  for (const e of game.soundEvents) {
    if (e.name === 'voice') { audio.unitVoice(e.unit, e.line, e.id); continue; }
    if (e.x === undefined) { audio.play(e.name); continue; }
    if (!game.isExplored(e.x, e.y)) continue;
    const s = renderer.toScreen(e.x, e.y);
    const dx = (s.x - w / 2) / w, dy = (s.y - h / 2) / h;
    const vol = Math.max(0, Math.min(1, 1.25 - Math.hypot(dx, dy) * 1.4));
    audio.play(e.name, vol, Math.max(-1, Math.min(1, dx * 1.6)));
  }
  game.soundEvents.length = 0;
}

// Registered before any battle's Input, so it sees Escape first
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (menu) {
      e.stopImmediatePropagation();
      menuBack();
    } else if (session && running && !session.input.placing && !session.input.mode) {
      e.stopImmediatePropagation();
      openMenu();
    }
    return;
  }
  if (!session || menu) return;
  if (k === 'm') audio.setSfx(!audio.sfxOn);
  if (k === 'v') audio.setVoice(!audio.voiceOn);
  if (k === 'u') audio.setUnitVoice(!audio.unitVoiceOn);
});

document.getElementById('btn-menu').addEventListener('click', () => { if (session && running) openMenu(); });

function showResult(result) {
  const m = session.game.mission;
  if (m && result === 'win') markMissionDone(m.id);
  const next = m && result === 'win' ? MISSIONS[MISSIONS.indexOf(m) + 1] : null;
  const text = m ? (result === 'win' ? `${m.title} complete.` : session.game.failReason || 'The mission has failed.')
    : result === 'win' ? 'The enemy base has been destroyed.' : 'Your forces have been wiped out.';
  statusPanel.innerHTML = `
    <h1>${result === 'win' ? 'Mission Accomplished' : 'Mission Failed'}</h1>
    <p>${text}</p>
    <div class="menu-buttons">
      ${next ? `<button data-act="next">Next mission: ${next.title}</button>` : ''}
      <button data-act="restart" ${next ? 'class="secondary"' : ''}>${m ? 'Restart mission' : 'Restart battle'}</button>
      ${m ? '<button data-act="campaign" class="secondary">Campaign</button>' : ''}
      ${hasSaves() ? '<button data-act="load" class="secondary">Load battle</button>' : ''}
      <button data-act="quit" class="secondary">Main menu</button>
    </div>`;
  statusPanel.querySelector('[data-act=restart]').onclick = restartBattle;
  statusPanel.querySelector('[data-act=next]')?.addEventListener('click', () => openMenu('briefing', { mission: next.id }));
  statusPanel.querySelector('[data-act=campaign]')?.addEventListener('click', () => openMenu('campaign'));
  statusPanel.querySelector('[data-act=load]')?.addEventListener('click', () => openMenu('load'));
  statusPanel.querySelector('[data-act=quit]').onclick = quitToSetup;
  showOverlay(statusPanel);
}

function showOverlay(panel) {
  setupPanel.hidden = panel !== setupPanel;
  statusPanel.hidden = panel !== statusPanel;
  overlay.style.display = 'flex';
}

function restartBattle() {
  const { game } = session;
  startGame({ ...game.setup, seed: game.seed });
}

function quitToSetup() {
  endGame();
  closeMenu();
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  refreshSetup();
  showOverlay(setupPanel);
}

// ---------- in-battle menu ----------
const hasSaves = () => Object.keys(listSaves()).length > 0;
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const battleName = (s) => s.mission ? `Campaign: ${missionById(s.mission)?.title ?? s.mission}`
  : `${FACTIONS[s.faction].name} · ${MODES[s.mode || '1v1'].name} · ${MAPS[s.map]?.name ?? s.map} · ${s.difficulty === 'hard' ? 'Hard' : 'Normal'}`;

function openMenu(view = 'main', extra = {}) {
  if (session) session.input.enabled = false;
  menu = { view, note: '', ...extra };
  menuEl.style.display = 'flex';
  renderMenu();
}

function closeMenu() {
  menu = null;
  menuEl.style.display = 'none';
  if (session && running) session.input.enabled = true;
}

// Escape steps back one level: sub-view -> pause menu -> battle
function menuBack() {
  if (!menu) return;
  if (menu.view === 'briefing') setView('campaign');
  else if (menu.view === 'main' || !session || !running) closeMenu();
  else { menu = { view: 'main', note: '' }; renderMenu(); }
}

function setView(view, extra = {}) {
  menu = { view, note: '', ...extra };
  renderMenu();
}

function renderMenu() {
  const v = menu.view;
  let html = '';
  if (v === 'main') {
    const g = session.game;
    html = `
      <h1>Paused</h1>
      <p class="sub">${battleName(g.setup)} · ${clock(g.time)}</p>
      <div class="menu-buttons">
        <button data-act="resume">Resume</button>
        <button data-act="save" class="secondary">Save battle</button>
        <button data-act="load" class="secondary">Load battle</button>
        <button data-act="restart" class="secondary">Restart battle</button>
        <button data-act="settings" class="secondary">Settings</button>
        <button data-act="quit" class="secondary">Quit to main menu</button>
      </div>
      <p class="sub hint">Esc to resume</p>`;
  } else if (v === 'save' || v === 'load') {
    const saves = listSaves();
    const rows = [];
    for (let n = 1; n <= SLOTS; n++) {
      const s = saves[n];
      const meta = s
        ? `<b>${battleName(s)}</b><span>${clock(s.time)} into the battle · saved ${new Date(s.savedAt).toLocaleString()}</span>`
        : '<b class="empty">Empty slot</b>';
      const main = v === 'save'
        ? `<button data-save="${n}">${s ? 'Overwrite' : 'Save'}</button>`
        : `<button data-load="${n}" ${s ? '' : 'disabled'}>Load</button>`;
      const del = s ? `<button data-del="${n}" class="secondary" title="Delete this save">${menu.confirmDel === n ? 'Sure?' : '✕'}</button>` : '';
      rows.push(`<div class="slot"><span class="num">${n}</span><div class="meta">${meta}</div>${main}${del}</div>`);
    }
    html = `
      <h1>${v === 'save' ? 'Save battle' : 'Load battle'}</h1>
      ${v === 'load' && session && running ? '<p class="sub">Loading replaces the battle in progress.</p>' : ''}
      <div class="slots">${rows.join('')}</div>
      <p class="note">${menu.note}</p>
      <div class="menu-buttons"><button data-act="back" class="secondary">Back</button></div>`;
  } else if (v === 'settings') {
    const opt = (key, choices) => choices.map(([val, label]) => `<option value="${val}" ${String(settings[key]) === String(val) ? 'selected' : ''}>${label}</option>`).join('');
    const range = (key, min, max, step) => `<input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}">`;
    html = `
      <h1>Settings</h1>
      <div class="settings">
        <label>Game speed <select data-set="speed">${opt('speed', [[0.75, 'Slow'], [1, 'Normal'], [1.25, 'Fast'], [1.5, 'Faster']])}</select></label>
        <label>Scroll speed ${range('scroll', 0.5, 2, 0.1)}</label>
        <label>Sound effects ${range('sfxVolume', 0, 1, 0.05)}</label>
        <label>Voices ${range('voiceVolume', 0, 1, 0.05)}</label>
        <label>Health bars <select data-set="healthBars">${opt('healthBars', [['selected', 'Selected only'], ['damaged', 'Damaged units'], ['all', 'Always']])}</select></label>
      </div>
      <div class="menu-buttons"><button data-act="back" class="secondary">Back</button></div>`;
  } else if (v === 'campaign') {
    const done = campaignProgress().done;
    const rows = MISSIONS.map((m, i) => {
      const open = missionUnlocked(i);
      return `<button data-mission="${m.id}" ${open ? '' : 'disabled'}><span class="n">${i + 1}</span>
        <span class="t"><b>${m.title}</b><span>${FACTIONS[m.faction].name} · ${MAPS[m.map].name}${open ? '' : ' · finish the previous mission to unlock'}</span></span>
        ${done.includes(m.id) ? '<span class="ok">✔</span>' : ''}</button>`;
    });
    html = `
      <h1>Campaign</h1>
      <p class="sub">Four missions across all three sides. Each one unlocks the next.</p>
      <div class="missions">${rows.join('')}</div>
      <div class="menu-buttons"><button data-act="back" class="secondary">Back</button></div>`;
  } else if (v === 'briefing') {
    const m = missionById(menu.mission);
    const objs = m.objectives.map((o) => `<li>${typeof o.text === 'function' ? o.text({ time: 0, buildings: [], human: null }) : o.text}${o.optional ? ' (bonus)' : ''}</li>`).join('');
    html = `
      <h1>${m.title}</h1>
      <p class="meta">${FACTIONS[m.faction].name} · ${MAPS[m.map].name}${m.difficulty === 'hard' ? ' · Hard' : ''}</p>
      <div class="briefing">${m.briefing.map((t) => `<p>${t}</p>`).join('')}<b>Objectives</b><ul>${objs}</ul></div>
      <div class="menu-buttons row">
        <button data-act="play">Start mission</button>
        <button data-act="back" class="secondary">Back</button>
      </div>`;
  } else if (v === 'confirm') {
    html = `
      <h1>${menu.title}</h1>
      <p class="sub">Progress since your last save will be lost.</p>
      <div class="menu-buttons row">
        <button data-act="yes">${menu.yes}</button>
        <button data-act="back" class="secondary">Cancel</button>
      </div>`;
  }
  menuPanel.innerHTML = html;
}

menuPanel.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !menu) return;
  if (session) session.game.sound('click');
  const act = b.dataset.act;
  if (act === 'resume') closeMenu();
  else if (act === 'back') menuBack();
  else if (act === 'save' || act === 'load' || act === 'settings') setView(act);
  else if (act === 'restart') setView('confirm', { title: 'Restart battle?', yes: 'Restart', then: restartBattle });
  else if (act === 'quit') setView('confirm', { title: 'Quit battle?', yes: 'Quit', then: quitToSetup });
  else if (act === 'yes') menu.then();
  else if (act === 'play') { audio.unlock(); startGame({ mission: menu.mission }); }
  else if (b.dataset.mission) setView('briefing', { mission: b.dataset.mission });
  else if (b.dataset.save) {
    try {
      writeSave(+b.dataset.save, session.game, session.renderer);
      setView('save', { note: `Saved to slot ${b.dataset.save}.` });
    } catch (err) {
      setView('save', { note: `Couldn't save: ${err.name === 'QuotaExceededError' ? 'browser storage is full — delete an old save' : err.message}` });
    }
  } else if (b.dataset.load) {
    try {
      startGame(null, readSave(+b.dataset.load));
    } catch (err) {
      console.error(err);
      setView('load', { note: `Couldn't load: ${err.message}` });
    }
  } else if (b.dataset.del) {
    const n = +b.dataset.del;
    if (menu.confirmDel === n) { deleteSave(n); setView(menu.view, { note: `Slot ${n} deleted.` }); }
    else setView(menu.view, { confirmDel: n });
  }
});

// Settings apply as soon as a control moves
menuPanel.addEventListener('input', (e) => {
  const key = e.target.dataset.set;
  if (!key) return;
  settings[key] = typeof settings[key] === 'number' ? Number(e.target.value) : e.target.value;
  saveSettings();
  audio.applyVolume();
});

// ---------- setup screen ----------
const setup = { faction: 'allied', map: 'random', difficulty: 'normal', mode: '1v1' };
try { Object.assign(setup, JSON.parse(localStorage.getItem('ironfront.setup') || '{}')); } catch { /* no saved setup */ }
if (!MAPS[setup.map]) setup.map = 'random';
if (!MODES[setup.mode]) setup.mode = '1v1';

function choose(group, attr, value) {
  for (const b of document.querySelectorAll(group)) b.classList.toggle('selected', b.dataset[attr] === value);
}

const mapList = document.getElementById('map-list');
for (const [id, m] of Object.entries(MAPS)) {
  const b = document.createElement('button');
  b.dataset.map = id;
  b.innerHTML = `<b>${m.name}</b><span>${m.size}×${m.size}</span>`;
  b.addEventListener('click', () => { setup.map = id; refreshSetup(); });
  mapList.appendChild(b);
}
for (const b of document.querySelectorAll('.faction')) b.addEventListener('click', () => { setup.faction = b.dataset.faction; refreshSetup(); });
for (const b of document.querySelectorAll('#difficulty button')) b.addEventListener('click', () => { setup.difficulty = b.dataset.difficulty; refreshSetup(); });
for (const b of document.querySelectorAll('#mode button')) b.addEventListener('click', () => { setup.mode = b.dataset.mode; refreshSetup(); });

const loadBtn = document.getElementById('load');
function refreshSetup() {
  choose('.faction', 'faction', setup.faction);
  choose('#map-list button', 'map', setup.map);
  // small maps only have room for two bases
  if (!mapSupports(setup.map, MODES[setup.mode].teams.length)) setup.mode = '1v1';
  for (const b of document.querySelectorAll('#mode button')) {
    b.disabled = !mapSupports(setup.map, MODES[b.dataset.mode].teams.length);
    b.title = b.disabled ? `${MAPS[setup.map].name} only has room for two bases` : '';
  }
  choose('#mode button', 'mode', setup.mode);
  // maps grow for more players
  for (const b of document.querySelectorAll('#map-list button')) {
    const m = MAPS[b.dataset.map], n = MODES[setup.mode].teams.length > 2 && m.sizeLarge ? m.sizeLarge : m.size;
    b.querySelector('span').textContent = `${n}×${n}`;
  }
  choose('#difficulty button', 'difficulty', setup.difficulty);
  document.getElementById('map-desc').textContent = MAPS[setup.map].desc;
  loadBtn.hidden = !hasSaves();
}
refreshSetup();

loadBtn.addEventListener('click', () => { audio.unlock(); openMenu('load'); });
document.getElementById('settings').addEventListener('click', () => openMenu('settings'));
document.getElementById('campaign').addEventListener('click', () => { audio.unlock(); openMenu('campaign'); });
document.getElementById('start').addEventListener('click', () => {
  audio.unlock(); // inside the click, so the browser allows audio
  try { localStorage.setItem('ironfront.setup', JSON.stringify(setup)); } catch { /* storage unavailable */ }
  statusPanel.innerHTML = `<h1>Deploying…</h1><p class="sub">${MODES[setup.mode].name} · ${MAPS[setup.map].name} · ${setup.difficulty === 'hard' ? 'Hard' : 'Normal'}</p>`;
  showOverlay(statusPanel);
  setTimeout(() => startGame({ ...setup }), 30);
});
