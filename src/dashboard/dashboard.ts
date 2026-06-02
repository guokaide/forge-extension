import {
  getState, getHistory, getStreak, getThreshold,
} from '../shared/store.js';

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.ceil(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function render() {
  const state = await getState();
  const streak = getStreak(state);
  const history = getHistory(state, 7);
  const threshold = getThreshold(state);
  const { workTime, entertainmentTime } = state.today;
  const today = state.today.date;

  document.getElementById('streak')!.textContent = String(streak);

  if (entertainmentTime > 0) {
    const ratio = (workTime / entertainmentTime).toFixed(1);
    document.getElementById('ratio')!.textContent = `${ratio} : 1`;
  } else {
    document.getElementById('ratio')!.textContent = workTime > 0 ? '∞' : '-';
  }

  const $today = document.getElementById('today-stats')!;
  $today.innerHTML = `
    <div>
      <div class="today-stat-label">工作</div>
      <div class="today-stat-value work">${fmt(workTime)}</div>
    </div>
    <div>
      <div class="today-stat-label">娱乐</div>
      <div class="today-stat-value play">${fmt(entertainmentTime)}</div>
    </div>
    <div>
      <div class="today-stat-label">阈值</div>
      <div class="today-stat-value credit">${fmt(threshold)}</div>
    </div>
    ${state.penalty > 0 ? `<div>
      <div class="today-stat-label">惩罚</div>
      <div class="today-stat-value debt">-${state.penalty}m</div>
    </div>` : ''}
  `;

  const $chart = document.getElementById('chart')!;
  if (history.length === 0) {
    $chart.innerHTML = '<div class="empty-msg">还没有数据</div>';
    return;
  }

  const maxMin = Math.max(
    ...history.map(d => Math.max(d.workTime || 0, d.entertainmentTime || 0)),
    workTime, entertainmentTime, state.settings.fullUnlockWork,
  );

  const barScale = maxMin > 0 ? 100 / maxMin : 0;

  $chart.innerHTML = history.map(day => {
    const isToday = day.date === today;
    const w = isToday ? workTime : (day.workTime || 0);
    const e = isToday ? entertainmentTime : (day.entertainmentTime || 0);
    const dateLabel = isToday ? '今天' : day.date.slice(5);
    const goalTag = w >= state.settings.fullUnlockWork ? '<span class="chart-goal">✓</span>' : '';

    return `
      <div class="chart-row">
        <div class="chart-date ${isToday ? 'today' : ''}">${dateLabel}</div>
        <div class="chart-bars">
          <div class="chart-bar-row">
            <div class="chart-bar work" style="width:${Math.max(w * barScale, 0.5)}%"></div>
            <span class="chart-bar-label">${fmt(w)}${goalTag}</span>
          </div>
          <div class="chart-bar-row">
            <div class="chart-bar play" style="width:${Math.max(e * barScale, 0.5)}%"></div>
            <span class="chart-bar-label">${fmt(e)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  renderSiteTime(state.today.siteTime);
}

function renderSiteTime(siteTime: Record<string, number>) {
  const $el = document.getElementById('site-time')!;
  const entries = Object.entries(siteTime || {})
    .map(([host, sec]) => ({ host, sec }))
    .sort((a, b) => b.sec - a.sec);

  if (entries.length === 0) {
    $el.innerHTML = '<div class="empty-msg">还没有浏览数据</div>';
    return;
  }

  const maxSec = entries[0].sec;

  $el.innerHTML = entries.slice(0, 20).map(({ host, sec }) => {
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    const duration = min > 0 ? `${min}m ${s}s` : `${s}s`;
    const pct = Math.round((sec / maxSec) * 100);
    return `
      <div class="site-row">
        <span class="site-host">${host}</span>
        <span class="site-duration">${duration}</span>
        <div class="site-bar-bg"><div class="site-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }).join('');
}

render();
