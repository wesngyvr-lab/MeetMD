import { formatTranscript } from '../lib/markdown.js';
import { buildFilename } from '../lib/filename.js';
import { textToDataUrl } from '../lib/download.js';

const DOWNLOAD_SUBFOLDER = 'MeetMD';

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

  // NEW: surface content-script diagnostics in the SW console
  if (message.type === 'DIAG') {
    console.log('[MeetMD/cs tab=' + (sender.tab?.id ?? '?') + ']', message.msg, message.data ?? '');
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

  const result = await downloadTranscript(filename, markdown);

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

// chrome.downloads works from the service worker with no user gesture and no
// permission handshake — unlike the FS Access API that sank the v0.1
// architecture (see docs/superpowers/dev-log/2026-05-07-shelved-postmortem.md).
function downloadTranscript(filename, content) {
  return new Promise((resolve) => {
    chrome.downloads.download(
      {
        url: textToDataUrl(content),
        filename: `${DOWNLOAD_SUBFOLDER}/${filename}`,
        conflictAction: 'uniquify',
      },
      (downloadId) => {
        if (chrome.runtime.lastError || downloadId === undefined) {
          const reason = chrome.runtime.lastError?.message || 'Download did not start';
          console.log('[MeetMD] downloadTranscript failed:', reason);
          resolve({ ok: false, reason });
          return;
        }
        resolve({ ok: true, filename });
      }
    );
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
