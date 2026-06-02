import {
  getState, getThreshold, getUnlockWorkNeeded,
  getFullUnlockWorkRemaining, getStreak,
} from '../shared/store.js';

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.ceil(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function render() {
  const state = await getState();
  const $status = document.getElementById('status')!;
  const $footer = document.getElementById('footer')!;

  const threshold = getThreshold(state);
  const streak = getStreak(state);
  const { entertainmentTime, workTime, dayUnlocked, locked } = state.today;

  if (dayUnlocked) {
    $status.innerHTML = `
      <div class="status-label status-ok">今日已达标，自由时间</div>
      <div class="stats">
        <span class="stat-work">工作 ${fmt(workTime)}</span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-play">娱乐 ${fmt(entertainmentTime)}</span>
      </div>`;
  } else if (locked) {
    const unlockNeeded = getUnlockWorkNeeded(state);
    const fullRemaining = getFullUnlockWorkRemaining(state);
    const pct = entertainmentTime > 0 ? Math.round(Math.min(workTime / entertainmentTime, 1) * 100) : 0;

    $status.innerHTML = `
      <div class="status-label status-locked">娱乐时间已用完</div>
      <div class="stats">
        <span class="stat-play">娱乐 ${fmt(entertainmentTime)}</span>
        <span class="stat-sep">&middot;</span>
        <span class="stat-work">工作 ${fmt(workTime)}</span>
      </div>
      <div class="progress-label">还需工作 ${fmt(unlockNeeded)} 解锁</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="hint">或工作满 ${fmt(state.settings.fullUnlockWork)} 解锁全天（还需 ${fmt(fullRemaining)}）</div>`;
  } else {
    const remaining = Math.max(0, threshold - entertainmentTime);
    const pct = Math.round((entertainmentTime / threshold) * 100);
    const fullRemaining = getFullUnlockWorkRemaining(state);

    $status.innerHTML = `
      <div class="stats">
        <span class="stat-play">娱乐 ${fmt(entertainmentTime)} / ${fmt(threshold)}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill play" style="width:${pct}%"></div></div>
      <div class="stats" style="margin-top:8px">
        <span class="stat-work">工作 ${fmt(workTime)}</span>
        ${fullRemaining > 0 ? `<span class="stat-sep">&middot;</span><span class="hint">距全天解锁 ${fmt(fullRemaining)}</span>` : ''}
      </div>`;
  }

  let footerHtml = '';
  if (streak > 0) footerHtml += `<span class="stat-streak">连续 ${streak} 天达标</span>`;
  if (state.penalty > 0) footerHtml += `${footerHtml ? '<span class="stat-sep">&middot;</span>' : ''}<span class="stat-penalty">惩罚 -${state.penalty}m</span>`;
  $footer.innerHTML = footerHtml;
}

document.getElementById('nav-dashboard')!.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});
document.getElementById('nav-options')!.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

render();
setInterval(render, 1000);
