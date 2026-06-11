# MeetMD — Manual Test Checklist

Run this before each release. Not all scenarios apply to v1; skip what's not relevant.

## Setup

- [ ] Fresh install: load unpacked, popup says "No pending drafts" and flush button is disabled.
- [ ] `chrome://settings/downloads`: "Ask where to save each file" is OFF.
- [ ] `~/Downloads/MeetMD` symlink points at the vault (`ls -la ~/Downloads/ | grep MeetMD`).
- [x] **First-run symlink check** (verified 2026-06-11): Chrome writes through the symlink — 9 recovered drafts landed in the vault root.
- [ ] Popup folder setting: change the subfolder, save, next transcript lands in the new path; empty value saves to Downloads root.

## Standard meeting

- [ ] Join a Meet call. Captions auto-enable if they were off.
- [ ] Speak; observe captions in Meet.
- [ ] Leave the call.
- [ ] Vault root contains a new file `YYYY-MM-DD HHMM Meeting.md` (via the `Downloads/MeetMD` symlink).
- [ ] File has correct frontmatter (date, time, type, participants, source).
- [ ] File body has speaker wikilinks and timestamps.

## Edge cases

- [ ] Captions never enabled: file is written with the empty-transcript fallback message.
- [ ] Two meetings starting in the same minute: second file gets ` (2)` suffix.
- [ ] Two concurrent meetings in different tabs: both transcripts saved independently with no cross-talk.
- [ ] Browser force-quit mid-call: on next browser start, a `(recovered).md` appears automatically (no popup click needed).
- [ ] Speaker name with double-quotes: frontmatter remains valid YAML (escaped).

## Re-port scenario (when Meet changes its DOM)

- [ ] Captures suddenly stop firing in console.
- [ ] Pull TranscripTonic upstream, diff against vendored `content.js`, port fixes.
- [ ] Update `src/capture/CAPTURE.md` with new SHA and date.
