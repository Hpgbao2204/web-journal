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

`data/catalog.json` contains the imported June 2026 Scopus Source List, SCImago 2025 and the current ICORE 2026 conference ranking snapshot. The downloaded source files are kept under `data/` and `data/imports/`.

## Import official files

```powershell
npm install xlsx # only for .xlsx/.xls; CSV, TSV and JSON need no dependency
npm.cmd run import -- --source ablesci --file .\data\imports\ablesci.csv
npm.cmd run import -- --source scopus --file .\data\imports\scopus-source-list.xlsx
npm.cmd run import -- --source scopus --file .\data\imports\scopus-source-metrics.xlsx
npm.cmd run import -- --source scimago --file .\data\imports\scimago.csv
npm.cmd run import -- --source scimago --file ".\data\scimagojr 2025.csv" --year 2025
npm.cmd run import -- --source core --file .\data\imports\core.csv
```

The importer merges records by normalized ISSN/EISSN or title, maps common column names plus common Chinese labels for IF, and writes the local index to `data/catalog.json`.

`data/imports/scopus-source-metrics.xlsx` is bundled as a small development seed so the command works immediately. Replace it with the real Scopus **source titles and metrics** export when you have access; the seed values are not an official current Scopus snapshot.

The UI shows 15 rows per page in an Excel-like table, sorts by rank (`Q1 → A* → Q2 → A → Q3 → Q4`), and links to a homepage when one is available.

On the first search for a journal, the server looks up its ISSN on AbleSci for IF/JCR status and batches missing homepage lookups through OpenAlex. Results are saved in `data/enrichment-cache.json`; later searches keep working from the local cache. A journal absent from JCR is shown explicitly instead of receiving a fake IF value.

## Sync conference data and homepages

Download all current ICORE 2026 rows from the official conference portal and merge them into the catalog:

```powershell
npm.cmd run sync:core
```

Find official homepages for ranked conferences through Wikidata. The bot processes A* first and only accepts conference-like matches:

```powershell
npm.cmd run enrich:conference-homepages -- --limit 100 --delay 900
```

Every ICORE row also stores its CORE profile and DBLP URL. If no official homepage has been verified yet, clicking the title opens the CORE profile as a safe fallback.

Optional deadline/event crawl from a list of known official URLs:

```powershell
Copy-Item .\data\imports\conference-seeds.example.json .\data\imports\conference-seeds.json
npm.cmd run crawl:conferences -- --file .\data\imports\conference-seeds.json --limit 50
```

## Source links

- https://www.ablesci.com/journal
- https://www.scopus.com/sources
- https://www.scimagojr.com/
- https://portal.core.edu.au/conf-ranks/
