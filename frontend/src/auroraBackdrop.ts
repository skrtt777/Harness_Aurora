// The animated aurora behind the app (aurora-ui.css). Per-computer preference.
const KEY = 'aurora-background';

export function auroraBackdropOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setAuroraBackdrop(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
  document.documentElement.dataset.auroraBg = on ? 'on' : 'off';
}

export function applyAuroraBackdrop() {
  document.documentElement.dataset.auroraBg = auroraBackdropOn() ? 'on' : 'off';
}
