import {
  getState, getUnlockWorkNeeded,
  getFullUnlockWorkRemaining, getStreak, getEntertainmentBalance, getEntertainmentUsagePct,
} from '../shared/store.js';
import { fmt } from '../shared/format.js';

async function render() {
  const state = await getState();
  const $status = document.getElementById('status')!;

  const streak = getStreak(state);
  const { entertainmentTime, workTime, dayUnlocked, locked } = state.today;
  const fullUnlock = state.settings.fullUnlockWork;

  let metaHtml = '';
  if (streak > 0) metaHtml += `<span class="forge-meta-badge streak">${streak} 天连续达标</span>`;
  if (state.penalty > 0) metaHtml += `<span class="forge-meta-badge penalty">惩罚 -${state.penalty}m</span>`;

  if (dayUnlocked) {
    $status.innerHTML = `
      <div class="forge-card unlocked">
        <div class="card-top">
          <div class="status-icon check">✓</div>
          <div>
            <div class="hero-value">${fmt(workTime)}</div>
            <div class="card-subtitle">已达标 · 自由时间 · 娱乐 ${fmt(entertainmentTime)}</div>
          </div>
        </div>
        <div class="forge-meta">${metaHtml}</div>
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
            <div class="hero-value">${fmt(unlockNeeded)}</div>
            <div class="card-subtitle">还需工作解锁娱乐</div>
          </div>
        </div>
        <div class="summary-row">
          <span>解锁进度</span>
          <strong>${pct}%</strong>
        </div>
        <div class="progress-track locked"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="card-hint">或工作满 ${fmt(fullUnlock)} 解锁全天，还需 ${fmt(fullRemaining)}</div>
        <div class="forge-meta">${metaHtml}</div>
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
            <div class="hero-value">${fmt(workTime)}</div>
            <div class="card-subtitle">工作时长 / ${fmt(fullUnlock)} 解锁全天</div>
          </div>
          <div class="progress-ring" style="--progress:${workPct * 3.6}deg">
            <span>${workPct}%</span>
          </div>
        </div>
        <div class="summary-row">
          <span>娱乐余额 <strong>${fmt(balance)}</strong> · 已娱乐 ${fmt(entertainmentTime)}</span>
        </div>
        <div class="progress-track"><div class="progress-fill play" style="width:${entertainmentPct}%"></div></div>
        <div class="forge-meta">${metaHtml}</div>
      </div>`;
  }

}

async function openNewtabPanel(hash: string): Promise<void> {
  const newtabUrl = chrome.runtime.getURL('newtab/newtab.html');
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(t =>
    t.url === 'chrome://newtab/' ||
    (t.url !== undefined && t.url.startsWith(newtabUrl))
  );
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true, url: `${newtabUrl}#${hash}` });
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: `${newtabUrl}#${hash}` });
  }
}

document.getElementById('nav-dashboard')!.addEventListener('click', () => openNewtabPanel('dashboard'));
document.getElementById('nav-options')!.addEventListener('click', () => openNewtabPanel('settings'));

render();
setInterval(render, 1000);
