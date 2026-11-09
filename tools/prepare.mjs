// Runs before every build: copies commish-supplied assets into public/ and writes the small JSON
// files the browser-side tools (trade assistant, schedule picker) read.
import fs from 'node:fs';
import path from 'node:path';
import * as S from '../src/lib/strat.mjs';
import { gamecastsFor } from '../src/lib/gamecast.mjs';

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

// Server-side redirects (instant, no flash) for the "latest" pages plus old PHP addresses.
const redirects = [
  `/newspaper /newspaper/${S.newspaperDates().at(-1)}/ 302`, `/newspaper/ /newspaper/${S.newspaperDates().at(-1)}/ 302`,
  `/schedule /schedule/${S.currentScheduleDate()}/ 302`, `/schedule/ /schedule/${S.currentScheduleDate()}/ 302`,
  '/uba/index.php / 301', '/uba/ / 301', '/uba/newspaper.php /newspaper/ 302', '/uba/schedule.php /schedule/ 302', '/uba/standings.php /standings/ 301',
  '/uba/stats.php /stats/ 301', '/uba/files.php /files/ 301', '/uba/teams.php /teams/ 301', '/uba/tradetool.php /trade/ 301', '/uba/addfiles.php /admin/ 301', '/uba/* / 301',
];
fs.writeFileSync(path.join(pub, '_redirects'), redirects.join('\n') + '\n');
console.log('_redirects written');

// Watch mode: rebuild gamecasts for the most recent game days (WATCH_DAYS, default 7) of the current season.
{
  const days = +(process.env.WATCH_DAYS || 7);
  const season = String(S.league().season);
  const dates = S.newspaperDates().filter((d) => d.startsWith(season)).slice(-days);
  const dir = path.join(pub, 'data', 'gamecast'); fs.rmSync(dir, { recursive: true, force: true });
  const games = S.schedule().games.filter((g) => g.played);
  const recordBefore = (ab, date) => { let w = 0, l = 0; for (const g of games) { if (g.date >= date) break; if (g.away !== ab && g.home !== ab) continue; const won = (g.away === ab) === (g.as > g.hs); won ? w++ : l++; } return `${w}-${l}`; };
  const index = []; const t0 = Date.now(); let n = 0, exact = 0;
  for (const date of dates) {
    const list = gamecastsFor(date); fs.mkdirSync(path.join(dir, date), { recursive: true });
    for (const g of list) { fs.writeFileSync(path.join(dir, date, `${g.id}.json`), JSON.stringify(g)); n++; if (g.exact) exact++; }
    index.push({ date, games: list.map((g) => ({ id: g.id, away: g.away.abbr, home: g.home.abbr, awayRec: recordBefore(g.away.abbr, date), homeRec: recordBefore(g.home.abbr, date), innings: g.innings })) });
  }
  fs.writeFileSync(path.join(pub, 'data', 'watch.json'), JSON.stringify(index.reverse()));
  console.log(`gamecasts: ${n} games over ${dates.length} days (${exact} exact) in ${Math.round((Date.now() - t0) / 1000)}s`);
}
