# MeetMD — Shelved (2026-05-07)

Status: paused indefinitely. Capture pipeline works; file-write architecture blocked by Chrome.

## Why shelved

The product goal was set-and-forget transcript saves directly into a chosen Obsidian vault folder. Chrome's File System Access API + MV3 extension architecture cannot deliver this without a user click per save. Three independent constraints converge:

1. **Service workers have no user activation.** `FileSystemHandle.requestPermission()` requires a user gesture; SW can never satisfy it. Permission state from the popup's `showDirectoryPicker` does NOT transfer to the SW context — the SW reading the same handle from IndexedDB sees `'prompt'`, not `'granted'`.

2. **Content scripts can't access the extension's IndexedDB.** They run in the page's origin (`meet.google.com`), not the extension origin. The vault handle stored by the popup is invisible. Confirmed via runtime error: `Failed to execute 'transaction' on 'IDBDatabase': One of the specified object stores was not found`.

3. **`chrome.tabs.sendMessage` strips method capabilities from FileSystemHandles.** It uses JSON-like serialization, not real structured clone. Even though FileSystemHandle is in the structured-clone-supported types per the spec, Chrome's runtime messaging doesn't fully preserve it. Confirmed via runtime error: `handle.queryPermission is not a function`. So passing the handle from SW to content script doesn't work.

The combined effect: no execution context can both (a) access the persisted handle AND (b) supply a user gesture for `requestPermission`, except the popup — which is closed at meeting end.

## Why TranscripTonic, Tactiq, etc. work

They use `chrome.downloads.download(...)` — the Chrome Downloads API has none of these constraints. Files land in `~/Downloads/` (or wherever Chrome's download default points). The trade-off is that you can't write to an arbitrary user-chosen folder; everything goes through Chrome's download pipeline.

## Architectures considered and rejected

- **Write from SW** — blocked by #1
- **Write from content script** — blocked by #2 + #3
- **Pass handle in message payload** — blocked by #3
- **Offscreen document** — same-origin as popup so could access IDB, but uncertain whether popup's permission grant persists; not tested
- **Popup-mediated writes (click-per-save)** — works reliably but breaks the set-and-forget product goal
- **`chrome.downloads` + symlink Downloads/MeetMD → vault folder** — would work, but at that point we're rebuilding TranscripTonic with a different folder; not worth it given Laxis already covers the user's need

## What's salvageable

- **Capture pipeline (`src/capture/content.js`)**: vendored from TranscripTonic, adapted to emit messages. Works correctly — caption capture, speaker extraction, call-start/end detection all verified.
- **Markdown formatter (`src/lib/markdown.js`)** + **filename module (`src/lib/filename.js`)**: pure functions, fully unit-tested. Reusable for any future iteration.
- **Spec + plan**: in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

If Chrome ever changes the FS Access API permission model (e.g., persistent grants across extension contexts), this repo is ready to resume. Until then, the user is on Laxis.

## Final commit

`3b24734` — `fix: pass vault handle in WRITE_FILE message (content script can't access extension IDB)`. The fix landed but ran into constraint #3, which surfaced the architectural impasse.
