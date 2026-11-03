import { SIDEBAR_W, FACTIONS, MODES } from './config.js';
import { Game, mapSupports, TICK } from './game.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { AudioSystem } from './audio.js';
import { MAPS } from './maps.js';
import { SLOTS, listSaves, writeSave, readSave, deleteSave } from './save.js';
import { settings, saveSettings } from './settings.js';
import { MISSIONS, missionById, missionUnlocked, markMissionDone, campaignProgress } from './missions.js';
import { registerCustomMaps } from './customMaps.js';
import { Editor } from './editor.js';
import { listReplays, storeReplay, deleteReplay, importReplay, exportReplay } from './replays.js';
import { Net } from './net.js';

const canvas = document.getElementById('game');
const audio = new AudioSystem();
const overlay = document.getElementById('overlay');
const setupPanel = document.getElementById('setup-panel');
const statusPanel = document.getElementById('status-panel');
const pauseEl = document.getElementById('paused');
const menuEl = document.getElementById('menu');
const menuPanel = menuEl.querySelector('.panel');
const replayBar = document.getElementById('replay-bar');

// The battle in progress: { game, renderer, input, ui, ac }
let session = null;
let running = false;
let menu = null; // the open menu view, or null
let last = performance.now();
let acc = 0; // real time not yet simulated, in seconds
let replaySpeed = 1;

// replay: watch a recorded battle instead of playing a new one
// online: { net, you } for a battle with other people
function startGame(setup, loaded = null, replay = null, online = null) {
  audio.unlock();
  endGame();
  const ac = new AbortController();
  const game = loaded ? loaded.game : new Game({ ...setup, local: online?.you ?? 0 });
  game.soundEnabled = true;
  if (online) {
    game.net = online.net;
    const humans = new Set(setup.players.map((pl, i) => (pl.ai ? -1 : i)).filter((i) => i >= 0));
    online.net.begin(game, online.you, humans);
  }
  if (replay) {
    game.replay = { commands: replay.commands, i: 0, ticks: replay.ticks, data: replay };
    game.human = game.players[replay.player] || game.human;
    replaySpeed = 1;
  } else if (!loaded) {
    game.recording = []; // loaded games aren't recorded: a replay has to start from the beginning
  }
  acc = 0;
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
  replayBar.hidden = !replay;
  if (replay) game.notify('Watching replay', 'info', 0);
  else if (loaded) game.notify('Battle loaded', 'info', 0);
  else game.notify(game.setup.faction === 'soviet' ? 'Welcome, Comrade General' : 'Battle control online');

  // Expose for debugging in the console
  Object.assign(window, { game, renderer, input, ui, audio });
  last = performance.now();
}

// Tear the current battle down so another can start without reloading the page
function endGame() {
  if (!session) return;
  storeReplay(session.game);
  if (session.game.net) { session.game.net.close(); lobby = null; }
  replayBar.hidden = true;
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
  // online the battle never pauses, and keeps running (and sending turns) after you're done
  const net = game.net;
  const paused = !net && (input.paused || !!menu);
  // Fixed simulation steps: faster speeds (and fast-forwarded replays) just run more of them
  let steps = 0;
  if ((running || net) && !paused) {
    const speed = game.replay ? replaySpeed : net ? 1 : settings.speed;
    const max = Math.ceil(speed * 4) + 2;
    acc += dt * speed;
    while (acc >= TICK && steps < max && (net || !game.result)) {
      if (game.replay && game.tick >= game.replay.ticks) break;
      if (net && !net.ready(game.tick)) { acc = Math.min(acc, TICK * 2); break; } // waiting for someone's turn
      game.step();
      acc -= TICK;
      steps++;
    }
    if (steps >= max) acc = 0; // can't keep up: slow down rather than spiral
  }
  if (net) updateNetStatus(game, steps);
  input.update(dt);
  renderer.draw(steps * TICK, input);
  if (game.replay) updateReplayBar(game);
  ui.update();
  playSounds();
  pauseEl.style.display = input.paused && !menu && !net ? 'flex' : 'none';

  const replayOver = game.replay && game.tick >= game.replay.ticks;
  if ((game.result || replayOver) && running) {
    running = false;
    input.enabled = false;
    if (game.replay) showReplayEnd(); else showResult(game.result);
  }
}

// ---------- replays ----------
const fmt = (ticks) => clock(ticks * TICK);
function updateReplayBar(game) {
  const t = `${fmt(game.tick)} / ${fmt(game.replay.ticks)}`;
  const el = replayBar.querySelector('.time');
  if (el.textContent !== t) el.textContent = t;
  for (const b of replayBar.querySelectorAll('[data-speed]')) b.classList.toggle('on', +b.dataset.speed === replaySpeed);
  replayBar.querySelector('[data-rp=pause]').textContent = session.input.paused ? '▶' : '❚❚';
}

replayBar.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !session?.game.replay) return;
  if (b.dataset.speed) replaySpeed = +b.dataset.speed;
  if (b.dataset.rp === 'pause') session.input.paused = !session.input.paused;
  if (b.dataset.rp === 'exit') quitToSetup();
});

function showReplayEnd() {
  const r = session.game.replay.data;
  statusPanel.innerHTML = `
    <h1>Replay finished</h1>
    <p>${battleName(r.setup)} · ${fmt(r.ticks)}</p>
    <div class="menu-buttons">
      <button data-act="again">Watch again</button>
      <button data-act="replays" class="secondary">Replays</button>
      <button data-act="quit" class="secondary">Main menu</button>
    </div>`;
  statusPanel.querySelector('[data-act=again]').onclick = () => startGame(r.setup, null, r);
  statusPanel.querySelector('[data-act=replays]').onclick = () => openMenu('replays');
  statusPanel.querySelector('[data-act=quit]').onclick = quitToSetup;
  showOverlay(statusPanel);
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
  if (session.game.net) {
    // online: the others may still be fighting, so the only way on is out
    statusPanel.innerHTML = `
      <h1>${result === 'win' ? 'Victory' : 'Defeat'}</h1>
      <p>${result === 'win' ? 'Your side has won the battle.' : 'Your forces have been wiped out.'}</p>
      <div class="menu-buttons"><button data-act="quit">Leave battle</button></div>`;
    statusPanel.querySelector('[data-act=quit]').onclick = quitToSetup;
    showOverlay(statusPanel);
    return;
  }
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
  if (v === 'main' && session.game.replay) {
    html = `
      <h1>Replay paused</h1>
      <p class="sub">${battleName(session.game.replay.data.setup)}</p>
      <div class="menu-buttons">
        <button data-act="resume">Resume</button>
        <button data-act="quit-now" class="secondary">Exit replay</button>
      </div>`;
  } else if (v === 'main' && session.game.net) {
    html = `
      <h1>Online battle</h1>
      <p class="sub">Room ${session.game.net.code} · the battle keeps running while this menu is open</p>
      <div class="menu-buttons">
        <button data-act="resume">Resume</button>
        <button data-act="settings" class="secondary">Settings</button>
        <button data-act="quit" class="secondary">Leave battle</button>
      </div>`;
  } else if (v === 'main') {
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
  } else if (v === 'online') {
    html = `
      <h1>Play online</h1>
      <p class="sub">Everyone opens this game from the same server. On your network, others use your computer's address
        (shown in the terminal when the server starts) with port ${location.port || 80}.</p>
      <div class="settings">
        <label>Your name <input type="text" id="net-name" maxlength="20" value="${settings.netName || ''}" placeholder="Commander"></label>
        <label>Game code <input type="text" id="net-code" maxlength="4" placeholder="ABCD" style="text-transform:uppercase"></label>
      </div>
      <p class="note">${menu.note}</p>
      <div class="menu-buttons row">
        <button data-act="host">Host a game</button>
        <button data-act="join" class="secondary">Join</button>
        <button data-act="back" class="secondary">Back</button>
      </div>`;
  } else if (v === 'lobby') {
    html = lobbyHtml();
  } else if (v === 'replays') {
    const list = listReplays();
    const rows = list.map((r) => `<div class="slot"><div class="meta"><b>${battleName(r.setup)}</b>
      <span>${new Date(r.date).toLocaleString()} · ${fmt(r.ticks)}${r.result ? ` · ${r.result === 'win' ? 'won' : 'lost'}` : ''}</span></div>
      <button data-watch="${r.id}">Watch</button><button data-export="${r.id}" class="secondary" title="Save as a file">⇩</button>
      <button data-delreplay="${r.id}" class="secondary" title="Delete">${menu.confirmDel === r.id ? 'Sure?' : '✕'}</button></div>`);
    html = `
      <h1>Replays</h1>
      <p class="sub">Your last ${list.length ? list.length : ''} battles are kept automatically. Replays play back at up to 8× speed with the whole map revealed.</p>
      <div class="slots">${rows.join('') || '<p class="sub">No replays yet. Play a battle for at least 15 seconds.</p>'}</div>
      <p class="note">${menu.note}</p>
      <div class="menu-buttons row">
        <button data-act="import-replay" class="secondary">Import file</button>
        <button data-act="back" class="secondary">Back</button>
      </div>`;
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
  else if (act === 'quit-now') quitToSetup();
  else if (act === 'host' || act === 'join') goOnline(act);
  else if (act === 'leave-lobby') { lobby?.net.close(); lobby = null; setView('online'); }
  else if (act === 'start-online') lobby?.net.act({ act: 'start' });
  else if (b.dataset.sit !== undefined) lobby?.net.act({ act: 'sit', slot: +b.dataset.sit });
  else if (act === 'import-replay') document.getElementById('replay-file').click();
  else if (b.dataset.watch) { const r = listReplays().find((x) => x.id === b.dataset.watch); if (r) { audio.unlock(); startGame(r.setup, null, r); } }
  else if (b.dataset.export) { const r = listReplays().find((x) => x.id === b.dataset.export); if (r) exportReplay(r); }
  else if (b.dataset.delreplay) {
    const id = b.dataset.delreplay;
    if (menu.confirmDel === id) { deleteReplay(id); setView('replays', { note: 'Replay deleted.' }); }
    else setView('replays', { confirmDel: id });
  }
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
  if (e.target.dataset.lobby) return lobbyChange(e.target);
  const key = e.target.dataset.set;
  if (!key) return;
  settings[key] = typeof settings[key] === 'number' ? Number(e.target.value) : e.target.value;
  saveSettings();
  audio.applyVolume();
});

// ---------- setup screen ----------
registerCustomMaps();
const setup = { faction: 'allied', map: 'random', difficulty: 'normal', mode: '1v1' };
try { Object.assign(setup, JSON.parse(localStorage.getItem('ironfront.setup') || '{}')); } catch { /* no saved setup */ }
if (!MAPS[setup.map]) setup.map = 'random';
if (!MODES[setup.mode]) setup.mode = '1v1';

function choose(group, attr, value) {
  for (const b of document.querySelectorAll(group)) b.classList.toggle('selected', b.dataset[attr] === value);
}

const mapList = document.getElementById('map-list');
function renderMapList() {
  mapList.innerHTML = '';
  for (const [id, m] of Object.entries(MAPS)) {
    const b = document.createElement('button');
    b.dataset.map = id;
    b.innerHTML = `<b>${m.name}</b><span>${m.size}×${m.size}</span>`;
    if (m.custom) b.classList.add('custom');
    b.addEventListener('click', () => { setup.map = id; refreshSetup(); });
    mapList.appendChild(b);
  }
}
renderMapList();
for (const b of document.querySelectorAll('.faction')) b.addEventListener('click', () => { setup.faction = b.dataset.faction; refreshSetup(); });
for (const b of document.querySelectorAll('#difficulty button')) b.addEventListener('click', () => { setup.difficulty = b.dataset.difficulty; refreshSetup(); });
for (const b of document.querySelectorAll('#mode button')) b.addEventListener('click', () => { setup.mode = b.dataset.mode; refreshSetup(); });

const loadBtn = document.getElementById('load');
function refreshSetup() {
  if (!MAPS[setup.map]) setup.map = 'random';
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
document.getElementById('replays').addEventListener('click', () => { audio.unlock(); openMenu('replays'); });
document.getElementById('online').addEventListener('click', () => { audio.unlock(); openMenu('online'); });

// ---------- online lobby ----------
let lobby = null; // { net, state }
const SIDES = Object.keys(FACTIONS);
const ONLINE_MAPS = Object.keys(MAPS).filter((id) => !MAPS[id].custom); // everyone needs the same map

async function goOnline(kind) {
  const name = document.getElementById('net-name').value.trim();
  const code = document.getElementById('net-code').value.trim();
  settings.netName = name;
  saveSettings();
  if (kind === 'join' && code.length !== 4) { setView('online', { note: 'Enter the 4-letter code from the host.' }); return; }
  try {
    const net = kind === 'host' ? await Net.host(name) : await Net.join(code, name);
    lobby = { net, state: null };
    net.listen(onNetMessage);
    setView('lobby');
  } catch (err) {
    setView('online', { note: location.protocol === 'file:' || err.message.includes('Failed to fetch')
      ? 'Online play needs the game served by its own server (npm start).' : err.message });
  }
}

function onNetMessage(msg) {
  if (!lobby) return;
  if (msg.k === 'lobby') { lobby.state = msg; if (menu?.view === 'lobby') renderMenu(); }
  if (msg.k === 'closed') { lobby.net.close(); lobby = null; openMenu('online', { note: 'The host closed the game.' }); }
  if (msg.k === 'start') { audio.unlock(); startGame(msg.setup, null, null, { net: lobby.net, you: msg.you }); }
  if (msg.k === 'left' && session?.game.net) session.game.notify(`${msg.name} left the battle`, 'warn', 0);
  if (msg.k === 'error' && !session && menu?.view === 'lobby') setView('online', { note: 'Lost the connection to the server.' });
}

function lobbyHtml() {
  const st = lobby?.state;
  if (!st) return '<h1>Connecting…</h1><div class="menu-buttons"><button data-act="leave-lobby" class="secondary">Back</button></div>';
  const host = st.host, s = st.settings;
  const opt = (list, cur, label) => list.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label(v)}</option>`).join('');
  const slots = st.slots.map((sl, i) => {
    const mine = i === st.you, canSide = mine || (host && !sl.name);
    return `<div class="slot"><span class="num">${i + 1}</span>
      <div class="meta"><b>${sl.name ? sl.name + (mine ? ' (you)' : '') : 'Computer'}</b><span>Team ${sl.team + 1}</span></div>
      <select data-lobby="faction" data-slot="${i}" ${canSide ? '' : 'disabled'}>${opt(SIDES, sl.faction, (f) => FACTIONS[f].name)}</select>
      ${sl.name ? '' : `<button data-sit="${i}" class="secondary">Sit here</button>`}</div>`;
  }).join('');
  return `
    <h1>Game ${st.code}</h1>
    <p class="sub">${host ? 'Give this code to the other players. Empty seats are played by the computer.' : 'Waiting for the host to start.'}</p>
    <div class="settings">
      <label>Map <select data-lobby="map" ${host ? '' : 'disabled'}>${opt(ONLINE_MAPS.filter((id) => mapSupports(id, MODES[s.mode].teams.length) || id === s.map), s.map, (id) => MAPS[id].name)}</select></label>
      <label>Mode <select data-lobby="mode" ${host ? '' : 'disabled'}>${opt(Object.keys(MODES).filter((md) => mapSupports(s.map, MODES[md].teams.length)), s.mode, (md) => MODES[md].name)}</select></label>
      <label>Computer players <select data-lobby="difficulty" ${host ? '' : 'disabled'}>${opt(['normal', 'hard'], s.difficulty, (d) => (d === 'hard' ? 'Hard' : 'Normal'))}</select></label>
    </div>
    <div class="slots">${slots}</div>
    <div class="menu-buttons row">
      ${host ? '<button data-act="start-online">Start battle</button>' : ''}
      <button data-act="leave-lobby" class="secondary">Leave</button>
    </div>`;
}

function lobbyChange(el) {
  const st = lobby?.state;
  if (!st) return;
  if (el.dataset.lobby === 'faction') lobby.net.act({ act: 'faction', slot: +el.dataset.slot, faction: el.value });
  else lobby.net.act({ act: 'settings', ...st.settings, [el.dataset.lobby]: el.value });
}

// "Waiting for …" and desync warnings during an online battle
const netEl = document.getElementById('net-status');
let waited = 0;
function updateNetStatus(game, steps) {
  const net = game.net;
  waited = steps ? 0 : waited + 1;
  let text = '';
  if (net.desync) text = 'Out of sync with the other players: this battle may differ between screens.';
  else if (waited > 30) text = `Waiting for ${net.waitingFor(game.tick).map((i) => game.players[i].name).join(', ') || 'players'}…`;
  if (netEl.textContent !== text) netEl.textContent = text;
  netEl.hidden = !text;
}
document.getElementById('replay-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { importReplay(await f.text()); setView('replays', { note: 'Replay imported.' }); }
  catch (err) { setView('replays', { note: `Couldn't import: ${err.message}.` }); }
});

// ---------- map editor ----------
const editor = new Editor({
  onClose: () => { refreshSetup(); showOverlay(setupPanel); },
  onSaved: () => { renderMapList(); refreshSetup(); },
  onPlay: (mapId) => {
    audio.unlock();
    Object.assign(setup, { map: mapId, mode: '1v1' });
    refreshSetup();
    startGame({ ...setup });
  },
});
document.getElementById('open-editor').addEventListener('click', () => { overlay.style.display = 'none'; editor.open(); });
window.editor = editor; // for debugging in the console
document.getElementById('start').addEventListener('click', () => {
  audio.unlock(); // inside the click, so the browser allows audio
  try { localStorage.setItem('ironfront.setup', JSON.stringify(setup)); } catch { /* storage unavailable */ }
  statusPanel.innerHTML = `<h1>Deploying…</h1><p class="sub">${MODES[setup.mode].name} · ${MAPS[setup.map].name} · ${setup.difficulty === 'hard' ? 'Hard' : 'Normal'}</p>`;
  showOverlay(statusPanel);
  setTimeout(() => startGame({ ...setup }), 30);
});
