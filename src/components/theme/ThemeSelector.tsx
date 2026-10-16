'use client';

import { useId, useSyncExternalStore } from 'react';
import {
  getServerThemeSnapshot,
  getThemeSnapshot,
  setThemePreference,
  subscribeToTheme,
} from '@/lib/theme';
import styles from './ThemeSelector.module.css';
import type { ThemePreference } from '@/lib/theme';

const themeOptions: Array<{ value: ThemePreference; label: string; description: string }> = [
  { value: 'light', label: 'Light', description: 'The original white appearance' },
  { value: 'dark', label: 'Dark', description: 'Black canvas, softer surfaces' },
  { value: 'system', label: 'System', description: 'Follow your device settings' },
];

function LayoutPreview({ dark = false }: { dark?: boolean }) {
  return (
    <span className={styles.previewLayout} data-preview-theme={dark ? 'dark' : 'light'}>
      <span className={styles.previewSidebar}>
        <span />
        <span />
        <span />
        <span />
      </span>
      <span className={styles.previewMain}>
        <span className={styles.previewHeader}>
          <span />
          <span />
        </span>
        <span className={styles.previewMetrics}>
          <span />
          <span />
          <span />
        </span>
        <span className={styles.previewTable}>
          <span />
          <span />
          <span />
        </span>
      </span>
    </span>
  );
}

function ThemeSelector() {
  const preference = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  const groupId = useId();

  return (
    <fieldset className={styles.selector} aria-describedby={`${groupId}-description`}>
      <legend className={styles.legend}>Theme</legend>
      <p id={`${groupId}-description`} className={styles.description}>
        Choose how the application looks. Your choice applies immediately in this browser.
      </p>
      <div className={styles.options}>
        {themeOptions.map((option) => (
          <label key={option.value} className={styles.option}>
            <input
              className={styles.input}
              type="radio"
              name={`${groupId}-theme`}
              value={option.value}
              checked={preference === option.value}
              onChange={() => setThemePreference(option.value)}
              aria-describedby={`${groupId}-${option.value}-description`}
            />
            <span className={styles.optionSurface}>
              <span className={styles.preview} data-preview={option.value} aria-hidden="true">
                <LayoutPreview dark={option.value === 'dark'} />
                {option.value === 'system' && <LayoutPreview dark />}
              </span>
              <span className={styles.optionLabel}>
                <span className={styles.radio} aria-hidden="true" />
                {option.label}
              </span>
              <span
                id={`${groupId}-${option.value}-description`}
                className={styles.optionDescription}
              >
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function AppearanceSection() {
  return (
    <section className="card" aria-labelledby="appearance-heading">
      <div className="card-header">
        <h3 id="appearance-heading">Appearance</h3>
      </div>
      <div className="card-body">
        <ThemeSelector />
      </div>
    </section>
  );
}

export { AppearanceSection };
