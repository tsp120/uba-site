// Watch mode player. Loads one reconstructed game and plays it back batter by batter.
(() => {
  const root = document.getElementById('gc'); if (!root) return;
  const T = JSON.parse(root.dataset.teams);
  const $ = (s) => root.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
  const HIT = new Set(['1B', '2B', '3B', 'HR']); const NOT_AB = new Set(['BB', 'IBB', 'HBP', 'SF', 'SH']);
  const PA = new Set(['1B', '2B', '3B', 'HR', 'BB', 'IBB', 'HBP', 'E', 'K', 'O', 'SF', 'SH', 'GDP']);
  const OUTS = { K: 1, O: 1, SF: 1, SH: 1, GDP: 2 };
  let G = null, i = -1, shown = 0, timer = null, playing = false, speed = 2400;
  const btn = (a) => root.querySelector(`[data-act="${a}"]`);

  fetch(root.dataset.src).then((r) => r.json()).then((g) => { G = g; if (!g.exact) $('.gc-note').textContent += ' A few runs in this game could not be placed exactly, so parts of it are approximate.'; render(); })
    .catch(() => { $('.gc-wait').textContent = 'This game could not be loaded.'; });

  function tally(upto) {
    const runs = { away: Array(G.innings).fill(null), home: Array(G.innings).fill(null) }, hits = { away: 0, home: 0 };
    const bat = {}, pit = {};
    for (let k = 0; k <= upto; k++) {
      const p = G.plays[k]; const s = p.side;
      runs[s][p.inning - 1] = (runs[s][p.inning - 1] || 0) + (p.runs || 0);
      if (HIT.has(p.t)) hits[s]++;
      if (p.batter && PA.has(p.t)) { const b = (bat[p.batter] ||= { ab: 0, h: 0, rbi: 0, bb: 0, k: 0 }); if (!NOT_AB.has(p.t)) b.ab++; if (HIT.has(p.t)) b.h++; if (['BB', 'IBB'].includes(p.t)) b.bb++; if (p.t === 'K') b.k++; if (!['E', 'GDP'].includes(p.t)) b.rbi += p.runs || 0; }
      if (p.pitcher && PA.has(p.t)) { const q = (pit[p.pitcher] ||= { outs: 0, h: 0, k: 0, bb: 0, r: 0 }); q.outs += OUTS[p.t] || 0; if (HIT.has(p.t)) q.h++; if (p.t === 'K') q.k++; if (['BB', 'IBB'].includes(p.t)) q.bb++; q.r += p.runs || 0; }
    }
    return { runs, hits, bat, pit };
  }
  const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);

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
    $('.gc-line tbody').innerHTML = ['away', 'home'].map((s) => `<tr><td class="nowrap">${T[s].logo ? `<img class="logo-sm" src="${esc(T[s].logo)}" alt="">` : ''}${esc(T[s].city)}</td>${t.runs[s].map((r, k) => `<td class="num">${r == null ? (done && s === 'home' && G.final.home.inn[k] == null ? 'x' : '') : r}</td>`).join('')}<td class="num tot">${i < 0 ? 0 : sum(t.runs[s])}</td><td class="num tot">${t.hits[s]}</td><td class="num tot">${done ? G.final[s].e : '-'}</td></tr>`).join('');
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
    // at the plate
    if (i >= 0 && p.batter) { const b = t.bat[p.batter]; $('[data-k="batter"]').textContent = p.batter; $('[data-k="bline"]').textContent = b ? `${b.h}-for-${b.ab} today${b.rbi ? `, ${b.rbi} RBI` : ''}${b.bb ? `, ${b.bb} BB` : ''}` : ''; }
    if (i >= 0 && p.pitcher) { const q = t.pit[p.pitcher]; $('[data-k="pitcher"]').textContent = p.pitcher; $('[data-k="pline"]').textContent = q ? `${Math.floor(q.outs / 3)}.${q.outs % 3} IP, ${q.h} H, ${q.r} R, ${q.k} K, ${q.bb} BB` : ''; }
    // final
    const end = $('.gc-end'); end.hidden = !done;
    if (done) {
      const a = sum(t.runs.away), h = sum(t.runs.home); const w = a > h ? 'away' : 'home';
      $('[data-k="finaltxt"]').textContent = `${T[w].city} ${T[w].nick} win, ${Math.max(a, h)} to ${Math.min(a, h)}${G.innings > 9 ? ` in ${G.innings} innings` : ''}.`;
      $('[data-k="storylink"]').href = root.dataset.story;
      stop(); ['play', 'step', 'inning', 'final'].forEach((x) => (btn(x).disabled = true));
    }
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
