export const fmtDate = (d, opts = { month: 'long', day: 'numeric', year: 'numeric' }) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
export const shortDate = (d) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
export const pct = (x) => (x >= 1 ? '1.000' : x.toFixed(3).replace(/^0/, ''));
export const gbStr = (g) => (g === 0 ? '—' : (g < 0 ? '+' + (-g).toFixed(1) : g.toFixed(1)).replace(/\.0$/, ''));
export const paperUrl = (d) => `/newspaper/${d}/`;
export const nth = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
export const ext = (f) => (f.split('.').pop() || '').toLowerCase();
