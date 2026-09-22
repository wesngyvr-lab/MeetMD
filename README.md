# MeetMD

A Chrome extension that captures Google Meet captions and saves each meeting as a
markdown file, formatted for Obsidian.

When a call ends, MeetMD writes a file like `2026-09-22 0940 Meeting.md` into
`Downloads/MeetMD/`, with YAML frontmatter, speaker wikilinks, and timestamps.
Nothing leaves your machine: there is no server, no account, and no network call.

- [What you get](#what-you-get)
- [Requirements](#requirements)
- [Install](#install)
- [Use it](#use-it)
- [Settings](#settings)
- [Output format](#output-format)
- [How it works](#how-it-works)
- [Limits](#limits)
- [Troubleshooting](#troubleshooting)
- [Develop](#develop)
- [Credits and license](#credits-and-license)

For frequently asked questions and longer guides, see the
[wiki](https://github.com/wesngyvr-lab/MeetMD/wiki).

## What you get

MeetMD reads the captions Google Meet already renders on screen. It does not
record audio or video, and it does not transcribe anything itself. If captions
are off, there is nothing to capture.

The extension does three things:

- Turns captions on for you when you join a call, if they are off.
- Collects each utterance with its speaker and timestamp while the call runs.
- Writes a markdown file when the call ends.

## Requirements

- Google Chrome, or another Chromium browser that supports Manifest V3 extensions.
- A Google Meet call where captions are available.
- Node.js, only if you want to run the tests.

## Install

MeetMD is not on the Chrome Web Store, so you install it as an unpacked
extension.

1. Download the code. On the [repository page](https://github.com/wesngyvr-lab/MeetMD),
   select **Code** > **Download ZIP**, then unzip it. If you prefer git, run
   `git clone https://github.com/wesngyvr-lab/MeetMD.git`.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode**, in the top-right corner.
4. Select **Load unpacked**, then choose the folder you unzipped. The folder you
   pick must be the one that contains `manifest.json`.
5. Go to `chrome://settings/downloads` and turn **off** "Ask where to save each
   file before downloading."

Step 5 matters more than it looks. MeetMD saves through Chrome's download
pipeline, so if Chrome asks where to put every file, you get a save dialog at the
end of each call instead of a saved transcript.

To keep the extension one click away, select the puzzle-piece icon in the Chrome
toolbar and pin MeetMD.

## Use it

1. Join a Google Meet call. If captions are off, MeetMD turns them on.
2. Confirm that captions are visible on screen. Captions you cannot see are
   captions MeetMD cannot read.
3. Leave the call.

Chrome saves the transcript to `Downloads/MeetMD/` and shows a notification that
names the file and the number of captions captured. A notification that says
"saved (empty)" means the call ended with nothing captured.

If Chrome quits mid-call, MeetMD keeps the partial transcript. The next time the
extension starts, it writes what it has to a file whose name ends in
`(recovered).md`. You do not need to select anything for this to happen.

## Settings

Select the MeetMD toolbar icon to open the popup. It shows:

- Where transcripts are saved.
- How many drafts are in progress or pending.
- **Save pending drafts now**, which forces a recovery pass over any orphaned
  drafts.
- **Save folder**, the subfolder inside Downloads. The default is `MeetMD`. Leave
  it empty to save directly to your Downloads folder.

The save folder accepts nested paths such as `Notes/Meetings`. MeetMD strips
characters that Chrome rejects, along with `.` and `..` segments, because a
rejected download is a lost transcript.

## Output format

```markdown
---
date: 2026-09-22
time: 09:40
type: meeting
participants: ["[[Alice]]", "[[Wesley]]"]
source: google-meet
---

# Meeting — 2026-09-22 09:40

**[[Alice]]** [09:40:02] — hey, ready when you are
**[[Wesley]]** [09:40:05] — yep, let's go
```

Speakers appear as `[[wikilinks]]` in both the frontmatter and the body, so an
Obsidian vault links each meeting to the people in it. Double quotes in a speaker
name are escaped, which keeps the frontmatter valid YAML.

Files are named `YYYY-MM-DD HHMM Meeting.md`, using the time the call started. If
that name is taken, Chrome appends a numeric suffix, so a second call in the same
minute becomes `... Meeting (1).md`.

## How it works

Three pieces, with messages between them:

1. **Content script** (`src/capture/content.js`) runs on `meet.google.com`. It
   watches the caption container with a `MutationObserver`, groups captions by
   speaker, and detects when the call starts and ends. It sends `CALL_STARTED`,
   `CAPTION`, `CHECKPOINT` every 30 seconds, and `CALL_ENDED`.
2. **Service worker** (`src/background/service-worker.js`) holds the transcript
   for each tab and writes every change to `chrome.storage.local`. Manifest V3
   can stop a service worker at any moment, so the draft on disk is the source of
   truth, not the copy in memory.
3. **Write path** (`src/lib/download.js`) turns the markdown into a `data:` URL
   and hands it to `chrome.downloads.download()`. Service workers have no
   `URL.createObjectURL`, which is why the content becomes a data URL first.

MeetMD uses `chrome.downloads` rather than the File System Access API, which
cannot write to a folder you choose without a click per save. The
[shelved postmortem](docs/superpowers/dev-log/2026-05-07-shelved-postmortem.md)
documents the three constraints that rule the File System Access API out, and the
[downloads re-architecture log](docs/superpowers/dev-log/2026-06-11-downloads-rearchitecture.md)
covers the rebuild.

## Limits

- **Captions must be on and visible.** No captions, no transcript.
- **Caption accuracy is Google's.** MeetMD copies what Meet displays, including
  its mistakes.
- **Speaker names come from the caption UI**, so they match the display names in
  the call.
- **Meet's layout can change.** The caption selectors are vendored from
  TranscripTonic at a pinned commit. When Google restructures the caption DOM,
  capture stops and the files come out empty. See
  [Re-porting the capture module](https://github.com/wesngyvr-lab/MeetMD/wiki/Re-porting-the-capture-module).
- **Downloads only.** Files go where Chrome puts downloads. You can point the
  subfolder elsewhere inside Downloads, but not outside it.

## Troubleshooting

| What you see | What to check |
|---|---|
| A file appears, but says no captions were captured | Were captions visible on screen during the call? If yes, the selectors have likely drifted — see the wiki. |
| A save dialog at the end of every call | Turn off "Ask where to save each file" in `chrome://settings/downloads`. |
| No file at all | Open `chrome://extensions`, select **service worker** under MeetMD, and read the console for `[MeetMD]` lines. |
| The popup does not open | Select the reload arrow on the MeetMD card in `chrome://extensions`. |
| Transcripts stopped after you moved the folder | An unpacked extension points at a path. Remove it and load unpacked again from the new location. |

Longer answers live in the
[wiki FAQ](https://github.com/wesngyvr-lab/MeetMD/wiki/FAQ) and
[Troubleshooting](https://github.com/wesngyvr-lab/MeetMD/wiki/Troubleshooting) pages.

## Develop

```bash
npm install     # only needed for tests
npm test        # run unit tests
npm run test:watch
```

Layout:

```
src/capture/content.js          caption scraping, vendored from TranscripTonic
src/background/service-worker.js  transcript state, recovery, writing
src/lib/markdown.js             frontmatter and body formatting
src/lib/filename.js             YYYY-MM-DD HHMM Meeting.md
src/lib/download.js             text to data: URL
src/lib/settings.js             save-folder setting and sanitizing
src/popup/                      popup UI
tests/                          vitest unit tests
```

The pure functions in `src/lib/` are unit-tested. The capture layer and the
Chrome APIs are not, because they need a real browser and a real call. Before you
release, walk through [TESTING.md](TESTING.md).

After you change the vendored capture code, update the commit SHA and date in
[src/capture/CAPTURE.md](src/capture/CAPTURE.md).

## Credits and license

The caption-scraping logic is vendored from
[vivek-nexus/transcriptonic](https://github.com/vivek-nexus/transcriptonic).
[src/capture/CAPTURE.md](src/capture/CAPTURE.md) records what was lifted, what was
rewritten, and the pinned upstream commit.

MIT. See [LICENSE](LICENSE).
