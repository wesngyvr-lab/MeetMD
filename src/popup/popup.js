const pendingEl = document.getElementById('pending');
const flushBtn = document.getElementById('flushBtn');

const DRAFT_KEY_PREFIX = 'meetmd:draft:';

async function refresh() {
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

refresh();
