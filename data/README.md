# Data snapshots

`catalog.json` is the searchable local index. `imports/` is kept in git so source files can be dropped here without changing application code.

## Import

```powershell
npm install xlsx
npm run import -- --source scopus --file .\data\imports\scopus-source-list.xlsx
npm run import -- --source scimago --file .\data\imports\scimago.csv
npm run import -- --source core --file .\data\imports\core.csv
npm run import -- --source ablesci --file .\data\imports\ablesci.csv
```

The importer accepts JSON, CSV, TSV, XLSX and XLS, maps common column names, merges by ISSN, and preserves source-specific metrics. It also accepts optional `deadline`, `submission deadline`, `paper deadline`, or `abstract deadline` columns for conference data. Bundled rows are a small demo snapshot for UI development, not a substitute for the latest official files.

See `sources.json` for source URLs, update cadence, and the metrics each source contributes. Ranking files do not normally contain conference submission deadlines, so deadlines must come from an official conference CFP or a separate calendar dataset.
