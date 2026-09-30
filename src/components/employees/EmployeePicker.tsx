'use client';

import './employee-picker.css';
import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { EmployeeOption } from '@/lib/queries/employees';

interface EmployeePickerProps {
  employees: Array<EmployeeOption & { searchText?: string }>;
  label?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  searchValue?: string;
  onSearchChange?: (query: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}

/** Search roster fields; form submissions contain only an employee ID chosen from the roster. */
function EmployeePicker({
  employees,
  label = 'Employee',
  name,
  value,
  defaultValue = '',
  onChange,
  searchValue,
  onSearchChange,
  placeholder = 'Type a name or employee code…',
  hint,
  required = false,
  disabled = false,
  style,
}: EmployeePickerProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [localValue, setLocalValue] = useState(defaultValue);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = employees.find((employee) => employee.id === (value ?? localValue));
  const selectedId = selected?.id ?? '';
  const searchQuery = searchValue ?? query;
  const terms = (searchQuery ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = employees.filter((employee) => {
    const text = `${employee.name} ${employee.code} ${employee.searchText ?? ''}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const expanded = open && !disabled;
  const activeIndex = Math.min(active, matches.length - 1);
  const displayValue = searchQuery ?? (selected ? `${selected.name} · ${selected.code}` : '');

  function changeSelection(employeeId: string) {
    if (value === undefined) {
      setLocalValue(employeeId);
    }
    onChange?.(employeeId);
  }

  function choose(employee: EmployeeOption) {
    changeSelection(employee.id);
    setQuery(null);
    inputRef.current?.focus();
    setOpen(false);
    setActive(0);
  }

  // Form pickers require a real selection; a standalone controlled search can remain unselected.
  useEffect(() => {
    inputRef.current?.setCustomValidity(
      !selectedId && (required || (searchValue === undefined && !!query?.trim()))
        ? 'Choose an employee from the list.'
        : '',
    );
  }, [selectedId, query, required, searchValue]);

  // React form actions reset native controls after submission; reset local selection with them.
  useEffect(() => {
    const form = inputRef.current?.form;
    function reset(event: Event) {
      if (event.defaultPrevented) {
        return;
      }
      if (value === undefined) {
        setLocalValue(defaultValue);
      }
      setQuery(null);
      onSearchChange?.('');
      setOpen(false);
      setActive(0);
    }
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, [value, defaultValue, onSearchChange]);

  useEffect(() => {
    if (expanded) {
      listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    }
  }, [expanded, activeIndex, searchQuery]);

  return (
    <div
      className="form-field employee-picker"
      style={style}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <label htmlFor={id}>
        {label}
        {required ? ' *' : ''}
      </label>
      {name && <input type="hidden" name={name} value={selectedId} disabled={disabled} />}
      <div className="employee-picker-control">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? `${id}-options` : undefined}
          aria-activedescendant={
            expanded && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
          }
          aria-describedby={hint ? `${id}-hint` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={displayValue}
          required={required}
          disabled={disabled}
          onFocus={(event) => {
            setOpen(true);
            if (selectedId) {
              event.currentTarget.select();
            }
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            onSearchChange?.(event.target.value);
            setActive(0);
            setOpen(true);
            if (selectedId) {
              changeSelection('');
            }
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive(
                expanded && matches.length
                  ? (activeIndex + step + matches.length) % matches.length
                  : step === 1
                    ? 0
                    : Math.max(0, matches.length - 1),
              );
              setOpen(true);
            } else if (event.key === 'Enter' && expanded) {
              event.preventDefault();
              if (matches[activeIndex]) {
                choose(matches[activeIndex]);
              }
            } else if (event.key === 'Escape' && expanded) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            } else if (expanded && (event.key === 'Home' || event.key === 'End') && event.ctrlKey) {
              event.preventDefault();
              setActive(event.key === 'Home' ? 0 : Math.max(0, matches.length - 1));
            }
          }}
        />
        <div className="employee-picker-buttons">
          {displayValue && (
            <button
              type="button"
              disabled={disabled}
              aria-label={`Clear ${label.toLowerCase()}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                changeSelection('');
                setQuery(null);
                onSearchChange?.('');
                setActive(0);
                inputRef.current?.focus();
                setOpen(true);
              }}
            >
              ×
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            aria-label={expanded ? 'Close employee list' : 'Show employee list'}
            aria-expanded={expanded}
            aria-controls={expanded ? `${id}-options` : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              inputRef.current?.focus();
              setOpen(!expanded);
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
        {expanded && (
          <div
            className="employee-picker-options"
            ref={listRef}
            id={`${id}-options`}
            role="listbox"
            aria-label={label}
          >
            {matches.map((employee, index) => (
              <button
                key={employee.id}
                id={`${id}-option-${index}`}
                type="button"
                role="option"
                aria-selected={employee.id === selectedId}
                data-active={index === activeIndex}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(employee)}
              >
                <span>{employee.name}</span>
                <small className="text-monospace">{employee.code}</small>
              </button>
            ))}
            {matches.length === 0 && (
              <div className="employee-picker-empty">
                {employees.length ? 'No matching employees.' : 'No employees available.'}
              </div>
            )}
          </div>
        )}
      </div>
      {hint && (
        <span id={`${id}-hint`} className="hint">
          {hint}
        </span>
      )}
      <span className="employee-picker-status" role="status">
        {expanded ? `${matches.length} employees found` : ''}
      </span>
    </div>
  );
}

export { EmployeePicker };
