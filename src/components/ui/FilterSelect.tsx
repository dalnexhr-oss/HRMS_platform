'use client';

// A labelled dropdown for table filter bars (assets / inventory). '' = All.
// Options are the distinct values present in the data, so the list never
// offers a choice that would return zero rows on its own.
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--ink-3)' }}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Filter by ${label}`}
        style={{ minWidth: 110, maxWidth: 180, padding: '5px 8px', fontSize: 12 }}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Distinct non-empty values, sorted, for a FilterSelect's options. */
export function distinctOptions(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v.trim() !== ''))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}
