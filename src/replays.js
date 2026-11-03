// Replays: a battle's setup (with its seed) plus every command, tick by tick. Playing
// one back runs the same simulation again, so it takes a few KB however long the
// battle was. The last few are kept in the browser; any can be exported as a file.
const KEY = 'ironfront.replays';
const KEEP = 10;
export const REPLAY_VERSION = 1;

export function listReplays() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, KEEP))); } catch { /* storage full or unavailable */ }
}

// Keep the battle that just ended (or was left), unless it was over in seconds
export function storeReplay(game) {
  if (!game.recording || game.tick < 60 * 15) return null;
  const r = {
    id: Date.now().toString(36),
    version: REPLAY_VERSION,
    date: Date.now(),
    setup: { ...game.setup, seed: game.seed },
    player: game.human.id,
    ticks: game.tick,
    result: game.result,
    commands: game.recording,
  };
  write([r, ...listReplays()]);
  game.recording = null; // stored once
  return r;
}

export function deleteReplay(id) {
  write(listReplays().filter((r) => r.id !== id));
}

export function importReplay(text) {
  const r = JSON.parse(text);
  if (r.version !== REPLAY_VERSION || !r.setup || !Array.isArray(r.commands) || !r.ticks) throw new Error('not a replay file');
  r.id = Date.now().toString(36);
  write([r, ...listReplays()]);
  return r;
}

export function exportReplay(r) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
  a.download = `iron-front-replay-${new Date(r.date).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
