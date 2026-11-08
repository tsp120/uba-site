// Imports the old site's news stories from a phpMyAdmin/mysqldump export of the MySQL database.
// Usage: node tools/import-news-sql.mjs path/to/export.sql [--only-custom]
//   --only-custom  skip stories that are just copies of Strat game stories (the new site shows those automatically)
import fs from 'node:fs';
import path from 'node:path';

const [file, flag] = process.argv.slice(2);
if (!file) { console.error('usage: node tools/import-news-sql.mjs export.sql [--only-custom]'); process.exit(1); }
const sql = fs.readFileSync(file, 'utf8');
const out = path.resolve('data/news'); fs.mkdirSync(out, { recursive: true });

// Column order from the CREATE TABLE (falls back to the old site's id,title,img,news,date).
const create = sql.match(/CREATE TABLE `?news`?\s*\(([\s\S]*?)\)\s*(ENGINE|;)/i);
const cols = create ? [...create[1].matchAll(/^\s*`(\w+)`/gm)].map((m) => m[1]) : ['id', 'title', 'img', 'news', 'date'];

function parseValues(s, i) { // returns [rows, endIndex]; handles quotes and backslash escapes
  const rows = []; let row = null; let val = ''; let inStr = false; let quoted = false;
  for (; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') { const n = s[++i]; val += { n: '\n', r: '\r', t: '\t', 0: '\0' }[n] ?? n; }
      else if (c === "'" && s[i + 1] === "'") { val += "'"; i++; }
      else if (c === "'") inStr = false; else val += c;
      continue;
    }
    if (c === "'") { inStr = true; quoted = true; val = ''; }
    else if (c === '(' && !row) { row = []; val = ''; quoted = false; }
    else if ((c === ',' || c === ')') && row) { const v = val.trim(); row.push(quoted ? val : v === 'NULL' ? null : v); val = ''; quoted = false; if (c === ')') { rows.push(row); row = null; } }
    else if (c === ';' && !row) return [rows, i];
    else if (row) val += c;
  }
  return [rows, i];
}
const rows = [];
const re = /INSERT INTO `?news`?\s*(\(([^)]*)\))?\s*VALUES\s*/gi; let m;
while ((m = re.exec(sql))) {
  const c = m[2] ? m[2].split(',').map((x) => x.trim().replace(/`/g, '')) : cols;
  const [r, end] = parseValues(sql, re.lastIndex); re.lastIndex = end;
  for (const v of r) rows.push(Object.fromEntries(c.map((k, i) => [k, v[i]])));
}
const toText = (html) => String(html || '').replace(/<\/p>\s*<p>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\(['"])/g, '$1').trim();
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'story';
const gameStory = /\b(beat|defeated|outscored|edged|downed|topped|blanked|shut out|by the (score|count) of)\b/i;
let n = 0, skipped = 0;
for (const r of rows) {
  const body = toText(r.news); const title = toText(r.title).replace(/"/g, "'");
  if (!title || !body) continue;
  if (flag === '--only-custom' && gameStory.test(body.split('\n')[0])) { skipped++; continue; }
  const date = String(r.date || '').slice(0, 10) || '2000-01-01';
  const img = /^https?:\/\//.test(r.img || '') ? r.img.replace(/^http:/, 'https:') : '';
  fs.writeFileSync(path.join(out, `${date}-${r.id}-${slug(title)}.md`), `---\ntitle: "${title}"\ndate: ${date}\n${img ? `image: ${img}\n` : ''}legacyId: ${r.id}\n---\n${body}\n`);
  n++;
}
console.log(`Imported ${n} stories into data/news${skipped ? ` (skipped ${skipped} game-story copies)` : ''}.`);
