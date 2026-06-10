import { getState, getUnlockWorkNeeded, getFullUnlockWorkRemaining, getStreak } from '../shared/store.js';
import { fmt } from '../shared/format.js';

const HEADLINES = [
  '先去锻造吧',
  '工作时间到了',
  '磨炼出好钢',
  '沉淀一下',
  '专注当下',
];

const QUOTES = [
  '千里之行，始于足下。',
  '不积跬步，无以至千里。',
  '业精于勤，荒于嬉。',
  '天道酬勤。',
  '宝剑锋从磨砺出，梅花香自苦寒来。',
  '吾生也有涯，而知也无涯。',
  '锲而不舍，金石可镂。',
];

const headline = HEADLINES[Math.floor(Math.random() * HEADLINES.length)];
const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];

async function render() {
  const state = await getState();
  const { entertainmentTime, workTime } = state.today;
  const unlockNeeded = getUnlockWorkNeeded(state);
  const fullRemaining = getFullUnlockWorkRemaining(state);
  const workPct = state.settings.fullUnlockWork > 0
    ? Math.round(Math.min(workTime / state.settings.fullUnlockWork, 1) * 100)
    : 0;
  const streak = getStreak(state);

  const $title = document.getElementById('title')!;
  const $msg = document.getElementById('message')!;
  const $progress = document.getElementById('progress')!;
  const $statsRow = document.getElementById('statsRow')!;
  const $quote = document.getElementById('quote')!;
  const $accentBar = document.getElementById('accentBar')!;

  let blockedSite = '';
  try {
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    if (from) blockedSite = new URL(from).hostname;
  } catch {}
  if (!blockedSite) {
    const referrer = document.referrer;
    try { if (referrer) blockedSite = new URL(referrer).hostname; } catch {}
  }

  if (!state.today.locked) {
    $accentBar.className = 'accent-bar unlocked';
    $title.textContent = '已解锁';
    $msg.textContent = '你可以继续浏览了';
    $progress.innerHTML = '';
    $statsRow.innerHTML = '';
    $quote.textContent = '';
    return;
  }

  $accentBar.className = 'accent-bar';
  $title.textContent = headline;

  const siteInfo = blockedSite && state.today.siteTime[blockedSite]
    ? `你今天已在 ${blockedSite} 上花了 ${fmt(Math.floor(state.today.siteTime[blockedSite] / 60))}`
    : `今日娱乐已达 ${fmt(entertainmentTime)}`;
  $msg.textContent = siteInfo;

  $progress.innerHTML = `
    <div class="progress-section">
      <div class="progress-label">还需工作 ${fmt(unlockNeeded)} 解锁</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${workPct}%"></div></div>
      <div class="progress-sub">或工作满 ${fmt(state.settings.fullUnlockWork)} 解锁全天（还需 ${fmt(fullRemaining)}）</div>
    </div>
  `;

  $statsRow.innerHTML = `
    <div class="stat">
      <div class="stat-value work">${fmt(workTime)}</div>
      <div class="stat-label">工作</div>
    </div>
    <div class="stat">
      <div class="stat-value play">${fmt(entertainmentTime)}</div>
      <div class="stat-label">娱乐</div>
    </div>
    <div class="stat">
      <div class="stat-value streak">${streak > 0 ? '🔥 ' : ''}${streak}</div>
      <div class="stat-label">连续天数</div>
    </div>
  `;

  $quote.textContent = `"${quote}"`;
}

document.getElementById('btn-back')!.addEventListener('click', () => history.back());

render();
setInterval(render, 5000);
