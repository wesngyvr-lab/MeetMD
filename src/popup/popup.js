import { sanitizeSubfolder, getSubfolder, SUBFOLDER_KEY } from '../lib/settings.js';

const saveTargetEl = document.getElementById('saveTarget');
const pendingEl = document.getElementById('pending');
const flushBtn = document.getElementById('flushBtn');
const folderInput = document.getElementById('folderInput');
const saveFolderBtn = document.getElementById('saveFolderBtn');
const folderHint = document.getElementById('folderHint');

const DRAFT_KEY_PREFIX = 'meetmd:draft:';

async function refresh() {
  const subfolder = await getSubfolder();
  saveTargetEl.innerHTML = subfolder
    ? `Transcripts save to <strong>Downloads/${subfolder}/</strong>`
    : 'Transcripts save to <strong>Downloads/</strong>';
  folderInput.value = subfolder;

  const all = await chrome.storage.local.get(null);
  const drafts = Object.keys(all).filter((k) => k.startsWith(DRAFT_KEY_PREFIX));
  if (drafts.length === 0) {
    pendingEl.textContent = 'No pending drafts.';
    flushBtn.disabled = true;
  } else {
    pendingEl.innerHTML = `<strong>${drafts.length}</strong> draft(s) in progress or pending.`;
    flushBtn.disabled = false;
  }
}

flushBtn.addEventListener('click', async () => {
  chrome.runtime.sendMessage({ type: 'FLUSH_DRAFTS' });
  // Give the SW a moment to recover orphans before re-counting.
  setTimeout(refresh, 500);
});

saveFolderBtn.addEventListener('click', async () => {
  const cleaned = sanitizeSubfolder(folderInput.value);
  await chrome.storage.local.set({ [SUBFOLDER_KEY]: cleaned });
  folderHint.textContent = cleaned
    ? `Saved — next transcript goes to Downloads/${cleaned}/`
    : 'Saved — next transcript goes directly to Downloads/';
  await refresh();
});

refresh();
