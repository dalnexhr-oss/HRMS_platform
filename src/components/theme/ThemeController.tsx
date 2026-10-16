'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import {
  applyThemePreference,
  getThemeSnapshot,
  parseThemePreference,
  readThemePreference,
  themeMediaQuery,
  themeStorageKey,
} from '@/lib/theme';

function ThemeController() {
  const pathname = usePathname();

  useEffect(() => {
    // Preserve an in-memory selection when storage is blocked, including across navigation.
    const preference = document.documentElement.dataset.themePreference
      ? getThemeSnapshot()
      : readThemePreference();
    applyThemePreference(preference);

    const media = window.matchMedia(themeMediaQuery);
    function onSystemChange() {
      if (getThemeSnapshot() === 'system') {
        applyThemePreference('system');
      }
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== themeStorageKey && event.key !== null) {
        return;
      }
      try {
        if (event.storageArea !== window.localStorage) {
          return;
        }
      } catch {
        return;
      }
      applyThemePreference(parseThemePreference(event.newValue));
    }
    media.addEventListener('change', onSystemChange);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [pathname]);

  return null;
}

export { ThemeController };
