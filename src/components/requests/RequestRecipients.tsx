'use client';

import { useState } from 'react';
import { RecipientPicker } from './RecipientPicker';
import type { RequestRecipient } from '@/types/requests';

function RequestRecipients({
  people,
  disabled,
}: {
  people: RequestRecipient[];
  disabled?: boolean;
}) {
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [copiedRecipientIds, setCopiedRecipientIds] = useState<string[]>([]);
  return (
    <>
      <RecipientPicker
        label="To · Approver"
        name="approver_id"
        people={people}
        value={approverIds}
        onChange={(ids) => {
          setApproverIds(ids);
          setCopiedRecipientIds((previous) => previous.filter((id) => !ids.includes(id)));
        }}
        required
        disabled={disabled}
      />
      <RecipientPicker
        label="CC"
        name="cc_ids"
        people={people.filter((person) => !approverIds.includes(person.id))}
        value={copiedRecipientIds}
        onChange={setCopiedRecipientIds}
        multiple
        disabled={disabled}
      />
    </>
  );
}

export { RequestRecipients };
