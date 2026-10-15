'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './AutocompleteInput.module.css';

interface AutocompleteInputProps {
  name: string;
  label: string;
  options: readonly string[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

interface SuggestionPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

/** Suggest existing values without preventing the user from entering a new value. */
function AutocompleteInput({
  name,
  label,
  options,
  defaultValue = '',
  placeholder,
  required,
  disabled,
}: AutocompleteInputProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<SuggestionPosition | null>(null);
  const suggestions = useMemo(
    () => [...new Set(options.map((option) => option.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    [options],
  );
  const query = value.trim().toLocaleLowerCase();
  const matches = suggestions.filter((option) => option.toLocaleLowerCase().includes(query));
  const expanded = open && !disabled && matches.length > 0;
  const activeOption = activeIndex >= 0 && activeIndex < matches.length ? activeIndex : -1;

  function chooseSuggestion(option: string) {
    setValue(option);
    inputRef.current?.focus();
    setOpen(false);
    setActiveIndex(-1);
  }

  useEffect(() => {
    const form = inputRef.current?.form;
    function reset(event: Event) {
      if (!event.defaultPrevented) {
        setValue(defaultValue);
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, [defaultValue]);

  useLayoutEffect(() => {
    if (!expanded) {
      return;
    }
    function updatePosition(event?: Event) {
      if (event?.target instanceof Node && listRef.current?.contains(event.target)) {
        return;
      }
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom <= 0 || rect.top >= window.innerHeight) {
        setOpen(false);
        return;
      }
      const margin = 12;
      const gap = 6;
      const below = window.innerHeight - rect.bottom - margin - gap;
      const above = rect.top - margin - gap;
      const placeAbove = below < 160 && above > below;
      const width = Math.min(rect.width, window.innerWidth - margin * 2);
      setPosition({
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
        top: placeAbove ? rect.top - gap : rect.bottom + gap,
        width,
        maxHeight: Math.max(0, Math.min(240, placeAbove ? above : below)),
        above: placeAbove,
      });
    }
    function closeOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !inputRef.current?.contains(event.target) &&
        !listRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', closeOutside, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', closeOutside, true);
    };
  }, [expanded]);

  useEffect(() => {
    if (expanded && activeOption >= 0) {
      listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    }
  }, [expanded, activeOption, value]);

  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? `${id}-options` : undefined}
        aria-activedescendant={expanded && activeOption >= 0 ? `${id}-option-${activeOption}` : undefined}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (!listRef.current?.contains(event.relatedTarget)) {
            setOpen(false);
          }
        }}
        onChange={(event) => {
          setValue(event.target.value);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            return;
          }
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActiveIndex(
              expanded && activeOption >= 0
                ? (activeOption + step + matches.length) % matches.length
                : step === 1 ? 0 : matches.length - 1,
            );
            setOpen(true);
          } else if (event.key === 'Enter' && expanded && activeOption >= 0) {
            event.preventDefault();
            chooseSuggestion(matches[activeOption]);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === 'Tab') {
            setOpen(false);
          }
        }}
      />
      <span className={styles.status} role="status">
        {open && !disabled ? `${matches.length} suggestions available` : ''}
      </span>
      {expanded && position && createPortal(
        <div
          ref={listRef}
          id={`${id}-options`}
          className={styles.suggestions}
          role="listbox"
          aria-label={`${label} suggestions`}
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
            transform: position.above ? 'translateY(-100%)' : undefined,
          }}
        >
          {matches.map((option, index) => (
            <button
              key={option}
              id={`${id}-option-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              className={styles.option}
              aria-selected={option === value}
              data-active={index === activeOption}
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => chooseSuggestion(option)}
            >
              {option}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export { AutocompleteInput };
