import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Dialog } from './dialog';

export function isHomeScreenApp() {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches;
}

export function isIOSBrowser() {
  return !isHomeScreenApp() && (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
}

export function HomeScreenInstallButton() {
  const [available] = useState(isIOSBrowser);
  const [open, setOpen] = useState(false);
  if (!available) return null;
  return <>
    <button className="icon-button" title="加入主畫面" aria-label="加入主畫面" onClick={() => setOpen(true)}><Smartphone size={19} /></button>
    {open && <Dialog title="從主畫面開啟 Playroom" onClose={() => setOpen(false)}>
      <div className="home-screen-guide">
        <p>從主畫面開啟，可隱藏瀏覽器網址列與工具列，讓遊戲有更多空間。</p>
        <ol>
          <li>使用 Safari 開啟 Playroom。</li>
          <li>按「分享」（部分版本位於選單內）。</li>
          <li>選擇「加入主畫面」；若有「作為 Web App 開啟」，請保持開啟，再按「加入」。</li>
          <li>從主畫面的 Playroom 圖示開啟，選擇遊戲，再按遊戲的全螢幕按鈕。</li>
        </ol>
        <p>主畫面版本可能需要重新登入。支援雲端存檔的遊戲會讀取同一帳號的進度；遊戲本機存檔不一定與瀏覽器共用。遊玩仍需網路連線。</p>
        <p>iOS 的狀態列與底部手勢區可能仍會保留。</p>
      </div>
    </Dialog>}
  </>;
}
