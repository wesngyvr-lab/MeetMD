# MeetMD — Design Spec

**Date:** 2026-05-06
**Repo:** https://github.com/wesngyvr-lab/MeetMD (private)
**Author:** Wesley Ng

## Summary

A Chrome MV3 extension that captures Google Meet captions in real time and saves each meeting as a markdown file directly into a user-chosen Obsidian vault folder. Personal-use tool, not a Chrome Web Store product.

## Goals

- Zero-friction capture: join a Meet, leave a Meet, find the transcript in your vault.
- One vault folder picked once, used forever (no per-meeting prompts).
- Vault-native output: frontmatter, speaker names as `[[wikilinks]]`, ready for Bases/Dataview/backlinks.
- Local-only. No server, no API keys, no remote dependencies.

## Non-goals

- No language translation. Captions land in the language Meet outputs them.
- No AI summaries, no action-item extraction, no analytics.
- No Zoom or Teams support in v1 (lifted capture module will be Meet-specific).
- No Chrome Web Store distribution in v1; load unpacked locally.

## Architecture

Three logical pieces, all running locally in the browser.

### 1. Capture (content script)

- Lifted from [vivek-nexus/transcriptonic](https://github.com/vivek-nexus/transcriptonic), placed in `src/capture/` with a `CAPTURE.md` recording the upstream commit SHA and re-port instructions.
- Runs on `meet.google.com/*`.
- Detects call start via call-screen DOM signal.
- Auto-enables Meet's native caption toggle if not already on.
- MutationObserver on the caption container appends `{ speaker, timestamp, text }` entries to an in-memory array.
- Detects call end via the leave-call DOM signal, tab close, or navigation away.
- On call end, sends the full transcript array to the background worker.

### 2. Coordinator (background service worker)

- Tracks which Meet tabs are active and which have ongoing transcripts.
- Receives the final transcript from the content script when a call ends.
- Every 30 seconds during an active call, persists the in-flight transcript to `chrome.storage.local` under a draft key. On clean meeting end, the draft is cleared. On extension start, any orphan drafts are recovered and written as `<filename> (recovered).md`.
- Calls into the save layer.

### 3. Save layer

- Uses the **File System Access API** to write directly into the granted vault folder.
- Folder handle is granted once via the popup ("Pick your Meetings folder") and stored in `chrome.storage.local` for re-use across browser sessions.
- If Chrome revokes the persisted permission (occurs occasionally after browser updates), the extension auto-detects via `queryPermission()` and surfaces a re-prompt in the popup.

## Note shape

```markdown
---
date: 2026-05-06
time: 14:30
type: meeting
participants: ["[[Alice]]", "[[Wesley]]"]
source: google-meet
---

# Meeting — 2026-05-06 14:30

**[[Alice]]** [14:30:02] — hey, ready when you are
**[[Wesley]]** [14:30:05] — yep, let's go
```

**Filename:** `YYYY-MM-DD HHMM Meeting.md` (e.g. `2026-05-06 1430 Meeting.md`).

**Collisions:** if a file with the same name already exists, append ` (2)`, ` (3)`, etc.

**Speaker names:** rendered as `[[wikilinks]]` using the verbatim string from Meet's caption byline. The extension makes no attempt to canonicalize, alias, or fuzzy-match against existing vault notes. Aliasing is the user's job in Obsidian.

**Frontmatter `participants`:** the deduplicated set of speakers seen during the call.

## Lifecycle

| Event | Trigger | Action |
|---|---|---|
| Join Meet call | URL match + call-screen DOM | Start capture. Auto-enable captions if off. |
| Caption appears | MutationObserver fires | Append `{ speaker, timestamp, text }` to transcript. |
| Periodic checkpoint | Every 30s while in call | Persist current transcript to `chrome.storage.local`. |
| Leave call | Leave-call DOM signal, tab close, or navigation away | Send transcript to background; background formats and saves; clear draft. |
| Extension start | Service worker init | Scan storage for orphan drafts; write each as `(recovered).md`. |

## Setup flow (first-run UX)

1. User installs extension (load unpacked from local repo).
2. User clicks the extension popup. Popup says: "Pick your Meetings folder."
3. User clicks button → File System Access API prompt → user picks a folder inside their vault (e.g. `WN Main/Meetings/`).
4. Folder handle is stored. Popup now shows: "Saving to: `Meetings/`. Change folder."
5. User joins next Meet call. Transcript saves silently when call ends.

## Error handling

- **Captions never enabled / fail to enable:** transcript is empty. On call end, write the file anyway with a note in the body indicating no captions were captured. (Better than silently dropping the meeting.)
- **Vault folder permission lost:** popup surfaces re-prompt; meeting transcript queued in `chrome.storage.local` until permission re-granted, then flushed.
- **Concurrent meetings (two Meet tabs):** each tab maintains its own transcript independently. Background worker keys by tab ID.
- **Browser crash mid-call:** transcript drafts checkpointed every 30s in `chrome.storage.local`; recovered as `(recovered).md` on next browser start.
- **Two meetings starting in the same minute:** filename collision suffix (` (2)`).

## Repo layout

```
MeetMD/
├── manifest.json
├── src/
│   ├── capture/              # Lifted from TranscripTonic
│   │   ├── content.js
│   │   └── CAPTURE.md        # Upstream commit + re-port instructions
│   ├── background/
│   │   └── service-worker.js
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.js
│   └── lib/
│       ├── markdown.js       # Format transcript → markdown string
│       └── filesystem.js     # File System Access API wrapper
├── tests/
│   └── markdown.test.js      # Vitest, formatter unit tests
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-05-06-meetmd-design.md
├── TESTING.md                # Manual test checklist
├── README.md
└── LICENSE                   # MIT
```

## Testing

- **Unit tests (Vitest):** the markdown formatter — input is a structured transcript object, output is the exact markdown string. Covers frontmatter, speaker wikilinks, timestamps, deduplicated participants, empty-transcript fallback.
- **Manual test plan (`TESTING.md`):** checklist run before each release. Scenarios: fresh install, join/leave standard meeting, captions enabled mid-call, captions never enabled, two meetings same minute, two meetings same tab back-to-back, two concurrent meetings in different tabs, browser crash mid-call, vault permission revoked, vault folder moved.
- **No E2E tests.** Cost > value for a personal tool against a third-party DOM.

## Distribution

- v1: load unpacked from local clone in Chrome dev mode.
- No Chrome Web Store listing. Revisit if anyone else wants to install.

## License

MIT.

## Open questions

None at spec time. Decisions to revisit after v1 use:

- Whether to add a "rename file before save" prompt at meeting end (currently auto-saves silent).
- Whether to support Zoom/Teams via TranscripTonic's beta capture modules.
- Whether to ship a Chrome Web Store build.
