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
