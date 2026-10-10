import { Playroom } from './playroom-sdk.js';
const config = await fetch('./config.json').then((r) => r.json());
const colors =
  config.mode === 'colors' || new URLSearchParams(location.search).get('mode') === 'colors';
const board = document.getElementById('board');
const start = document.getElementById('start');
const scoreEl = document.getElementById('score');
const timeEl = document.getElementById('time');
const bestEl = document.getElementById('best');
const status = document.getElementById('status');
const result = document.getElementById('result');
const storageKey = colors ? 'playroom-color-best' : 'playroom-signal-best';
let best = 0;
let cloudRevision = null;
let cloudQueue = Promise.resolve();
let cloudEnabled = false;
start.disabled = true;
const sdk = await Playroom.ready();
cloudEnabled = sdk.progressAvailable;
if (cloudEnabled) {
  try {
    const saved = await Playroom.loadProgress();
    if (saved && (saved.formatVersion !== 1 || !Number.isSafeInteger(saved.data.best) || saved.data.best < 0)) throw new Error('不支援此存檔格式');
    best = saved?.data.best ?? 0;
    cloudRevision = saved?.revision ?? 0;
  } catch {
    result.textContent = '未能讀取帳號進度；仍可遊玩，但本頁不會覆蓋雲端存檔。請重新開啟遊戲重試。';
  }
} else if (sdk.mode === 'guest' || sdk.mode === 'standalone') {
  try { best = Number(localStorage.getItem(storageKey)) || 0; } catch {}
}
start.disabled = false;
let score = 0;
let target = colors ? 7 : 12;
let running = false;
let endsAt = 0;
let timer;
let accountRun = Promise.resolve(null);
const format = (value) => String(value).padStart(2, '0');
bestEl.textContent = format(best);
if (colors) {
  document.body.classList.add('colors');
  document.title = '色彩尋蹤';
  document.getElementById('title').textContent = '色彩尋蹤';
  document.getElementById('subtitle').textContent = 'A LITTLE DIFFERENT';
  document.getElementById('tagline').textContent = '總有一格，藏著不一樣。';
  result.textContent = '找出不同的色塊，相信你的第一眼。';
}
const tiles = Array.from({ length: 20 }, (_, i) => {
  const tile = document.createElement('button');
  tile.className = 'tile';
  tile.setAttribute('aria-label', `格子 ${i + 1}`);
  tile.addEventListener('click', () => {
    if (!running || i !== target) return;
    if (performance.now() >= endsAt) {
      finish();
      return;
    }
    score++;
    scoreEl.textContent = format(score);
    const old = target;
    do {
      target = Math.floor(Math.random() * 20);
    } while (target === old);
    render();
  });
  board.append(tile);
  return tile;
});
function render() {
  if (colors) {
    const hue = (330 + score * 29) % 360;
    tiles.forEach((tile, i) => {
      tile.style.backgroundColor = `hsl(${hue} ${i === target ? 49 : 43}% ${i === target ? 66 : 78}%)`;
      tile.classList.toggle('odd', i === target);
    });
  } else tiles.forEach((tile, i) => tile.classList.toggle('lit', i === target));
}
function finish() {
  if (!running) return;
  running = false;
  clearInterval(timer);
  best = Math.max(best, score);
  if (!cloudEnabled && (sdk.mode === 'guest' || sdk.mode === 'standalone')) {
    try { localStorage.setItem(storageKey, String(best)); } catch {}
  }
  bestEl.textContent = format(best);
  timeEl.innerHTML = '00<span>s</span>';
  status.textContent = 'NICELY DONE';
  start.disabled = false;
  start.innerHTML = '再玩一次 <span>↗</span>';
  result.textContent = `這次找到 ${score} ${colors ? '個色塊' : '道光'}，最佳紀錄 ${best} 分。`;
  const finalScore = score;
  void accountRun.then((run) => run && Playroom.finishRun({ runId: run.runId, score: finalScore })).catch(() => {});
  if (cloudEnabled && cloudRevision !== null) {
    const finalBest = best;
    cloudQueue = cloudQueue.then(async () => {
      if (cloudRevision === null) return;
      const input = { data: { best: finalBest }, revision: cloudRevision, formatVersion: 1, requestId: crypto.randomUUID() };
      // One retry keeps the same request identity, including when the response was lost.
      let saved;
      try { saved = await Playroom.saveProgress(input); }
      catch (error) { if (error.code === 409 || error.code === 401 || error.code === 403) throw error; saved = await Playroom.saveProgress(input); }
      if (saved?.saved) cloudRevision = saved.revision;
      else throw new Error('進度未保存');
    }).catch(() => {
      cloudRevision = null;
      result.textContent = '進度尚未保存，或另一台設備已更新；請重新開啟遊戲讀取最新存檔。';
    });
  }
}
start.addEventListener('click', () => {
  accountRun = Playroom.startRun().catch(() => null);
  score = 0;
  running = true;
  endsAt = performance.now() + 20000;
  scoreEl.textContent = '00';
  timeEl.innerHTML = '20<span>s</span>';
  start.disabled = true;
  start.textContent = '挑戰進行中';
  status.textContent = 'YOU GOT THIS';
  result.textContent = colors ? '點擊不一樣的那一格。' : '點擊亮起的光點。';
  target = Math.floor(Math.random() * 20);
  render();
  timer = setInterval(() => {
    const left = Math.max(0, Math.ceil((endsAt - performance.now()) / 1000));
    timeEl.innerHTML = `${format(left)}<span>s</span>`;
    if (left === 0) finish();
  }, 100);
});
render();
