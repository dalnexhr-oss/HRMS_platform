'use client';

// One clock, two controls.
//
// The punch toggle lives in the top bar and the full attendance-clock card
// lives on /me, so a punch made from either one has to redraw the other —
// otherwise the card keeps offering "Punch in" seconds after the top bar has
// already recorded it, and the second tap is rejected as an out-of-sequence
// punch.
//
// The event carries which control raised it so a listener can ignore its own
// announcement: the control that punched already reloaded itself.

const EVENT = 'hrms:punch-changed';

/** Whoever raised the punch. Only used to skip the sender's own listener. */
export type PunchSource = 'topbar' | 'card';

export function announcePunch(source: PunchSource): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { source } }));
}

/** Subscribe to punches made *elsewhere*. Returns the unsubscribe function. */
export function onPunchChange(self: PunchSource, handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const from = (event as CustomEvent<{ source?: PunchSource }>).detail?.source;
    if (from !== self) handler();
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
