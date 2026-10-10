const locks = new Map<HTMLElement, { count: number; overflow: string }>();

// Dialogs and immersive players may mount/unmount in either order.
export function lockScroll(element: HTMLElement) {
  const lock = locks.get(element) ?? { count: 0, overflow: element.style.overflow };
  lock.count++;
  locks.set(element, lock);
  element.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.count === 0) {
      element.style.overflow = lock.overflow;
      locks.delete(element);
    }
  };
}
