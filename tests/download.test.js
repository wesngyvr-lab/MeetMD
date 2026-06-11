import { describe, it, expect } from 'vitest';
import { textToDataUrl } from '../src/lib/download.js';

function decodeDataUrl(url) {
  const base64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

describe('textToDataUrl', () => {
  it('produces a markdown data URL', () => {
    const url = textToDataUrl('# Hello');
    expect(url).toMatch(/^data:text\/markdown;base64,/);
  });

  it('round-trips plain ASCII', () => {
    const text = '# Meeting\n\n**Wesley:** hello there\n';
    expect(decodeDataUrl(textToDataUrl(text))).toBe(text);
  });

  it('round-trips non-ASCII (CJK, emoji, accents)', () => {
    const text = '李小姐: 你好 👋 — café naïve\n';
    expect(decodeDataUrl(textToDataUrl(text))).toBe(text);
  });

  it('round-trips a large transcript (>1MB)', () => {
    const text = '**Speaker:** caption line with some 中文 text\n'.repeat(30000);
    expect(decodeDataUrl(textToDataUrl(text))).toBe(text);
  });

  it('handles empty content', () => {
    expect(decodeDataUrl(textToDataUrl(''))).toBe('');
  });
});
