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
try {
  best = Number(localStorage.getItem(storageKey)) || 0;
} catch {}
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
  try {
    localStorage.setItem(storageKey, String(best));
  } catch {}
  bestEl.textContent = format(best);
  timeEl.innerHTML = '00<span>s</span>';
  status.textContent = 'NICELY DONE';
  start.disabled = false;
  start.innerHTML = '再玩一次 <span>↗</span>';
  result.textContent = `這次找到 ${score} ${colors ? '個色塊' : '道光'}，最佳紀錄 ${best} 分。`;
  const finalScore = score;
  void accountRun.then((run) => run && Playroom.finishRun({ runId: run.runId, score: finalScore })).catch(() => {});
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
