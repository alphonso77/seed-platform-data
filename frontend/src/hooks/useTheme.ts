import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme-preference';

function getStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  } catch {
    // localStorage unavailable
  }
  return 'auto';
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'auto') return getSystemTheme();
  return preference;
}

function applyTheme(resolved: ResolvedTheme) {
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

// Module-level state so all hook instances share the same value
let currentPreference: ThemePreference = getStoredPreference();
let currentResolved: ResolvedTheme = resolveTheme(currentPreference);
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentPreference + ':' + currentResolved;
}

// Listen for system theme changes
if (typeof window !== 'undefined') {
  applyTheme(currentResolved);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentPreference === 'auto') {
      currentResolved = getSystemTheme();
      applyTheme(currentResolved);
      notify();
    }
  });
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const [theme, resolvedTheme] = snapshot.split(':') as [ThemePreference, ResolvedTheme];

  const setTheme = useCallback((pref: ThemePreference) => {
    currentPreference = pref;
    currentResolved = resolveTheme(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // localStorage unavailable
    }
    applyTheme(currentResolved);
    notify();
  }, []);

  // Ensure DOM is in sync on mount
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  return { theme, setTheme, resolvedTheme };
}
