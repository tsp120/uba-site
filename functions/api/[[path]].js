// Commish API (Cloudflare Pages Function). Every route except /api/login requires the signed session cookie,
// and every POST must carry the X-UBA header, which a cross-site form cannot send (CSRF protection).
import { passwordOk, sessionCookie, clearCookie, isAuthed } from '../_lib/auth.js';
import { route, MAX_FILE, MAX_TOTAL, safeName } from '../_lib/routes.js';
import { commit, readJson, listDir, readText, checkRepo } from '../_lib/github.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'post';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const decode1252 = (b) => { try { return new TextDecoder('windows-1252').decode(b); } catch { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; } };
const TEXT_KINDS = new Set(['webbuilder', 'newspaper', 'report', 'realstats']);
const clean = (s, n = 200) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

export async function onRequest({ request, env, params }) {
  const path = '/' + (params.path || []).join('/');
  const method = request.method;
  try {
    if (method === 'POST' && request.headers.get('X-UBA') !== '1') return json({ error: 'Bad request' }, 400);
    if (path === '/login' && method === 'POST') {
      // Tell the person setting up the site exactly what's missing, instead of a misleading "Wrong password".
      const missing = ['ADMIN_PASSWORD', 'SESSION_SECRET', 'GITHUB_TOKEN', 'GITHUB_REPO'].filter((k) => !env[k]);
      if (missing.length) return json({ error: `The upload page isn't set up yet. In Cloudflare, add ${missing.join(', ')} under Settings > Variables and Secrets (Production), then retry the deployment.` }, 503);
      const { password } = await request.json().catch(() => ({}));
      if (!(await passwordOk(env, password))) { await new Promise((r) => setTimeout(r, 1200)); return json({ error: 'Wrong password' }, 401); }
      return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(env) });
    }
    if (path === '/logout') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
    if (!(await isAuthed(env, request))) return json({ error: 'Please log in' }, 401);

    if (path === '/me') return json({ ok: true, repo: env.GITHUB_REPO, problem: await checkRepo(env).catch((e) => `Could not reach GitHub: ${e.message}`) });

    // Ask where files would go before uploading them (the drop zone shows this as a checklist).
    if (path === '/plan' && method === 'POST') {
      const { names = [] } = await request.json();
      const league = await readJson(env, 'data/league.json', { teams: [] });
      return json({ plan: names.slice(0, 500).map((name) => ({ name, ...route(name, league) })) });
    }

    // Publish: multipart form with files + "titles" JSON ({filename: title}) for downloadable files.
    if (path === '/publish' && method === 'POST') {
      const form = await request.formData();
      const titles = JSON.parse(form.get('titles') || '{}');
      const league = await readJson(env, 'data/league.json', { teams: [] });
      const out = []; const skipped = []; const errors = []; let total = 0; let binaries = 0; const newDownloads = [];
      for (const f of form.getAll('files')) {
        if (typeof f === 'string') continue;
        const r = route(f.name, league);
        if (r.skip) { skipped.push(f.name); continue; }
        if (r.error || !r.dest) { errors.push(`${f.name}: ${r.error || 'not accepted'}`); continue; }
        if (f.size > MAX_FILE) { errors.push(`${f.name}: larger than 20 MB`); continue; }
        total += f.size; if (total > MAX_TOTAL) { errors.push('Too much at once: upload in smaller batches (90 MB max).'); break; }
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (TEXT_KINDS.has(r.kind)) {
          // Strat writes Windows-1252; store as UTF-8 text so it can go inline (no per-file API call).
          let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = decode1252(bytes); }
          out.push({ path: r.dest, text });
        } else {
          if (++binaries > 35) { errors.push(`${f.name}: too many spreadsheets/PDFs in one go, publish the rest in a second batch`); continue; }
          out.push({ path: r.dest, bytes });
        }
        if (r.kind === 'download') newDownloads.push({ file: r.dest.split('/').pop(), title: clean(titles[f.name] || f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '), 120) });
      }
      if (errors.length && !out.length) return json({ error: errors.join('\n') }, 400);
      // Remember when the real MLB stats were uploaded, so team pages can say how current they are.
      const statsUp = out.filter((o) => o.path.startsWith('data/realstats/')).map((o) => o.path.split('/').pop());
      if (statsUp.length) { const meta = await readJson(env, 'data/realstats/meta.json', {}); for (const f of statsUp) meta[f] = today(); out.push({ path: 'data/realstats/meta.json', text: JSON.stringify(meta, null, 2) }); }
      if (newDownloads.length) {
        const manifest = await readJson(env, 'data/files.json', []);
        for (const d of newDownloads) {
          const i = manifest.findIndex((m) => m.file === d.file);
          const entry = { title: d.title, file: d.file, updated: today(), section: 'current' };
          if (i >= 0) manifest[i] = { ...manifest[i], ...entry, section: manifest[i].section }; else manifest.unshift(entry);
        }
        out.push({ path: 'data/files.json', text: JSON.stringify(manifest, null, 2) });
      }
      const kinds = [...new Set(out.map((o) => o.path.split('/')[1]))].join(', ');
      const c = await commit(env, out, `Commish upload: ${out.length} file(s) (${kinds})`);
      return json({ ok: true, committed: out.length, skipped, errors, commit: c });
    }

    if (path === '/files' && method === 'GET') return json({ files: await readJson(env, 'data/files.json', []) });
    if (path === '/files' && method === 'POST') {
      // Edit titles/sections, or remove entries (removing an entry also deletes the file).
      const { files } = await request.json();
      if (!Array.isArray(files)) return json({ error: 'Bad list' }, 400);
      const current = await readJson(env, 'data/files.json', []);
      const keep = files.filter((f) => current.some((c) => c.file === f.file)).map((f) => ({ ...current.find((c) => c.file === f.file), title: clean(f.title, 120), section: ['current', 'history', 'archive'].includes(f.section) ? f.section : 'current' }));
      const removed = current.filter((c) => !keep.some((k) => k.file === c.file)).map((c) => ({ path: `data/files/${safeName(c.file)}`, delete: true }));
      const c = await commit(env, [{ path: 'data/files.json', text: JSON.stringify(keep, null, 2) }, ...removed], 'Commish: update Files page');
      return json({ ok: true, commit: c });
    }

    if (path === '/news' && method === 'GET') return json({ posts: (await listDir(env, 'data/news')).filter((f) => f.name.endsWith('.md')).map((f) => f.name).sort().reverse() });
    if (path === '/news' && method === 'POST') {
      const b = await request.json();
      if (b.remove) { const name = safeName(b.remove); if (!name.endsWith('.md')) return json({ error: 'Bad name' }, 400); const c = await commit(env, [{ path: `data/news/${name}`, delete: true }], `Commish: remove post ${name}`); return json({ ok: true, commit: c }); }
      const title = clean(b.title, 140); const body = String(b.body || '').slice(0, 50000); const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : today();
      if (!title || !body.trim()) return json({ error: 'Title and story are required' }, 400);
      const image = /^https:\/\/[^\s"]+$/.test(b.image || '') ? b.image : '';
      const name = b.file && /^[\w.-]+\.md$/.test(b.file) ? b.file : `${date}-${slug(title)}.md`;
      const md = `---\ntitle: "${title.replace(/"/g, "'")}"\ndate: ${date}\n${image ? `image: ${image}\n` : ''}---\n${body.trim()}\n`;
      const c = await commit(env, [{ path: `data/news/${name}`, text: md }], `Commish: news "${title}"`);
      return json({ ok: true, file: name, commit: c });
    }
    if (path.startsWith('/news/') && method === 'GET') { const t = await readText(env, `data/news/${safeName(path.slice(6))}`); return t == null ? json({ error: 'Not found' }, 404) : json({ text: t }); }

    if (path === '/league' && method === 'GET') return json(await readJson(env, 'data/league.json', {}));
    if (path === '/league' && method === 'POST') {
      // Owners, managers and names only. Divisions and records come from Strat's Web Builder files.
      const b = await request.json(); const cur = await readJson(env, 'data/league.json', { teams: [] });
      for (const t of cur.teams) { const u = (b.teams || []).find((x) => x.abbr === t.abbr); if (u) for (const k of ['city', 'nickname', 'owner', 'manager']) if (k in u) t[k] = clean(u[k], 80); }
      if (b.wildcards && +b.wildcards >= 0 && +b.wildcards <= 6) cur.wildcards = +b.wildcards;
      const files = [{ path: 'data/league.json', text: JSON.stringify(cur, null, 2) }];
      const c = await commit(env, files, 'Commish: update teams/owners/managers');
      return json({ ok: true, commit: c });
    }
    if (path === '/logo' && method === 'POST') {
      const form = await request.formData(); const ab = String(form.get('team') || ''); const f = form.get('file');
      const cur = await readJson(env, 'data/league.json', { teams: [] }); const t = cur.teams.find((x) => x.abbr === ab);
      const ext = (f?.name || '').toLowerCase().match(/\.(png|jpe?g|gif|webp)$/)?.[1];
      if (!t || !ext || f.size > 2 * 1024 * 1024) return json({ error: 'Pick a team and a PNG/JPG/GIF/WebP under 2 MB' }, 400);
      const name = `${ab}.${ext}`; const files = [{ path: `data/logos/${name}`, bytes: new Uint8Array(await f.arrayBuffer()) }];
      if (t.logo && t.logo !== name) files.push({ path: `data/logos/${t.logo}`, delete: true });
      t.logo = name; files.push({ path: 'data/league.json', text: JSON.stringify(cur, null, 2) });
      return json({ ok: true, commit: await commit(env, files, `Commish: new logo for ${ab}`) });
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json({ error: e.message || 'Server error' }, 500);
  }
}
