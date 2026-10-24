import { useEffect, type RefObject } from 'react';

/** Closes a `<details>` menu on an outside pointer press or Escape, returning focus to its summary. */
export function useDismissableDetails(menu: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (menu.current?.open && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menu]);
}
