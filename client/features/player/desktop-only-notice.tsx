import { Monitor } from 'lucide-react';
import { desktopOnly, useTouchOnly } from '../../ui/device';

/** Warns touch-device players before they open a game that declares desktop support only. */
export function DesktopOnlyNotice({ game }: { game: { devices: readonly string[] } }) {
  const touchOnly = useTouchOnly();
  if (!touchOnly || !desktopOnly(game)) return null;
  return (
    <p className="device-notice" role="note">
      <Monitor size={16} />
      <span>此遊戲只支援電腦，在手機或平板上可能無法正常操作，建議改用電腦遊玩。</span>
    </p>
  );
}
