# Research Index

Local-first search portal for journal and conference metadata. Search the bundled snapshot immediately, then import official source files when available.

## Run

Requirements: Node.js 18

```powershell
npm.cmd start
```

Open:

- http://localhost:3000/journals — journal search (primary page)
- http://localhost:3000/conferences — conference search (separate page)

## Data sources

- Ablesci / WoS — Impact Factor, JCR quartile and category.
- Scopus Source List — ISSN/EISSN, active status, coverage, source type, publisher, OA, language and ASJC. The “source titles only” workbook does not itself contain CiteScore/SNIP/SJR.
- SCImago — SJR, H-index, quartile, country and subject category.

`data/catalog.json` contains the imported June 2026 Scopus Source List, SCImago 2025 and the current ICORE 2026 conference ranking snapshot. The downloaded source files are kept under `data/` and `data/imports/`.

## Import official files

```powershell
npm install xlsx # only for .xlsx/.xls; CSV, TSV and JSON need no dependency
npm.cmd run import -- --source ablesci --file .\data\imports\ablesci.csv
npm.cmd run import -- --source scopus --file .\data\imports\scopus-source-list.xlsx
npm.cmd run import -- --source scopus --file .\data\imports\scopus-source-metrics.xlsx
npm.cmd run import -- --source scimago --file .\data\imports\scimago.csv
npm.cmd run import -- --source scimago --file ".\data\scimagojr 2025.csv" --year 2025
```

The importer merges records by normalized ISSN/EISSN or title, maps common column names plus common Chinese labels for IF, and writes the local index to `data/catalog.json`.

`data/imports/scopus-source-metrics.xlsx` is bundled as a small development seed so the command works immediately. Replace it with the real Scopus **source titles and metrics** export when you have access; the seed values are not an official current Scopus snapshot.

The journal UI shows 15 rows per page in an Excel-like table, sorts by journal quartile (`Q1 → Q2 → Q3 → Q4`), and links titles directly to a verified homepage when one is available. CORE is not shown on either search page.

On the first search for a journal, the server looks up its exact title and all available ISSNs on AbleSci for IF/JCR status. Lookups are rate-limited and stale negative cache entries are ignored, preventing false “not found” results during AbleSci throttling. Missing homepages are batched through OpenAlex. Results are saved in `data/enrichment-cache.json`; later searches keep working from the local cache.

Preload journal metadata for a search group:

```powershell
npm.cmd run enrich:journals -- --query "IEEE Transactions" --limit 100
```

For journals still missing a homepage, enable the slower AbleSci detail-page fallback:

```powershell
npm.cmd run enrich:journals -- --query "Canadian Journal of Veterinary Research" --limit 1 --deep-homepages
```

The Scopus source-title workbook proves that a title is indexed and provides status, coverage, Source ID, publisher, OA, language and ASJC. CiteScore/SNIP/SJR are only populated when the official **source titles and metrics** export is imported; they are never fabricated from the title-only file. The UI therefore always shows Scopus membership and coverage, while SCImago SJR/H-index/quartile remain clearly labeled as SCImago data.

## Source links

- https://www.ablesci.com/journal
- https://www.scopus.com/sources
- https://www.scimagojr.com/
