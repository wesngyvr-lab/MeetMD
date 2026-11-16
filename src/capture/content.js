// src/capture/content.js
// Vendored caption-capture from TranscripTonic. See CAPTURE.md for upstream SHA.

diag('content script loaded on', location.href);

const state = {
  startedAt: null,
  entries: [],
  observer: null,
  checkpointTimer: null,
  observerTimer: null,
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
// Meet renamed the captions icon in late Oct 2026 from "closed_caption_off" to
// "translate_cc" (upstream TranscripTonic v3.4.4). Match both. The new icon
// text no longer changes with state, so read aria-pressed on the button instead.
const CAPTIONS_ICON_TEXTS = ["closed_caption_off", "translate_cc"];

function getCaptionsPressedState() {
  const icon = Array.from(document.querySelectorAll(".google-symbols")).find(
    (el) => CAPTIONS_ICON_TEXTS.includes(el.textContent || "")
  );
  const button = icon && icon.closest("button");
  return button ? button.getAttribute("aria-pressed") : null;
}

// Upstream v3.4.5: press Meet's "c" shortcut, then confirm through aria-pressed
// and retry, because Meet can drop the first keypress while its shortcut
// handler loads. Never press "c" once captions are on: it toggles them off.
async function enableCaptionsIfNeeded() {
  await waitForElement(".google-symbols", CAPTIONS_ICON_TEXTS);
  for (let attempt = 1; attempt <= 10; attempt++) {
    if (!state.inCall) return;
    const pressed = getCaptionsPressedState();
    if (pressed === "true") {
      diag('captions on');
      return;
    }
    if (pressed === null) {
      diag('captions state unknown, not toggling');
      return;
    }
    diag('auto-enabling captions, attempt', attempt);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "c", code: "KeyC", bubbles: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  diag('could not turn on captions');
}

// ---------------------------------------------------------------------------
// Caption MutationObserver
// TranscripTonic: waits for div[role="region"][tabindex="0"] to appear — this
// is the caption container region that Meet injects when captions are active.
// Observes characterData mutations (Meet updates live text nodes in-place).
// Only processes the third-from-last child of the parent list to avoid
// double-counting corrected caption blocks (last two slots are non-transcript).
// ---------------------------------------------------------------------------
// Polls every 2s rather than attaching once, so captions turned on late, or
// turned off and back on (Meet replaces the region), are still captured.
function attachCaptionObserver() {
  let observedNode = null;
  const mutationConfig = {
    childList: true,
    attributes: true,
    subtree: true,
    characterData: true,
  };

  const tryAttach = () => {
    if (!state.inCall) return;
    const region = document.querySelector('div[role="region"][tabindex="0"]');
    if (!region || region === observedNode) return;
    if (state.observer) {
      state.observer.disconnect();
      flushBuffer();
    }
    observedNode = region;
    state.observer = new MutationObserver(transcriptMutationCallback);
    state.observer.observe(region, mutationConfig);
    diag('caption observer attached');
  };

  tryAttach();
  state.observerTimer = setInterval(tryAttach, 2000);
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
  if (state.observerTimer) clearInterval(state.observerTimer);
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
  const texts = text === undefined ? [] : Array.isArray(text) ? text : [text];
  if (texts.length) {
    while (
      !Array.from(document.querySelectorAll(selector)).find((el) =>
        texts.includes(el.textContent)
      )
    ) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  } else {
    while (!document.querySelector(selector)) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }
  return texts.length
    ? Array.from(document.querySelectorAll(selector)).find((el) =>
        texts.includes(el.textContent)
      )
    : document.querySelector(selector);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
detectCallStart();
