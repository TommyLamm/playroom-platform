import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { lockScroll } from './scroll-lock';

export type GameDisplayMode = 'normal' | 'native' | 'immersive';
type KeyboardLock = { lock: (keys: string[]) => Promise<void>; unlock: () => void };

export function useGameDisplay(
  container: RefObject<HTMLDivElement | null>,
  frame: RefObject<HTMLIFrameElement | null>,
  onExpandedChange?: (expanded: boolean) => void,
) {
  const [mode, setMode] = useState<GameDisplayMode>('normal');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const enterButton = useRef<HTMLButtonElement>(null);
  const modeRef = useRef<GameDisplayMode>('normal');
  const mounted = useRef(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const fallingBack = useRef(false);
  const lockedKeyboard = useRef<KeyboardLock | null>(null);
  const onChange = useRef(onExpandedChange);
  onChange.current = onExpandedChange;

  function changeMode(next: GameDisplayMode) {
    modeRef.current = next;
    if (mounted.current) setMode(next);
  }

  function unlock() {
    lockedKeyboard.current?.unlock();
    lockedKeyboard.current = null;
  }

  function ownsFullscreen(shell: HTMLDivElement) {
    return document.fullscreenElement === shell ||
      (modeRef.current === 'native' && !!document.fullscreenElement && shell.contains(document.fullscreenElement));
  }

  useLayoutEffect(() => {
    mounted.current = true;
    const shell = container.current!;
    function syncFullscreen() {
      if (ownsFullscreen(shell)) {
        if (pending.current || modeRef.current === 'native') changeMode('native');
      } else if (modeRef.current === 'native' && !fallingBack.current) {
        // A browser exit cancels the request too; never trigger fallback/re-entry.
        generation.current++;
        unlock();
        setHint('');
        changeMode('normal');
      }
    }
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => {
      mounted.current = false;
      generation.current++;
      document.removeEventListener('fullscreenchange', syncFullscreen);
      unlock();
      if (ownsFullscreen(shell)) void document.exitFullscreen().catch(() => {});
      onChange.current?.(false);
    };
  }, [container]);

  const expanded = mode !== 'normal';
  const wasExpanded = useRef(false);
  useLayoutEffect(() => {
    onChange.current?.(expanded);
    if (expanded) frame.current?.focus({ preventScroll: true });
    if (expanded) wasExpanded.current = true;
    else if (!busy && wasExpanded.current) {
      enterButton.current?.focus({ preventScroll: true });
      wasExpanded.current = false;
    }
  }, [mode, busy, frame]);

  useLayoutEffect(() => {
    if (mode !== 'immersive') return;
    const releaseRoot = lockScroll(document.documentElement);
    const releaseBody = lockScroll(document.body);
    return () => { releaseRoot(); releaseBody(); };
  }, [mode]);

  useLayoutEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(''), 5000);
    return () => clearTimeout(timer);
  }, [hint]);

  async function enter() {
    if (pending.current || modeRef.current !== 'normal') return;
    const shell = container.current;
    if (!shell) return;
    const request = ++generation.current;
    const isCurrent = () => mounted.current && generation.current === request;
    pending.current = true;
    setBusy(true);
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
    let enteredNative = false;

    async function immersive() {
      if (!isCurrent()) return;
      fallingBack.current = true;
      unlock();
      try {
        if (ownsFullscreen(shell!)) await document.exitFullscreen();
        if (isCurrent()) {
          changeMode('immersive');
          setHint('已使用沉浸模式，按右上角退出');
        }
      } catch {
        if (isCurrent()) setHint('無法離開全螢幕，請按右上角或使用瀏覽器退出操作');
      } finally {
        fallingBack.current = false;
      }
    }

    try {
      if (!shell.requestFullscreen || !document.fullscreenEnabled || !keyboard?.lock || !keyboard.unlock) {
        await immersive();
        return;
      }
      await shell.requestFullscreen({ navigationUI: 'hide' });
      enteredNative = true;
      if (!isCurrent()) {
        if (ownsFullscreen(shell)) await document.exitFullscreen();
        return;
      }
      // The user may have left fullscreen before its promise completed.
      if (!ownsFullscreen(shell)) return;
      changeMode('native');
      lockedKeyboard.current = keyboard;
      await keyboard.lock(['Escape']);
      if (!isCurrent() || !ownsFullscreen(shell)) {
        // A pending lock can finish after an exit/unmount already called unlock.
        keyboard.unlock();
        lockedKeyboard.current = null;
        return;
      }
      setHint('短按 Esc 操作遊戲；長按 Esc 可退出全螢幕');
      frame.current?.focus({ preventScroll: true });
    } catch {
      if (enteredNative && !ownsFullscreen(shell)) {
        unlock();
        if (isCurrent()) changeMode('normal');
      } else await immersive();
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function exit() {
    const request = ++generation.current;
    unlock();
    setHint('');
    const shell = container.current;
    if (shell && ownsFullscreen(shell)) {
      try {
        await document.exitFullscreen();
      } catch {
        if (mounted.current) setHint('無法離開全螢幕，請使用瀏覽器退出操作');
        return;
      }
    }
    if (mounted.current && generation.current === request) changeMode('normal');
  }

  return { mode, expanded, busy, hint, enterButton, enter, exit };
}
