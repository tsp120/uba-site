import * as G from '../src/lib/gamecast.mjs';
import * as S from '../src/lib/strat.mjs';
const cases = [['2026-09-25','stl-cho'],['2026-09-25','mex-sdg'],['2026-09-25','kcm-ind'],['2026-09-25','lan-nsh'],['2026-09-24','jax-mia'],['2026-09-23','pit-tol'],['2026-09-23','bal-atl'],['2026-09-23','van-nsh'],['2026-09-22','sdg-hwi']];
for (const [d, id] of cases) {
  const p = S.newspaper(d); const b = p.blocks.find((x) => x.id === 'box-' + id); const box = G.parseBox(b.text);
  for (const side of ['away', 'home']) {
    const O = G.buildOffense(side, box, {});
    let seed = 7; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let V = G.exactSearch(O, r); let ghost = false;
    if (!V && O.runs.length > 9) { O.ghost = true; V = G.exactSearch(O, r); ghost = !!V; }
    const sim = V ? G.simulate(O, V, [], [], false) : null;
    const ok = sim && O.runs.every((x, i) => x === null || x === (sim.innRuns[i] || 0));
    if (!ok) {
      const cnt = {}; for (const pl of Object.values(O.pools)) for (const t of pl) cnt[t] = (cnt[t] || 0) + 1;
      console.log(d, id, side, 'dfs', !!V, 'ghost', ghost, 'simExact', ok, 'runs', O.runs.join(''), 'walkoff', O.walkoff, 'roe', O.roe, 'PA', O.order.length, JSON.stringify(cnt), 'R', O.roster.reduce((a, x) => a + x.line.r, 0), 'cs', O.cats.cs.length, 'E:', box.extra.ERRORS, 'WP:', box.extra['WILD PITCHES'] || '', box.extra['PASSED BALLS'] || '', box.extra.BALKS || '');
    }
  }
}
