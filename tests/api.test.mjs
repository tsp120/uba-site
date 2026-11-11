// End-to-end test of the commish API against a fake GitHub. Run: node tests/api.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { onRequest } from '../functions/api/[[path]].js';

const repo = { files: new Map(Object.entries({ 'data/league.json': fs.readFileSync('data/league.json', 'utf8'), 'data/files.json': '[]' })), commits: [] };
const real = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const p = u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, ''); const body = init.body ? JSON.parse(init.body) : null; const ok = (j) => new Response(JSON.stringify(j), { status: 200 });
  assert.match(init.headers.Authorization, /^Bearer test-token$/);
  if (p.startsWith('/contents/')) { const path = decodeURIComponent(p.slice(10)); if (repo.files.has(path)) return ok({ content: Buffer.from(repo.files.get(path)).toString('base64') });
    const dir = [...repo.files.keys()].filter((k) => k.startsWith(path + '/')); return dir.length ? ok(dir.map((k) => ({ name: k.split('/').pop(), path: k, size: 1 }))) : new Response('nf', { status: 404 }); }
  if (p === '' ) return ok({ permissions: { push: true } });
  if (p === '/branches/main') return ok({});
  if (p === '/git/ref/heads/main') return ok({ object: { sha: 'c0' } });
  if (p === '/git/commits/c0' || p.startsWith('/git/commits/c')) return ok({ tree: { sha: 't0' } });
  if (p === '/git/blobs') { const id = 'b' + repo.files.size + Math.random(); repo.blobs = { ...(repo.blobs || {}), [id]: Buffer.from(body.content, 'base64') }; return ok({ sha: id }); }
  if (p === '/git/trees') { repo.pendingTree = body.tree; return ok({ sha: 't1' }); }
  if (p === '/git/commits' && init.method === 'POST') { repo.commits.push({ message: body.message, tree: repo.pendingTree });
    for (const t of repo.pendingTree) { if (t.sha === null) repo.files.delete(t.path); else repo.files.set(t.path, t.content ?? repo.blobs[t.sha]); } return ok({ sha: 'c' + repo.commits.length }); }
  if (p === '/git/refs/heads/main') return ok({});
  throw new Error('unexpected ' + init.method + ' ' + p);
};
const env = { ADMIN_PASSWORD: 'correct horse', SESSION_SECRET: 's3cret-s3cret-s3cret', GITHUB_TOKEN: 'test-token', GITHUB_REPO: 'goob/uba-site', GITHUB_BRANCH: 'main' };
let cookie = '';
const call = async (path, { method = 'GET', json, form, headers = {}, noHeader } = {}) => {
  const h = new Headers(headers); if (method === 'POST' && !noHeader) h.set('X-UBA', '1'); if (cookie) h.set('Cookie', cookie);
  let body; if (json) { body = JSON.stringify(json); h.set('Content-Type', 'application/json'); } if (form) body = form;
  const req = new Request('https://uba.example' + '/api' + path, { method, headers: h, body });
  const res = await onRequest({ request: req, env, params: { path: path.slice(1).split('/') } });
  return { status: res.status, json: await res.json(), setCookie: res.headers.get('Set-Cookie') };
};

// Auth
assert.equal((await call('/me')).status, 401, 'unauthenticated blocked');
assert.equal((await call('/publish', { method: 'POST', form: new FormData() })).status, 401, 'publish blocked without login');
assert.equal((await call('/login', { method: 'POST', json: { password: 'nope' } })).status, 401, 'wrong password');
assert.equal((await call('/login', { method: 'POST', json: { password: 'correct horse' }, noHeader: true })).status, 400, 'CSRF header required');
const forged = 'uba_admin=' + (Date.now() + 1e7) + '.deadbeef'; cookie = forged; assert.equal((await call('/me')).status, 401, 'forged cookie rejected'); cookie = '';
const li = await call('/login', { method: 'POST', json: { password: 'correct horse' } });
assert.equal(li.status, 200); assert.match(li.setCookie, /HttpOnly; Secure; SameSite=Strict/); cookie = li.setCookie.split(';')[0];
const me = await call('/me'); assert.equal(me.status, 200); assert.equal(me.json.problem, null, 'healthy connection reports no problem');

// Plan routing
const { plan } = (await call('/plan', { method: 'POST', json: { names: ['leaguedata.js', 'bNYK.js', 'teamnyk.js', '20260928DAY.htm', '20260928BAT.htm', 'results.htm', 'cap12.xlsx', 'cap99.xlsx', 'realbatters.csv', '2027_Rule_Book.pdf', 'stats.css', 'shell.php', 'evil.php.xlsx', 'index.html'] } })).json;
const by = Object.fromEntries(plan.map((p) => [p.name, p]));
assert.equal(by['leaguedata.js'].dest, 'data/webbuilder/leaguedata.js');
assert.equal(by['20260928DAY.htm'].dest, 'data/newspapers/20260928DAY.htm');
assert.ok(by['20260928BAT.htm'].skip); assert.ok(by['stats.css'].skip); assert.ok(by['index.html'].skip);
assert.equal(by['cap12.xlsx'].dest, 'data/rosters/ATL.xlsx');
assert.ok(by['cap99.xlsx'].error); assert.ok(by['shell.php'].error);
assert.equal(by['evil.php.xlsx'].dest, 'data/files/evil.php.xlsx', 'double extension stays an inert download');
assert.ok(by['2027_Rule_Book.pdf'].needsTitle);

// Publish a mixed batch
const fd = new FormData();
const latin = Buffer.from('<pre><font color="#FF0000">JOS\xc9 RAM\xcdREZ</font></pre>', 'latin1');
fd.append('files', new File([latin], '20260928DAY.htm'));
fd.append('files', new File(['sub = new Array( "EC", "WC" );'], 'leaguedata.js'));
fd.append('files', new File([Buffer.from('PK\x03\x04fakexlsx', 'latin1')], 'cap12.xlsx'));
fd.append('files', new File(['%PDF-1.4'], '2027_Rule_Book.pdf'));
fd.append('files', new File(['<?php system($_GET[1]);'], 'shell.php'));
fd.append('files', new File(['x'], 'stats.css'));
fd.append('titles', JSON.stringify({ '2027_Rule_Book.pdf': '2027 Rule Book' }));
const pub = await call('/publish', { method: 'POST', form: fd });
assert.equal(pub.status, 200, JSON.stringify(pub.json));
assert.equal(pub.json.committed, 5, 'four files + files.json'); assert.deepEqual(pub.json.skipped, ['stats.css']); assert.match(pub.json.errors[0], /shell\.php/);
assert.equal(repo.commits.length, 1, 'one commit for the whole batch');
assert.equal(repo.files.get('data/newspapers/20260928DAY.htm'), '<pre><font color="#FF0000">JOSÉ RAMÍREZ</font></pre>', 'Windows-1252 converted to UTF-8');
assert.ok(Buffer.isBuffer(repo.files.get('data/rosters/ATL.xlsx')));
assert.ok(![...repo.files.keys()].some((k) => k.endsWith('.php')), 'no php anywhere');
const manifest = JSON.parse(repo.files.get('data/files.json')); assert.equal(manifest[0].title, '2027 Rule Book'); assert.equal(manifest[0].section, 'current');

// News
const n = await call('/news', { method: 'POST', json: { title: 'Trade: "big" deal', date: '2026-11-08', body: 'Para one.\n\nPara <script>two</script>.', image: 'javascript:alert(1)' } });
assert.equal(n.status, 200); const md = repo.files.get('data/news/' + n.json.file); assert.match(md, /title: "Trade: 'big' deal"/); assert.doesNotMatch(md, /image:/, 'non-https image dropped');
assert.equal((await call('/news')).json.posts.length, 1);
assert.equal((await call('/news', { method: 'POST', json: { remove: '../league.json' } })).status, 400, 'path traversal refused');
assert.equal((await call('/news', { method: 'POST', json: { remove: n.json.file } })).status, 200); assert.ok(!repo.files.has('data/news/' + n.json.file));

// News with an uploaded photo: photo committed beside the post; replacing it removes the old one; removing the post removes both
{
  const fd = new FormData(); fd.append('title', 'Opening Day photo'); fd.append('date', '2026-11-09'); fd.append('body', 'Look at those uniforms.');
  fd.append('photo', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' }), 'photo.jpg');
  const r = await call('/news', { method: 'POST', form: fd }); assert.equal(r.status, 200, JSON.stringify(r.json));
  const img1 = r.json.image; assert.match(img1, /^\/media\/news\/2026-11-09-opening-day-photo-[a-z0-9]+\.jpg$/);
  assert.ok(repo.files.has('data/newsimg/' + img1.split('/').pop()), 'photo committed');
  assert.match(repo.files.get('data/news/' + r.json.file), new RegExp('image: ' + img1.replace(/\./g, '\\.')));
  await new Promise((ok) => setTimeout(ok, 5));
  const fd2 = new FormData(); fd2.append('file', r.json.file); fd2.append('title', 'Opening Day photo'); fd2.append('date', '2026-11-09'); fd2.append('body', 'New photo.'); fd2.append('image', img1);
  fd2.append('photo', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'photo.png');
  const r2 = await call('/news', { method: 'POST', form: fd2 }); assert.equal(r2.status, 200); assert.notEqual(r2.json.image, img1);
  assert.ok(!repo.files.has('data/newsimg/' + img1.split('/').pop()), 'old photo removed'); assert.ok(repo.files.has('data/newsimg/' + r2.json.image.split('/').pop()));
  const bad = new FormData(); bad.append('title', 'x'); bad.append('body', 'y'); bad.append('photo', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'x.svg');
  assert.equal((await call('/news', { method: 'POST', form: bad })).status, 400, 'non-photo refused');
  await call('/news', { method: 'POST', json: { remove: r2.json.file } });
  assert.ok(!repo.files.has('data/newsimg/' + r2.json.image.split('/').pop()), 'photo removed with its post');
}

// Files page edit + removal deletes file
const fe = await call('/files', { method: 'POST', json: { files: [] } }); assert.equal(fe.status, 200); assert.ok(!repo.files.has('data/files/2027_Rule_Book.pdf'));

// League: only names/owners/managers can change
const lg = (await call('/league')).json; lg.teams[0].owner = 'New Owner'; lg.teams[0].abbr = 'HACK'; lg.teams[1].legacyId = 999;
await call('/league', { method: 'POST', json: lg });
const saved = JSON.parse(repo.files.get('data/league.json')); assert.equal(saved.teams[0].owner, 'Sean Foisy', 'abbr mismatch ignored'); assert.notEqual(saved.teams[1].legacyId, 999);
lg.teams[0].abbr = 'BUF'; await call('/league', { method: 'POST', json: lg }); assert.equal(JSON.parse(repo.files.get('data/league.json')).teams[0].owner, 'New Owner');

// Logout
assert.match((await call('/logout', { method: 'POST' })).setCookie, /Max-Age=0/);
globalThis.fetch = real;
console.log('All API tests passed ✔ (' + repo.commits.length + ' commits)');
