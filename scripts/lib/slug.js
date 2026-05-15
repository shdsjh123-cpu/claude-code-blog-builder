export function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function keywordSlug(keyword) {
  return String(keyword || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function outputFolderForKeyword(keyword, date = new Date()) {
  return `output/${localDateString(date)}_${keywordSlug(keyword)}`;
}
