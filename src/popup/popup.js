import { pickVaultFolder, getStoredVaultFolder, checkPermission } from '../lib/filesystem.js';

const statusEl = document.getElementById('status');
const pickBtn = document.getElementById('pickBtn');

async function refresh() {
  const { handle, name } = await getStoredVaultFolder();
  if (!handle) {
    statusEl.textContent = 'No vault folder picked yet.';
    pickBtn.textContent = 'Pick your Meetings folder';
    return;
  }
  const ok = await checkPermission(handle);
  if (ok) {
    statusEl.innerHTML = `Saving to: <strong>${name}</strong>`;
    pickBtn.textContent = 'Change folder';
  } else {
    statusEl.textContent = `Permission lost for "${name}". Click below to re-grant.`;
    pickBtn.textContent = 'Re-grant access';
  }
}

pickBtn.addEventListener('click', async () => {
  try {
    await pickVaultFolder();
    chrome.runtime.sendMessage({ type: 'FLUSH_DRAFTS' });
    await refresh();
  } catch (err) {
    if (err.name !== 'AbortError') {
      statusEl.textContent = `Error: ${err.message}`;
    }
  }
});

refresh();
