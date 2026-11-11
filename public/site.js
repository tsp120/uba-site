// Sortable tables: click a header. Numbers sort high-to-low first.
document.addEventListener('click', (e) => {
  const th = e.target.closest('table.sortable th'); if (!th) return;
  const table = th.closest('table'); const idx = [...th.parentNode.children].indexOf(th);
  const body = table.tBodies[0]; const rows = [...body.rows];
  const val = (r) => { const c = r.cells[idx]; const v = (c?.dataset.v ?? c?.textContent ?? '').trim(); const n = parseFloat(v.replace(/[$,+]/g, '')); return v === '' || v === '-' ? -Infinity : (isNaN(n) || /[a-z]{2}/i.test(v) && !/^[.\d]/.test(v) ? v.toLowerCase() : n); };
  const isNum = rows.some((r) => typeof val(r) === 'number' && val(r) !== -Infinity);
  const cur = th.getAttribute('aria-sort'); const dir = cur ? (cur === 'descending' ? 1 : -1) : (isNum && !th.dataset.asc ? -1 : 1);
  table.querySelectorAll('th').forEach((h) => h.removeAttribute('aria-sort')); th.setAttribute('aria-sort', dir === -1 ? 'descending' : 'ascending');
  rows.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; }).forEach((r) => body.appendChild(r));
});
// Phone menu: the hamburger opens the site nav under the masthead.
(() => {
  const btn = document.getElementById('navbtn'); const nav = document.getElementById('mainnav'); if (!btn || !nav) return;
  const set = (open) => { btn.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('navopen', open); btn.querySelector('.lbl').textContent = open ? 'Close' : 'Menu'; btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); };
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('navopen')) { set(false); btn.focus(); } });
  document.addEventListener('click', (e) => { if (document.body.classList.contains('navopen') && !e.target.closest('.mast')) set(false); });
})();
// Live filter for any input[data-filter="#tableId"]
document.querySelectorAll('input[data-filter]').forEach((inp) => inp.addEventListener('input', () => {
  const q = inp.value.trim().toLowerCase(); document.querySelectorAll(inp.dataset.filter + ' tbody tr').forEach((r) => { r.style.display = !q || r.textContent.toLowerCase().includes(q) ? '' : 'none'; });
}));
