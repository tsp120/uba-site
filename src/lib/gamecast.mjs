// Gamecast reconstruction.
// Strat's box score has no play-by-play, but it pins down a lot: lineups in batting order, every batter's
// AB/R/H/RBI, who doubled/tripled/homered/walked/struck out/hit into a DP/sacrificed, runs by inning, and each
// pitcher's line. We search (simulated annealing) for an order of plate appearances whose simulated base-running
// reproduces those numbers, plus the "in the 6th inning" moments from the written game story and the web gems.
// The result is a plausible, box-score-faithful replay, not a pitch-by-pitch record, and the UI says so.
import { newspaper, players } from './strat.mjs';

// ---------- small deterministic RNG so every build produces the same replay ----------
function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const pickR = (r, a) => a[Math.floor(r() * a.length)];
const shuffle = (r, a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- parse one Strat box score ----------
const listItems = (txt) => (txt || '').split(/,\s*/).map((x) => x.trim()).filter(Boolean).map((x) => {
  const m = x.match(/^(.+?)(?:-(\d+))?(?:\(.*\))?$/); return m ? { name: m[1].trim(), n: +(m[2] || 1) } : null;
}).filter(Boolean);

export function parseBox(text) {
  const lines = text.split(/\r?\n/);
  const box = { away: { bat: [], pit: [] }, home: { bat: [], pit: [] }, notes: [], extra: {} };
  let i = lines.findIndex((l) => /AB\s+R\s+H\s+RBI\s+AVG.*AB\s+R\s+H\s+RBI\s+AVG/.test(l));
  if (i < 0) return null;
  const hdr = lines[i]; const mid = hdr.indexOf('AVG') + 3;
  box.awayNick = hdr.slice(0, hdr.indexOf('AB')).trim(); box.homeNick = hdr.slice(mid, hdr.lastIndexOf(' AB')).trim();
  const POSN = '(?:[A-Z0-9]{1,2}|PH|PR|DH)'; const batRe = new RegExp(`^\\s*(?:([A-Z])-)?(\\S.*?)\\s+(${POSN}(?:,${POSN})*)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\S+)\\s*$`);
  for (i++; i < lines.length && !/--\s+--/.test(lines[i]); i++) {
    for (const [side, part] of [['away', lines[i].slice(0, mid)], ['home', lines[i].slice(mid)]]) {
      const m = part.match(batRe); if (!m) continue;
      box[side].bat.push({ sub: m[1] || null, short: m[2], pos: m[3], ab: +m[4], r: +m[5], h: +m[6], rbi: +m[7] });
    }
  }
  for (; i < lines.length; i++) {
    const l = lines[i];
    const n = l.match(/^([A-Z])-(.*)$/); if (n) { box.notes.push({ letter: n[1], text: n[2] }); continue; }
    const ls = l.match(/^(\S.*?)\.+\s+((?:[\dXx]+\s+)+)-\s+(\d+)\s+(\d+)\s+(\d+)\s*$/);
    if (ls) { const key = box.lineAway ? 'lineHome' : 'lineAway'; box[key] = { inn: ls[2].trim().split(/\s+/).map((x) => (/x/i.test(x) ? null : +x)), r: +ls[3], h: +ls[4], e: +ls[5] }; continue; }
    const ph = l.match(/^(.+?)\s+\(\d+-\d+\)\s+IP\s+H\s+R\s+ER/);
    if (ph) {
      const side = ph[1].trim() === box.awayNick ? 'away' : 'home';
      const pitRe = /^(\S.*?)\s+((?:(?:WIN|LOSS|SAVE|HOLD|BS|W|L|S|H)\([^)]*\)\s*)*)(\d+)(?:\s+(\d)\/3)?\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/;
      for (i++; i < lines.length && !/^Totals/.test(lines[i].trim()); i++) {
        const m = lines[i].trim().match(pitRe); if (!m) continue;
        box[side].pit.push({ short: m[1].trim(), outs: +m[3] * 3 + (+m[4] || 0), h: +m[5], r: +m[6], er: +m[7], bb: +m[8], so: +m[9], hr: +m[10], pc: +m[11], dec: (m[2].match(/^(WIN|LOSS|SAVE|W|L|S)\(/) || [])[1] || null });
      }
      continue;
    }
    const kv = l.match(/^([A-Z][A-Za-z0-9 /]+?)-\s+(.*)$/);
    if (kv) { let v = kv[2]; while (i + 1 < lines.length && /^\s{6,}\S/.test(lines[i + 1])) v += ' ' + lines[++i].trim(); box.extra[kv[1].trim()] = v.trim(); }
  }
  return box.lineAway && box.lineHome ? box : null;
}

// Lists in the box are written away-team names first, then home. Split them, handling names both teams share.
function splitList(items, away, home) {
  const out = { away: {}, home: {} }; let phase = 'away';
  for (const { name, n } of items) {
    const inA = away.has(name), inH = home.has(name);
    if (phase === 'away' && !inA && inH) phase = 'home';
    const side = inA && inH ? phase : inA ? 'away' : inH ? 'home' : null; if (!side) continue;
    out[side][name] = (out[side][name] || 0) + n;
  }
  return out;
}

// ---------- story + web-gem clues ----------
function storyClues(story, rosters) {
  const clues = []; if (!story) return clues;
  const all = [...rosters.away.map((b) => ({ ...b, side: 'away' })), ...rosters.home.map((b) => ({ ...b, side: 'home' }))];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const byLast = (txt) => all.filter((b) => b.lastFull && new RegExp(`\\b${esc(b.lastFull)}\\b`).test(txt));
  const EV = [[/home run|homer|clout|went deep|round[- ]tripper|blast|dinger|over the (fence|wall)|grand slam/i, 'HR'], [/tripled|triple/i, '3B'], [/doubled|double\b|two-base hit/i, '2B'], [/singled|single|one-base hit|base hit/i, '1B'], [/walk(ed)?\b|base on balls/i, 'BB']];
  for (const para of story.paragraphs) {
    let last = null;
    for (const sentence of para.split(/(?<=\.)\s+/)) {
      const named = byLast(sentence); if (named.length === 1) last = named[0];
      for (const clause of sentence.split(/,\s*|\s+and\s+(?=[a-z]+ed\b)/)) {
        const inn = clause.match(/in the (\d+)(?:st|nd|rd|th) inning/); if (!inn) continue;
        const ev = EV.find(([re]) => re.test(clause)); if (!ev) continue;
        if (/allow|gave up|surrender|pitch/i.test(clause)) continue;
        const who = byLast(clause); const b = who.length === 1 ? who[0] : /\b[Hh]e\b/.test(clause) ? last : null;
        if (b) clues.push({ side: b.side, id: b.id, type: ev[1], inning: +inn[1] });
      }
    }
  }
  return clues;
}
function gemClues(text, rosters) {
  const out = [];
  for (const m of (text || '').matchAll(/(Top|Bottom|Bot) (\d+)(?:st|nd|rd|th):\s*([^.]+?) robbed ([^.]+?) of an? ([^.]+?)\./g)) {
    const side = m[1] === 'Top' ? 'away' : 'home'; const victim = m[4].trim(); const lastName = victim.split(' ').pop();
    const b = rosters[side].find((x) => x.full === victim) || rosters[side].find((x) => x.lastFull === lastName);
    if (b) out.push({ side, id: b.id, inning: +m[2], fielder: m[3].trim(), what: `a${/^[aeiou]/i.test(m[5]) ? 'n' : ''} ${m[5].trim()}` });
  }
  return out;
}


// ---------- exact search: guarantees runs-by-inning, then annealing polishes the rest ----------
// One plate appearance; pure, so the DFS and the simulator share identical rules.
function step(bases0, outs0, id, t, bits) {
  const bases = bases0.slice(); let outs = outs0; const sc = []; let rbi = id; let bad = 0;
  const adv = (n) => { for (let i = 2; i >= 0; i--) if (bases[i]) { const to = i + n; if (to >= 3) sc.push(bases[i]); else bases[to] = bases[i]; bases[i] = null; } };
  const force = () => { if (bases[0]) { if (bases[1]) { if (bases[2]) sc.push(bases[2]); bases[2] = bases[1]; } bases[1] = bases[0]; } bases[0] = id; };
  switch (t) {
    case 'HR': adv(3); sc.push(id); break;
    case '3B': adv(3); bases[2] = id; break;
    case '2B': if (bases[2]) { sc.push(bases[2]); bases[2] = null; } if (bases[1]) { sc.push(bases[1]); bases[1] = null; } if (bases[0]) { if (bits & 1) sc.push(bases[0]); else bases[2] = bases[0]; bases[0] = null; } bases[1] = id; break;
    case '1B': if (bases[2]) { sc.push(bases[2]); bases[2] = null; } if (bases[1]) { if (bits & 1) sc.push(bases[1]); else bases[2] = bases[1]; bases[1] = null; } if (bases[0]) { if (bits & 2 && !bases[2]) bases[2] = bases[0]; else bases[1] = bases[0]; bases[0] = null; } bases[0] = id; break;
    case 'BB': case 'IBB': case 'HBP': force(); break;
    case 'E': rbi = null; if (bits & 1) { adv(1); bases[0] = id; } else force(); break;
    case 'K': outs++; break;
    case 'O': outs++; if (outs < 3) { if (bits & 1 && bases[2]) { sc.push(bases[2]); bases[2] = null; } if (bits & 2) { if (bases[1] && !bases[2]) { bases[2] = bases[1]; bases[1] = null; } if (bases[0] && !bases[1]) { bases[1] = bases[0]; bases[0] = null; } } } break;
    case 'SF': outs++; if (bases[2] && outs < 3) { sc.push(bases[2]); bases[2] = null; } else bad += 25; break;
    case 'SH': if (outs < 2 && bases.some(Boolean)) { outs++; adv(1); } else { outs++; bad += 15; } break;
    case 'GDP': if (bases[0] && outs < 2) { bases[0] = null; outs += 2; rbi = null; if (outs < 3) { if (bases[2] && bits & 1) { sc.push(bases[2]); bases[2] = null; } if (bases[1] && !bases[2]) { bases[2] = bases[1]; bases[1] = null; } } } else { outs++; bad += 30; } break;
  }
  return { bases, outs, sc, rbi, bad };
}
const BITS = { '1B': [0, 1, 2, 3], '2B': [0, 1], O: [0, 1, 2, 3], E: [0, 1], GDP: [0, 1] };
const OUTV = { K: 1, O: 1, SF: 1, SH: 1, GDP: 2 };

export function exactSearch(O, r, nodeLimit = 120000) {
  const order = O.order; const N = order.length; const target = O.runs; const batted = O.batted;
  const totalOutsNeeded = O.walkoff ? null : 3 * batted;
  for (let attempt = 0; attempt < 2; attempt++) {
    let nodes = 0;
    const pools = Object.fromEntries(Object.entries(O.pools).map(([id, p]) => [id, p.reduce((m, t) => ((m[t] = (m[t] || 0) + 1), m), {})]));
    let roeLeft = O.roe; let csLeft = O.cats.cs.length + (O.extraOuts || 0); let advLeft = O.wp + (O.advErr || 0);
    const path = []; // {p, t, bits, ev}
    const outsLeftInPools = () => { let n = 0; for (const m of Object.values(pools)) n += (m.K || 0) + (m.O || 0) + (m.SF || 0) + (m.SH || 0) + 2 * (m.GDP || 0); return n - roeLeft + csLeft; };
    const dead = new Set();
    const poolSig = () => { let k = ''; for (const id in pools) { const m = pools[id]; for (const t in m) k += m[t]; k += '.'; } return k; };
    const dfs = (p, inning, outs, bases, runsInn, score, outsUsed) => {
      if (++nodes > nodeLimit) return false;
      const memo = `${p}|${inning}|${outs}|${bases[0] ? 1 : 0}${bases[1] ? 1 : 0}${bases[2] ? 1 : 0}|${runsInn}|${score}|${roeLeft}|${csLeft}|${advLeft}|${poolSig()}`;
      if (dead.has(memo)) return false;
      const res = dfs2(p, inning, outs, bases, runsInn, score, outsUsed);
      if (!res && nodes <= nodeLimit) dead.add(memo);
      return res;
    };
    const dfs2 = (p, inning, outs, bases, runsInn, score, outsUsed) => {
      if (O.walkoff && inning === batted && score > O.oppFinal) return p === N && runsInn === target[inning - 1]; // walk-off: last PA, exact runs
      if (inning > batted) return p === N && csLeft === 0;
      if (p === N) return false;
      if (totalOutsNeeded !== null) { if (outsLeftInPools() !== totalOutsNeeded - outsUsed) return false; }
      else { const left = outsLeftInPools(), minNeed = 3 * (batted - 1) - outsUsed; if (left + 2 < minNeed || left > minNeed + 2) return false; }
      const need = target[inning - 1] - runsInn; if (need < 0) return false;
      const id = order[p]; const pool = pools[id];
      // optional caught-stealing before this PA (it is an out the box requires somewhere)
      const opts = [];
      for (const t of Object.keys(pool)) if (pool[t] > 0) {
        for (const b of BITS[t] || [0]) opts.push({ t, b }); if (t === 'O' && roeLeft > 0) for (const b of BITS.E) opts.push({ t: 'E', b });
      }
      // order: when runs are still needed try productive outcomes first; otherwise outs first
      const prod = (o) => (['HR', '3B', '2B', '1B'].includes(o.t) ? 3 : ['BB', 'IBB', 'HBP', 'E'].includes(o.t) ? 2 : o.t === 'SF' ? 1 : 0) + (o.b & 1 ? 0.5 : 0);
      shuffle(r, opts); opts.sort((a, b) => (need > 0 ? prod(b) - prod(a) : prod(a) - prod(b)) + (r() - 0.5) * 1.5);
      const tryCS = csLeft > 0 && outs < 2 && ((bases[0] && !bases[1]) || (bases[1] && !bases[2]));
      const tryADV = advLeft > 0 && need > 0 && bases.some(Boolean);
      const pre = [false]; if (tryCS) pre.push('CS'); if (tryADV) pre.push('ADV'); if (r() < 0.3) shuffle(r, pre);
      for (const withCS of pre) {
        let b0 = bases, o0 = outs, inn = inning, ri = runsInn, ou = outsUsed, sc0 = 0;
        if (withCS === 'CS' && O.walkoff && csLeft <= 0) continue;
        if (withCS === 'ADV') { b0 = [null, bases[0], bases[1]]; if (bases[2]) { ri++; sc0 = 1; } if (ri > target[inn - 1]) continue; advLeft--; }
        else if (withCS === 'CS') { b0 = bases.slice(); const i = b0[1] && !b0[2] ? 1 : 0; b0[i] = null; o0++; ou++; csLeft--; if (o0 === 3) { if (ri !== target[inn - 1]) { csLeft++; continue; } inn++; o0 = 0; ri = 0; b0 = O.ghost && inn > 9 ? [null, order[p - 1] || null, null] : [null, null, null]; } }
        const tried = new Set();
        for (const o of opts) {
          const t = o.t === 'E' ? 'O' : o.t; if (pool[t] <= 0) continue;
          { const pre = step(b0, o0, id, o.t, o.b); const key = `${o.t}|${pre.outs}|${pre.sc.length}|${pre.bases.map((x) => (x ? 1 : 0)).join('')}`; if (tried.has(key)) continue; tried.add(key); }
          if (o.t === 'GDP' && !(b0[0] && o0 < 2)) continue; if (o.t === 'SF' && !(b0[2] && o0 < 2)) continue; if (o.t === 'SH' && !(o0 < 2 && b0.some(Boolean))) continue;
          const s = step(b0, o0, id, o.t, o.b); if (s.bad) continue;
          const nr = ri + s.sc.length; if (nr > target[inn - 1]) continue;
          pool[t]--; if (o.t === 'E') roeLeft--;
          path.push({ p, t: o.t, bits: o.b, cs: withCS === 'CS' || withCS === true, adv: withCS === 'ADV' });
          const gained = (OUTV[o.t] || 0);
          let ok;
          if (s.outs >= 3) ok = nr === target[inn - 1] && dfs(p + 1, inn + 1, 0, O.ghost && inn + 1 > 9 ? [null, id, null] : [null, null, null], 0, score + sc0 + s.sc.length, ou + gained);
          else ok = dfs(p + 1, inn, s.outs, s.bases, nr, score + sc0 + s.sc.length, ou + gained);
          if (ok) return true;
          path.pop(); pool[t]++; if (o.t === 'E') roeLeft++;
          if (nodes > nodeLimit) break;
        }
        if (withCS === 'CS' && O.walkoff && csLeft <= 0) continue;
        if (withCS === 'ADV') advLeft++; else if (withCS) csLeft++;
        if (nodes > nodeLimit) break;
      }
      return false;
    };
    if (dfs(0, 1, 0, [null, null, null], 0, 0, 0)) {
      // turn the path into annealing variables
      const perm = Object.fromEntries(Object.keys(O.pools).map((id) => [id, []])); const bits = O.order.map(() => 0); const roe = new Set(); const events = {};
      for (const st of path) { const id = order[st.p]; const k = perm[id].length; perm[id].push(st.t === 'E' ? 'O' : st.t); if (st.t === 'E') roe.add(`${id}:${k}`); bits[st.p] = st.bits; if (st.cs) (events[st.p] ||= []).push({ kind: 'CS' }); if (st.adv) (events[st.p] ||= []).push({ kind: 'WP', err: true }); }
      for (const [id, pool] of Object.entries(O.pools)) { const left = [...pool]; for (const t of perm[id]) left.splice(left.indexOf(t), 1); perm[id].push(...left); }
      return { perm, bits, roe, events };
    }
  }
  return null;
}

// ---------- the offense model ----------
const OUT_TYPES = new Set(['K', 'O', 'SF', 'SH', 'GDP']);
const HIT = new Set(['1B', '2B', '3B', 'HR']);
export function buildOffense(side, box, fullNames) {
  const extra = box.extra; const bat = box[side].bat; const other = side === 'away' ? 'home' : 'away';
  const awayNames = new Set(box.away.bat.map((b) => b.short)), homeNames = new Set(box.home.bat.map((b) => b.short));
  const L = (k) => splitList(listItems(extra[k]), awayNames, homeNames)[side];
  const d2 = L('DOUBLES'), d3 = L('TRIPLES'), hr = L('HOME RUNS'), bb = L('WALKS'), ibb = L('IBB'), hbp = L('HIT BY PITCH'), k = L('STRIKE OUTS'), sf = L('SACRIFICE FLIES'), sh = L('SACRIFICE HITS'), gdp = L('GIDP'), sb = L('STOLEN BASES'), cs = L('CAUGHT STEALING');
  const lists = [d2, d3, hr, bb, ibb, hbp, k, sf, sh, gdp, sb, cs];
  const slots = []; const roster = [];
  bat.forEach((b, idx) => {
    const take = (map) => map[b.short] || 0;
    const full = fullNames[b.short] || b.short;
    const p = { id: `${side}${idx}`, short: b.short, full, lastFull: full.includes(' ') ? full.split(' ').slice(-1)[0].replace(/,$/, '') : b.short.split('.').pop(), pos: b.pos, sub: b.sub, line: b,
      d2: take(d2), d3: take(d3), hr: take(hr), bb: take(bb), ibb: take(ibb), hbp: take(hbp), k: take(k), sf: take(sf), sh: take(sh), gdp: take(gdp), sb: take(sb), cs: take(cs) };
    if (/^(Jr\.?|Sr\.?|II|III|IV)$/.test(p.lastFull)) p.lastFull = full.split(' ').slice(-2)[0];
    for (const m of lists) delete m[b.short]; // a name shared by two players on one team is credited once
    p.single = Math.max(0, b.h - p.d2 - p.d3 - p.hr);
    p.inplay = Math.max(0, b.ab - b.h - p.k - p.gdp);
    p.pa = b.ab + p.bb + p.hbp + p.sf + p.sh;
    roster.push(p);
    if (!b.sub || !slots.length) slots.push([p]); else slots[slots.length - 1].push(p);
  });
  const lineup = slots.slice(0, 9);
  for (const extraSlot of slots.slice(9)) lineup[lineup.length - 1].push(...extraSlot);
  const remaining = new Map(roster.map((p) => [p.id, p.pa])); const order = []; let guard = 0;
  while ([...remaining.values()].some((v) => v > 0) && guard++ < 500) {
    for (const slot of lineup) { const p = slot.find((x) => remaining.get(x.id) > 0); if (p) { order.push(p.id); remaining.set(p.id, remaining.get(p.id) - 1); } }
  }
  const pools = Object.fromEntries(roster.map((p) => [p.id, [
    ...Array(p.single).fill('1B'), ...Array(p.d2).fill('2B'), ...Array(p.d3).fill('3B'), ...Array(p.hr).fill('HR'),
    ...Array(Math.max(0, p.bb - p.ibb)).fill('BB'), ...Array(Math.min(p.ibb, p.bb)).fill('IBB'), ...Array(p.hbp).fill('HBP'),
    ...Array(p.k).fill('K'), ...Array(p.inplay).fill('O'), ...Array(p.sf).fill('SF'), ...Array(p.sh).fill('SH'), ...Array(p.gdp).fill('GDP')]]));
  for (const p of roster) { const n = order.filter((x) => x === p.id).length; while (pools[p.id].length < n) pools[p.id].push('O'); pools[p.id].length = n; }
  const line = side === 'away' ? box.lineAway : box.lineHome; const otherLine = side === 'away' ? box.lineHome : box.lineAway;
  const innings = line.inn.length; const batted = line.inn.filter((x) => x !== null).length;
  const walkoff = side === 'home' && innings >= otherLine.inn.length && line.inn[innings - 1] !== null && line.r > otherLine.r && line.inn[innings - 1] > 0;
  const capOuts = roster.reduce((s, p) => s + p.k + p.inplay + p.sf + p.sh + p.gdp * 2 + p.cs, 0);
  // Reached-on-error count makes the outs add up exactly; for a walk-off the final inning's outs are unknown (0-2).
  let roe = capOuts - 3 * batted;
  if (walkoff) for (const lo of [2, 1, 0]) { const rr = capOuts - (3 * (batted - 1) + lo); if (rr >= 0) { roe = rr; break; } }
  const pitchers = box[other].pit;
  const wpItems = ['WILD PITCHES', 'PASSED BALLS', 'BALKS'].flatMap((k2) => listItems(extra[k2]));
  const ourPitchersAndCatchers = new Set([...pitchers.map((x) => x.short), ...box[other].bat.filter((b) => /^C$/.test(b.pos)).map((b) => b.short)]);
  const wp = wpItems.filter((x) => ourPitchersAndCatchers.has(x.name)).reduce((a, x) => a + x.n, 0);
  const fielders = new Set([...box[other].bat.map((b) => b.short), ...pitchers.map((x) => x.short)]);
  const errs = listItems(extra.ERRORS).filter((x) => fielders.has(x.name)).reduce((a, x) => a + x.n, 0);
  const advErr = Math.max(0, errs - Math.max(0, roe));
  const extraOuts = walkoff ? 0 : Math.max(0, -roe);
  return { side, roster, byId: Object.fromEntries(roster.map((p) => [p.id, p])), order, pools, runs: line.inn, batted, walkoff, roe: Math.max(0, roe), advErr, extraOuts,
    cats: { sb: roster.flatMap((p) => Array(p.sb).fill(p.id)), cs: roster.flatMap((p) => Array(p.cs).fill(p.id)) }, pitchers, wp: Math.min(wp, 4), oppFinal: otherLine.r };
}

// Simulate one offense given the decision variables; returns cost and, when asked, a play log.
export function simulate(O, V, clues, gems, log) {
  const { order } = O; const bases = [null, null, null]; const R = {}, RBI = {}; let outs = 0, inning = 1, cost = 0, done = false;
  const innRuns = Array(O.runs.length).fill(0); const plays = []; let score = 0;
  const seen = {}; const paInfo = [];
  const lead = () => O.side === 'home' && O.walkoff && inning === O.batted && score > O.oppFinal;
  const scoreRun = (id, rbiTo) => { if (!id) return; innRuns[inning - 1] = (innRuns[inning - 1] || 0) + 1; score++; R[id] = (R[id] || 0) + 1; if (rbiTo) RBI[rbiTo] = (RBI[rbiTo] || 0) + 1; };
  const endInning = () => { inning++; outs = 0; bases[0] = bases[1] = bases[2] = null; ghostPending = O.ghost && inning > 9; };
  let ghostPending = false;
  for (let p = 0; p < order.length; p++) {
    if (ghostPending) { bases[1] = order[p - 1] || null; ghostPending = false; if (log) plays.push({ inning, outs, kind: 'GHOST', runner: bases[1], bases: bases.slice(), scored: [] }); }
    if (done) { cost += 120; continue; }
    for (const ev of V.events[p] || []) {
      if (done || inning > O.batted) break;
      const before = bases.slice();
      if (ev.kind === 'SB') { const i = bases[1] && !bases[2] ? 1 : bases[0] && !bases[1] ? 0 : -1; if (i < 0) { cost += 8; continue; } bases[i + 1] = bases[i]; bases[i] = null; if (log) plays.push({ inning, outs, kind: 'SB', runner: bases[i + 1], to: i + 2, bases: bases.slice(), scored: [] }); }
      else if (ev.kind === 'CS') { const i = bases[1] && !bases[2] ? 1 : bases[0] && !bases[1] ? 0 : -1; if (i < 0) { cost += 8; continue; } const rr = bases[i]; bases[i] = null; outs++; if (log) plays.push({ inning, outs, kind: 'CS', runner: rr, to: i + 2, bases: bases.slice(), scored: [] }); if (outs === 3) endInning(); }
      else if (ev.kind === 'WP') { if (!bases.some(Boolean)) { cost += 2; continue; } const r3 = bases[2]; bases[2] = bases[1]; bases[1] = bases[0]; bases[0] = null; const sc = []; if (r3) { scoreRun(r3, null); sc.push(r3); } if (log) plays.push({ inning, outs, kind: 'WP', err: !!ev.err, scored: sc, before, bases: bases.slice() }); if (lead()) done = true; }
    }
    if (done) { cost += 120; continue; }
    if (inning > O.batted) { cost += 200; continue; }
    const id = order[p]; const k = (seen[id] = (seen[id] || 0) + 1) - 1; const type = V.perm[id][k]; const bits = V.bits[p];
    const t = type === 'O' && V.roe.has(`${id}:${k}`) ? 'E' : type;
    const before = bases.slice(); const outsBefore = outs;
    const st = step(bases, outs, id, t, bits); cost += st.bad;
    for (const x of st.sc) scoreRun(x, st.rbi);
    bases[0] = st.bases[0]; bases[1] = st.bases[1]; bases[2] = st.bases[2]; outs = st.outs; const sc = st.sc;
    paInfo.push({ id, t, inning, outsBefore });
    if (log) plays.push({ inning, outs, kind: 'PA', id, t, before, bases: bases.slice(), scored: sc, outsBefore });
    if (outs >= 3) endInning(); else if (lead()) done = true;
  }
  const completed = inning - 1;
  if (O.walkoff) { if (!done) cost += 150; cost += 100 * Math.abs(completed - (O.batted - 1)); }
  else cost += 100 * Math.abs(completed - O.batted) + 40 * outs;
  for (let i = 0; i < O.runs.length; i++) if (O.runs[i] !== null) cost += 150 * Math.abs((innRuns[i] || 0) - O.runs[i]);
  for (const p of O.roster) cost += 4 * Math.abs((R[p.id] || 0) - p.line.r) + 4 * Math.abs((RBI[p.id] || 0) - p.line.rbi);
  for (const c of clues) if (!paInfo.some((x) => x.id === c.id && x.inning === c.inning && x.t === c.type)) cost += 9;
  for (const g of gems) if (!paInfo.some((x) => x.id === g.id && x.inning === g.inning && x.t === 'O')) cost += 6;
  cost += pitcherFit(O, paInfo).cost;
  return { cost, plays, paInfo, innRuns };
}

// Split plate appearances among the fielding team's pitchers: each pitcher's outs are fixed by his IP; who faced
// the extra batters before the next out is fitted to his hits and walks.
function pitcherFit(O, paInfo) {
  const P = O.pitchers; if (!P.length) return { cost: 0, owner: [] };
  const outsOf = (x) => (x.t === 'GDP' ? 2 : OUT_TYPES.has(x.t) ? 1 : 0);
  const owner = []; let idx = 0; let cost = 0;
  for (let pi = 0; pi < P.length; pi++) {
    const p = P[pi]; let got = 0, h = 0, bb = 0, so = 0, hr = 0;
    const take = () => { const x = paInfo[idx]; got += outsOf(x); h += HIT.has(x.t); bb += x.t === 'BB' || x.t === 'IBB'; so += x.t === 'K'; hr += x.t === 'HR'; owner[idx++] = pi; };
    while (idx < paInfo.length && got < p.outs) take();
    if (pi === P.length - 1) while (idx < paInfo.length) take();
    else while (idx < paInfo.length && !outsOf(paInfo[idx]) && (h < p.h || bb < p.bb)) take();
    cost += 1.5 * (Math.abs(h - p.h) + Math.abs(bb - p.bb) + Math.abs(so - p.so)) + 2 * Math.abs(hr - p.hr);
  }
  return { cost, owner };
}

export function solveOffense(O, clues, gems, seed) {
  const r = rng(seed);
  const outSlots = (perm, roe) => { const a = []; for (const [id, pool] of Object.entries(perm)) pool.forEach((t, k) => { if (t === 'O' && !(roe && roe.has(`${id}:${k}`))) a.push(`${id}:${k}`); }); return a; };
  const initVars = () => {
    const perm = Object.fromEntries(Object.entries(O.pools).map(([id, pool]) => [id, shuffle(r, [...pool])]));
    const bits = O.order.map(() => (r() < 0.5 ? 1 : 0) | (r() < 0.3 ? 2 : 0));
    const roe = new Set(shuffle(r, outSlots(perm)).slice(0, O.roe));
    const events = {}; const put = (kind, id) => { const p = 1 + Math.floor(r() * Math.max(1, O.order.length - 1)); (events[p] ||= []).push({ kind, id }); };
    O.cats.sb.forEach((id) => put('SB', id)); O.cats.cs.forEach((id) => put('CS', id)); for (let i = 0; i < O.wp; i++) put('WP');
    return { perm, bits, roe, events };
  };
  const clone = (V) => ({ perm: Object.fromEntries(Object.entries(V.perm).map(([k, v]) => [k, v.slice()])), bits: V.bits.slice(), roe: new Set(V.roe), events: Object.fromEntries(Object.entries(V.events).map(([k, v]) => [k, v.slice()])) });
  const ids = Object.keys(O.pools).filter((id) => O.pools[id].length > 1);
  // 1) exact search for an order that reproduces every inning's runs
  let seedV = exactSearch(O, r);
  if (!seedV && O.runs.length > 9) { O.ghost = true; seedV = exactSearch(O, r); if (!seedV) O.ghost = false; }
  if (seedV) {
    const exactOK = (V) => { const s = simulate(O, V, [], [], false); return O.runs.every((x, i) => x === null || x === (s.innRuns[i] || 0)) && s.cost < 150; };
    // add stolen bases / wild pitches where they don't disturb the scoring
    for (const [kind, list] of [['SB', O.cats.sb], ['WP', Array(O.wp).fill(null)]]) for (const id of list) {
      for (let tries = 0; tries < 25; tries++) { const p = 1 + Math.floor(r() * Math.max(1, O.order.length - 1)); const W = clone(seedV); (W.events[p] ||= []).push({ kind, id }); if (exactOK(W)) { seedV.events = W.events; break; } }
    }
    // 2) polish: R/RBI per batter, pitcher lines, story moments, web gems, without breaking the innings
    let V = seedV; let c = simulate(O, V, clues, gems).cost; let best = clone(V), bestCost = c; let T = 6;
    for (let it = 0; it < 7000 && c > 0; it++) {
      const W = clone(V); const m = r();
      if (m < 0.6 && ids.length) { const id = pickR(r, ids); const a = W.perm[id]; const i = Math.floor(r() * a.length), j = Math.floor(r() * a.length); const mi = W.roe.has(`${id}:${i}`), mj = W.roe.has(`${id}:${j}`); [a[i], a[j]] = [a[j], a[i]]; W.roe.delete(`${id}:${i}`); W.roe.delete(`${id}:${j}`); if (mi) W.roe.add(`${id}:${j}`); if (mj) W.roe.add(`${id}:${i}`); }
      else { const p = Math.floor(r() * W.bits.length); W.bits[p] = Math.floor(r() * 4); }
      const res = simulate(O, W, clues, gems);
      if (!O.runs.every((x, i) => x === null || x === (res.innRuns[i] || 0))) continue; // innings are a hard rule here
      const c2 = res.cost;
      if (c2 <= c || r() < Math.exp((c - c2) / T)) { V = W; c = c2; }
      if (c < bestCost) { bestCost = c; best = clone(V); }
      T = Math.max(0.2, T * 0.999);
    }
    return { V: best, cost: bestCost };
  }
  // 3) fallback: pure annealing
  let best = null; let bestCost = Infinity; let bestExact = false;
  const exactRuns = (V) => { const s = simulate(O, V, [], [], false); return O.runs.every((x, i) => x === null || x === (s.innRuns[i] || 0)); };
  for (let restart = 0; restart < 12 && !(bestExact && bestCost < 80) && !(restart >= 4 && bestExact); restart++) {
    let V = initVars(); let c = simulate(O, V, clues, gems).cost; let T = 60;
    for (let it = 0; it < 9000 && c > 0; it++) {
      const W = clone(V); const m = r();
      if (m < 0.5 && ids.length) {
        const id = pickR(r, ids); const a = W.perm[id]; const i = Math.floor(r() * a.length), j = Math.floor(r() * a.length);
        // error marks follow the out they were attached to
        const mi = W.roe.has(`${id}:${i}`), mj = W.roe.has(`${id}:${j}`);
        [a[i], a[j]] = [a[j], a[i]];
        W.roe.delete(`${id}:${i}`); W.roe.delete(`${id}:${j}`); if (mi) W.roe.add(`${id}:${j}`); if (mj) W.roe.add(`${id}:${i}`);
      } else if (m < 0.8) { const p = Math.floor(r() * W.bits.length); W.bits[p] = Math.floor(r() * 4); }
      else if (m < 0.92) { const keys = Object.keys(W.events).filter((k) => W.events[k].length); if (keys.length) { const k = pickR(r, keys); const ev = W.events[k].pop(); const p = 1 + Math.floor(r() * Math.max(1, O.order.length - 1)); (W.events[p] ||= []).push(ev); } }
      else if (W.roe.size) { const free = outSlots(W.perm, W.roe); if (free.length) { const o = pickR(r, [...W.roe]); W.roe.delete(o); W.roe.add(pickR(r, free)); } }
      const c2 = simulate(O, W, clues, gems).cost;
      if (c2 <= c || r() < Math.exp((c - c2) / T)) { V = W; c = c2; }
      if (c < bestCost) { bestCost = c; best = clone(V); }
      T = Math.max(0.3, T * 0.9992);
    }
    bestExact = exactRuns(best);
  }
  return { V: best, cost: bestCost };
}

// ---------- turn a solved offense into readable plays ----------
const WHERE = { gb: ['shortstop', 'second', 'third', 'first', 'the pitcher'], fly: ['center', 'left', 'right'], hit: ['left', 'center', 'right', 'left-center', 'right-center'] };
function narrate(pl, nm, r, gem) {
  const b = nm(pl.id); const sc = pl.scored.map((x) => nm(x, true));
  const scoreTxt = sc.length ? ` ${sc.join(sc.length > 2 ? ', ' : ' and ')} ${sc.length > 1 ? 'score' : 'scores'}.` : '';
  const to = pickR(r, WHERE.hit);
  switch (pl.t) {
    case 'HR': { const n = pl.scored.length; return n === 4 ? `${b} hits a grand slam to ${to}!` : n === 1 ? `${b} hits a solo home run to ${to}!` : `${b} hits a ${['', '', 'two', 'three'][n]}-run homer to ${to}!`; }
    case '3B': return `${b} triples into the ${to} gap.${scoreTxt}`;
    case '2B': return `${b} doubles to ${to}.${scoreTxt}`;
    case '1B': return `${b} ${pickR(r, ['singles to', 'lines a single to', 'grounds a single to', 'bloops a single to'])} ${to}.${scoreTxt}`;
    case 'BB': return `${b} walks.${scoreTxt}`;
    case 'IBB': return `${b} is intentionally walked.${scoreTxt}`;
    case 'HBP': return `${b} is hit by a pitch.${scoreTxt}`;
    case 'E': return `${b} reaches on an error.${scoreTxt}`;
    case 'K': return `${b} strikes out ${pickR(r, ['swinging', 'looking', 'swinging'])}.`;
    case 'SF': return `${b} hits a sacrifice fly to ${pickR(r, WHERE.fly)}.${scoreTxt}`;
    case 'SH': return `${b} lays down a sacrifice bunt.${scoreTxt}`;
    case 'GDP': return `${b} grounds into a double play.${scoreTxt}`;
    case 'O': {
      if (gem) return `${gem.fielder} robs ${b} of ${gem.what}!`;
      const k = r();
      return `${b} ${k < 0.5 ? 'grounds out to' : k < 0.75 ? 'flies out to' : k < 0.9 ? 'lines out to' : 'pops out to'} ${k < 0.5 ? pickR(r, WHERE.gb) : pickR(r, WHERE.fly)}.${scoreTxt}`;
    }
  }
  return `${b} bats.`;
}

export function buildGamecast(date, story, block, abbrAway, abbrHome) {
  const box = parseBox(block.text); if (!box) return null;
  const P = players();
  const nameMap = (ab) => Object.fromEntries([...P.batters, ...P.pitchers].filter((p) => p.team === ab).map((p) => [p.short, p.name]));
  const fullA = nameMap(abbrAway), fullH = nameMap(abbrHome);
  const OA = buildOffense('away', box, fullA), OH = buildOffense('home', box, fullH);
  const rosters = { away: OA.roster, home: OH.roster };
  const clues = storyClues(story, rosters); const gems = gemClues(box.extra['WEB GEMS'], rosters);
  const solved = {};
  for (const [side, O] of [['away', OA], ['home', OH]]) {
    const s = solveOffense(O, clues.filter((c) => c.side === side), gems.filter((g) => g.side === side), `${date}${abbrAway}${abbrHome}${side}`);
    const run = simulate(O, s.V, [], [], true);
    solved[side] = { O, cost: s.cost, run, owner: pitcherFit(O, run.paInfo).owner, fullPit: side === 'away' ? fullH : fullA };
  }
  const r = rng(`${date}${abbrAway}${abbrHome}words`);
  const usedGems = new Set(); const plays = []; const innings = Math.max(box.lineAway.inn.length, box.lineHome.inn.length);
  const lastPitcher = { away: null, home: null }; const score = [0, 0];
  for (let inning = 1; inning <= innings; inning++) {
    for (const side of ['away', 'home']) {
      if (side === 'home' && box.lineHome.inn[inning - 1] == null) continue;
      const { O, run, owner, fullPit } = solved[side];
      const nm = (id, short) => { const p = O.byId[id]; return !p ? '' : short ? p.lastFull : p.full; };
      let pa = -1;
      for (const pl of run.plays) {
        if (pl.kind === 'PA') pa++;
        if (pl.inning !== inning) continue;
        const si = side === 'away' ? 0 : 1; score[si] += pl.scored.length;
        const basesNames = pl.bases.map((x) => (x ? O.byId[x]?.lastFull || '' : null));
        const common = { side, inning, outs: pl.outs, bases: basesNames, runs: pl.scored.length, score: score.slice() };
        if (pl.kind === 'PA') {
          const pit = O.pitchers[owner[pa]]; const pitName = pit ? fullPit[pit.short] || pit.short : null;
          if (pitName && pitName !== lastPitcher[side]) {
            if (lastPitcher[side]) plays.push({ side, inning, outs: pl.outsBefore, bases: pl.before.map((x) => (x ? O.byId[x]?.lastFull || '' : null)), runs: 0, score: [score[0] - (si === 0 ? pl.scored.length : 0), score[1] - (si === 1 ? pl.scored.length : 0)], t: 'CHANGE', text: `Pitching change: ${pitName} takes the mound.` });
            lastPitcher[side] = pitName;
          }
          const gi = pl.t === 'O' ? gems.findIndex((g, i) => g.side === side && g.inning === inning && g.id === pl.id && !usedGems.has(i)) : -1;
          if (gi >= 0) usedGems.add(gi);
          plays.push({ ...common, t: pl.t, batter: O.byId[pl.id].full, batterId: pl.id, pitcher: pitName, text: narrate(pl, nm, r, gi >= 0 ? gems[gi] : null), big: pl.scored.length > 0 || pl.t === 'HR' || gi >= 0, gem: gi >= 0 });
        } else if (pl.kind === 'SB') plays.push({ ...common, t: 'SB', text: `${nm(pl.runner)} steals ${['', '', 'second', 'third'][pl.to]}.` });
        else if (pl.kind === 'CS') plays.push({ ...common, t: 'CS', text: `${nm(pl.runner)} is caught stealing ${['', '', 'second', 'third'][pl.to]}.` });
        else if (pl.kind === 'GHOST') plays.push({ ...common, t: 'GHOST', text: `${nm(pl.runner)} starts the inning on second base.` });
        else if (pl.kind === 'WP') plays.push({ ...common, t: 'WP', big: pl.scored.length > 0, text: `${pl.err ? 'An error lets the runners move up.' : 'A wild pitch moves the runners up.'}${pl.scored.length ? ` ${pl.scored.map((x) => nm(x, true)).join(' and ')} scores.` : ''}` });
      }
    }
  }
  const exact = box.lineAway.inn.every((x, i) => x == null || x === solved.away.run.innRuns[i]) && box.lineHome.inn.every((x, i) => x == null || x === solved.home.run.innRuns[i]);
  if (!exact) {
    // Safety net: make every half-inning's runs match the box score so the replay always ends on the real final.
    for (const [sd, line] of [['away', box.lineAway], ['home', box.lineHome]]) line.inn.forEach((want, i) => {
      if (want == null) return;
      const halfIdx = plays.map((pl, k) => (pl.side === sd && pl.inning === i + 1 ? k : -1)).filter((k) => k >= 0);
      const got = halfIdx.reduce((a, k) => a + (plays[k].runs || 0), 0); let diff = want - got;
      for (let j = halfIdx.length - 1; diff < 0 && j >= 0; j--) { const pl = plays[halfIdx[j]]; const take = Math.min(pl.runs || 0, -diff); pl.runs -= take; diff += take; if (take) pl.text = pl.text.replace(/\s*[A-Z][^.]*\bscores?\.$/, ''); }
      if (diff > 0 && halfIdx.length) {
        const lastK = halfIdx[halfIdx.length - 1]; const at = plays[lastK].outs >= 3 ? lastK : lastK + 1; const ref = plays[Math.max(halfIdx[0], at - 1)];
        plays.splice(at, 0, { side: sd, inning: i + 1, outs: Math.min(2, ref.outs), bases: ref.bases, runs: diff, t: 'RUN', big: true, text: diff === 1 ? 'A run comes around to score.' : `${diff} runs come around to score.` });
      }
    });
    const sc = [0, 0]; for (const pl of plays) { sc[pl.side === 'away' ? 0 : 1] += pl.runs || 0; pl.score = sc.slice(); }
  }
  const side = (s, ab) => ({ abbr: ab, roster: solved[s].O.roster.map((p) => ({ id: p.id, name: p.full, pos: p.pos, sub: !!p.sub, ab: p.line.ab, r: p.line.r, h: p.line.h, rbi: p.line.rbi })) });
  return { date, away: side('away', abbrAway), home: side('home', abbrHome), innings, plays, final: { away: box.lineAway, home: box.lineHome },
    exact, cost: Math.round(solved.away.cost + solved.home.cost),
    pitchers: { away: box.away.pit.map((p) => ({ ...p, name: fullA[p.short] || p.short })), home: box.home.pit.map((p) => ({ ...p, name: fullH[p.short] || p.short })) },
    story: story ? story.paragraphs : [] };
}

export function gamecastsFor(date) {
  const P = newspaper(date); if (!P) return [];
  const out = [];
  for (const s of P.stories) {
    if (!s.away || !s.home) continue;
    const block = P.blocks.find((b) => b.id === `box-${s.id}`); if (!block) continue;
    try { const g = buildGamecast(date, s, block, s.away, s.home); if (g) out.push({ id: s.id, ...g }); }
    catch (e) { console.warn('gamecast failed', date, s.id, e.message); }
  }
  return out;
}
