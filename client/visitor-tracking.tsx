import { canAccessAdmin } from '../shared/account';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import type { Session } from '../shared/account.js';
import type { VisitorEventInput } from '../shared/visitors.js';

// Serialize requests so the first response establishes the visitor cookie before
// a game event or another navigation is sent. Analytics never blocks navigation.
let pending = Promise.resolve();
export function trackVisitor(input: Omit<VisitorEventInput, 'requestId' | 'referrer'>, requestId = crypto.randomUUID()) {
  const body = JSON.stringify({ ...input, requestId, referrer: document.referrer.slice(0, 2048) });
  pending = pending.then(async () => {
    await fetch('/api/v1/visits', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body,
      signal: AbortSignal.timeout(5000),
    });
  }).catch(() => { /* Visitor telemetry must not interrupt the website. */ });
}

export function VisitorTracking({ session }: { session: Session | null }) {
  const location = useLocation();
  const lastLocation = useRef('');
  useEffect(() => {
    if (!session || (session.authenticated && canAccessAdmin(session.role))) return;
    const path = location.pathname;
    if (!/^(?:\/|\/(?:login|register|settings\/account)|\/(?:games|play)\/[a-z0-9][a-z0-9-]*|\/players\/[A-Za-z0-9_.-]{3,32})$/.test(path)) return;
    // StrictMode, session refreshes, query changes and fragment navigation do not
    // create additional page views; returning through browser history does.
    const identity = `${location.key}:${path}`;
    if (lastLocation.current === identity) return;
    lastLocation.current = identity;
    trackVisitor({ kind: 'page_view', path });
  }, [location.key, location.pathname, session]);
  return null;
}
