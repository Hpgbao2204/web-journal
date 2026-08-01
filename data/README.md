# Data snapshots

`catalog.json` is the searchable local index. `imports/` is kept in git so source files can be dropped here without changing application code.

## Import

```powershell
npm install xlsx
npm.cmd run import -- --source scopus --file .\data\imports\scopus-source-list.xlsx
npm.cmd run import -- --source scopus --file .\data\imports\scopus-source-metrics.xlsx
npm.cmd run import -- --source scimago --file .\data\imports\scimago.csv
npm.cmd run import -- --source core --file .\data\imports\core.csv
npm.cmd run import -- --source ablesci --file .\data\imports\ablesci.csv
```

The importer accepts JSON, CSV, TSV, XLSX and XLS, maps common column names, merges by ISSN, and preserves source-specific metrics. It also accepts optional `deadline`, `submission deadline`, `paper deadline`, or `abstract deadline` columns for conference data. Bundled rows are a small demo snapshot for UI development, not a substitute for the latest official files.

For CiteScore/SNIP/SJR, export **Download source titles and metrics** from Scopus Sources. The **source titles only** export intentionally has no citation metrics; the app now labels those cells as `Source title list · không có metric` instead of showing fake zeroes.

The repo includes `imports/scopus-source-metrics.xlsx` as a small development seed so the import command is runnable immediately. Replace that file with the official export for production use.

See `sources.json` for source URLs, update cadence, and the metrics each source contributes. Ranking files do not normally contain conference submission deadlines, so deadlines must come from an official conference CFP or a separate calendar dataset.

## Conference crawler

Copy `data/imports/conference-seeds.example.json` to `data/imports/conference-seeds.json`, add public conference homepage URLs, then run:

```powershell
npm.cmd run crawl:conferences -- --file .\data\imports\conference-seeds.json --limit 50
```

The crawler only visits explicit seed URLs, waits between requests, and writes homepage, JSON-LD event dates/location, description, and deadline-like text back into `catalog.json`. Use public pages and respect each site's robots.txt and terms; ranking data still comes from downloaded datasets.

For journal/source records that have an ISSN, homepage discovery can use the public OpenAlex source metadata API:

```powershell
npm.cmd run enrich:homepages -- --limit 100 --delay 300
```

This only enriches records without a homepage and stores the result locally.
