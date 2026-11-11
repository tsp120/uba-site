// Parsers for Strat-O-Matic exports. Everything the site shows comes from files in data/.
// These run at build time only; nothing here is exposed to visitors.
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

export const DATA = path.resolve(process.env.UBA_DATA || 'data');
// Strat writes Windows-1252; files that came through the upload page are UTF-8. Accept either.
const read = (p) => { const b = fs.readFileSync(path.join(DATA, p)); try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1252').decode(b); } };
const exists = (p) => fs.existsSync(path.join(DATA, p));
const memo = (fn) => { let v; let done = false; return () => (done ? v : ((done = true), (v = fn()))); };
const num = (s) => { const n = parseFloat(String(s).trim()); return Number.isFinite(n) ? n : 0; };
const t = (s) => String(s ?? '').trim();

// ---------- Web Builder "x = new Array( "a", "b" );" lines ----------
function wbArrays(text) {
  const out = [];
  const re = /^\s*([A-Za-z_][\w]*)\s*=\s*new Array\s*\(([\s\S]*?)\)\s*;?\s*$/gm;
  let m;
  while ((m = re.exec(text))) {
    const vals = [...m[2].matchAll(/"([^"]*)"|(-?[\d.]+)/g)].map((x) => (x[1] !== undefined ? x[1] : x[2]));
    out.push({ key: m[1], vals });
  }
  return out;
}

// ---------- League, teams, standings ----------
export const leagueFile = memo(() => JSON.parse(read('league.json')));

export const league = memo(() => {
  const arrs = wbArrays(read('webbuilder/leaguedata.js'));
  const get = (k) => arrs.find((a) => a.key === k)?.vals || [];
  const subs = get('sub'); const subLong = get('sublong');
  const meta = Object.fromEntries(leagueFile().teams.map((x) => [x.abbr, x]));
  const teams = {}; let season = null;
  const conferences = subs.map((c, i) => ({
    id: c, name: subLong[i] || c,
    divisions: get(c).map((d) => ({
      name: d, label: d.charAt(0) + d.slice(1).toLowerCase(),
      teams: get(c + d).map((ab) => {
        const v = get(ab); season = season || v[4];
        const g = num(v[5]), w = num(v[6]), l = num(v[7]);
        const m = meta[ab] || {};
        teams[ab] = { abbr: ab, city: m.city || v[1], nickname: m.nickname || v[2], stratName: `${v[1]} ${v[2]}`, owner: m.owner || '', manager: m.manager || '',
          logo: m.logo ? `/logos/${m.logo}` : null, legacyId: m.legacyId, conf: c, confName: subLong[i], div: d,
          divLabel: d.charAt(0) + d.slice(1).toLowerCase(), g, w, l, pct: g ? w / g : 0, home: t(v[9]), road: t(v[10]) };
        return ab;
      }),
    })),
  }));
  return { name: leagueFile().name, established: leagueFile().established, season: +season, conferences, teams };
});
export const team = (ab) => league().teams[ab];
export const teamList = () => Object.values(league().teams).sort((a, b) => a.city.localeCompare(b.city));

const gb = (lw, ll, w, l) => ((lw - w) + (l - ll)) / 2;
export const standings = memo(() => {
  const L = league();
  return L.conferences.map((c) => {
    const divisions = c.divisions.map((d) => {
      const rows = d.teams.map((ab) => L.teams[ab]).sort((a, b) => b.pct - a.pct || b.w - a.w);
      const [ld] = rows;
      return { ...d, rows: rows.map((r, i) => ({ ...r, place: i + 1, gb: i === 0 ? 0 : gb(ld.w, ld.l, r.w, r.l) })) };
    });
    const leaders = new Set(divisions.map((d) => d.rows[0].abbr));
    const wc = Object.values(L.teams).filter((x) => x.conf === c.id && !leaders.has(x.abbr)).sort((a, b) => b.pct - a.pct || b.w - a.w);
    // Games back of the final wild-card spot; negative = ahead of it. Spots per conference: league.json "wildcards" (default 3).
    const spots = leagueFile().wildcards || 3;
    const cut = wc[spots - 1] || wc[wc.length - 1];
    return { ...c, spots, divisions, wildcard: wc.map((r, i) => ({ ...r, place: i + 1, gb: gb(cut.w, cut.l, r.w, r.l) })) };
  });
});
export const placeOf = (ab) => {
  for (const c of standings()) for (const d of c.divisions) { const r = d.rows.find((x) => x.abbr === ab); if (r) return r; }
};

// ---------- Players (Web Builder b/p files) ----------
// Column positions confirmed against the old site and Strat's players.js header map.
const BAT = { g: 5, pa: 6, ab: 7, r: 8, h: 9, avg: 10, tb: 11, d: 13, tr: 14, hr: 15, rbi: 16, sh: 17, sf: 20, hbp: 21, bb: 22, ibb: 23, so: 24, sb: 25, cs: 26, gdp: 28, slg: 29, obp: 30, ops: 31 };
const PIT = { w: 6, l: 7, era: 9, g: 10, gs: 11, cg: 13, sho: 15, sv: 16, ip: 19, h: 21, hr: 23, bb: 24, so: 26, r: 29, er: 30 };
const pick = (vals, map) => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, t(vals[i])]));
// Strat writes IP as "50.1" meaning 50 1/3.
export const ipToOuts = (ip) => { const [w, f = '0'] = String(ip).trim().split('.'); return (+w || 0) * 3 + (+f || 0); };
export const outsToIp = (o) => `${Math.floor(o / 3)}.${o % 3}`;

export const players = memo(() => {
  const out = { batters: [], pitchers: [] };
  for (const ab of Object.keys(league().teams)) {
    for (const [kind, file, map, full, last] of [['batters', `webbuilder/b${ab}.js`, BAT, 89, 91], ['pitchers', `webbuilder/p${ab}.js`, PIT, 79, 81]]) {
      if (!exists(file)) continue;
      for (const { key, vals } of wbArrays(read(file))) {
        if (vals.length < 40) continue;
        const s = pick(vals, map);
        const p = { id: `${ab}-${key}`, team: ab, short: t(vals[0]), name: t(vals[full]) || t(vals[0]), last: t(vals[last]), card: `${t(vals[1])} ${t(vals[2])}`, hand: t(vals[3]), ...s };
        if (kind === 'pitchers') { p.outs = ipToOuts(p.ip); if (!p.outs && !+p.g) continue; } else if (!+p.pa && !+p.g) continue;
        out[kind].push(p);
      }
    }
  }
  return out;
});
export const teamPlayers = (ab) => ({ batters: players().batters.filter((p) => p.team === ab), pitchers: players().pitchers.filter((p) => p.team === ab) });

// ---------- Team totals (Web Builder totals.js, columnar) ----------
export const teamTotals = memo(() => {
  const arrs = wbArrays(read('webbuilder/totals.js'));
  const col = (prefix) => {
    const head = arrs.find((a) => a.key === `head${prefix}`)?.vals || [];
    const cols = arrs.filter((a) => a.key.startsWith(prefix.replace('head', '') + 'Grand') || a.key.startsWith(prefix.slice(5) + 'Grand'));
    return { head, cols };
  };
  const build = (headKey, prefix) => {
    const head = arrs.find((a) => a.key === headKey).vals;
    const cols = head.map((_, i) => arrs.find((a) => a.key === `${prefix}${i}`)?.vals || []);
    const rows = {};
    cols[0].forEach((ab, r) => {
      const o = {}; head.forEach((h, i) => { if (h !== 'Abbrev') o[h in o ? h + '2' : h] = t(cols[i][r]); });
      rows[ab] = o;
    });
    return rows;
  };
  return { batting: build('headGrandB1', 'B1Grand'), pitching: build('headGrandP1', 'P1Grand') };
});

// ---------- League leaders (Web Builder leaders.js) ----------
const LEADER_TITLES = ['Batting Average','At Bats','Runs Scored','Hits','Doubles','Triples','Home Runs','Runs Batted In','Walks','Intentional Walks','Strike Outs','Hit By Pitch','Sacrifice Hits','Stolen Bases','Stolen Base Pct','GIDP','Hitting Streak','Pinch Hit Bat Ave','Slugging Pct','On Base Pct','Runs Created/27 Outs','Total Average','Total Bases','Bat Avg vs. Left','HR vs. Left','Bat Avg vs. Right','HR vs. Right','Wins','Losses','Winning Pct','ERA','Innings Pitched','Batters Faced','Games Pitched','Games Started','Complete Games','Games Finished','Saves','Save Pct','Shutouts','Hits Allowed','Runs Allowed','Earned Runs','Home Runs Allowed','Walks Allowed','Strikeouts','Wild Pitches','Balks','Pitcher X-Pct','Opponent Steals','Opponent SB Pct',"Pitcher's Bat Avg","Pitcher's HRs",'Hits / 9 IP','BB / 9 IP','K / 9 IP','HR / 9 IP'];
export const leaders = memo(() => {
  const arrs = Object.fromEntries(wbArrays(read('webbuilder/leaders.js')).map((a) => [a.key, a.vals]));
  return LEADER_TITLES.map((title, i) => ({ title, group: i < 27 ? 'batting' : 'pitching',
    rows: (arrs[`leaderName${i}`] || []).map((n, j) => ({ name: t(n), team: t(arrs[`leaderTeam${i}`][j]), value: t(arrs[`leaderData${i}`][j]) })).filter((r) => r.name) }))
    .filter((c) => c.rows.length);
});

// ---------- Schedule + results (Strat reports) ----------
const pad = (n) => String(n).padStart(2, '0');
const stripTags = (s) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
export const schedule = memo(() => {
  const sched = stripTags(read('reports/schedule.htm'));
  const year = +(sched.match(/Schedule for (\d{4})/)?.[1] || league().season);
  const games = []; let date = null;
  for (const raw of sched.split(/\r?\n/)) {
    const line = raw.replace(/\*/g, ' ');
    const dm = line.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+\d+\s+(.*)$/);
    let rest = line;
    if (dm) { date = `${dm[3]}-${pad(dm[1])}-${pad(dm[2])}`; rest = dm[4]; }
    if (!date) continue;
    for (const g of rest.matchAll(/\b([A-Z]{2,3})-([A-Z]{2,3})\b/g)) games.push({ date, away: g[1], home: g[2], played: false });
  }
  // Results are the truth for games already played. Strat sometimes moves a game a day or two
  // (rainouts, edits), so each result claims the closest scheduled meeting of the same two teams.
  const res = exists('reports/results.htm') ? stripTags(read('reports/results.htm')) : '';
  const re = /^\s*(\d{1,2})\/\s*(\d{1,2})\s+([A-Z]{2,3})\s+(\d+)\s+(\d+)\s+(\d+)\s+([A-Z]{2,3})\s+(\d+)\s+(\d+)\s+(\d+)\s+(?:(\d+)\s+)?(\S.*?\(\d+-\d+\))\s+(\S.*?\(\d+-\d+\))\s*$/;
  const day = (d) => Date.parse(d + 'T12:00:00Z') / 864e5;
  const played = [];
  for (const line of res.split(/\r?\n/)) {
    const m = line.match(re); if (!m) continue;
    played.push({ date: `${year}-${pad(m[1])}-${pad(m[2])}`, away: m[3], home: m[7], as: +m[4], ah: +m[5], ae: +m[6], hs: +m[8], hh: +m[9], he: +m[10], inn: m[11] ? +m[11] : 9, win: m[12].trim(), loss: m[13].trim(), played: true });
  }
  const open = new Set(games);
  for (const r of played) {
    let best = null; let bd = 99;
    for (const g of open) if (g.away === r.away && g.home === r.home) { const dd = Math.abs(day(g.date) - day(r.date)); if (dd < bd) { bd = dd; best = g; } }
    if (best && bd <= 7) { open.delete(best); r.scheduled = best.date; }
  }
  const lastPlayed = played.length ? played[played.length - 1].date : '';
  const upcoming = [...open].filter((g) => g.date > lastPlayed);
  games.length = 0; games.push(...played, ...upcoming);
  games.sort((a, b) => a.date.localeCompare(b.date));
  return { year, games, dates: [...new Set(games.map((g) => g.date))] };
});
// The day the Schedule link opens on: the next day with games if the season is underway, else the last game day.
export const currentScheduleDate = () => { const up = schedule().games.find((g) => !g.played); const today = new Date().toISOString().slice(0, 10); return up && up.date <= today ? up.date : lastPlayedDate(); };
export const lastPlayedDate = () => { const g = schedule().games.filter((x) => x.played); return g.length ? g[g.length - 1].date : schedule().dates[0]; };
export const teamSchedule = (ab) => schedule().games.filter((g) => g.away === ab || g.home === ab).map((g) => {
  const home = g.home === ab; const us = home ? g.hs : g.as; const them = home ? g.as : g.hs;
  return { ...g, opp: home ? g.away : g.home, at: home ? 'vs' : '@', result: g.played ? (us > them ? 'W' : 'L') : null, score: g.played ? `${us}-${them}` : null };
});

// ---------- Newspapers (Strat Daily Report HTML) ----------
export const newspaperDates = memo(() => (exists('newspapers') ? fs.readdirSync(path.join(DATA, 'newspapers')) : [])
  .map((f) => f.match(/^(\d{4})(\d{2})(\d{2})DAY\.htm$/i)).filter(Boolean).map((m) => `${m[1]}-${m[2]}-${m[3]}`).sort());

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
// Turns one <pre> block into safe HTML: only text plus a colour class survives. No tags from the file are passed through.
function preToSafe(inner) {
  let html = ''; let text = '';
  const re = /<font[^>]*color="?#?([0-9A-Fa-f]{6})"?[^>]*>([\s\S]*?)<\/font>|<[^>]+>|([^<]+)/g; let m;
  while ((m = re.exec(inner))) {
    if (m[1]) { const s = decode(m[2].replace(/<[^>]*>/g, '')); text += s; const c = m[1].toUpperCase(); const cls = c === 'FF0000' ? 'h' : c === '0000FF' ? 'n' : ''; html += cls ? `<span class="${cls}">${esc(s)}</span>` : esc(s); }
    else if (m[3]) { const s = decode(m[3]); text += s; html += esc(s); }
  }
  return { html: html.replace(/^\n+|\s+$/g, ''), text: text.replace(/^\n+|\s+$/g, '') };
}
const STORY_HEAD = /^[A-Z][A-Z .'-]+?(?:\(\d+-\d+\))? AT [A-Z][A-Z .'-]+?(?:\(\d+-\d+\))?\s*$/m;
const kindOf = (text) => STORY_HEAD.test(text) ? 'stories' : /^NEWSPAPER STYLE RECAP/i.test(text) ? 'recap' : /^LEAGUE STANDINGS/i.test(text) ? 'standings' : /^NEWSPAPER GAME STORIES/i.test(text) ? 'title'
  : /\(\d+-\d+\) AT .*\(\d+-\d+\)/.test(text.split('\n')[0]) ? 'stories' : / At \d{4} /.test(text.split('\n')[0]) ? 'box' : 'other';

const cityIndex = memo(() => Object.fromEntries(Object.values(league().teams).map((x) => [x.city.toUpperCase(), x.abbr])));
function splitStories(text, date) {
  const lines = text.split('\n'); const out = []; let cur = null;
  for (const line of lines) {
    const h = line.match(/^([A-Z][A-Z .'-]+?)\s*(?:\((\d+-\d+)\))? AT ([A-Z][A-Z .'-]+?)\s*(?:\((\d+-\d+)\))?\s*$/);
    if (h) { cur = { date, awayCity: h[1].trim(), awayRec: h[2], homeCity: h[3].trim(), homeRec: h[4], lines: [] }; out.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }
  return out.map((s) => {
    const body = s.lines.join('\n');
    const [head, ...paras] = body.split(/\n\s*\n/);
    const score = head.split('\n').map((l) => l.match(/^\S.*?\.\s+[\d ]+-\s+(\d+)\s+(\d+)\s+(\d+)\s*$/)).filter(Boolean).map((m) => +m[1]);
    const decision = head.split('\n').find((l) => /^Win:/.test(l)) || '';
    const text = paras.map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    // Franchises have moved over the years, so only link stories from the current season to today's teams.
    const cur = +date.slice(0, 4) === league().season;
    const away = cur ? cityIndex()[s.awayCity] || null : null; const home = cur ? cityIndex()[s.homeCity] || null : null;
    const lead = text[0] || '';
    return { date, away, home, awayCity: s.awayCity, homeCity: s.homeCity, awayRec: s.awayRec, homeRec: s.homeRec,
      awayScore: score[0], homeScore: score[1], linescore: head, decision, paragraphs: text, lead,
      id: `${away || s.awayCity.replace(/\W/g, '')}-${home || s.homeCity.replace(/\W/g, '')}`.toLowerCase() };
  });
}
const paperCache = new Map();
export function newspaper(date) {
  if (paperCache.has(date)) return paperCache.get(date);
  const f = `newspapers/${date.replace(/-/g, '')}DAY.htm`;
  if (!exists(f)) return null;
  const raw = read(f);
  const blocks = [...raw.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((m) => preToSafe(m[1])).filter((b) => b.text.trim()).map((b) => ({ ...b, kind: kindOf(b.text.trim()) }));
  const stories = blocks.filter((b) => b.kind === 'stories').flatMap((b) => splitStories(b.text, date));
  // Anchor box scores so scoreboards can deep-link to them.
  const full = Object.fromEntries(Object.values(league().teams).flatMap((x) => [[`${x.city} ${x.nickname}`.toUpperCase(), x.abbr], [x.stratName.toUpperCase(), x.abbr]]));
  for (const b of blocks) if (b.kind === 'box') {
    const m = b.text.trim().split('\n')[0].match(/^\s*\d{4}\s+(.+?)\s+At\s+\d{4}\s+(.+?)\s{2,}/i) || b.text.trim().split('\n')[0].match(/^\s*\d{4}\s+(.+?)\s+At\s+\d{4}\s+(.+?)\s+\d+\/\d+\/\d+/i);
    if (m && +date.slice(0, 4) === league().season) { const a = full[m[1].trim().toUpperCase()], h = full[m[2].trim().toUpperCase()]; if (a && h) b.id = `box-${a}-${h}`.toLowerCase(); }
  }
  { const seenB = {}; for (const b of blocks) if (b.id) { seenB[b.id] = (seenB[b.id] || 0) + 1; if (seenB[b.id] > 1) b.id += `-${seenB[b.id]}`; } }
  // De-duplicate ids for doubleheaders.
  const seen = {}; for (const s of stories) { seen[s.id] = (seen[s.id] || 0) + 1; if (seen[s.id] > 1) s.id += `-${seen[s.id]}`; }
  const res = { date, blocks, stories };
  paperCache.set(date, res);
  return res;
}
export const storyHeadline = (s) => {
  if (s.awayScore == null || s.homeScore == null) return `${titleCase(s.awayCity)} at ${titleCase(s.homeCity)}`;
  const aw = s.awayScore > s.homeScore;
  const [wc, ws, lc, ls] = aw ? [s.awayCity, s.awayScore, s.homeCity, s.homeScore] : [s.homeCity, s.homeScore, s.awayCity, s.awayScore];
  return `${titleCase(wc)} ${ws}, ${titleCase(lc)} ${ls}`;
};
export const titleCase = (s) => String(s).toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bSt\b/g, 'St');

// ---------- Rosters (commish's cap spreadsheets) ----------
const SECTION = [[/major league/i, 'Major League'], [/minor league/i, 'Minor League'], [/^dnp\b/i, 'Did Not Play'], [/injur|disabled/i, 'Injured']];
export function roster(ab) {
  const f = `rosters/${ab}.xlsx`;
  if (!exists(f)) return null;
  const wb = XLSX.read(fs.readFileSync(path.join(DATA, f)), { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).map((r) => r.map(t));
  const title = rows[0]?.find(Boolean) || '';
  const season = (rows[0] || []).find((c) => /^20\d\d$/.test(c)) || (title.match(/20\d\d/) || [])[0] || '';
  const sections = []; let sec = null; let grp = null; const totals = [];
  for (const r of rows.slice(1)) {
    const a = r[0];
    if (!r.some(Boolean)) continue;
    const s = SECTION.find(([re]) => re.test(a));
    if (s && r.slice(5).every((c) => !c)) { sec = { name: s[1], groups: [] }; sections.push(sec); grp = null; continue; }
    if (/^posit?on players|^position players|^hitters|^batters/i.test(a) || /^pitchers$/i.test(a)) {
      if (!sec) { sec = { name: 'Major League', groups: [] }; sections.push(sec); }
      const cols = r.slice(5).map(t); let last = cols.length; while (last && !cols[last - 1]) last--;
      grp = { name: /pitch/i.test(a) ? 'Pitchers' : 'Position Players', columns: cols.slice(0, last), players: [] }; sec.groups.push(grp); continue;
    }
    if (/total|^plus additional/i.test(a)) { totals.push({ label: a, salary: r[2] }); continue; }
    if (!a || /^(major|minor) league players$/i.test(a)) continue;
    if (!grp) { if (!sec) { sec = { name: 'Other', groups: [] }; sections.push(sec); } grp = { name: 'Players', columns: [], players: [] }; sec.groups.push(grp); }
    const stats = {}; grp.columns.forEach((c, i) => { if (c) stats[c] = r[5 + i]; });
    grp.players.push({ name: a, pos: r[1], salary: r[2], fa: r[3], notes: r[4], stats });
  }
  const salary = (s) => num(String(s).replace(/[$,]/g, ''));
  for (const sec of sections) sec.payroll = sec.groups.flatMap((g) => g.players).reduce((s, p) => s + salary(p.salary), 0);
  return { team: ab, title, season, sections, totals, payroll: sections.reduce((s, x) => s + x.payroll, 0) };
}

// ---------- Real MLB stats (CSV from Baseball-Reference / FanGraphs) ----------
export const normName = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.*#+'’]/g, '').replace(/,?\s+(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift()?.map((h) => h.trim()) || [];
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, t(r[i])])));
}
// Column names differ between FanGraphs and Baseball-Reference exports; map them to one set.
const ALIAS = { Player: 'Name', Tm: 'Team', BA: 'AVG', K: 'SO', IBB: 'IBB', HBP: 'HBP' };
export const realStats = memo(() => {
  const meta = exists('realstats/meta.json') ? JSON.parse(read('realstats/meta.json')) : {};
  const load = (f) => {
    if (!exists(`realstats/${f}`)) return { updated: null, rows: new Map() };
    const rows = new Map();
    for (const raw of parseCsv(read(`realstats/${f}`))) {
      const r = {}; for (const [k, v] of Object.entries(raw)) r[ALIAS[k] || k] = v;
      const name = (r.Name || '').replace(/[*#+]+$/, '').trim(); if (!name || name === 'Name' || /league average/i.test(name)) continue;
      const k = normName(name);
      // Baseball-Reference lists traded players once per team plus a total row (2TM/3TM/TOT): keep the total.
      const isTotal = /^(\dTM|TOT|- - -)$/.test(r.Team || '');
      if (!rows.has(k) || isTotal) rows.set(k, { ...r, Name: name, Team: isTotal ? 'Multiple teams' : r.Team || '' });
    }
    // Upload date is recorded by the commish's upload page; files carried over from the old site have none.
    return { updated: meta[f] || null, rows };
  };
  return { batters: load('realbatters.csv'), pitchers: load('realpitchers.csv') };
});

// ---------- Files page + commish news posts ----------
export const fileManifest = memo(() => (exists('files.json') ? JSON.parse(read('files.json')) : []));
export const posts = memo(() => {
  if (!exists('news')) return [];
  return fs.readdirSync(path.join(DATA, 'news')).filter((f) => f.endsWith('.md')).map((f) => {
    const src = read(`news/${f}`);
    const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const meta = {}; if (m) for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"(.*)"$/, '$1'); }
    return { slug: f.replace(/\.md$/, ''), title: meta.title || f, date: meta.date || '', image: /^https:\/\/[^\s"]+$|^\/media\/news\/[\w.-]+$/.test(meta.image || '') ? meta.image : null, body: (m ? m[2] : src).trim(), excerpt: (m ? m[2] : src).replace(/[#*_>\x60\[\]]|\(https?:[^)]*\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 240).replace(/\s+\S*$/, '') };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug));
});
