import { useSyncExternalStore } from 'react';

// Phones and tablets with no hover-capable pointer; a laptop with a touchscreen still matches neither.
const touchOnlyQuery = '(hover: none) and (pointer: coarse)';

function subscribe(change: () => void) {
  const query = matchMedia(touchOnlyQuery);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

/** True on touch-first devices, where games built only for desktop may be unplayable. */
export function useTouchOnly() {
  return useSyncExternalStore(subscribe, () => matchMedia(touchOnlyQuery).matches, () => false);
}

export const desktopOnly = (game: { devices: readonly string[] }) => !game.devices.includes('mobile');
