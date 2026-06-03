import { getState, getUnlockWorkNeeded, getFullUnlockWorkRemaining, getEntertainmentUsagePct } from '../shared/store.js';
import { fmt } from '../shared/format.js';

async function render() {
  const state = await getState();
  const { entertainmentTime, workTime } = state.today;
  const unlockNeeded = getUnlockWorkNeeded(state);
  const fullRemaining = getFullUnlockWorkRemaining(state);
  const pct = getEntertainmentUsagePct(state);

  const $title = document.getElementById('title')!;
  const $msg = document.getElementById('message')!;
  const $progress = document.getElementById('progress')!;

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

  $title.textContent = '先去工作吧';

  const siteInfo = blockedSite && state.today.siteTime[blockedSite]
    ? `你今天已在 ${blockedSite} 上花了 ${fmt(Math.floor(state.today.siteTime[blockedSite] / 60))}`
    : `今日娱乐已达 ${fmt(entertainmentTime)}`;
  $msg.textContent = siteInfo;

  $progress.innerHTML = `
    <div class="progress-info">还需工作 ${fmt(unlockNeeded)} 解锁</div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="progress-info sub">或工作满 ${fmt(state.settings.fullUnlockWork)} 解锁全天（还需 ${fmt(fullRemaining)}）</div>
  `;

  if (!state.today.locked) {
    $title.textContent = '已解锁';
    $msg.textContent = '你可以继续浏览了';
    $progress.innerHTML = '';
  }
}

document.getElementById('btn-back')!.addEventListener('click', () => history.back());

render();
setInterval(render, 5000);
