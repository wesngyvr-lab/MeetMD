# MeetMD

Capture Google Meet captions, save each meeting as a markdown file in your Obsidian vault.

## How it works (v0.2 architecture)

The extension saves transcripts via `chrome.downloads` into `Downloads/MeetMD/` (subfolder configurable in the popup). Files are moved into the vault manually.

Optional zero-click vault delivery: make `~/Downloads/MeetMD` a symlink to the vault — verified working 2026-06-11, but retired the same day because files "disappearing" from Downloads was confusing in practice.

Why not the File System Access API? See `docs/superpowers/dev-log/2026-05-07-shelved-postmortem.md` — MV3 makes set-and-forget FS Access writes impossible. Why not a launchd watcher moving files out of `Downloads/MeetMD/`? See `docs/superpowers/dev-log/2026-06-11-downloads-rearchitecture.md` — macOS TCC blocks launchd-spawned scripts from reading `~/Downloads`.

## Install (developer mode)

1. Clone this repo
2. `npm install` (only needed to run tests)
3. Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select this folder
4. In `chrome://settings/downloads`, make sure **"Ask where to save each file before downloading" is OFF** — a per-save prompt defeats the automation.
5. Join a Google Meet — transcript saves to `Downloads/MeetMD/` automatically when the call ends.

## Develop

- `npm test` — run unit tests
- `npm run test:watch` — watch mode

## License

MIT
