# MeetMD — Downloads re-architecture (2026-06-11)

Status: un-shelved. Write path rebuilt on `chrome.downloads`; awaiting one real-Meet verification run.

## Why now

Laxis hit its storage limit, which killed the "Laxis already covers this" reason for shelving. The 2026-05-07 postmortem listed `chrome.downloads` + symlink as "would work, but not worth it" — it's now worth it.

A fresh check (June 2026) of Chrome's [persistent permissions for the FS Access API](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api) found nothing that changes the extension-context impasse: persistence is an origin-level opt-in surfaced through page permission UI, with no evidence it transfers to MV3 service-worker contexts. Did not relitigate.

## What changed

- **Write path:** SW now calls `chrome.downloads.download()` with a base64 `data:` URL (`src/lib/download.js` — SWs have no `URL.createObjectURL`). Files land in `Downloads/MeetMD/`, `conflictAction: 'uniquify'` replaces manual collision logic.
- **Recovered drafts simplified:** downloads need no user gesture, so orphan recovery saves directly from the SW. The "leave draft for popup-driven flush" dance is gone.
- **Content script:** `WRITE_FILE` handler deleted (~70 lines). Content script is now capture-only.
- **Popup:** no more folder picker. Shows pending-draft count + manual flush button.
- **Deleted:** `src/lib/filesystem.js` (FS Access wrapper).
- **Manifest:** `downloads` permission added.

## Vault delivery: launchd watcher REJECTED, symlink adopted

First attempt was a launchd `WatchPaths` agent moving `~/Downloads/MeetMD/*.md` into the vault. The agent ran (runs=4, exit 0) but saw an empty directory: **macOS TCC blocks launchd-spawned `/bin/bash` from reading `~/Downloads`** (`ls: Operation not permitted`). Terminal sessions work because Terminal holds the TCC grant; launchd children have no granting context and get silently denied. Fixing it would require giving bash Full Disk Access — rejected.

Adopted instead: `~/Downloads/MeetMD` is a symlink to the vault root (`~/Workspace/WN Main`), matching Wesley's flat `YYYY-MM-DD HHMM Title.md` meeting-note convention (no `Meetings/` subfolder exists). Chrome writes through the symlink; no daemon, no TCC.

## Open risk — RESOLVED 2026-06-11

Chrome *may* resolve symlinks during download-path sanitization and refuse or redirect the write — **verified it does not**: on extension reload, orphan recovery flushed 9 May-era drafts via `chrome.downloads`, and all 9 landed in the vault root through the symlink. The downloads write path and symlink delivery are both confirmed working end-to-end.

Fallbacks kept for reference in case a future Chrome version changes symlink handling:

- Fallback A: real `Downloads/MeetMD/` folder + macOS **Folder Actions** (Folder Actions Dispatcher has its own TCC identity and prompts properly, unlike raw launchd).
- Fallback B: real folder, move files manually/with a Terminal-run script.

Also requires `chrome://settings/downloads` → "Ask where to save each file" OFF.
