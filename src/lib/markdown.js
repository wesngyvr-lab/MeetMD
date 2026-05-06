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
