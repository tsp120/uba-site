// Runs before every build: copies commish-supplied assets into public/ and writes the small JSON
// files the browser-side tools (trade assistant, schedule picker) read.
import fs from 'node:fs';
import path from 'node:path';
import * as S from '../src/lib/strat.mjs';

const pub = path.resolve('public');
const sync = (from, to) => {
  const src = path.join(S.DATA, from); if (!fs.existsSync(src)) return 0;
  const dst = path.join(pub, to); fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(dst, { recursive: true });
  let n = 0; for (const f of fs.readdirSync(src)) { if (/^[\w.-]+$/.test(f) && !/\.(php\d?|phtml|phar|html?|js|svg|htaccess)$/i.test(f)) { fs.copyFileSync(path.join(src, f), path.join(dst, f)); n++; } }
  return n;
};
console.log('logos', sync('logos', 'logos'), 'files', sync('files', 'files'), 'schedules', sync('schedules', 'schedules'), 'rosters', sync('rosters', 'rosters'));

fs.mkdirSync(path.join(pub, 'data'), { recursive: true });
const rosters = {};
for (const t of S.teamList()) {
  const r = S.roster(t.abbr); if (!r) continue;
  rosters[t.abbr] = { title: r.title, season: r.season, totals: r.totals,
    sections: r.sections.map((s) => ({ name: s.name, payroll: s.payroll, groups: s.groups.map((g) => ({ name: g.name, players: g.players.map((p) => ({ n: p.name, p: p.pos, s: p.salary, fa: p.fa, notes: p.notes,
      k: g.name === 'Pitchers' ? [p.stats.W && `${p.stats.W}-${p.stats.L}`, p.stats.ERA && `${p.stats.ERA} ERA`, p.stats.IP && `${p.stats.IP} IP`].filter(Boolean).join(', ')
        : [p.stats.AVG, p.stats.HR && `${p.stats.HR} HR`, p.stats.OPS && `${p.stats.OPS} OPS`].filter(Boolean).join(', ') })) })) })) };
}
const teams = Object.fromEntries(S.teamList().map((t) => [t.abbr, { city: t.city, nickname: t.nickname, logo: t.logo, w: t.w, l: t.l }]));
fs.writeFileSync(path.join(pub, 'data', 'rosters.json'), JSON.stringify({ teams, rosters }));
fs.writeFileSync(path.join(pub, 'data', 'papers.json'), JSON.stringify(S.newspaperDates()));
console.log('rosters.json teams', Object.keys(rosters).length);
