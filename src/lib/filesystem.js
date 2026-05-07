// File System Access API wrapper. The directory handle is persisted in
// IndexedDB (chrome.storage.local does not reliably structured-clone
// FileSystemDirectoryHandle).

const DB_NAME = 'meetmd';
const DB_VERSION = 1;
const STORE = 'kv';
const HANDLE_KEY = 'vaultFolderHandle';
const NAME_KEY = 'vaultFolderName';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore(mode, fn) {
  return openDB().then((db) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const result = fn(store);
      tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    })
  );
}

async function idbGet(key) {
  return withStore('readonly', (store) => store.get(key));
}

async function idbSet(key, value) {
  return withStore('readwrite', (store) => {
    store.put(value, key);
  });
}

export async function pickVaultFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idbSet(HANDLE_KEY, handle);
  await idbSet(NAME_KEY, handle.name);
  return handle;
}

export async function getStoredVaultFolder() {
  const handle = await idbGet(HANDLE_KEY);
  const name = await idbGet(NAME_KEY);
  return {
    handle: handle || null,
    name: name || null,
  };
}

export async function ensurePermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

export async function checkPermission(handle) {
  return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
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
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}
