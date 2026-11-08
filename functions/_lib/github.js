// Minimal GitHub client: reads files and writes many files as ONE commit (so a day's upload is one rebuild).
const api = (env, path, init = {}) => fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'uba-site-admin', 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
}).then(async (r) => { if (!r.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path.split('?')[0]} → ${r.status} ${(await r.text()).slice(0, 200)}`); return r.status === 204 ? null : r.json(); });

const branch = (env) => env.GITHUB_BRANCH || 'main';

export function toBase64(bytes) {
  let s = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}
const fromBase64 = (b) => Uint8Array.from(atob(b.replace(/\n/g, '')), (c) => c.charCodeAt(0));

export async function readText(env, path) {
  try { const j = await api(env, `/contents/${path}?ref=${branch(env)}`); return new TextDecoder().decode(fromBase64(j.content)); }
  catch (e) { if (/→ 404/.test(e.message)) return null; throw e; }
}
export const readJson = async (env, path, fallback) => { const t = await readText(env, path); return t ? JSON.parse(t) : fallback; };

export async function listDir(env, path) {
  try { return (await api(env, `/contents/${path}?ref=${branch(env)}`)).map((f) => ({ name: f.name, path: f.path, size: f.size })); }
  catch (e) { if (/→ 404/.test(e.message)) return []; throw e; }
}

/** files: [{path, bytes?: Uint8Array, text?: string, delete?: true}]
 *  Text goes inline in the tree request (one call total); binaries need one blob call each.
 *  Cloudflare's free plan allows 50 outbound calls per request, so keep binaries under ~40 per commit. */
export async function commit(env, files, message) {
  const ref = await api(env, `/git/ref/heads/${branch(env)}`);
  const head = await api(env, `/git/commits/${ref.object.sha}`);
  const tree = [];
  for (const f of files) {
    if (f.delete) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
    if (f.text != null) { tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.text }); continue; }
    const blob = await api(env, '/git/blobs', { method: 'POST', body: JSON.stringify({ content: toBase64(f.bytes), encoding: 'base64' }) });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const t = await api(env, '/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
  const c = await api(env, '/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [ref.object.sha] }) });
  await api(env, `/git/refs/heads/${branch(env)}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
  return { sha: c.sha, url: `https://github.com/${env.GITHUB_REPO}/commit/${c.sha}` };
}
