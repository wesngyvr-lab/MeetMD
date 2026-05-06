# MeetMD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that captures Google Meet captions in real time and writes each meeting as a markdown file directly into a user-chosen Obsidian vault folder.

**Architecture:** Three pieces all running locally in the browser — a content script (lifted from TranscripTonic) that scrapes Meet captions, a background service worker that coordinates state and checkpoints transcripts to `chrome.storage.local`, and a save layer that uses the File System Access API to write markdown files into a granted vault folder.

**Tech Stack:** Chrome MV3 (vanilla JS, ES modules), File System Access API, `chrome.storage.local`, Vitest for unit tests, no bundler.

**Reference:** Spec at `docs/superpowers/specs/2026-05-06-meetmd-design.md`.

---

## File Map

```
MeetMD/
├── manifest.json                # MV3 manifest
├── package.json                 # vitest only
├── vitest.config.js
├── .gitignore
├── README.md
├── LICENSE                      # MIT
├── TESTING.md                   # manual test checklist
├── src/
│   ├── capture/
│   │   ├── content.js           # vendored from TranscripTonic, adapted
│   │   └── CAPTURE.md           # upstream SHA + re-port notes
│   ├── background/
│   │   └── service-worker.js    # coordinator + checkpointing + recovery
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.js             # folder picker UI
│   └── lib/
│       ├── markdown.js          # pure: transcript -> markdown string
│       ├── filename.js          # pure: filename + collision logic
│       └── filesystem.js        # File System Access API wrapper
└── tests/
    ├── markdown.test.js
    └── filename.test.js
```

**Messaging contract (content ↔ background):**
- `{ type: 'CAPTION', tabId, entry: { speaker, timestamp, text } }` — emitted on each new caption
- `{ type: 'CHECKPOINT', tabId, transcript: [...], startedAt }` — every 30s during call
- `{ type: 'CALL_ENDED', tabId, transcript: [...], startedAt }` — emitted when leave-call detected
- `{ type: 'CALL_STARTED', tabId, startedAt }` — emitted when call screen appears

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `.gitignore`
- Create: `README.md`
- Create: `LICENSE`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "meetmd",
  "version": "0.1.0",
  "description": "Google Meet captions to Obsidian markdown",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
.DS_Store
*.log
dist/
```

- [ ] **Step 4: Create `README.md`**

```markdown
# MeetMD

Capture Google Meet captions, save each meeting as a markdown file in your Obsidian vault.

## Install (developer mode)

1. Clone this repo
2. `npm install`
3. Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select this folder
4. Click the MeetMD icon in the toolbar, click "Pick your Meetings folder", grant access to a folder inside your vault
5. Join a Google Meet — transcript saves automatically when the call ends

## Develop

- `npm test` — run unit tests
- `npm run test:watch` — watch mode

## License

MIT
```

- [ ] **Step 5: Create `LICENSE` (MIT, year 2026, holder "Wesley Ng")**

Use the standard MIT license text. Copy from https://opensource.org/license/mit (or any existing MIT-licensed repo Wesley owns) and substitute year + holder.

- [ ] **Step 6: Install dependencies**

Run: `cd ~/Workspace/MeetMD && npm install`
Expected: `node_modules/` populated, `package-lock.json` created, no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.js .gitignore README.md LICENSE
git commit -m "chore: scaffold project (vitest, manifest, license)"
```

---

## Task 2: Markdown formatter (TDD)

**Files:**
- Create: `tests/markdown.test.js`
- Create: `src/lib/markdown.js`

- [ ] **Step 1: Write failing tests for `formatTranscript`**

Create `tests/markdown.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { formatTranscript } from '../src/lib/markdown.js';

describe('formatTranscript', () => {
  it('renders a basic two-speaker transcript', () => {
    const result = formatTranscript({
      startedAt: new Date('2026-05-06T14:30:00'),
      entries: [
        { speaker: 'Alice', timestamp: '14:30:02', text: 'hey, ready when you are' },
        { speaker: 'Wesley', timestamp: '14:30:05', text: "yep, let's go" },
      ],
    });

    expect(result).toBe(
`---
date: 2026-05-06
time: 14:30
type: meeting
participants: ["[[Alice]]", "[[Wesley]]"]
source: google-meet
---

# Meeting — 2026-05-06 14:30

**[[Alice]]** [14:30:02] — hey, ready when you are
**[[Wesley]]** [14:30:05] — yep, let's go
`);
  });

  it('deduplicates participants while preserving order of first appearance', () => {
    const result = formatTranscript({
      startedAt: new Date('2026-05-06T14:30:00'),
      entries: [
        { speaker: 'Alice', timestamp: '14:30:02', text: 'hi' },
        { speaker: 'Wesley', timestamp: '14:30:05', text: 'hello' },
        { speaker: 'Alice', timestamp: '14:30:10', text: 'how are you' },
      ],
    });

    expect(result).toContain('participants: ["[[Alice]]", "[[Wesley]]"]');
  });

  it('renders an empty-transcript fallback when no captions captured', () => {
    const result = formatTranscript({
      startedAt: new Date('2026-05-06T14:30:00'),
      entries: [],
    });

    expect(result).toContain('participants: []');
    expect(result).toContain('_No captions were captured during this meeting._');
  });

  it('escapes double-quotes in speaker names so frontmatter stays valid', () => {
    const result = formatTranscript({
      startedAt: new Date('2026-05-06T14:30:00'),
      entries: [
        { speaker: 'Alice "Ace" Smith', timestamp: '14:30:02', text: 'hi' },
      ],
    });

    expect(result).toContain('participants: ["[[Alice \\"Ace\\" Smith]]"]');
  });

  it('pads single-digit dates and times correctly', () => {
    const result = formatTranscript({
      startedAt: new Date('2026-01-03T09:05:00'),
      entries: [],
    });

    expect(result).toContain('date: 2026-01-03');
    expect(result).toContain('time: 09:05');
    expect(result).toContain('# Meeting — 2026-01-03 09:05');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: All five tests fail with "formatTranscript is not a function" or "Cannot find module".

- [ ] **Step 3: Implement `formatTranscript`**

Create `src/lib/markdown.js`:

```js
const pad2 = (n) => String(n).padStart(2, '0');

function formatDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatTime(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function escapeYamlString(s) {
  return s.replace(/"/g, '\\"');
}

function uniqueSpeakers(entries) {
  const seen = new Set();
  const ordered = [];
  for (const e of entries) {
    if (!seen.has(e.speaker)) {
      seen.add(e.speaker);
      ordered.push(e.speaker);
    }
  }
  return ordered;
}

export function formatTranscript({ startedAt, entries }) {
  const date = formatDate(startedAt);
  const time = formatTime(startedAt);
  const participants = uniqueSpeakers(entries)
    .map((s) => `"[[${escapeYamlString(s)}]]"`)
    .join(', ');

  const frontmatter =
`---
date: ${date}
time: ${time}
type: meeting
participants: [${participants}]
source: google-meet
---`;

  const heading = `# Meeting — ${date} ${time}`;

  const body = entries.length === 0
    ? '_No captions were captured during this meeting._'
    : entries
        .map((e) => `**[[${e.speaker}]]** [${e.timestamp}] — ${e.text}`)
        .join('\n');

  return `${frontmatter}\n\n${heading}\n\n${body}\n`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All five tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/markdown.test.js src/lib/markdown.js
git commit -m "feat(markdown): transcript-to-markdown formatter with frontmatter and wikilinks"
```

---

## Task 3: Filename generation (TDD)

**Files:**
- Create: `tests/filename.test.js`
- Create: `src/lib/filename.js`

- [ ] **Step 1: Write failing tests for `buildFilename` and `resolveCollision`**

Create `tests/filename.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildFilename, resolveCollision } from '../src/lib/filename.js';

describe('buildFilename', () => {
  it('formats as "YYYY-MM-DD HHMM Meeting.md"', () => {
    expect(buildFilename(new Date('2026-05-06T14:30:00'))).toBe('2026-05-06 1430 Meeting.md');
  });

  it('zero-pads single-digit hours/minutes', () => {
    expect(buildFilename(new Date('2026-01-03T09:05:00'))).toBe('2026-01-03 0905 Meeting.md');
  });
});

describe('resolveCollision', () => {
  it('returns the original name when not taken', () => {
    const exists = (name) => false;
    expect(resolveCollision('foo.md', exists)).toBe('foo.md');
  });

  it('appends " (2)" when the original is taken', () => {
    const taken = new Set(['foo.md']);
    const exists = (name) => taken.has(name);
    expect(resolveCollision('foo.md', exists)).toBe('foo (2).md');
  });

  it('walks up the suffix chain', () => {
    const taken = new Set(['foo.md', 'foo (2).md', 'foo (3).md']);
    const exists = (name) => taken.has(name);
    expect(resolveCollision('foo.md', exists)).toBe('foo (4).md');
  });

  it('handles a "(recovered)" suffix correctly', () => {
    const exists = (name) => false;
    expect(resolveCollision('foo (recovered).md', exists)).toBe('foo (recovered).md');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: 5 new failures alongside passing markdown tests.

- [ ] **Step 3: Implement `filename.js`**

Create `src/lib/filename.js`:

```js
const pad2 = (n) => String(n).padStart(2, '0');

export function buildFilename(date) {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const min = pad2(date.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}${min} Meeting.md`;
}

export function resolveCollision(name, exists) {
  if (!exists(name)) return name;
  const dotIdx = name.lastIndexOf('.');
  const stem = dotIdx === -1 ? name : name.slice(0, dotIdx);
  const ext = dotIdx === -1 ? '' : name.slice(dotIdx);
  let i = 2;
  while (exists(`${stem} (${i})${ext}`)) i += 1;
  return `${stem} (${i})${ext}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests pass (markdown + filename).

- [ ] **Step 5: Commit**

```bash
git add tests/filename.test.js src/lib/filename.js
git commit -m "feat(filename): filename generation with collision resolution"
```

---

## Task 4: MV3 manifest

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "MeetMD",
  "version": "0.1.0",
  "description": "Capture Google Meet captions and save them as markdown in your Obsidian vault.",
  "permissions": ["storage", "tabs"],
  "host_permissions": ["https://meet.google.com/*"],
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["src/capture/content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_title": "MeetMD"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add manifest.json
git commit -m "feat: add MV3 manifest"
```

---

## Task 5: Vendor TranscripTonic capture module

**Files:**
- Create: `src/capture/content.js` (adapted from TranscripTonic)
- Create: `src/capture/CAPTURE.md`

This task is larger because it requires reading external code. Plan: clone TranscripTonic locally, study their `content.js`, copy the caption-scraping core, strip out their save/UI logic, and replace it with our messaging contract.

- [ ] **Step 1: Clone TranscripTonic into a temporary location and record the head SHA**

```bash
cd /tmp && rm -rf transcriptonic && git clone https://github.com/vivek-nexus/transcriptonic.git
cd transcriptonic && git log -1 --format='%H' > /tmp/transcriptonic-sha.txt
cat /tmp/transcriptonic-sha.txt
```

Expected: a 40-character SHA printed.

- [ ] **Step 2: Read TranscripTonic's content script**

Read `/tmp/transcriptonic/extension/chromium/content.js` (path may differ — search the repo with `find . -name content.js`). Identify:
- Caption container DOM selector(s)
- MutationObserver setup
- Speaker-name extraction logic
- Call-start and call-end detection signals
- Auto-enable-captions logic (if present)

Take notes; you'll port the *capture* parts and discard their save/UI/storage logic.

- [ ] **Step 3: Create `src/capture/content.js`**

Adapt the lifted capture logic to emit messages per our contract. Skeleton structure (fill in the DOM specifics from TranscripTonic):

```js
// src/capture/content.js
// Vendored caption-capture from TranscripTonic. See CAPTURE.md for upstream SHA.

const state = {
  startedAt: null,
  entries: [],
  observer: null,
  checkpointTimer: null,
  inCall: false,
};

function emit(message) {
  chrome.runtime.sendMessage(message);
}

function detectCallStart() {
  // PORT FROM TRANSCRIPTONIC: detect when the Meet call screen renders.
  // Typically a poll for a known selector (e.g. the leave-call button).
  // When detected, call onCallStart().
}

function onCallStart() {
  if (state.inCall) return;
  state.inCall = true;
  state.startedAt = new Date();
  state.entries = [];
  emit({ type: 'CALL_STARTED', tabId: null, startedAt: state.startedAt.toISOString() });
  enableCaptionsIfNeeded();
  attachCaptionObserver();
  state.checkpointTimer = setInterval(checkpoint, 30_000);
  watchForLeaveCall();
}

function enableCaptionsIfNeeded() {
  // PORT FROM TRANSCRIPTONIC: click the captions toggle button if captions are off.
  // If TranscripTonic doesn't auto-enable, find the captions button by aria-label
  // ("Turn on captions") and click it once.
}

function attachCaptionObserver() {
  // PORT FROM TRANSCRIPTONIC: locate the caption container and observe child mutations.
  // For each new caption, parse: { speaker, text } and append with the current timestamp.
  // Use HH:MM:SS format for timestamps (formatTimestamp below).
}

function appendEntry(speaker, text) {
  const timestamp = formatTimestamp(new Date());
  const entry = { speaker, timestamp, text };
  state.entries.push(entry);
  emit({ type: 'CAPTION', tabId: null, entry });
}

function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function checkpoint() {
  if (!state.inCall) return;
  emit({
    type: 'CHECKPOINT',
    tabId: null,
    transcript: state.entries,
    startedAt: state.startedAt.toISOString(),
  });
}

function watchForLeaveCall() {
  // PORT FROM TRANSCRIPTONIC: observe for the leave-call signal.
  // When detected, call onCallEnd().
  // Also handle beforeunload as a fallback.
  window.addEventListener('beforeunload', onCallEnd);
}

function onCallEnd() {
  if (!state.inCall) return;
  state.inCall = false;
  if (state.checkpointTimer) clearInterval(state.checkpointTimer);
  if (state.observer) state.observer.disconnect();
  emit({
    type: 'CALL_ENDED',
    tabId: null,
    transcript: state.entries,
    startedAt: state.startedAt.toISOString(),
  });
}

detectCallStart();
```

- [ ] **Step 4: Create `src/capture/CAPTURE.md`**

```markdown
# Capture Module

The caption-scraping logic in `content.js` is vendored from
[vivek-nexus/transcriptonic](https://github.com/vivek-nexus/transcriptonic).

## Upstream

- Source: https://github.com/vivek-nexus/transcriptonic
- File: `extension/chromium/content.js` (path may shift; verify when re-porting)
- Vendored at commit: `<PASTE SHA FROM /tmp/transcriptonic-sha.txt>`
- Vendored on: 2026-05-06

## What was lifted

- Caption container DOM selector and MutationObserver setup
- Speaker-name extraction logic
- Call-start and call-end DOM detection
- Auto-enable-captions click

## What was rewritten

- All save/UI/storage logic (TranscripTonic writes its own files; we send messages
  to our background worker per `docs/superpowers/specs/2026-05-06-meetmd-design.md`)
- Message format follows the contract in the design spec

## Re-porting upstream fixes

When Google Meet changes its caption DOM (the most likely break), check
TranscripTonic's recent commits:

```
git -C /tmp/transcriptonic pull
git -C /tmp/transcriptonic log --oneline <our-sha>..HEAD
```

Diff their `content.js` against ours, port the selector or observer changes,
update the commit SHA and date in this file.
```

- [ ] **Step 5: Manual smoke test**

Load the extension unpacked in Chrome (`chrome://extensions` → Developer Mode → Load unpacked → `~/Workspace/MeetMD`). Open a test Google Meet call. Open DevTools on the Meet tab. In the console, check that messages are being sent:

```js
chrome.runtime.onMessage.addListener((m) => console.log('msg', m));
```

Expected: `CALL_STARTED`, then `CAPTION` events as people speak, then `CALL_ENDED` on leave.

If captions don't fire: walk back through the DOM selectors in `content.js` against the live Meet DOM. This is the brittle part — expect to iterate.

- [ ] **Step 6: Commit**

```bash
git add src/capture/content.js src/capture/CAPTURE.md
git commit -m "feat(capture): vendor caption-capture from TranscripTonic"
```

---

## Task 6: Filesystem wrapper

**Files:**
- Create: `src/lib/filesystem.js`

This wraps the File System Access API. Pure browser API, no unit tests (would require mocking the entire API surface). Manual verification via the popup in Task 7.

- [ ] **Step 1: Create `src/lib/filesystem.js`**

```js
// File System Access API wrapper. Stores the granted folder handle in
// chrome.storage.local for re-use across sessions.

const STORAGE_KEY = 'meetmd:vaultFolderHandle';
const STORAGE_KEY_NAME = 'meetmd:vaultFolderName';

export async function pickVaultFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await persistHandle(handle);
  return handle;
}

async function persistHandle(handle) {
  await chrome.storage.local.set({
    [STORAGE_KEY]: handle,
    [STORAGE_KEY_NAME]: handle.name,
  });
}

export async function getStoredVaultFolder() {
  const result = await chrome.storage.local.get([STORAGE_KEY, STORAGE_KEY_NAME]);
  return {
    handle: result[STORAGE_KEY] || null,
    name: result[STORAGE_KEY_NAME] || null,
  };
}

export async function ensurePermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

export async function listExistingNames(handle) {
  const names = new Set();
  for await (const entry of handle.values()) {
    names.add(entry.name);
  }
  return names;
}

export async function writeFile(handle, filename, content) {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/filesystem.js
git commit -m "feat(filesystem): File System Access API wrapper"
```

---

## Task 7: Popup UI (folder picker)

**Files:**
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.js`

- [ ] **Step 1: Create `src/popup/popup.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>MeetMD</title>
  <style>
    body { font-family: -apple-system, sans-serif; width: 280px; padding: 16px; margin: 0; }
    h1 { font-size: 14px; margin: 0 0 12px; }
    button { width: 100%; padding: 8px; font-size: 13px; cursor: pointer; }
    .status { font-size: 12px; color: #555; margin: 8px 0; }
    .status strong { color: #000; }
    .row { display: flex; gap: 8px; align-items: center; }
  </style>
</head>
<body>
  <h1>MeetMD</h1>
  <div class="status" id="status">Loading…</div>
  <button id="pickBtn">Pick your Meetings folder</button>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `src/popup/popup.js`**

```js
import { pickVaultFolder, getStoredVaultFolder, ensurePermission } from '../lib/filesystem.js';

const statusEl = document.getElementById('status');
const pickBtn = document.getElementById('pickBtn');

async function refresh() {
  const { handle, name } = await getStoredVaultFolder();
  if (!handle) {
    statusEl.textContent = 'No vault folder picked yet.';
    pickBtn.textContent = 'Pick your Meetings folder';
    return;
  }
  const ok = await ensurePermission(handle);
  if (ok) {
    statusEl.innerHTML = `Saving to: <strong>${name}</strong>`;
    pickBtn.textContent = 'Change folder';
  } else {
    statusEl.textContent = `Permission lost for "${name}". Re-grant access:`;
    pickBtn.textContent = 'Re-grant access';
  }
}

pickBtn.addEventListener('click', async () => {
  try {
    await pickVaultFolder();
    await refresh();
  } catch (err) {
    if (err.name !== 'AbortError') {
      statusEl.textContent = `Error: ${err.message}`;
    }
  }
});

refresh();
```

- [ ] **Step 3: Manual test**

Reload the extension in `chrome://extensions`. Click the MeetMD toolbar icon. Verify:
- Initial state shows "No vault folder picked yet."
- Clicking the button opens the OS folder picker.
- After picking a folder, status shows "Saving to: `<folder name>`".
- Closing and reopening the popup persists the state.

- [ ] **Step 4: Commit**

```bash
git add src/popup/popup.html src/popup/popup.js
git commit -m "feat(popup): folder picker UI with persisted handle"
```

---

## Task 8: Background service worker (coordinator + recovery)

**Files:**
- Create: `src/background/service-worker.js`

- [ ] **Step 1: Create `src/background/service-worker.js`**

```js
import { formatTranscript } from '../lib/markdown.js';
import { buildFilename, resolveCollision } from '../lib/filename.js';
import {
  getStoredVaultFolder,
  ensurePermission,
  listExistingNames,
  writeFile,
} from '../lib/filesystem.js';

const DRAFT_KEY_PREFIX = 'meetmd:draft:';

// In-memory map of tabId -> { startedAt, entries }. Service workers can be
// killed at any time, so we also persist drafts to chrome.storage.local on
// every CHECKPOINT and CAPTION.
const tabState = new Map();

chrome.runtime.onMessage.addListener((message, sender) => {
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
  if (!s) return;

  const startedAt = new Date(s.startedAt);
  const markdown = formatTranscript({ startedAt, entries: s.entries });

  let filename = buildFilename(startedAt);
  if (recovered) {
    filename = filename.replace(/\.md$/, ' (recovered).md');
  }

  const ok = await tryWrite(filename, markdown);
  if (ok) await clearDraft(tabId);
  // If write failed, leave the draft in place — it'll be retried at next
  // service-worker startup or recovered on next install.
}

async function tryWrite(filename, content) {
  const { handle } = await getStoredVaultFolder();
  if (!handle) return false;
  if (!(await ensurePermission(handle))) return false;

  const existing = await listExistingNames(handle);
  const finalName = resolveCollision(filename, (n) => existing.has(n));
  await writeFile(handle, finalName, content);
  return true;
}

// Recovery on service-worker startup: scan for orphan drafts and write them
// as "(recovered)" files.
async function recoverOrphanDrafts() {
  const all = await chrome.storage.local.get(null);
  const orphanKeys = Object.keys(all).filter((k) => k.startsWith(DRAFT_KEY_PREFIX));

  for (const key of orphanKeys) {
    const tabId = key.slice(DRAFT_KEY_PREFIX.length);
    const s = all[key];
    if (!s || !s.startedAt) continue;

    tabState.set(tabId, s);
    await saveAndClear(tabId, /* recovered */ true);
  }
}

recoverOrphanDrafts();
```

- [ ] **Step 2: Manual test — happy path**

Reload extension. Join a Meet call. Speak/let captions accumulate. Leave the call. Verify:
- A `YYYY-MM-DD HHMM Meeting.md` file appears in the chosen vault folder.
- File contents match the spec format (frontmatter, heading, speaker lines).

- [ ] **Step 3: Manual test — recovery path**

Join a Meet call, let a few captions appear. Force-quit Chrome (Cmd+Q). Reopen Chrome. Verify:
- Within a few seconds of opening, a `YYYY-MM-DD HHMM Meeting (recovered).md` appears in the vault folder.
- The orphan draft key is gone from `chrome.storage.local` (check via DevTools → Application → Storage).

- [ ] **Step 4: Commit**

```bash
git add src/background/service-worker.js
git commit -m "feat(background): coordinator with checkpointing and crash recovery"
```

---

## Task 9: Wire content-script tabId routing

**Files:**
- Modify: `src/capture/content.js`

The current content.js sends `tabId: null` because content scripts don't know their own tab ID. The background worker reads `sender.tab.id` instead, so the `tabId: null` field in the message is redundant. Clean up.

- [ ] **Step 1: Remove `tabId` from content-script messages**

Edit `src/capture/content.js`. In every `emit({ ... })` call, remove the `tabId: null` field. The background worker doesn't read it.

After cleanup, message shapes should match:
- `{ type: 'CALL_STARTED', startedAt }`
- `{ type: 'CAPTION', entry }`
- `{ type: 'CHECKPOINT', transcript, startedAt }`
- `{ type: 'CALL_ENDED', transcript, startedAt }`

- [ ] **Step 2: Manual smoke test**

Reload the extension. Join a quick test Meet call. Verify the file still saves correctly. (No behavioral change expected — purely a cleanup.)

- [ ] **Step 3: Commit**

```bash
git add src/capture/content.js
git commit -m "refactor(capture): drop redundant tabId from messages"
```

---

## Task 10: Manual test plan + final smoke

**Files:**
- Create: `TESTING.md`

- [ ] **Step 1: Create `TESTING.md`**

```markdown
# MeetMD — Manual Test Checklist

Run this before each release. Not all scenarios apply to v1; skip what's not relevant.

## Setup

- [ ] Fresh install: load unpacked, popup says "No vault folder picked yet."
- [ ] Pick a folder: status updates to "Saving to: <name>".
- [ ] Reopen popup: status persists across browser sessions.

## Standard meeting

- [ ] Join a Meet call. Captions auto-enable if they were off.
- [ ] Speak; observe captions in Meet.
- [ ] Leave the call.
- [ ] Vault folder contains a new file `YYYY-MM-DD HHMM Meeting.md`.
- [ ] File has correct frontmatter (date, time, type, participants, source).
- [ ] File body has speaker wikilinks and timestamps.

## Edge cases

- [ ] Captions never enabled: file is written with the empty-transcript fallback message.
- [ ] Two meetings starting in the same minute: second file gets ` (2)` suffix.
- [ ] Two concurrent meetings in different tabs: both transcripts saved independently with no cross-talk.
- [ ] Browser force-quit mid-call: on next browser start, a `(recovered).md` appears.
- [ ] Vault folder permission lost (toggle in chrome://settings): popup shows re-grant prompt; transcript queues until permission restored.
- [ ] Speaker name with double-quotes: frontmatter remains valid YAML (escaped).

## Re-port scenario (when Meet changes its DOM)

- [ ] Captures suddenly stop firing in console.
- [ ] Pull TranscripTonic upstream, diff against vendored `content.js`, port fixes.
- [ ] Update `src/capture/CAPTURE.md` with new SHA and date.
```

- [ ] **Step 2: Run through the full checklist for the first time**

Walk through every checklist item. Note any that fail. Decide per-item whether to fix now or document as a known issue in `README.md`.

- [ ] **Step 3: Commit**

```bash
git add TESTING.md
git commit -m "docs: add manual test checklist"
```

- [ ] **Step 4: Push to GitHub**

```bash
cd ~/Workspace/MeetMD
git remote add origin https://github.com/wesngyvr-lab/MeetMD.git
git push -u origin main
```

Expected: push succeeds, branch tracks `origin/main`.

---

## Self-Review

**Spec coverage:**

| Spec section | Plan task |
|---|---|
| Goals — zero-friction, vault folder, vault-native, local-only | Tasks 4–8 collectively |
| Architecture — content script (lifted) | Task 5 |
| Architecture — background coordinator with checkpointing | Task 8 |
| Architecture — File System Access API save layer | Tasks 6, 7, 8 |
| Note shape — frontmatter + wikilinks + format | Task 2 |
| Filename + collision | Task 3 |
| Lifecycle — call start, captions, checkpoint, end, recovery | Tasks 5, 8 |
| Setup flow — popup folder picker | Task 7 |
| Error handling — captions never enabled | Task 2 (empty fallback) + verified in Task 10 |
| Error handling — permission lost | Task 6 (`ensurePermission`) + Task 7 popup UI |
| Error handling — concurrent meetings | Task 8 (per-tab state) |
| Error handling — browser crash | Task 8 (recovery) + Task 10 (verification) |
| Error handling — filename collision | Task 3 + Task 8 (`tryWrite`) |
| Repo layout | All tasks (paths match) |
| Testing — formatter unit tests | Task 2 |
| Testing — manual TESTING.md | Task 10 |
| Distribution — load unpacked v1 | README in Task 1 |
| License — MIT | Task 1 |

All spec sections have at least one corresponding task.

**Placeholder scan:** No "TBD", no "implement later", no naked "add error handling" without code. The capture-module skeleton in Task 5 has explicit `PORT FROM TRANSCRIPTONIC` comments — these are deliberate flags for code the engineer must lift from a specific external source, not abstract handwaves.

**Type consistency:** `formatTranscript` signature `({ startedAt, entries })` is used identically in Task 2 (definition), Task 8 (call site). `buildFilename(date)` and `resolveCollision(name, exists)` signatures match across Tasks 3 and 8. Message contract is consistent across Tasks 5, 8, 9.
