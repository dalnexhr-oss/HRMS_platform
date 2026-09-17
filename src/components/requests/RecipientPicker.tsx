'use client';

import { useId, useState } from 'react';
import type { RequestRecipient } from '@/types/requests';

/** Searchable company-account tags. The submitted values are IDs, never free-form email addresses. */
export function RecipientPicker({
  label,
  name,
  people,
  value,
  onChange,
  multiple = false,
  required = false,
  disabled = false,
}: {
  label: string;
  name?: string;
  people: RequestRecipient[];
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const canAdd = value.length < (multiple ? 20 : 1);
  const search = query.trim().toLowerCase();
  const matches = people
    .filter(
      (person) =>
        !value.includes(person.id) &&
        `${person.name} ${person.email} ${person.detail}`.toLowerCase().includes(search),
    )
    .slice(0, 8);
  const expanded = open && canAdd && !disabled;
  const activeIndex = Math.min(active, matches.length - 1);
  function select(person: RequestRecipient) {
    onChange(multiple ? [...value, person.id] : [person.id]);
    setQuery('');
    setActive(0);
    setOpen(false);
  }
  return (
    <div
      className="f recipient-picker"
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
      <div className="recipient-tags">
        {value.map((selectedId) => {
          const person = people.find((candidate) => candidate.id === selectedId);
          return (
            <span className="recipient-tag" key={selectedId} title={person?.email}>
              {name && <input type="hidden" name={name} value={selectedId} />}
              <span>{person?.name ?? 'Selected person'}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${person?.name ?? 'recipient'}`}
                onClick={() => onChange(value.filter((candidate) => candidate !== selectedId))}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={`${id}-options`}
          aria-activedescendant={
            expanded && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
          }
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          value={query}
          disabled={disabled}
          readOnly={!canAdd}
          required={required && value.length === 0}
          placeholder={canAdd ? 'Type a name or company email' : ''}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActive(
                Math.max(
                  0,
                  Math.min(matches.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)),
                ),
              );
            } else if (event.key === 'Enter' && expanded) {
              event.preventDefault();
              if (matches[activeIndex]) {
                select(matches[activeIndex]);
              }
            } else if (event.key === 'Escape') {
              setOpen(false);
            } else if (event.key === 'Backspace' && !query && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
        />
      </div>
      {expanded && (
        <div className="recipient-options" id={`${id}-options`} role="listbox" aria-label={label}>
          {matches.map((person, index) => (
            <button
              key={person.id}
              id={`${id}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(person)}
            >
              <b>{person.name}</b>
              <span>{person.email}</span>
              <small>{person.detail}</small>
            </button>
          ))}
          {matches.length === 0 && <p className="muted">No matching company accounts.</p>}
        </div>
      )}
      <div className="recipient-hint" id={`${id}-hint`}>
        {multiple
          ? 'CC recipients can view this request and receive updates.'
          : 'Choose a company account from the suggestions.'}
      </div>
    </div>
  );
}
