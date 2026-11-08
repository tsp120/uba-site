// Commish login: one password (Cloudflare secret ADMIN_PASSWORD) → signed, HttpOnly, SameSite=Strict cookie.
const enc = new TextEncoder();
const COOKIE = 'uba_admin';
const HOURS = 12;
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Compare via HMAC of both sides so timing reveals nothing about the password.
export async function passwordOk(env, given) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || typeof given !== 'string') return false;
  const [a, b] = await Promise.all([hmac(env.SESSION_SECRET, 'pw:' + given), hmac(env.SESSION_SECRET, 'pw:' + env.ADMIN_PASSWORD)]);
  let diff = a.length ^ b.length; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function sessionCookie(env) {
  const exp = Date.now() + HOURS * 3600e3; const sig = await hmac(env.SESSION_SECRET, `session:${exp}`);
  return `${COOKIE}=${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${HOURS * 3600}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
export async function isAuthed(env, request) {
  const c = (request.headers.get('Cookie') || '').split(/;\s*/).find((x) => x.startsWith(COOKIE + '='));
  if (!c || !env.SESSION_SECRET) return false;
  const [exp, sig] = c.slice(COOKIE.length + 1).split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  const want = await hmac(env.SESSION_SECRET, `session:${exp}`);
  let diff = want.length ^ sig.length; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (sig.charCodeAt(i) || 0);
  return diff === 0;
}
