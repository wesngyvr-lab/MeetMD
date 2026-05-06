// File System Access API wrapper. Stores the granted folder handle in
// chrome.storage.local for re-use across sessions.

const STORAGE_KEY = 'meetmd:vaultFolderHandle';
const STORAGE_KEY_NAME = 'meetmd:vaultFolderName';

export async function pickVaultFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await persistHandle(handle);
  return handle;
}

async function persistHandle(handle) {
  await chrome.storage.local.set({
    [STORAGE_KEY]: handle,
    [STORAGE_KEY_NAME]: handle.name,
  });
}

export async function getStoredVaultFolder() {
  const result = await chrome.storage.local.get([STORAGE_KEY, STORAGE_KEY_NAME]);
  return {
    handle: result[STORAGE_KEY] || null,
    name: result[STORAGE_KEY_NAME] || null,
  };
}

export async function ensurePermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

export async function listExistingNames(handle) {
  const names = new Set();
  for await (const entry of handle.values()) {
    names.add(entry.name);
  }
  return names;
}

export async function writeFile(handle, filename, content) {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}
