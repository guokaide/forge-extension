import {
  getState, getUnlockWorkNeeded,
  getFullUnlockWorkRemaining, getStreak, getEntertainmentBalance, getEntertainmentUsagePct,
} from '../shared/store.js';

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.ceil(min % 60);
  if (h > 0 && m === 0) return `${h}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function render() {
  const state = await getState();
  const $status = document.getElementById('status')!;
  const $footer = document.getElementById('footer')!;

  const streak = getStreak(state);
  const { entertainmentTime, workTime, dayUnlocked, locked } = state.today;
  const fullUnlock = state.settings.fullUnlockWork;

  if (dayUnlocked) {
    $status.innerHTML = `
      <div class="forge-card unlocked">
        <div class="card-top">
          <div class="status-icon check">✓</div>
          <div>
            <div class="card-eyebrow">今日已达标</div>
            <div class="hero-value">${fmt(workTime)}</div>
            <div class="card-subtitle">自由时间</div>
          </div>
        </div>
        <div class="summary-row">
          <span>今日娱乐</span>
          <strong>${fmt(entertainmentTime)}</strong>
        </div>
      </div>`;
  } else if (locked) {
    const unlockNeeded = getUnlockWorkNeeded(state);
    const fullRemaining = getFullUnlockWorkRemaining(state);
    const pct = getEntertainmentUsagePct(state);

    $status.innerHTML = `
      <div class="forge-card locked">
        <div class="card-top">
          <div class="status-icon lock">!</div>
          <div>
            <div class="card-eyebrow">娱乐已锁定</div>
            <div class="hero-value">${fmt(unlockNeeded)}</div>
            <div class="card-subtitle">还需工作时间</div>
          </div>
        </div>
        <div class="summary-row">
          <span>解锁进度</span>
          <strong>${pct}%</strong>
        </div>
        <div class="progress-track locked"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="card-hint">或工作满 ${fmt(fullUnlock)} 解锁全天，还需 ${fmt(fullRemaining)}</div>
      </div>`;
  } else {
    const balance = Math.max(0, getEntertainmentBalance(state));
    const entertainmentPct = getEntertainmentUsagePct(state);
    const workPct = fullUnlock > 0 ? Math.round(Math.min(workTime / fullUnlock, 1) * 100) : 0;
    const fullRemaining = getFullUnlockWorkRemaining(state);

    $status.innerHTML = `
      <div class="forge-card normal${balance < 15 && entertainmentTime > 0 ? ' low' : ''}">
        <div class="card-top">
          <div>
            <div class="card-eyebrow">今日工作</div>
            <div class="hero-value">${fmt(workTime)}</div>
            <div class="card-subtitle">距离全天解锁还需 ${fmt(fullRemaining)}</div>
          </div>
          <div class="progress-ring" style="--progress:${workPct * 3.6}deg">
            <span>${workPct}%</span>
          </div>
        </div>
        <div class="summary-row">
          <span>娱乐余额 <strong>${fmt(balance)}</strong> · 已娱乐 ${fmt(entertainmentTime)}</span>
        </div>
        <div class="progress-track"><div class="progress-fill play" style="width:${entertainmentPct}%"></div></div>
      </div>`;
  }

  let footerHtml = '';
  if (streak > 0) footerHtml += `<span class="stat-streak">${streak} 天连续达标</span>`;
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
