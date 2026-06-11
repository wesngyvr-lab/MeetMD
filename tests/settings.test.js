import { describe, it, expect } from 'vitest';
import { sanitizeSubfolder } from '../src/lib/settings.js';

describe('sanitizeSubfolder', () => {
  it('passes a plain folder name through', () => {
    expect(sanitizeSubfolder('MeetMD')).toBe('MeetMD');
  });

  it('trims whitespace and slashes', () => {
    expect(sanitizeSubfolder('  /MeetMD/Calls/  ')).toBe('MeetMD/Calls');
  });

  it('allows nested subfolders', () => {
    expect(sanitizeSubfolder('Meetings/2026')).toBe('Meetings/2026');
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(sanitizeSubfolder('Meetings\\2026')).toBe('Meetings/2026');
  });

  it('strips path traversal segments', () => {
    expect(sanitizeSubfolder('../../etc')).toBe('etc');
    expect(sanitizeSubfolder('a/./b/../c')).toBe('a/b/c');
  });

  it('removes characters illegal in filenames', () => {
    expect(sanitizeSubfolder('Meet<MD>: "v2"?*|')).toBe('MeetMD v2');
  });

  it('returns empty string for empty or all-invalid input', () => {
    expect(sanitizeSubfolder('')).toBe('');
    expect(sanitizeSubfolder('  ')).toBe('');
    expect(sanitizeSubfolder('/../..')).toBe('');
    expect(sanitizeSubfolder(undefined)).toBe('');
  });
});
