import { formatTranscript } from '../lib/markdown.js';
import { buildFilename, resolveCollision } from '../lib/filename.js';
import {
  getStoredVaultFolder,
  checkPermission,
  listExistingNames,
  writeFile,
} from '../lib/filesystem.js';

const DRAFT_KEY_PREFIX = 'meetmd:draft:';

// In-memory map of tabId -> { startedAt, entries }. Service workers can be
// killed at any time, so we also persist drafts to chrome.storage.local on
// every CHECKPOINT and CAPTION.
const tabState = new Map();

chrome.runtime.onMessage.addListener((message, sender) => {
  // Messages from the popup have no sender.tab — handle them first.
  if (message.type === 'FLUSH_DRAFTS') {
    recoverOrphanDrafts();
    return;
  }

  const tabId = sender.tab?.id;
  if (!tabId) return;

  switch (message.type) {
    case 'CALL_STARTED':
      tabState.set(tabId, { startedAt: message.startedAt, entries: [] });
      persistDraft(tabId);
      break;

    case 'CAPTION':
      mergeCaption(tabId, message.entry);
      persistDraft(tabId);
      break;

    case 'CHECKPOINT':
      mergeCheckpoint(tabId, message);
      persistDraft(tabId);
      break;

    case 'CALL_ENDED':
      mergeCheckpoint(tabId, message);
      saveAndClear(tabId, /* recovered */ false);
      break;
  }
});

function mergeCaption(tabId, entry) {
  const s = tabState.get(tabId);
  if (!s) return;
  s.entries.push(entry);
}

function mergeCheckpoint(tabId, message) {
  const s = tabState.get(tabId) || { startedAt: message.startedAt, entries: [] };
  s.startedAt = message.startedAt;
  s.entries = message.transcript;
  tabState.set(tabId, s);
}

async function persistDraft(tabId) {
  const s = tabState.get(tabId);
  if (!s) return;
  await chrome.storage.local.set({ [DRAFT_KEY_PREFIX + tabId]: s });
}

async function clearDraft(tabId) {
  await chrome.storage.local.remove(DRAFT_KEY_PREFIX + tabId);
  tabState.delete(tabId);
}

async function saveAndClear(tabId, recovered) {
  const s = tabState.get(tabId);
  if (!s) return;

  const startedAt = new Date(s.startedAt);
  const markdown = formatTranscript({ startedAt, entries: s.entries });

  let filename = buildFilename(startedAt);
  if (recovered) {
    filename = filename.replace(/\.md$/, ' (recovered).md');
  }

  const ok = await tryWrite(filename, markdown);
  if (ok) await clearDraft(tabId);
  // If write failed, leave the draft in place — it'll be retried at next
  // service-worker startup or recovered on next install.
}

async function tryWrite(filename, content) {
  const { handle } = await getStoredVaultFolder();
  if (!handle) return false;
  if (!(await checkPermission(handle))) return false;

  const existing = await listExistingNames(handle);
  const finalName = resolveCollision(filename, (n) => existing.has(n));
  try {
    await writeFile(handle, finalName, content);
    return true;
  } catch {
    return false;
  }
}

// Recovery on service-worker startup: scan for orphan drafts and write them
// as "(recovered)" files.
async function recoverOrphanDrafts() {
  const all = await chrome.storage.local.get(null);
  const orphanKeys = Object.keys(all).filter((k) => k.startsWith(DRAFT_KEY_PREFIX));

  for (const key of orphanKeys) {
    const tabId = Number(key.slice(DRAFT_KEY_PREFIX.length));
    const s = all[key];
    if (!s || !s.startedAt) continue;

    if (await tabStillOpen(tabId)) continue; // live tab — let it finish naturally

    tabState.set(tabId, s);
    await saveAndClear(tabId, /* recovered */ true);
  }
}

function tabStillOpen(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, () => {
      // chrome.tabs.get throws via runtime.lastError when the tab doesn't exist
      resolve(!chrome.runtime.lastError);
    });
  });
}

recoverOrphanDrafts();
