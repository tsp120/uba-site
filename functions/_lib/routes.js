// Decides where an uploaded file belongs in the repo. The server is the only authority:
// anything not matched here is refused, so a stray .php (or anything else) can never be published.
export const MAX_FILE = 20 * 1024 * 1024;
export const MAX_TOTAL = 90 * 1024 * 1024;
const WEB_BUILDER = /^(leaguedata|leaders|totals|ECtotals|WCtotals|ECleaders|WCleaders)\.js$|^[bp][A-Z]{2,4}\.js$|^team[a-z]{2,4}\.js$/;
const WEB_BUILDER_EXTRAS = /\.(html?|gif|jpe?g|png|css|log)$|^(stats|players|teams|custom|dyndata|traded)\.js$/i;
const DOC = /\.(xlsx|xls|docx|doc|pdf|csv|txt)$/i;

export const safeName = (n) => String(n).split(/[\\/]/).pop().replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(0, 120);

/** @returns {{dest?: string, kind: string, label: string, needsTitle?: boolean, skip?: boolean, error?: string}} */
export function route(name, league) {
  const n = String(name).split(/[\\/]/).pop();
  const byLegacy = (id) => league?.teams?.find((t) => +t.legacyId === +id);
  let m;
  if (WEB_BUILDER.test(n)) return { dest: `data/webbuilder/${n}`, kind: 'webbuilder', label: 'Web Builder stats' };
  if ((m = n.match(/^(\d{8})DAY\.htm$/i))) return { dest: `data/newspapers/${m[1]}DAY.htm`, kind: 'newspaper', label: `Newspaper ${m[1].slice(4, 6)}/${m[1].slice(6)}/${m[1].slice(0, 4)}` };
  if (/^\d{8}BAT\.htm$/i.test(n)) return { skip: true, kind: 'ignored', label: 'Not used by the site' };
  if (/^(schedule|results)\.htm$/i.test(n)) return { dest: `data/reports/${n.toLowerCase()}`, kind: 'report', label: n.toLowerCase().startsWith('s') ? 'Season schedule' : 'Game results' };
  if (/^real(batters|pitchers)\.csv$/i.test(n)) return { dest: `data/realstats/${n.toLowerCase()}`, kind: 'realstats', label: 'Real MLB stats' };
  if ((m = n.match(/^cap(\d+)\.xlsx$/i))) { const t = byLegacy(m[1]); return t ? { dest: `data/rosters/${t.abbr}.xlsx`, kind: 'roster', label: `Roster: ${t.city} ${t.nickname}` } : { error: `No team has id ${m[1]}` }; }
  if ((m = n.match(/^([A-Z]{2,4})\.xlsx$/)) && league?.teams?.some((t) => t.abbr === m[1])) return { dest: `data/rosters/${m[1]}.xlsx`, kind: 'roster', label: `Roster: ${m[1]}` };
  if (WEB_BUILDER_EXTRAS.test(n) && !DOC.test(n)) return { skip: true, kind: 'ignored', label: 'Web Builder extra (not needed)' };
  if (DOC.test(n) && !/\.(csv|txt)$/i.test(n)) return { dest: `data/files/${safeName(n)}`, kind: 'download', label: 'Downloadable file', needsTitle: true };
  return { error: 'This file type is not accepted' };
}
