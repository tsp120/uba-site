# UBA website (rebuild)

The Unbelievable Baseball Association site, rebuilt as a **static site** with a small, locked-down upload page for the commissioner.

* **The league still runs on the commish's PC.** The site only displays files he publishes from Strat-O-Matic. It never becomes the source of truth.
* **No PHP, no database.** Visitors only ever receive plain HTML/CSS/images, so there's nothing on the public site to hack.
* **Every change is a Git commit.** Full history, and any bad upload can be rolled back in one click on GitHub.

## How it fits together

```
Commish's PC (Strat-O-Matic)                         GitHub repo (this folder)           Cloudflare Pages
 Web Builder folder, DAY.htm, results.htm,  ──►  /admin  ──►  data/…  (one commit)  ──►  npm run build  ──►  the website
 cap spreadsheets, MLB stats CSVs, docs          (password)                                (~2 minutes)
```

| Folder | What's in it | Comes from |
|---|---|---|
| `data/webbuilder/` | `leaguedata.js`, `b???.js`, `p???.js`, `team???.js`, `totals.js`, `leaders.js` | Strat **Web Builder** export |
| `data/newspapers/` | `YYYYMMDDDAY.htm`, one per game day (2014 →) | Strat **Daily Report / newspaper** |
| `data/reports/` | `schedule.htm`, `results.htm` | Strat schedule + results reports |
| `data/rosters/` | `ATL.xlsx`, `BUF.xlsx` … | Commish's **cap** spreadsheets (`cap12.xlsx` is renamed to the team's code automatically) |
| `data/realstats/` | `realbatters.csv`, `realpitchers.csv` | Baseball-Reference / FanGraphs export |
| `data/files/` + `files.json` | Bid book, rookie list, rule book, archive | Uploaded on the admin page |
| `data/news/*.md` | Commissioner posts | Written on the admin page |
| `data/league.json` | Team names, owners, managers, logos, wild-card count | Edited on the admin page |
| `data/logos/` | Team logos | Uploaded on the admin page |

Code: `src/lib/strat.mjs` (all the Strat parsers), `src/pages/` (pages), `functions/api/` (the upload API, Cloudflare Pages Function), `public/admin/` (the upload page).

Game stories are pulled out of each newspaper automatically, so nobody has to copy them into the site by hand any more.

## One-time setup (about 30 minutes)

**0. Clean up the old site first.** The old server has been hacked (web shells in `uba/files/`). Delete `uba/files/dexm1.php`, `uba/files/schedule.php` and `uba/files/sym/`, and change the MySQL and AwardSpace passwords. Before you shut it down, export the `news` table in phpMyAdmin if you want the old stories (see step 6).

1. **GitHub.** Create a **private** repository called `uba-site` (no README). In this folder, run:
   ```
   git remote add origin https://github.com/YOUR-NAME/uba-site.git
   git push -u origin main
   ```
   (The folder is already a Git repo with everything committed. The first push is ~400 MB because it includes 13 seasons of newspapers.)
2. **A token for the upload page.** GitHub → Settings → Developer settings → *Fine-grained tokens* → Generate.
   *Repository access:* only `uba-site`. *Permissions:* **Contents: Read and write** (nothing else). Expiry: 1 year (put a reminder in your calendar).
3. **Cloudflare Pages** (free). dash.cloudflare.com → Workers & Pages → Create → Pages → *Connect to Git* → pick `uba-site`.
   * Build command: `npm run build` · Output directory: `dist`
   * Environment variable: `NODE_VERSION` = `22`
4. **Secrets.** In the Pages project → Settings → Variables and Secrets (Production), add as **encrypted** values:
   | Name | Value |
   |---|---|
   | `ADMIN_PASSWORD` | the commish's password (make it a long passphrase) |
   | `SESSION_SECRET` | 64 random characters (e.g. from a password manager) |
   | `GITHUB_TOKEN` | the token from step 2 |
   | `GITHUB_REPO` | `YOUR-NAME/uba-site` |
   | `GITHUB_BRANCH` | `main` |
   Then *Deployments → Retry deployment* so the functions pick them up.
5. **Address.** The site is live at `uba-site.pages.dev`. To use a proper name, buy a domain (Cloudflare Registrar sells them at cost, about $10/yr) and add it under *Custom domains*. `uba.sportsontheweb.net` is an AwardSpace freebie. To send old visitors over, delete everything on AwardSpace and upload `legacy-redirect/.htaccess` (edit `NEW-SITE` first).
6. **Old news (optional).** phpMyAdmin → the `news` table → Export → SQL. Then:
   ```
   node tools/import-news-sql.mjs path/to/news.sql --only-custom
   git add data/news && git commit -m "Import old news" && git push
   ```
   `--only-custom` skips stories that were just copies of Strat game stories, since the new site already shows all of those.

## Working on the site locally

```
npm install
npm run dev          # http://localhost:4321 (public pages)
npm run check-data   # sanity-checks the Strat files: record mismatches, roster parsing, etc.
node tests/api.test.mjs   # tests the upload API against a fake GitHub
npx wrangler pages dev    # runs the admin page + API locally (needs a .dev.vars, see .dev.vars.example)
```

## Limits worth knowing

* Cloudflare's free plan gives each API request a small CPU budget and 50 outbound calls. The upload page sends big drops in batches to stay inside that, and text files (Web Builder, newspapers) cost nothing extra. If the commish ever sees "exceeded CPU" errors on very large uploads, the $5/month Workers Paid plan removes the problem.
* The "View" button for Excel/Word files uses Microsoft's free Office web viewer, exactly as the old site did. It needs the site to be publicly reachable.
* Older newspapers (before the current season) still show every story and box score, but their team names aren't linked, because franchises have moved over the years (e.g. the Oklahoma City Otters).
