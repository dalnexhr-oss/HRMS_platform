'use client';

// Says so when the browser loses its connection, and again briefly when it comes back. Without it a
// save attempted offline fails with no hint that the network, not the form, is the problem.
import { useEffect, useState } from 'react';

type Connection = 'online' | 'offline' | 'restored';

const restoredMs = 3000;

function NetworkStatus() {
  // Seeded in an effect: the server cannot know, and guessing would mismatch on hydration.
  const [connection, setConnection] = useState<Connection>('online');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const goOffline = () => {
      clearTimeout(timer);
      setConnection('offline');
    };
    const goOnline = () => {
      setConnection((current) => (current === 'offline' ? 'restored' : current));
      clearTimeout(timer);
      timer = setTimeout(() => setConnection('online'), restoredMs);
    };
    if (navigator.onLine === false) {
      goOffline();
    }
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (connection === 'online') {
    return null;
  }

  return (
    <div className={`network-status is-${connection}`} role="status" aria-live="polite">
      {connection === 'offline'
        ? 'You are offline. Changes cannot be saved until the connection is back.'
        : 'Back online.'}
    </div>
  );
}

export { NetworkStatus };
