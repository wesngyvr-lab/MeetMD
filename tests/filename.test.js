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
