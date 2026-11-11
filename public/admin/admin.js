// Commish admin page. Talks only to /api/* on this site; the server re-checks everything.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { credentials: 'same-origin', ...opts, headers: { 'X-UBA': '1', ...(opts.json ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) }, body: opts.json ? JSON.stringify(opts.json) : opts.body });
  const j = await r.json().catch(() => ({ error: `Server error (${r.status})` }));
  if (r.status === 401 && path !== '/login') { show(false); throw new Error('Please log in again'); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const live = (c) => c ? ` <a href="${esc(c.url)}" target="_blank" rel="noopener">view change</a>. The site updates in ~2 minutes.` : '';
function show(authed) { $('#login').hidden = authed; $('#app').hidden = !authed; $('#who').innerHTML = authed ? '<button class="btn" id="logout">Log out</button>' : ''; if (authed) $('#logout').onclick = async () => { await api('/logout', { method: 'POST' }); show(false); }; }

$('#loginForm').onsubmit = async (e) => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await api('/login', { method: 'POST', json: { password: $('#pw').value } }); $('#pw').value = ''; show(true); loadAll(); } catch (err) { $('#loginErr').textContent = err.message; }
};
document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('[data-pane]').forEach((p) => p.hidden = p.dataset.pane !== b.dataset.tab);
});

// ---------- Publish ----------
let queue = []; // {file, plan}
async function addFiles(list) {
  const files = [...list].filter((f) => f.size > 0 && !queue.some((q) => q.file.name === f.name && q.file.size === f.size));
  if (!files.length) return;
  const { plan } = await api('/plan', { method: 'POST', json: { names: files.map((f) => f.name) } });
  files.forEach((f, i) => queue.push({ file: f, plan: plan[i] }));
  renderPlan();
}
function renderPlan() {
  const use = queue.filter((q) => q.plan.dest), skip = queue.filter((q) => q.plan.skip), bad = queue.filter((q) => q.plan.error);
  const groups = {}; use.forEach((q) => (groups[q.plan.kind] ||= []).push(q));
  $('#plan').innerHTML = !queue.length ? '' : `<h3>Ready to publish: ${use.length} file(s)</h3>` +
    Object.entries(groups).map(([k, qs]) => `<p><span class="tag">${esc(qs[0].plan.kind === 'download' ? 'Files page' : qs[0].plan.label.replace(/:.*|\s\d.*/, ''))}</span>${qs.length > 6 && k !== 'download' ? `${qs.length} files` : qs.map((q) => esc(q.plan.label.includes(':') || q.plan.kind === 'newspaper' ? q.plan.label : q.file.name)).join(', ')}</p>` +
      (k === 'download' ? qs.map((q) => `<label class="small">Title for <code>${esc(q.file.name)}</code> <input data-title="${esc(q.file.name)}" value="${esc(q.file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '))}" /></label>`).join('') : '')).join('') +
    (skip.length ? `<p class="skip small">Ignored (not needed by the site): ${skip.length} file(s)</p>` : '') +
    (bad.length ? `<p class="bad small">Not accepted: ${bad.map((q) => `${esc(q.file.name)} (${esc(q.plan.error)})`).join(', ')}</p>` : '');
  $('#pubbar').hidden = !use.length;
}
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', async (e) => {
  const items = [...(e.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!items.length) return addFiles(e.dataTransfer.files).catch((x) => alert(x.message));
  const out = []; const walk = async (en) => { if (en.isFile) out.push(await new Promise((r) => en.file(r))); else { const rd = en.createReader(); let batch; do { batch = await new Promise((r) => rd.readEntries(r)); for (const c of batch) await walk(c); } while (batch.length); } };
  for (const it of items) await walk(it);
  addFiles(out).catch((x) => alert(x.message));
});
$('#pickFiles').onchange = (e) => addFiles(e.target.files).catch((x) => alert(x.message));
$('#pickDir').onchange = (e) => addFiles(e.target.files).catch((x) => alert(x.message));
$('#clearPlan').onclick = () => { queue = []; renderPlan(); $('#result').innerHTML = ''; };
$('#publish').onclick = async () => {
  const use = queue.filter((q) => q.plan.dest);
  const titles = Object.fromEntries([...document.querySelectorAll('[data-title]')].map((i) => [i.dataset.title, i.value]));
  // Split into batches that stay well inside the server's limits.
  const batches = []; let cur = [], size = 0, bin = 0;
  for (const q of use) { const isBin = !['webbuilder', 'newspaper', 'report', 'realstats'].includes(q.plan.kind);
    if (cur.length && (size + q.file.size > 25e6 || (isBin && bin >= 30))) { batches.push(cur); cur = []; size = 0; bin = 0; }
    cur.push(q); size += q.file.size; if (isBin) bin++; }
  if (cur.length) batches.push(cur);
  $('#publish').disabled = true; const log = [];
  try {
    for (const [i, b] of batches.entries()) {
      $('#pubmsg').textContent = `Publishing${batches.length > 1 ? ` batch ${i + 1} of ${batches.length}` : ''}…`;
      const fd = new FormData(); b.forEach((q) => fd.append('files', q.file, q.file.name)); fd.append('titles', JSON.stringify(titles));
      const r = await api('/publish', { method: 'POST', body: fd });
      log.push(`<p class="ok">✔ Published ${r.committed} file(s).${live(r.commit)}</p>` + (r.errors?.length ? `<p class="bad">${r.errors.map(esc).join('<br>')}</p>` : ''));
    }
    queue = []; renderPlan(); loadFiles();
  } catch (err) { log.push(`<p class="bad">✖ ${esc(err.message)}</p>`); }
  $('#result').innerHTML = log.join(''); $('#pubmsg').textContent = ''; $('#publish').disabled = false;
};

// ---------- News ----------
async function loadNews() {
  const { posts } = await api('/news');
  $('#postList').innerHTML = posts.map((p) => `<li><a href="#" data-edit="${esc(p)}">${esc(p.replace(/\.md$/, ''))}</a> · <a href="#" class="bad" data-del="${esc(p)}">remove</a></li>`).join('') || '<li class="muted">None yet</li>';
}
$('#postList').onclick = async (e) => {
  const ed = e.target.dataset.edit, del = e.target.dataset.del; if (!ed && !del) return; e.preventDefault();
  if (del) { if (!confirm(`Remove "${del}"?`)) return; const r = await api('/news', { method: 'POST', json: { remove: del } }); $('#nMsg').innerHTML = `Removed.${live(r.commit)}`; return loadNews(); }
  const { text } = await api('/news/' + encodeURIComponent(ed)); const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/); const meta = {};
  (m ? m[1] : '').split('\n').forEach((l) => { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"(.*)"$/, '$1'); });
  $('#nFile').value = ed; $('#nTitle').value = meta.title || ''; $('#nDate').value = meta.date || ''; $('#nImage').value = meta.image || ''; $('#nBody').value = (m ? m[2] : text).trim();
  photo = null; $('#nPhoto').value = ''; preview(meta.image || '', meta.image ? 'Current photo' : ''); window.scrollTo(0, 0);
};
// ----- story photo: shrink in the browser (long side 1600px, JPEG) so uploads stay small and fast
let photo = null;
function preview(src, info) { $('#nPreview').hidden = !src; $('#nPreview img').src = src || ''; $('#nPhotoInfo').textContent = info || ''; }
async function shrink(file) {
  if (file.type === 'image/gif') return file; // keep animation
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That file could not be read as a picture')); i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  if (k === 1 && file.size < 900 * 1024) return file;
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return await new Promise((ok) => c.toBlob((b) => ok(b), 'image/jpeg', 0.86));
}
$('#nPhoto').onchange = async () => {
  const f = $('#nPhoto').files[0]; if (!f) return;
  try { photo = await shrink(f); $('#nImage').value = ''; preview(URL.createObjectURL(photo), `${f.name}, ${Math.round(photo.size / 1024)} KB after resizing`); }
  catch (err) { photo = null; $('#nPhoto').value = ''; $('#nMsg').innerHTML = `<span class="bad">${esc(err.message)}</span>`; }
};
$('#nImage').oninput = () => { if ($('#nImage').value) { photo = null; $('#nPhoto').value = ''; preview(/^https:\/\//.test($('#nImage').value) ? $('#nImage').value : '', 'Linked photo'); } else preview('', ''); };
$('#nNoPhoto').onclick = () => { photo = null; $('#nPhoto').value = ''; $('#nImage').value = ''; preview('', ''); };
$('#nNew').onclick = () => { $('#newsForm').reset(); $('#nFile').value = ''; photo = null; preview('', ''); $('#nDate').valueAsDate = new Date(); };
$('#newsForm').onsubmit = async (e) => {
  e.preventDefault(); $('#nMsg').textContent = photo ? 'Uploading the photo and saving…' : 'Saving…';
  const fd = new FormData(); fd.append('file', $('#nFile').value); fd.append('title', $('#nTitle').value); fd.append('date', $('#nDate').value); fd.append('image', $('#nImage').value); fd.append('body', $('#nBody').value);
  if (photo) fd.append('photo', photo, 'photo.' + ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[photo.type] || 'jpg'));
  try { const r = await api('/news', { method: 'POST', body: fd }); $('#nFile').value = r.file; $('#nImage').value = r.image || ''; photo = null; $('#nPhoto').value = ''; $('#nMsg').innerHTML = `<span class="ok">Saved.</span>${live(r.commit)}`; loadNews(); }
  catch (err) { $('#nMsg').innerHTML = `<span class="bad">${esc(err.message)}</span>`; }
};

// ---------- Files page ----------
let files = [];
async function loadFiles() {
  files = (await api('/files')).files;
  $('#fileRows').innerHTML = files.map((f, i) => `<tr><td><input data-i="${i}" data-k="title" value="${esc(f.title)}" /></td><td class="small"><a href="/files/${esc(f.file)}" target="_blank">${esc(f.file)}</a></td>
    <td><select data-i="${i}" data-k="section">${['current', 'history', 'archive'].map((s) => `<option ${f.section === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td><label class="small"><input type="checkbox" data-i="${i}" data-k="remove" style="width:auto"> remove</label></td></tr>`).join('');
}
$('#saveFiles').onclick = async () => {
  document.querySelectorAll('#fileRows [data-k]').forEach((el) => { const f = files[el.dataset.i]; if (el.dataset.k === 'remove') f._rm = el.checked; else f[el.dataset.k] = el.value; });
  const rm = files.filter((f) => f._rm); if (rm.length && !confirm(`Remove ${rm.length} file(s) from the site?`)) return;
  try { const r = await api('/files', { method: 'POST', json: { files: files.filter((f) => !f._rm) } }); $('#fMsg').innerHTML = `<span class="ok">Saved.</span>${live(r.commit)}`; loadFiles(); } catch (err) { $('#fMsg').innerHTML = `<span class="bad">${esc(err.message)}</span>`; }
};

// ---------- League ----------
let league = null;
async function loadLeague() {
  league = await api('/league'); $('#wc').value = league.wildcards ?? 3;
  $('#teamRows').innerHTML = league.teams.map((t, i) => `<tr><td><b>${esc(t.abbr)}</b></td>${['city', 'nickname', 'owner', 'manager'].map((k) => `<td><input data-i="${i}" data-k="${k}" value="${esc(t[k])}" /></td>`).join('')}
    <td class="small"><label class="btn" style="padding:.15rem .5rem">${t.logo ? 'Replace' : 'Upload'}<input type="file" accept="image/*" data-logo="${esc(t.abbr)}" hidden></label></td></tr>`).join('');
}
$('#teamRows').onchange = async (e) => {
  const ab = e.target.dataset.logo; if (!ab) return;
  const fd = new FormData(); fd.append('team', ab); fd.append('file', e.target.files[0]);
  try { const r = await api('/logo', { method: 'POST', body: fd }); $('#lMsg').innerHTML = `<span class="ok">Logo saved for ${esc(ab)}.</span>${live(r.commit)}`; } catch (err) { $('#lMsg').innerHTML = `<span class="bad">${esc(err.message)}</span>`; }
};
$('#saveLeague').onclick = async () => {
  document.querySelectorAll('#teamRows [data-k]').forEach((el) => { league.teams[el.dataset.i][el.dataset.k] = el.value; });
  try { const r = await api('/league', { method: 'POST', json: { teams: league.teams, wildcards: +$('#wc').value } }); $('#lMsg').innerHTML = `<span class="ok">Saved.</span>${live(r.commit)}`; } catch (err) { $('#lMsg').innerHTML = `<span class="bad">${esc(err.message)}</span>`; }
};

function banner(msg) { let b = $('#banner'); if (!b) { b = document.createElement('div'); b.id = 'banner'; $('#app').prepend(b); } b.className = msg ? 'banner' : ''; b.textContent = msg || ''; }
const fail = (where) => (e) => banner(`Couldn't load ${where}: ${e.message}`);
async function loadAll() {
  $('#nDate').valueAsDate = new Date();
  const me = await api('/me').catch(() => ({}));
  banner(me.problem ? `GitHub connection problem: ${me.problem}` : '');
  if (me.problem) return;
  loadNews().catch(fail('news')); loadFiles().catch(fail('the Files page list')); loadLeague().catch(fail('teams'));
}
api('/me').then(() => { show(true); loadAll(); }).catch(() => show(false));
