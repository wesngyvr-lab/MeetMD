// src/capture/content.js
// Vendored caption-capture from TranscripTonic. See CAPTURE.md for upstream SHA.

diag('content script loaded on', location.href);

const state = {
  startedAt: null,
  entries: [],
  observer: null,
  checkpointTimer: null,
  inCall: false,
};

// Buffer for the currently-speaking person, mirroring TranscripTonic's approach.
// Meet mutates a live caption block's characterData continuously while someone speaks,
// then moves on to the next speaker. We buffer until the speaker changes or the
// call ends, then flush to state.entries via appendEntry().
let speakerBuffer = "";
let textBuffer = "";
let timestampBuffer = "";

function emit(message) {
  try {
    chrome.runtime.sendMessage(message);
  } catch (e) {
    // Extension was reloaded; this content script's runtime is gone. Silent.
  }
}

function diag(msg, data) {
  console.log('[MeetMD]', msg, data !== undefined ? data : '');
  emit({ type: 'DIAG', msg, data: data === undefined ? null : safeData(data) });
}

// Make diagnostic data structured-clone-safe (errors stringify, etc).
function safeData(d) {
  if (d instanceof Error) return { error: d.message, name: d.name };
  try {
    JSON.stringify(d);
    return d;
  } catch {
    return String(d);
  }
}

// ---------------------------------------------------------------------------
// Call-start detection
// TranscripTonic: waits for .google-symbols icon with text "call_end" to appear
// (this is the leave-call button, used as the reliable meeting-started signal).
// Uses requestAnimationFrame polling — efficient and avoids setInterval spam.
// ---------------------------------------------------------------------------
function detectCallStart() {
  waitForElement(".google-symbols", "call_end").then(() => {
    onCallStart();
  });
}

function onCallStart() {
  if (state.inCall) return;
  diag('call start detected');
  state.inCall = true;
  state.startedAt = new Date();
  state.entries = [];
  speakerBuffer = "";
  textBuffer = "";
  timestampBuffer = "";
  emit({ type: "CALL_STARTED", startedAt: state.startedAt.toISOString() });
  enableCaptionsIfNeeded();
  attachCaptionObserver();
  state.checkpointTimer = setInterval(checkpoint, 30_000);
  watchForLeaveCall();
}

// ---------------------------------------------------------------------------
// Auto-enable captions
// TranscripTonic: clicks the .google-symbols icon with text "closed_caption_off"
// once captions button is visible in the toolbar. If already on, the icon text
// will differ and this waitForElement will eventually resolve anyway — the click
// of a live button is harmless because Meet toggles it back. We guard with a
// check: only click if the off-state icon is still present.
// ---------------------------------------------------------------------------
function enableCaptionsIfNeeded() {
  waitForElement(".google-symbols", "closed_caption_off").then(() => {
    // Re-check at click time — icon may have changed if user manually enabled
    const offIcons = selectElements(".google-symbols", "closed_caption_off");
    if (offIcons.length > 0) {
      diag('auto-enabling captions');
      offIcons[0].click();
    } else {
      diag('captions already on (or button not found)');
    }
  });
}

// ---------------------------------------------------------------------------
// Caption MutationObserver
// TranscripTonic: waits for div[role="region"][tabindex="0"] to appear — this
// is the caption container region that Meet injects when captions are active.
// Observes characterData mutations (Meet updates live text nodes in-place).
// Only processes the third-from-last child of the parent list to avoid
// double-counting corrected caption blocks (last two slots are non-transcript).
// ---------------------------------------------------------------------------
function attachCaptionObserver() {
  waitForElement('div[role="region"][tabindex="0"]').then((targetNode) => {
    if (!targetNode) {
      diag('caption observer: container not found');
      return;
    }
    diag('caption observer attached');

    const mutationConfig = {
      childList: true,
      attributes: true,
      subtree: true,
      characterData: true,
    };

    state.observer = new MutationObserver(transcriptMutationCallback);
    state.observer.observe(targetNode, mutationConfig);
  });
}

// ---------------------------------------------------------------------------
// Caption mutation callback
// Adapted from TranscripTonic's transcriptMutationCallback.
// DOM structure observed in TranscripTonic's inline comment:
//   div[role="region"][tabindex="0"]          <- observed root
//     div.iOzk7 (active transcript container)
//       div.nMcdL (per-speaker block)
//         div.adE6rb > div.KcIKyf             <- speaker name
//         div.bYevke > div.bh44bd             <- caption text (mutated via characterData)
//
// On a characterData mutation, mutation.target is the text node inside the
// caption div. We navigate: target -> parentElement (caption div) and
// target -> parentElement.previousSibling (speaker name div).
// We only act on the third-from-last block (index -3) to avoid capturing
// re-corrections of older blocks that Meet also mutates.
// ---------------------------------------------------------------------------
function transcriptMutationCallback(mutationsList) {
  mutationsList.forEach((mutation) => {
    try {
      if (mutation.type !== "characterData") return;

      const captionDiv = mutation.target.parentElement;
      // Walk up to the per-speaker block, then to the container of all blocks
      const speakerBlock = captionDiv && captionDiv.parentElement;
      const allBlocks = speakerBlock && speakerBlock.parentElement;
      if (!allBlocks) return;

      const children = Array.from(allBlocks.children);
      // TranscripTonic: last two slots are non-transcript elements; act only on [-3]
      const isTargetBlock =
        children.length >= 3 &&
        children[children.length - 3] === speakerBlock;

      if (!isTargetBlock) return;

      // Speaker name: div.KcIKyf jxFHg, which is previousSibling of the caption container
      const currentSpeaker =
        captionDiv && captionDiv.previousSibling
          ? captionDiv.previousSibling.textContent || ""
          : "";
      const currentText = captionDiv ? captionDiv.textContent || "" : "";

      if (currentSpeaker && currentText) {
        if (textBuffer === "") {
          // Starting fresh
          speakerBuffer = currentSpeaker;
          timestampBuffer = formatTimestamp(new Date());
          textBuffer = currentText;
        } else if (speakerBuffer !== currentSpeaker) {
          // Speaker changed — flush previous buffer
          flushBuffer();
          speakerBuffer = currentSpeaker;
          timestampBuffer = formatTimestamp(new Date());
          textBuffer = currentText;
        } else {
          // Same speaker, check for Meet's long-speech truncation
          // (TranscripTonic: when text shrinks by >250 chars, Meet dropped old text)
          if (currentText.length - textBuffer.length < -250) {
            flushBuffer();
            timestampBuffer = formatTimestamp(new Date());
          }
          textBuffer = currentText;
        }
      } else {
        // No active speaker — flush any buffered content
        if (speakerBuffer && textBuffer) {
          flushBuffer();
        }
        speakerBuffer = "";
        textBuffer = "";
      }
    } catch (err) {
      console.error("[MeetMD] transcriptMutationCallback error:", err);
    }
  });
}

// Flush the current speaker buffer to entries
function flushBuffer() {
  if (!speakerBuffer || !textBuffer) return;
  appendEntry(speakerBuffer, textBuffer, timestampBuffer);
  speakerBuffer = "";
  textBuffer = "";
  timestampBuffer = "";
}

function appendEntry(speaker, text, timestamp) {
  // Use provided timestamp (captured at start of utterance) or fall back to now
  const ts = timestamp || formatTimestamp(new Date());
  diag('caption', speaker + ' — ' + text);
  const entry = { speaker, timestamp: ts, text };
  state.entries.push(entry);
  emit({ type: "CAPTION", entry });
}

function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function checkpoint() {
  if (!state.inCall) return;
  emit({
    type: "CHECKPOINT",
    transcript: state.entries,
    startedAt: state.startedAt.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Leave-call detection
// TranscripTonic: attaches a click listener on the leave-call button's
// grandparent element (.google-symbols "call_end" -> parent -> parent).
// Also registers beforeunload as a fallback for tab closes / navigations.
// ---------------------------------------------------------------------------
function watchForLeaveCall() {
  try {
    const leaveIcons = selectElements(".google-symbols", "call_end");
    if (leaveIcons.length > 0) {
      const leaveButton = leaveIcons[0].parentElement && leaveIcons[0].parentElement.parentElement;
      if (leaveButton) {
        leaveButton.addEventListener("click", onCallEnd);
      }
    }
  } catch (err) {
    console.error("[MeetMD] watchForLeaveCall error:", err);
  }
  window.addEventListener("beforeunload", onCallEnd);
}

function onCallEnd() {
  if (!state.inCall) return;
  diag('call end detected, entries:', state.entries.length);
  state.inCall = false;

  // Flush any remaining buffered caption before reporting call end
  if (speakerBuffer && textBuffer) {
    flushBuffer();
  }

  if (state.checkpointTimer) clearInterval(state.checkpointTimer);
  if (state.observer) state.observer.disconnect();

  emit({
    type: "CALL_ENDED",
    transcript: state.entries,
    startedAt: state.startedAt.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Utility helpers (adapted from TranscripTonic)
// ---------------------------------------------------------------------------

/**
 * Returns all elements matching `selector` whose textContent matches `text`.
 * Returns the matching elements (not their parents).
 */
function selectElements(selector, text) {
  const elements = document.querySelectorAll(selector);
  return Array.prototype.filter.call(elements, (el) =>
    RegExp(text).test(el.textContent)
  );
}

/**
 * Efficiently waits for an element to appear in the DOM by polling on
 * requestAnimationFrame — the same approach used by TranscripTonic.
 * Resolves with the first matching element.
 */
async function waitForElement(selector, text) {
  if (text) {
    while (
      !Array.from(document.querySelectorAll(selector)).find(
        (el) => el.textContent === text
      )
    ) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  } else {
    while (!document.querySelector(selector)) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }
  return text
    ? Array.from(document.querySelectorAll(selector)).find(
        (el) => el.textContent === text
      )
    : document.querySelector(selector);
}

// ---------------------------------------------------------------------------
// WRITE_FILE handler
// The service worker formats the markdown and sends WRITE_FILE here. We do
// the actual file write because permission grants from the popup don't
// transfer to the SW — but the content script has user activation from the
// leave-call click, which satisfies handle.requestPermission().
// ---------------------------------------------------------------------------

const VAULT_DB_NAME = 'meetmd';
const VAULT_DB_VERSION = 1;
const VAULT_STORE = 'kv';
const VAULT_HANDLE_KEY = 'vaultFolderHandle';

function openVaultDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VAULT_DB_NAME, VAULT_DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStoredHandle() {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readonly');
    const req = tx.objectStore(VAULT_STORE).get(VAULT_HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function resolveCollision(name, existing) {
  if (!existing.has(name)) return name;
  const dotIdx = name.lastIndexOf('.');
  const stem = dotIdx === -1 ? name : name.slice(0, dotIdx);
  const ext = dotIdx === -1 ? '' : name.slice(dotIdx);
  let i = 2;
  while (existing.has(`${stem} (${i})${ext}`)) i += 1;
  return `${stem} (${i})${ext}`;
}

async function writeTranscriptFile(filename, content) {
  diag('writeTranscriptFile: starting');
  const handle = await getStoredHandle();
  if (!handle) {
    diag('writeTranscriptFile: no handle in IDB');
    return { ok: false, reason: 'No vault folder picked yet — open MeetMD popup to set one.' };
  }

  const opts = { mode: 'readwrite' };
  let perm = await handle.queryPermission(opts);
  diag('writeTranscriptFile: queryPermission ->', perm);
  if (perm !== 'granted') {
    perm = await handle.requestPermission(opts);
    diag('writeTranscriptFile: requestPermission ->', perm);
  }
  if (perm !== 'granted') {
    return { ok: false, reason: 'Vault folder permission denied' };
  }

  try {
    const existing = new Set();
    for await (const entry of handle.values()) existing.add(entry.name);
    const finalName = resolveCollision(filename, existing);
    const fileHandle = await handle.getFileHandle(finalName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(content);
    } finally {
      await writable.close();
    }
    diag('writeTranscriptFile: wrote', finalName);
    return { ok: true, filename: finalName };
  } catch (err) {
    diag('writeTranscriptFile: write error', err);
    return { ok: false, reason: err.message || 'File write error' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'WRITE_FILE') return false;
  diag('WRITE_FILE message received in content script');
  writeTranscriptFile(message.filename, message.content)
    .then(sendResponse)
    .catch((err) => {
      diag('writeTranscriptFile threw:', err && err.message);
      sendResponse({ ok: false, reason: (err && err.message) || 'Unhandled error' });
    });
  return true; // keep channel open for async response
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
detectCallStart();
