# Research Index

Local-first search portal for journal and conference metadata. Search the bundled snapshot immediately, then import official source files when available.

## Run

Requirements: Node.js 18

```powershell
npm.cmd start
```

Open http://localhost:3000.

## Data sources

- Ablesci / WoS — Impact Factor, JCR quartile and category.
- Scopus Source List — ISSN/EISSN, active status, coverage, source type, publisher, OA, language and ASJC. The “source titles only” workbook does not itself contain CiteScore/SNIP/SJR.
- SCImago — SJR, H-index, quartile, country and subject category.
- CORE — conference rank, ranking year and discipline.

`data/catalog.json` contains the imported June 2026 Scopus Source List plus a few clearly marked demo rows for Ablesci/SCImago/CORE UI coverage. Demo values are marked `demo snapshot`; do not present them as the latest official metrics. The downloaded Scopus workbook is kept at `data/imports/scopus-source-list-2026-06.xlsx`.

## Import official files

```powershell
npm install xlsx # only for .xlsx/.xls; CSV, TSV and JSON need no dependency
npm.cmd run import -- --source ablesci --file .\data\imports\ablesci.csv
npm.cmd run import -- --source scopus --file .\data\imports\scopus-source-list.xlsx
npm.cmd run import -- --source scopus --file .\data\imports\scopus-source-metrics.xlsx
npm.cmd run import -- --source scimago --file .\data\imports\scimago.csv
npm.cmd run import -- --source core --file .\data\imports\core.csv
```

The importer merges records by normalized ISSN/EISSN or title, maps common column names plus common Chinese labels for IF, and writes the local index to `data/catalog.json`.

The UI shows 15 rows per page in an Excel-like table, sorts by rank (`Q1 → A* → Q2 → A → Q3 → Q4`), and links to a homepage when one is available.

Conference homepage enrichment:

```powershell
Copy-Item .\data\imports\conference-seeds.example.json .\data\imports\conference-seeds.json
npm.cmd run crawl:conferences -- --file .\data\imports\conference-seeds.json --limit 50
```

## Source links

- https://www.ablesci.com/journal
- https://www.scopus.com/sources
- https://www.scimagojr.com/
- https://portal.core.edu.au/conf-ranks/
