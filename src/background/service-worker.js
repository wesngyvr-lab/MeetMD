import { formatTranscript } from '../lib/markdown.js';
import { buildFilename } from '../lib/filename.js';

const DRAFT_KEY_PREFIX = 'meetmd:draft:';

// In-memory map of tabId -> { startedAt, entries }. Service workers can be
// killed at any time, so we also persist drafts to chrome.storage.local on
// every CHECKPOINT and CAPTION.
const tabState = new Map();

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.png'),
      title,
      message,
    });
  } catch (e) {
    // Notifications can throw on some platforms if icon is missing — log and continue.
    console.warn('[MeetMD] notify failed:', e);
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  console.log('[MeetMD] message received:', message.type, 'from tab', sender.tab?.id);

  // FLUSH_DRAFTS comes from the popup (no sender.tab) — handle before tabId guard
  if (message.type === 'FLUSH_DRAFTS') {
    console.log('[MeetMD] FLUSH_DRAFTS — running orphan recovery');
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
  if (!s) {
    console.log('[MeetMD] saveAndClear: no state for tab', tabId);
    return;
  }
  const captionCount = s.entries.length;
  console.log('[MeetMD] saveAndClear: tab=' + tabId, 'entries=' + captionCount, 'recovered=' + recovered);

  const startedAt = new Date(s.startedAt);
  const markdown = formatTranscript({ startedAt, entries: s.entries });
  let filename = buildFilename(startedAt);
  if (recovered) {
    filename = filename.replace(/\.md$/, ' (recovered).md');
  }

  if (recovered) {
    // Recovered drafts cannot be written here — the originating tab is gone,
    // so there's no content script with user activation to delegate to. Leave
    // the draft in storage; a future popup-driven flush will handle it.
    console.log('[MeetMD] saveAndClear: leaving recovered draft for popup-driven flush');
    notify('MeetMD — pending', `1 transcript pending. Open MeetMD popup to save.`);
    return;
  }

  // Delegate write to the content script in the originating tab.
  const result = await delegateWrite(tabId, filename, markdown);

  if (result.ok) {
    await clearDraft(tabId);
    if (captionCount === 0) {
      notify('MeetMD — saved (empty)', `Saved empty transcript: ${result.filename}`);
    } else {
      notify('MeetMD — saved', `${result.filename} (${captionCount} captions)`);
    }
  } else {
    notify('MeetMD — save failed', result.reason || 'Unknown error');
  }
}

function delegateWrite(tabId, filename, content) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'WRITE_FILE', filename, content }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('[MeetMD] delegateWrite: tab message failed', chrome.runtime.lastError.message);
        resolve({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, reason: 'No response from content script' });
    });
  });
}

// Recovery on service-worker startup: scan for orphan drafts and write them
// as "(recovered)" files.
async function recoverOrphanDrafts() {
  const all = await chrome.storage.local.get(null);
  const orphanKeys = Object.keys(all).filter((k) => k.startsWith(DRAFT_KEY_PREFIX));
  console.log('[MeetMD] recoverOrphanDrafts: found', orphanKeys.length, 'drafts');

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
