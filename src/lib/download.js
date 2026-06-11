// Service workers can't use URL.createObjectURL, so transcripts are passed to
// chrome.downloads as base64 data: URLs. btoa() only accepts latin1, so UTF-8
// bytes are mapped through String.fromCharCode in chunks (spreading a full
// multi-MB array would blow the argument limit).
export function textToDataUrl(text, mime = 'text/markdown') {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}
