# Commissioner's guide to the new UBA site

Nothing about running the league changes. Strat-O-Matic and your spreadsheets stay on your PC and remain the official record. The website just shows what you publish.

## After each sim day

1. In Strat-O-Matic, produce your usual output: the **Web Builder** export, the **newspaper** (`YYYYMMDDDAY.htm`), and **results.htm**.
2. Go to **yoursite/admin** and log in.
3. Drag them onto the box. You can drag the whole Web Builder folder; the site ignores the bits it doesn't need.
4. Check the list ("Web Builder stats", "Newspaper 09/28/2026", "Game results"…) and press **Publish**.

The site updates itself in about two minutes: scores, standings, stats, leaders, the newspaper and the game stories.

## Other things you can do there

| To… | Do this |
|---|---|
| Update a team's roster | Drop its cap spreadsheet (e.g. `cap12.xlsx`) on **Publish files** |
| Update the real MLB stats | Export the current season's batting and pitching tables from FanGraphs or Baseball-Reference as CSV, name them `realbatters.csv` and `realpitchers.csv`, and drop them on **Publish files**. Each team's Stats page shows the date you uploaded them |
| Post the bid book, rookie list, rule book… | Drop the file on **Publish files**, give it a title, Publish. It appears at the top of the Files page |
| Rename or remove a document | **Files page** tab |
| Post an announcement | **News** tab (blank line = new paragraph) |
| Change an owner/manager/team name or logo | **Teams & managers** tab |
| New season schedule | Drop the new `schedule.htm` |

Made a mistake? Just publish the corrected file. Every version is kept, and Goob can roll anything back.
