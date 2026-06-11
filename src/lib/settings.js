export const SUBFOLDER_KEY = 'meetmd:subfolder';
export const DEFAULT_SUBFOLDER = 'MeetMD';

// chrome.downloads rejects filenames with traversal segments or characters
// illegal on the host OS — and a rejected download means a lost transcript,
// so sanitize at input time rather than save time.
export function sanitizeSubfolder(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.replace(/[<>:"|?*\x00-\x1f]/g, '').trim())
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
}

// Empty string is a valid stored value meaning "Downloads root"; only fall
// back to the default when the setting has never been saved.
export async function getSubfolder() {
  const stored = await chrome.storage.local.get(SUBFOLDER_KEY);
  const value = stored[SUBFOLDER_KEY];
  if (value === undefined) return DEFAULT_SUBFOLDER;
  return sanitizeSubfolder(value);
}
