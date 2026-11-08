import * as S from '../src/lib/strat.mjs';
const L = S.league(); console.log('season', L.season, 'teams', Object.keys(L.teams).length, L.conferences.map(c=>c.name+':'+c.divisions.map(d=>d.label).join('/')).join(' | '));
for (const c of S.standings()) { console.log(c.name, c.divisions.map(d=>d.label+' '+d.rows.map(r=>`${r.abbr} ${r.w}-${r.l} ${r.gb}`).join(', ')).join(' || ')); console.log(' WC', c.wildcard.slice(0,5).map(r=>`${r.abbr} ${r.gb}`).join(', ')); }
const P = S.players(); console.log('batters', P.batters.length, 'pitchers', P.pitchers.length, JSON.stringify(P.batters.find(p=>/Ohtani/.test(p.name))), JSON.stringify(P.pitchers.find(p=>/Skenes/.test(p.name))));
const T = S.teamTotals(); console.log('team bat NYK', JSON.stringify(T.batting.NYK)); console.log('team pit NYK', JSON.stringify(T.pitching.NYK));
console.log('leaders', S.leaders().length, JSON.stringify(S.leaders()[6].rows.slice(0,3)));
const sc = S.schedule(); const played = sc.games.filter(g=>g.played); console.log('games', sc.games.length, 'played', played.length, 'extra', sc.games.filter(g=>g.extra).length, 'dates', sc.dates.length, sc.dates[0], sc.dates.at(-1), JSON.stringify(played.at(-1)));
// verify W-L from results equals Strat standings
const rec={}; for(const g of played){const aw=g.as>g.hs; rec[g.away]=rec[g.away]||[0,0]; rec[g.home]=rec[g.home]||[0,0]; rec[g.away][aw?0:1]++; rec[g.home][aw?1:0]++;}
const bad=Object.entries(L.teams).filter(([ab,x])=>!rec[ab]||rec[ab][0]!==x.w||rec[ab][1]!==x.l).map(([ab,x])=>`${ab} strat ${x.w}-${x.l} results ${rec[ab]}`); console.log('record mismatches:', bad.length? bad.join('; '):'none');
const np = S.newspaperDates(); console.log('papers', np.length, np[0], np.at(-1));
const d = S.newspaper(np.at(-1)); console.log('blocks', d.blocks.map(b=>b.kind).join(','), 'stories', d.stories.length, JSON.stringify(d.stories.map(s=>[s.id,S.storyHeadline(s)])));
console.log(d.stories[0].paragraphs[0]);
const old = S.newspaper(np[0]); console.log('2014 stories', old.stories.length, old.stories.slice(0,2).map(s=>s.id+' '+S.storyHeadline(s)));
const R = S.roster('ATL'); console.log('roster', R.title, R.season, R.payroll, R.sections.map(s=>s.name+':'+s.groups.map(g=>g.name+'('+g.players.length+')').join('+')).join(' | '), JSON.stringify(R.sections[0].groups[0].players[1]));
let miss=[]; for (const t of S.teamList()) { const r=S.roster(t.abbr); if(!r) {miss.push(t.abbr);continue;} const n=r.sections.flatMap(s=>s.groups).flatMap(g=>g.players).length; if(n<20) miss.push(t.abbr+':'+n);} console.log('roster issues', miss);
const RS = S.realStats(); console.log('real', RS.batters.rows.size, RS.pitchers.rows.size, JSON.stringify(RS.pitchers.rows.get('paul skenes')));
const matched = P.batters.filter(p=>RS.batters.rows.has(S.normName(p.name))).length; console.log('batter real-match', matched, '/', P.batters.length);
