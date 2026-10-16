type ThemePreference = 'light' | 'dark' | 'system';

const themeStorageKey = 'dalnex-theme';
const themeMediaQuery = '(prefers-color-scheme: dark)';
const themeChangeEvent = 'dalnex:theme-change';

function parseThemePreference(value: unknown): ThemePreference {
  return value === 'dark' || value === 'system' ? value : 'light';
}

function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(themeStorageKey));
  } catch {
    return 'light';
  }
}

function getThemeSnapshot(): ThemePreference {
  return parseThemePreference(document.documentElement.dataset.themePreference);
}

function getServerThemeSnapshot(): ThemePreference {
  return 'light';
}

function applyThemePreference(preference: ThemePreference) {
  const authenticationPage = /^\/(?:login(?:\/|$)|auth(?:\/|$))/.test(window.location.pathname);
  const dark =
    !authenticationPage &&
    (preference === 'dark' ||
      (preference === 'system' && window.matchMedia(themeMediaQuery).matches));
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#000000' : '#FFFFFF');
  window.dispatchEvent(new Event(themeChangeEvent));
}

function setThemePreference(preference: ThemePreference) {
  applyThemePreference(preference);
  try {
    window.localStorage.setItem(themeStorageKey, preference);
  } catch {
    // The selection still works for this tab when browser storage is unavailable.
  }
}

function subscribeToTheme(onChange: () => void) {
  window.addEventListener(themeChangeEvent, onChange);
  return () => window.removeEventListener(themeChangeEvent, onChange);
}

// Run before the first paint so a saved dark theme never flashes the white canvas.
const themeInitScript = `(() => {
  let preference = 'light';
  try {
    const saved = localStorage.getItem(${JSON.stringify(themeStorageKey)});
    if (saved === 'dark' || saved === 'system') preference = saved;
  } catch {}
  const authenticationPage = /^\\/(?:login(?:\\/|$)|auth(?:\\/|$))/.test(location.pathname);
  const dark = !authenticationPage && (preference === 'dark' ||
    (preference === 'system' && matchMedia(${JSON.stringify(themeMediaQuery)}).matches));
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();`;

export {
  applyThemePreference,
  getServerThemeSnapshot,
  getThemeSnapshot,
  parseThemePreference,
  readThemePreference,
  setThemePreference,
  subscribeToTheme,
  themeInitScript,
  themeMediaQuery,
  themeStorageKey,
};
export type { ThemePreference };
