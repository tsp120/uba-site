// Tiny, safe Markdown: escapes all HTML first, then adds paragraphs, **bold**, *italic*, [links](https://...) and ## headings.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2">$1</a>');
export const md = (src) => esc(String(src)).split(/\n\s*\n/).map((b) => {
  const t = b.trim(); if (!t) return '';
  const h = t.match(/^(#{2,4})\s+(.*)$/); if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
  if (/^[-*] /m.test(t) && t.split('\n').every((l) => /^[-*] /.test(l))) return '<ul>' + t.split('\n').map((l) => `<li>${inline(l.slice(2))}</li>`).join('') + '</ul>';
  return `<p>${inline(t).replace(/\n/g, '<br>')}</p>`;
}).join('\n');
