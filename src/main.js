import { SIDEBAR_W, FACTIONS } from './config.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { AudioSystem } from './audio.js';
import { MAPS } from './maps.js';
import { SLOTS, listSaves, writeSave, readSave, deleteSave } from './save.js';

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
  if (running && !paused) game.update(dt);
  input.update(dt);
  renderer.draw(paused ? 0 : dt, input);
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
    if (e.name === 'voice') { audio.unitVoice(e.unit, e.line); continue; }
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
  statusPanel.innerHTML = `
    <h1>${result === 'win' ? 'Mission Accomplished' : 'Mission Failed'}</h1>
    <p>${result === 'win' ? 'The enemy base has been destroyed.' : 'Your forces have been wiped out.'}</p>
    <div class="menu-buttons">
      <button data-act="restart">Restart battle</button>
      ${hasSaves() ? '<button data-act="load" class="secondary">Load battle</button>' : ''}
      <button data-act="quit" class="secondary">Main menu</button>
    </div>`;
  statusPanel.querySelector('[data-act=restart]').onclick = restartBattle;
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
const battleName = (s) => `${FACTIONS[s.faction].name} · ${MAPS[s.map]?.name ?? s.map} · ${s.difficulty === 'hard' ? 'Hard' : 'Normal'}`;

function openMenu(view = 'main') {
  if (session) session.input.enabled = false;
  menu = { view, note: '' };
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
  if (menu.view === 'main' || !session || !running) closeMenu();
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
  else if (act === 'save' || act === 'load') setView(act);
  else if (act === 'restart') setView('confirm', { title: 'Restart battle?', yes: 'Restart', then: restartBattle });
  else if (act === 'quit') setView('confirm', { title: 'Quit battle?', yes: 'Quit', then: quitToSetup });
  else if (act === 'yes') menu.then();
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

// ---------- setup screen ----------
const setup = { faction: 'allied', map: 'random', difficulty: 'normal' };
try { Object.assign(setup, JSON.parse(localStorage.getItem('ironfront.setup') || '{}')); } catch { /* no saved setup */ }
if (!MAPS[setup.map]) setup.map = 'random';

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

const loadBtn = document.getElementById('load');
function refreshSetup() {
  choose('.faction', 'faction', setup.faction);
  choose('#map-list button', 'map', setup.map);
  choose('#difficulty button', 'difficulty', setup.difficulty);
  document.getElementById('map-desc').textContent = MAPS[setup.map].desc;
  loadBtn.hidden = !hasSaves();
}
refreshSetup();

loadBtn.addEventListener('click', () => { audio.unlock(); openMenu('load'); });
document.getElementById('start').addEventListener('click', () => {
  audio.unlock(); // inside the click, so the browser allows audio
  try { localStorage.setItem('ironfront.setup', JSON.stringify(setup)); } catch { /* storage unavailable */ }
  statusPanel.innerHTML = `<h1>Deploying…</h1><p class="sub">${MAPS[setup.map].name} · ${setup.difficulty === 'hard' ? 'Hard' : 'Normal'}</p>`;
  showOverlay(statusPanel);
  setTimeout(() => startGame({ ...setup }), 30);
});
