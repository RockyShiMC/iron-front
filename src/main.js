import { SIDEBAR_W } from './config.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { AudioSystem } from './audio.js';

const canvas = document.getElementById('game');
const audio = new AudioSystem();
const overlay = document.getElementById('overlay');
const pauseEl = document.getElementById('paused');

let game, renderer, input, ui;
let running = false;
let last = performance.now();

function startGame(faction) {
  audio.unlock();
  game = new Game({ faction });
  game.soundEnabled = true;
  renderer = new Renderer(canvas, game);
  input = new Input(canvas, game, renderer);
  ui = new UI(game, input, renderer, audio);
  resize();
  const home = game.buildings.find((b) => b.owner === game.human);
  renderer.centerOn(home.x, home.y + 2);

  overlay.style.display = 'none';
  running = true;
  input.enabled = true;
  game.notify(faction === 'soviet' ? 'Welcome, Comrade General' : 'Battle control online');

  // Expose for debugging in the console
  Object.assign(window, { game, renderer, input, ui, audio });
  last = performance.now();
  requestAnimationFrame(frame);
}

function resize() {
  renderer?.resize(window.innerWidth - SIDEBAR_W, window.innerHeight);
}
window.addEventListener('resize', resize);

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (running && !input.paused) game.update(dt);
  input.update(dt);
  renderer.draw(input.paused ? 0 : dt, input);
  ui.update();
  playSounds();
  pauseEl.style.display = input.paused ? 'flex' : 'none';

  if (game.result && running) {
    running = false;
    input.enabled = false;
    showResult(game.result);
  }
  requestAnimationFrame(frame);
}

// Battle sounds fade with distance from the screen center and pan left/right
function playSounds() {
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

window.addEventListener('keydown', (e) => {
  if (!game || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'm') audio.setSfx(!audio.sfxOn);
  if (k === 'v') audio.setVoice(!audio.voiceOn);
  if (k === 'u') audio.setUnitVoice(!audio.unitVoiceOn);
});

function showResult(result) {
  overlay.innerHTML = `
    <div class="panel">
      <h1>${result === 'win' ? 'Mission Accomplished' : 'Mission Failed'}</h1>
      <p>${result === 'win' ? 'The enemy base has been destroyed.' : 'Your forces have been wiped out.'}</p>
      <button id="again">Play again</button>
    </div>`;
  overlay.style.display = 'flex';
  document.getElementById('again').onclick = () => location.reload();
}

for (const btn of document.querySelectorAll('.faction')) {
  btn.addEventListener('click', () => {
    audio.unlock(); // inside the click, so the browser allows audio
    // Painting the map takes about a second; show something meanwhile
    overlay.querySelector('.panel').innerHTML = '<h1>Deploying…</h1><p class="sub">Generating battlefield</p>';
    setTimeout(() => startGame(btn.dataset.faction), 30);
  });
}
