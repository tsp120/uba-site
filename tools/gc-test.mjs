import { gamecastsFor } from '../src/lib/gamecast.mjs';
const dates = process.argv.slice(2).length ? process.argv.slice(2) : ['2026-09-27'];
let n = 0, exact = 0, totalMs = 0;
for (const d of dates) {
  const t0 = Date.now(); const G = gamecastsFor(d); totalMs += Date.now() - t0;
  for (const g of G) {
    n++; if (g.exact) exact++;
    const last = g.plays.at(-1)?.score.join('-'); const box = `${g.final.away.r}-${g.final.home.r}`;
    if (!g.exact || last !== box || dates.length === 1) console.log(d, g.id, 'exact', g.exact, 'cost', g.cost, 'plays', g.plays.length, 'final', last, 'box', box);
  }
}
console.log(`games ${n}, exact innings ${exact}, avg ms ${Math.round(totalMs / Math.max(1, n))}`);
if (dates.length === 1) {
  const g = gamecastsFor(dates[0])[0];
  for (const p of g.plays.slice(0, 30)) console.log(p.side === 'away' ? 'T' : 'B', p.inning, `${p.outs} out`, (p.bases || []).map((x) => (x ? 'x' : '-')).join(''), p.score.join('-'), p.text, p.pitcher ? `[${p.pitcher}]` : '');
}
