// Player preferences, remembered in the browser between battles
const KEY = 'ironfront.settings';

export const DEFAULTS = {
  speed: 1, // game speed multiplier
  scroll: 1, // camera scroll speed multiplier
  sfxVolume: 0.8,
  voiceVolume: 0.9, // EVA and unit voices
  healthBars: 'selected', // 'selected' | 'damaged' | 'all'
};

export const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* no saved settings */ }

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}
