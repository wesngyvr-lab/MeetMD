# Capture Module

The caption-scraping logic in `content.js` is vendored from
[vivek-nexus/transcriptonic](https://github.com/vivek-nexus/transcriptonic).

## Upstream

- Source: https://github.com/vivek-nexus/transcriptonic
- File: extension/content-google-meet.js
- Vendored at commit: a1b9561548ae8771b7e69f0fe1e6ed180e72c7de
- Vendored on: 2026-05-06

## What was lifted

- Caption container DOM selector (`div[role="region"][tabindex="0"]`) and MutationObserver setup
- Speaker-name extraction logic (`mutation.target.parentElement.previousSibling.textContent`)
- Third-from-last block targeting (avoids double-counting re-corrected caption blocks)
- Long-speech truncation detection (>250 char shrink triggers buffer flush)
- Call-start detection (`waitForElement(".google-symbols", "call_end")`)
- Call-end detection (click listener on leave-button grandparent + `beforeunload` fallback)
- Auto-enable-captions click (`.google-symbols` with text `"closed_caption_off"`)
- `waitForElement` helper (requestAnimationFrame polling — efficient, no setInterval)
- `selectElements` helper (querySelectorAll + textContent filter)

## What was rewritten

- All save/UI/storage logic stripped (TranscripTonic writes to chrome.storage.local and
  triggers downloads via background; we send messages to our background worker per
  `docs/superpowers/specs/2026-05-06-meetmd-design.md`)
- Message format follows the contract in the design spec:
  - `CALL_STARTED` — emitted when call-end icon appears
  - `CAPTION` — emitted per utterance (on speaker change or long-speech truncation)
  - `CHECKPOINT` — every 30s with full transcript snapshot
  - `CALL_ENDED` — emitted on leave-call click or beforeunload
- Speaker buffer flushed to `appendEntry()` instead of TranscripTonic's `pushBufferToTranscript()`
- Removed: `checkExtensionStatus()`, `recoverLastMeeting()`, `overWriteChromeStorage()`,
  `showNotification()`, `pulseStatus()`, `updateMeetingTitle()`, `logError()`,
  chat-messages observer, userName capture interval, and all their chrome.storage references

## Re-porting upstream fixes

When Google Meet changes its caption DOM (the most likely break), check
TranscripTonic's recent commits:

```
git -C /tmp/transcriptonic pull
git -C /tmp/transcriptonic log --oneline a1b9561548ae8771b7e69f0fe1e6ed180e72c7de..HEAD
```

Diff their `extension/content-google-meet.js` against ours, port the selector or
observer changes, update the commit SHA and date in this file.
