'use client';

// Keep the topbar punch toggle and /me attendance card in sync. Include the source control so it
// can ignore its own refresh event.

const eventName = 'hrms:punch-changed';

// Whoever raised the punch. Only used to skip the sender's own listener.
export type PunchSource = 'topbar' | 'card';

export function announcePunch(source: PunchSource): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventName, { detail: { source } }));
}

// Subscribe to punches made *elsewhere*. Returns the unsubscribe function.
export function onPunchChange(self: PunchSource, handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const from = (event as CustomEvent<{ source?: PunchSource }>).detail?.source;
    if (from !== self) handler();
  };
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
