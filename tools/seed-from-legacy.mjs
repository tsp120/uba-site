// One-time migration: copies the old PHP site's Strat-O-Matic files into the new data/ layout.
// Usage: node tools/seed-from-legacy.mjs <path-to-old-site/uba> [dataDir]
import fs from 'node:fs';
import path from 'node:path';

const legacy = process.argv[2];
const data = process.argv[3] || 'data';
if (!legacy) { console.error('usage: node tools/seed-from-legacy.mjs <old-site/uba>'); process.exit(1); }
const mk = (p) => fs.mkdirSync(p, { recursive: true });
const cp = (a, b) => { mk(path.dirname(b)); fs.copyFileSync(a, b); };

// Owners/managers as shown on the live site (teams table in the old MySQL database), keyed by legacy team id.
const owners = {
  12:['Mike Buzgierski','John Lennon'],14:['Paul Frick','Mark Hamill'],1:['Sean Foisy','Willie Randolph'],
  20:['Mark Dorsey','Jim Leyland'],19:['Riley Burks','Steven Jayne'],23:['Justin Rosenberg','Felipe Alou'],
  17:['Billy Goodnow','Yadier Molina'],11:['Jackson Jost','Yoda Berra'],16:['Wil Kramer','Ken Griffey, Jr.'],
  26:['Betsy Schlehuber','Mike Sciosia'],9:['Tim Puzycki','Joe Orsulak'],6:['Joe Phelps','Joe Rudi'],
  24:['Alan Ashford','John Smoltz'],10:['Bryson Turner','Joe Girardi'],3:['Earl Kirk','Davey Johnson'],
  7:['Jason Buckner','Ricky Vaughn'],8:['Craig Phelps','Jim Palmer'],4:['Roland Schlehuber','Eddie Murray'],
  27:['Ben/Angus Phelps','Frank Robinson'],2:['Paul Skurda','Bud Abbott'],15:['Joe Era','George Smiley'],
  25:['Matthew Schoolcraft','Tony Gwynn'],21:['Evan Rosenberg','Simone Biles'],22:['Michael Farruggia','Jimy Williams'],
  30:['Steve Jost','Willie Mays'],29:['Steve Matheis','Lou Piniella'],18:['Dan Phelps','Edgar Martinez'],
  5:['Kathleen Phelps','Caitlin Clark'],28:['Stephen Buckner','Ted Lasso'],13:['R. J. Burks','Richie Zisk'],
};
const legacyCities = {1:'Buffalo',2:'Pittsburgh',3:'Milwaukee',4:'New York',5:'Toledo',6:'Memphis',7:'Nashville',8:'New Orleans',
  9:'Louisville',10:'Miami',11:'Jacksonville',12:'Atlanta',13:'Washington',14:'Baltimore',15:'Richmond',16:'Kansas City',
  17:'Indianapolis',18:'St. Louis',19:'Dallas',20:'Chicago',21:'San Antonio',22:'San Diego',23:'Hawaii',24:'Mexico City',
  25:'Salt Lake City',26:'Los Angeles',27:'Oakland',28:'Vancouver',29:'Seattle',30:'San Francisco'};
const nicknames = {27:'Black Panther Party'}; // DB name differs from Strat's
// Exact logo file in use on the live site (several old logos share an id).
const liveLogoExt = {1:'jpg',2:'png',3:'jpg',4:'jpg',5:'jpg',6:'png',7:'png',8:'png',9:'png',10:'jpg',11:'png',12:'png',13:'jpg',14:'jpg',15:'jpg',
  16:'png',17:'jpg',18:'png',19:'gif',20:'jpg',21:'jpg',22:'jpg',23:'png',24:'jpg',25:'png',26:'png',27:'jpeg',28:'jpg',29:'png',30:'png'};

// --- Web Builder export
const wb = path.join(legacy, 'WebBuilder');
const ld = fs.readFileSync(path.join(wb, 'leaguedata.js'), 'utf8');
const teamRe = /^(\w+) = new Array\("(\w+)", "([^"]+)", "([^"]+)"/gm;
const teams = []; let m;
while ((m = teamRe.exec(ld))) teams.push({ abbr: m[1], city: m[3], nickname: m[4] });
const want = new Set(['leaguedata.js','leaders.js','totals.js','ECtotals.js','WCtotals.js','ECleaders.js','WCleaders.js']);
for (const t of teams) for (const p of [`b${t.abbr}.js`, `p${t.abbr}.js`, `team${t.abbr.toLowerCase()}.js`]) want.add(p);
let n = 0;
for (const f of want) if (fs.existsSync(path.join(wb, f))) { cp(path.join(wb, f), path.join(data, 'webbuilder', f)); n++; }
console.log('webbuilder files:', n);

// --- League file (teams, owners, managers, logos)
const files = fs.readdirSync(path.join(legacy, 'files'));
const league = { name: 'Unbelievable Baseball Association', short: 'UBA', established: 1968, wildcards: 2, teams: [] };
for (const t of teams) {
  const id = Object.keys(legacyCities).find((k) => legacyCities[k] === t.city);
  const logo = files.find((f) => f.toLowerCase() === `logo${id}.${liveLogoExt[id]}`) || files.find((f) => new RegExp(`^logo${id}\\.(png|jpe?g|gif|webp)$`, 'i').test(f));
  if (logo) cp(path.join(legacy, 'files', logo), path.join(data, 'logos', `${t.abbr}${path.extname(logo).toLowerCase()}`));
  const roster = path.join(legacy, 'files', `cap${id}.xlsx`);
  if (fs.existsSync(roster)) cp(roster, path.join(data, 'rosters', `${t.abbr}.xlsx`));
  const cal = files.filter((f) => new RegExp(`^2026_Calendar_Schedule${id}\\.pdf$`, 'i').test(f))[0];
  if (cal) cp(path.join(legacy, 'files', cal), path.join(data, 'schedules', `${t.abbr}.pdf`));
  league.teams.push({ abbr: t.abbr, legacyId: +id, city: t.city, nickname: nicknames[id] || t.nickname,
    owner: owners[id]?.[0] || '', manager: owners[id]?.[1] || '',
    logo: logo ? `${t.abbr}${path.extname(logo).toLowerCase()}` : null });
}
fs.writeFileSync(path.join(data, 'league.json'), JSON.stringify(league, null, 2));
console.log('teams:', league.teams.length, 'missing logos:', league.teams.filter((t) => !t.logo).map((t) => t.abbr));

// --- Strat reports
for (const f of ['schedule.htm', 'results.htm']) cp(path.join(legacy, 'files', f), path.join(data, 'reports', f));
for (const f of ['realbatters.csv', 'realpitchers.csv']) cp(path.join(legacy, 'files', f), path.join(data, 'realstats', f));

// --- Newspapers
const box = fs.readdirSync(path.join(legacy, 'box')).filter((f) => /^\d{8}DAY\.htm$/.test(f));
for (const f of box) cp(path.join(legacy, 'box', f), path.join(data, 'newspapers', f));
console.log('newspapers:', box.length);

// --- Downloadable files (current ones shown on the live Files page + historical archive)
const current = [
  ['2027 Free Agent Bid Book', '2027_Free_Agents.xlsx', '2026-11-06'],
  ['2027 Rookie Draft Order', '2027_Rookie_Draft_Order.xlsx', '2026-11-06'],
  ['2027 Rookie List', '2027_Rookie_List.xlsx', '2026-10-13'],
  ['No Hitters', 'nohitter.docx', '2025-11-07'],
];
const manifest = [];
for (const [title, file, date] of current) { cp(path.join(legacy, 'files', file), path.join(data, 'files', file)); manifest.push({ title, file, updated: date, section: 'current' }); }
const archiveRe = /^(20\d\d)[_ ]?(Rule_Book|rulebook|Free_Agent_Bid_Book|Free_?Agents?|freeagents|Rookie_List|RookieList|Rookie_Draft_Order|Draft_Order|draftorder|DraftOrder|Team_to_Team(_Chart)?|teambyteam)\.(xlsx|docx|pdf)$/i;
const label = (s) => ({ rule_book:'Rule Book', rulebook:'Rule Book', free_agent_bid_book:'Free Agent Bid Book', free_agents:'Free Agents', freeagents:'Free Agents', free_agent:'Free Agents', freeagent:'Free Agents',
  rookie_list:'Rookie List', rookielist:'Rookie List', rookie_draft_order:'Rookie Draft Order', draft_order:'Draft Order', draftorder:'Draft Order', team_to_team:'Team-to-Team Chart', team_to_team_chart:'Team-to-Team Chart', teambyteam:'Team-to-Team Chart' }[s.toLowerCase()] || s);
for (const f of files) {
  const a = f.match(archiveRe); if (!a || current.some((c) => c[1] === f)) continue;
  if (f.endsWith('.docx') && files.includes(f.replace(/\.docx$/, '.pdf'))) continue; // prefer the PDF copy
  cp(path.join(legacy, 'files', f), path.join(data, 'files', f));
  manifest.push({ title: `${a[1]} ${label(a[2])}`, file: f, updated: null, section: 'archive', season: +a[1] });
}
for (const f of ['ubachamps.doc', 'yearbyyear.xls', 'recordbook.xls', 'all_stars.docx']) if (files.includes(f)) {
  cp(path.join(legacy, 'files', f), path.join(data, 'files', f));
  manifest.push({ title: { 'ubachamps.doc':'UBA Champions', 'yearbyyear.xls':'Year-by-Year Standings', 'recordbook.xls':'Record Book', 'all_stars.docx':'All-Stars' }[f], file: f, updated: null, section: 'history' });
}
fs.writeFileSync(path.join(data, 'files.json'), JSON.stringify(manifest, null, 2));
console.log('files:', manifest.length);
mk(path.join(data, 'news'));
