import { getState, saveState, extractDomain } from '../shared/store.js';

async function load() {
  const state = await getState();
  (document.getElementById('threshold') as HTMLInputElement).value = String(state.settings.baseThreshold);
  (document.getElementById('full-unlock') as HTMLInputElement).value = String(state.settings.fullUnlockWork);
  (document.getElementById('blocked-sites') as HTMLTextAreaElement).value = state.settings.blockedSites.join('\n');
}

document.getElementById('save')!.addEventListener('click', async () => {
  const state = await getState();
  const threshold = parseInt((document.getElementById('threshold') as HTMLInputElement).value, 10);
  const fullUnlock = parseInt((document.getElementById('full-unlock') as HTMLInputElement).value, 10);
  const sitesRaw = (document.getElementById('blocked-sites') as HTMLTextAreaElement).value;
  const sites = [...new Set(sitesRaw.split('\n').map(extractDomain).filter(Boolean))];

  if (threshold >= 15 && threshold <= 180) state.settings.baseThreshold = threshold;
  if (fullUnlock >= 60 && fullUnlock <= 480) state.settings.fullUnlockWork = fullUnlock;
  state.settings.blockedSites = sites;
  await saveState(state);
  chrome.runtime.sendMessage({ type: 'stateChanged' });

  const $msg = document.getElementById('msg')!;
  $msg.textContent = '已保存';
  setTimeout(() => { $msg.textContent = ''; }, 2000);
});

load();
