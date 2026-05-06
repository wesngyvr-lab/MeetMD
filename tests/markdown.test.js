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
