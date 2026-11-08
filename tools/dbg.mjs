import * as S from '../src/lib/strat.mjs';
const sc=S.schedule(); const ex=sc.games.filter(g=>g.extra).slice(0,6); console.log(ex.map(g=>`${g.date} ${g.away}-${g.home}`));
for(const g of ex.slice(0,3)) console.log(g.date, sc.games.filter(x=>x.date===g.date&&!x.extra&&!x.played).map(x=>x.away+'-'+x.home).join(' '));
const unplayedPast=sc.games.filter(g=>!g.played&&g.date<='2026-09-27'); console.log('unplayed past', unplayedPast.length, unplayedPast.slice(0,5).map(g=>g.date+' '+g.away+'-'+g.home));
const d=S.newspaper('2026-09-27'); const s=d.stories.find(s=>s.id==='mex-sdg'); console.log(s.linescore);
const o=S.newspaper('2014-03-30'); console.log(o.blocks.map(b=>b.kind).join(',')); console.log(o.blocks.find(b=>b.kind!=='recap'&&b.kind!=='standings')?.text.slice(0,600));
