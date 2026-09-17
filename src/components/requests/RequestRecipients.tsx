'use client';

import { useState } from 'react';
import { RecipientPicker } from './RecipientPicker';
import type { RequestRecipient } from '@/types/requests';

export function RequestRecipients({
  people,
  disabled,
}: {
  people: RequestRecipient[];
  disabled?: boolean;
}) {
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  return (
    <>
      <RecipientPicker
        label="To · Approver"
        name="approver_id"
        people={people}
        value={to}
        onChange={(ids) => {
          setTo(ids);
          setCc((previous) => previous.filter((id) => !ids.includes(id)));
        }}
        required
        disabled={disabled}
      />
      <RecipientPicker
        label="CC"
        name="cc_ids"
        people={people.filter((person) => !to.includes(person.id))}
        value={cc}
        onChange={setCc}
        multiple
        disabled={disabled}
      />
    </>
  );
}
