// Watch mode player. Loads one reconstructed game and plays it back batter by batter:
// scorebug, line score, play-by-play, who's up, and a box score that fills in as the game goes.
(() => {
  const root = document.getElementById('gc'); if (!root) return;
  const T = JSON.parse(root.dataset.teams);
  const $ = (s) => root.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
  const HIT = new Set(['1B', '2B', '3B', 'HR']); const NOT_AB = new Set(['BB', 'IBB', 'HBP', 'SF', 'SH']);
  const PA = new Set(['1B', '2B', '3B', 'HR', 'BB', 'IBB', 'HBP', 'E', 'K', 'O', 'SF', 'SH', 'GDP']);
  const OUTS = { K: 1, O: 1, SF: 1, SH: 1, GDP: 2 };
  const SIDES = ['away', 'home'];
  let G = null, i = -1, shown = 0, timer = null, playing = false, speed = 2400;
  let byName = {}; // per side: last name / full name -> roster id
  const btn = (a) => root.querySelector(`[data-act="${a}"]`);

  fetch(root.dataset.src).then((r) => r.json()).then((g) => {
    G = g; if (!g.exact) $('.gc-note').textContent += ' A few runs in this game could not be placed exactly, so parts of it are approximate.';
    for (const s of SIDES) { byName[s] = {}; for (const p of G[s].roster) { byName[s][p.name] = p.id; const last = p.name.split(' ').slice(1).join(' ') || p.name; byName[s][last] ??= p.id; } }
    // Batting-order slot: a substitute is listed right under the player he replaced.
    for (const s of SIDES) { let slot = 0; for (const p of G[s].roster) { if (!p.sub) slot++; p.slot = Math.max(1, slot); } }
    render();
  }).catch(() => { $('.gc-wait').textContent = 'This game could not be loaded.'; });

  const idOf = (side, p) => p.batterId || byName[side]?.[p.batter] || p.batter;
  const runnerId = (side, short) => byName[side]?.[short] || null;

  function tally(upto) {
    const runs = { away: Array(G.innings).fill(null), home: Array(G.innings).fill(null) }, hits = { away: 0, home: 0 };
    const bat = {}, pit = {}, used = { away: [], home: [] };
    const B = (id) => (bat[id] ||= { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0, hr: 0, d: 0, t: 0 });
    for (let k = 0; k <= upto; k++) {
      const p = G.plays[k]; const s = p.side; const prev = G.plays[k - 1];
      runs[s][p.inning - 1] = (runs[s][p.inning - 1] || 0) + (p.runs || 0);
      if (HIT.has(p.t)) hits[s]++;
      if (p.batter && PA.has(p.t)) {
        const b = B(idOf(s, p)); if (!NOT_AB.has(p.t)) b.ab++; if (HIT.has(p.t)) b.h++; if (p.t === 'HR') b.hr++; if (p.t === '2B') b.d++; if (p.t === '3B') b.t++;
        if (['BB', 'IBB'].includes(p.t)) b.bb++; if (p.t === 'K') b.k++; if (!['E', 'GDP'].includes(p.t)) b.rbi += p.runs || 0;
      }
      // Who scored: runners who were on base before the play (lead runner first), then the batter on a homer.
      if (p.runs) {
        const before = prev && prev.side === s && prev.inning === p.inning && prev.outs < 3 ? prev.bases || [] : [];
        const after = new Set((p.bases || []).filter(Boolean));
        const cand = [before[2], before[1], before[0]].filter(Boolean).filter((n) => !after.has(n)).map((n) => runnerId(s, n));
        if (p.t === 'HR' && p.batter) cand.push(idOf(s, p));
        cand.filter(Boolean).slice(0, p.runs).forEach((id) => B(id).r++);
      }
      if (p.pitcher && PA.has(p.t)) {
        const ps = s === 'away' ? 'home' : 'away';
        if (!used[ps].includes(p.pitcher)) used[ps].push(p.pitcher);
        const q = (pit[p.pitcher] ||= { outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0 }); q.outs += OUTS[p.t] || 0; if (HIT.has(p.t)) q.h++; if (p.t === 'HR') q.hr++; if (p.t === 'K') q.k++; if (['BB', 'IBB'].includes(p.t)) q.bb++; q.r += p.runs || 0;
      } else if (p.pitcher && p.t === 'CS') { const q = pit[p.pitcher]; if (q) q.outs++; }
    }
    return { runs, hits, bat, pit, used };
  }
  const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
  const ip = (outs) => `${Math.floor(outs / 3)}.${outs % 3}`;
  // The next plate appearance after play i: that's who is actually up, and who he faces.
  function upNext() { for (let k = i + 1; k < G.plays.length; k++) { const q = G.plays[k]; if (q.batter && PA.has(q.t)) return q; } return null; }
  function todayLine(b) {
    if (!b || (!b.ab && !b.bb)) return 'First time up today';
    const xs = [`${b.h}-for-${b.ab}`]; if (b.hr) xs.push(b.hr > 1 ? `${b.hr} HR` : 'HR'); if (b.t) xs.push(b.t > 1 ? `${b.t} 3B` : '3B'); if (b.d) xs.push(b.d > 1 ? `${b.d} 2B` : '2B');
    if (b.rbi) xs.push(`${b.rbi} RBI`); if (b.bb) xs.push(b.bb > 1 ? `${b.bb} BB` : 'BB'); if (b.k) xs.push(b.k > 1 ? `${b.k} K` : 'K'); return xs.join(', ') + ' today';
  }

  function render() {
    if (!G) return;
    const done = i >= G.plays.length - 1; const p = G.plays[Math.max(0, i)];
    const t = tally(i);
    // scorebug
    $('[data-k="away"]').textContent = i < 0 ? 0 : sum(t.runs.away);
    $('[data-k="home"]').textContent = i < 0 ? 0 : sum(t.runs.home);
    const half = p.side === 'away' ? 'Top' : 'Bottom';
    $('.gc-inning').textContent = i < 0 ? 'Pregame' : done ? (G.innings > 9 ? `Final, ${G.innings} innings` : 'Final') : p.outs >= 3 ? `End of the ${half.toLowerCase()} of the ${ord(p.inning)}` : `${half} ${ord(p.inning)}`;
    const bases = i < 0 || p.outs >= 3 || done ? [null, null, null] : p.bases || [null, null, null];
    ['b1', 'b2', 'b3'].forEach((c, k) => { const el = $(`.${c}`); el.classList.toggle('on', !!bases[k]); el.setAttribute('aria-label', bases[k] ? `${bases[k]} on ${['first', 'second', 'third'][k]}` : ''); });
    root.querySelectorAll('.gc-outs i').forEach((el, k) => el.classList.toggle('on', i >= 0 && !done && k < Math.min(3, p.outs)));
    // line score
    const n = G.innings;
    $('.gc-line thead').innerHTML = `<tr><th></th>${Array.from({ length: n }, (_, k) => `<th class="num">${k + 1}</th>`).join('')}<th class="num">R</th><th class="num">H</th><th class="num">E</th></tr>`;
    $('.gc-line tbody').innerHTML = SIDES.map((s) => `<tr><td class="nowrap">${T[s].logo ? `<img class="logo-sm" src="${esc(T[s].logo)}" alt="">` : ''}<span class="full">${esc(T[s].city)}</span><span class="ab">${esc(T[s].abbr)}</span></td>${t.runs[s].map((r, k) => `<td class="num">${r == null ? (done && s === 'home' && G.final.home.inn[k] == null ? 'x' : '') : r}</td>`).join('')}<td class="num tot">${i < 0 ? 0 : sum(t.runs[s])}</td><td class="num tot">${t.hits[s]}</td><td class="num tot">${done ? G.final[s].e : '-'}</td></tr>`).join('');
    // feed (newest first, grouped by half-inning)
    const ol = $('.gc-feed ol');
    for (; shown <= i; shown++) {
      const q = G.plays[shown]; const prev = G.plays[shown - 1];
      if (!prev || prev.inning !== q.inning || prev.side !== q.side) {
        const h = document.createElement('li'); h.className = 'gc-half'; h.textContent = `${q.side === 'away' ? 'Top' : 'Bottom'} of the ${ord(q.inning)}: ${T[q.side].city} batting`; ol.prepend(h);
      }
      const li = document.createElement('li'); li.className = `${q.big ? 'big' : ''} ${q.gem ? 'gem' : ''} ${q.t === 'CHANGE' ? 'change' : ''}`.trim();
      li.innerHTML = `<span class="txt">${esc(q.text)}</span><span class="meta">${q.runs ? `<b>${esc(T.away.abbr)} ${q.score[0]}, ${esc(T.home.abbr)} ${q.score[1]}</b>` : ''}${PA.has(q.t) || q.t === 'CS' ? `${['0', '1', '2', '3'][Math.min(3, q.outs)]} out${q.outs === 1 ? '' : 's'}` : ''}</span>`;
      ol.prepend(li);
      if (q.outs >= 3 && PA.has(q.t) || (q.outs >= 3 && q.t === 'CS')) { const e = document.createElement('li'); e.className = 'gc-endhalf'; e.textContent = `End of the ${q.side === 'away' ? 'top' : 'bottom'} of the ${ord(q.inning)}. ${T.away.city} ${q.score[0]}, ${T.home.city} ${q.score[1]}.`; ol.prepend(e); }
    }
    $('.gc-wait').hidden = i >= 0;
    // who's up (the next batter, not the one who just finished) and who he faces
    const nx = done ? null : upNext(); let upId = null;
    $('.gc-up').hidden = !nx;
    if (nx) {
      upId = idOf(nx.side, nx);
      const newHalf = i < 0 || p.outs >= 3 || p.side !== nx.side;
      const who = G[nx.side].roster.find((r) => r.id === upId);
      $('[data-k="uplabel"]').textContent = newHalf ? `Leading off for ${T[nx.side].city}${i < 0 ? '' : `, ${nx.side === 'away' ? 'top' : 'bottom'} of the ${ord(nx.inning)}`}` : `At bat for ${T[nx.side].city}`;
      $('[data-k="batter"]').textContent = nx.batter + (who && /^[A-Z0-9]{1,2}$/.test(who.pos) ? `, ${who.pos}` : '');
      $('[data-k="bline"]').textContent = todayLine(t.bat[upId]);
      const q = t.pit[nx.pitcher];
      $('[data-k="pitcher"]').textContent = nx.pitcher || '-';
      $('[data-k="pline"]').textContent = q ? `${ip(q.outs)} IP, ${q.h} H, ${q.r} R, ${q.bb} BB, ${q.k} K` : 'Just getting started';
    }
    box(t, done, upId);
    // final
    const end = $('.gc-end'); end.hidden = !done;
    if (done) {
      const a = sum(t.runs.away), h = sum(t.runs.home); const w = a > h ? 'away' : 'home';
      $('[data-k="finaltxt"]').textContent = `${T[w].city} ${T[w].nick} win, ${Math.max(a, h)} to ${Math.min(a, h)}${G.innings > 9 ? ` in ${G.innings} innings` : ''}.`;
      $('[data-k="storylink"]').href = root.dataset.story;
      stop(); ['play', 'step', 'inning', 'final'].forEach((x) => (btn(x).disabled = true));
    }
  }

  // Lineups and box score so far. At the final it switches to the official Strat box score.
  function box(t, done, upId) {
    const el = $('.gc-box'); if (i < 0) { el.innerHTML = SIDES.map((s) => lineup(s, t, false, null)).join(''); return; }
    el.innerHTML = SIDES.map((s) => lineup(s, t, done, upId)).join('');
  }
  function lineup(s, t, done, upId) {
    const rows = G[s].roster.filter((r) => !r.sub || done || t.bat[r.id]);
    const cell = (r, k) => { if (done) return r[k] ?? 0; const b = t.bat[r.id]; return b ? b[k] : 0; };
    const bt = `<table class="gc-bt"><thead><tr><th>${esc(T[s].city)}</th><th class="num">AB</th><th class="num">R</th><th class="num">H</th><th class="num">RBI</th>${done ? '' : '<th class="num">BB</th><th class="num">K</th>'}</tr></thead><tbody>${rows.map((r) =>
      `<tr class="${r.id === upId ? 'up' : ''} ${r.sub ? 'sub' : ''}"><td><span class="slot">${r.sub ? '' : r.slot}</span>${esc(r.name)} <span class="pos">${esc(r.pos)}</span></td><td class="num">${cell(r, 'ab')}</td><td class="num">${cell(r, 'r')}</td><td class="num">${cell(r, 'h')}</td><td class="num">${cell(r, 'rbi')}</td>${done ? '' : `<td class="num">${cell(r, 'bb')}</td><td class="num">${cell(r, 'k')}</td>`}</tr>`).join('')}</tbody></table>`;
    const staff = done ? (G.pitchers?.[s] || []).map((q) => ({ name: q.name || q.short, outs: q.outs, h: q.h, r: q.r, bb: q.bb, k: q.so, dec: q.dec }))
      : t.used[s].map((name) => ({ name, ...t.pit[name] }));
    const pt = staff.length ? `<table class="gc-pt"><thead><tr><th>Pitching</th><th class="num">IP</th><th class="num">H</th><th class="num">R</th><th class="num">BB</th><th class="num">K</th></tr></thead><tbody>${staff.map((q) =>
      `<tr><td>${esc(q.name)}${q.dec ? ` <span class="pos">${esc({ WIN: 'W', LOSS: 'L', SAVE: 'S', HOLD: 'H' }[q.dec] || q.dec)}</span>` : ''}</td><td class="num">${ip(q.outs || 0)}</td><td class="num">${q.h || 0}</td><td class="num">${q.r || 0}</td><td class="num">${q.bb || 0}</td><td class="num">${q.k || 0}</td></tr>`).join('')}</tbody></table>` : '';
    return `<div class="gc-team-box">${bt}${pt}</div>`;
  }

  function advance() { if (!G || i >= G.plays.length - 1) return false; i++; render(); return true; }
  function delayFor(p) { const next = G.plays[i + 1]; let d = speed; if (p && p.big) d *= 1.5; if (p && next && (next.side !== p.side || next.inning !== p.inning)) d *= 1.8; return d; }
  function tick() { if (!playing) return; if (!advance()) return; timer = setTimeout(tick, delayFor(G.plays[i])); }
  function start() { if (!G) return; playing = true; btn('play').textContent = 'Pause'; tick(); }
  function stop() { playing = false; clearTimeout(timer); btn('play').textContent = i < 0 ? 'Play ball' : G && i >= G.plays.length - 1 ? 'Final' : 'Resume'; }

  btn('play').onclick = () => (playing ? stop() : start());
  btn('step').onclick = () => { stop(); advance(); };
  btn('inning').onclick = () => { stop(); if (!G) return; const cur = G.plays[Math.max(0, i)]; const key = i < 0 ? null : `${cur.side}${cur.inning}`; if (i >= 0 && cur.outs >= 3) { advance(); return; } while (i < G.plays.length - 1) { advance(); const q = G.plays[i]; if (key && `${q.side}${q.inning}` !== key) { i--; shown = Math.min(shown, i + 1); break; } if (q.outs >= 3) break; } render(); };
  btn('final').onclick = () => { if (!G) return; if (!confirm('Jump to the final score?')) return; stop(); i = G.plays.length - 1; render(); };
  root.querySelector('[data-act="speed"]').onchange = (e) => { speed = +e.target.value; };
  document.addEventListener('keydown', (e) => { if (e.target.closest('input,select,textarea')) return; if (e.code === 'Space') { e.preventDefault(); playing ? stop() : start(); } if (e.code === 'ArrowRight') { stop(); advance(); } });
})();
