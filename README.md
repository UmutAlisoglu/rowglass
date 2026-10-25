# Rowglass

**See what changed between two table exports.**

Drop in a before and an after, choose the column that identifies each record, and compare. Rowglass follows the records even when someone sorts the spreadsheet differently. You get a change brief, old and new values, and a report you can keep.

[Open Rowglass](https://alisoglu.com/rowglass/) · [Download the portable app](https://github.com/UmutAlisoglu/rowglass/releases/latest) · [Report a problem](https://github.com/UmutAlisoglu/rowglass/issues)

## What it’s useful for

- Stock checks: quantities, locations, new items and discontinued SKUs.
- Supplier quotes: prices and lead times, matched by part code.
- Bills of materials: components across board or product revisions.
- Contact and membership exports: additions, removals and changed details.
- Content inventories: URLs, titles, owners and publication status.
- Order lists, asset registers, translations, schedules, and other tables with stable identifiers.

Five fictional examples are included. Choose one to see the whole workflow without bringing a file.

## Use it

1. Add two CSV or TSV exports, or paste the tables with their header rows. You can drop both files into the workspace together; the first becomes Before and the second After.
2. Check the suggested matching column. Use a stable ID, SKU, email, or part reference. Combine it with a second column when needed, such as SKU + warehouse.
3. Select **Find changes**. Inspect a row, filter by change type, or search the values.
4. Save the HTML report, export changes as CSV, or download the complete result as JSON.

Reports include your data. Share them only with the intended recipients. The HTML report contains every changed, added, and removed row, with no scripts or network resources. Open it in a browser and use Print to save a PDF if needed. The interactive table shows up to eight columns and 50 rows per page; row inspection and exports retain all fields.

## Portable app

Download and extract **Rowglass-1.0.0-portable.zip** from Releases, then open `index.html`. Keep the files together. No installation, Node, Python, server, account or internet connection is needed. It is a portable browser app rather than a Windows executable. Use a current desktop browser; mobile browsers can use the hosted version.

Clipboard access depends on your browser and can be restricted for local files. Copy the visible brief manually or save a report if the Copy button is unavailable.

## Comparison rules

Defaults compare exact text. Leading zeroes, spaces, and letter case are preserved. Optional rules can trim edge spaces, ignore case, compare decimal/scientific numbers by value with an absolute tolerance, or exclude columns. Space and case rules also apply to matching values; numeric tolerance never applies to IDs.

Duplicate or empty matching values stop comparison with an explanation. There is no fuzzy matching or guess about whether a changed identifier represents the same item: a new ID is an added row and the old ID is a removed row. Column names must match exactly after trimming header-edge spaces. Added and removed columns are reported, including empty columns.

Numeric comparison does not interpret currencies, decimal commas or dates. Numbers outside JavaScript’s safe integer range compare as exact text. Original values remain available in row inspection and JSON. The CSV export prefixes formula-like cells with an apostrophe so spreadsheet software treats them as text; this deliberately changes those exported strings. Use JSON for exact source values.

## Formats and limits

CSV, TSV and delimited text; comma, tab, semicolon and pipe separators. Automatic detection can be overridden. UTF-8 and BOM-marked UTF-16 are accepted. The first row must contain unique, non-empty column names, and each data row must have the same number of fields. Quoted commas, escaped quotes and multiline cells are supported. Blank physical lines are skipped; quoted empty cells remain data.

Per table: **10 MB, 20,000 data rows, 200 columns and 1,000,000 cells**. XLSX workbooks must be exported as CSV first. Rowglass compares exported values, not workbook formatting, formulas or sheet structure.

## Privacy

File processing happens in the page’s memory. Rowglass makes no upload, analytics, font, API or account requests and does not write input, filenames or history to cookies, localStorage or IndexedDB. Clear everything or close the page to release the session. Saved downloads remain wherever you save them.

The hosted page uses GitHub Pages. Loading its public code sends ordinary connection information, such as your IP address, to the host. The app’s Content Security Policy blocks network connections from the application. The portable download works offline.

## Development

Node.js 22 or newer is needed for development only. The app, core checks and build need no installed packages.

```sh
npm test
npm run build
npm run dev
```

Open `http://127.0.0.1:8790`. `dist/` is the portable application. The comparison engine is `src/core.js`, the interface is `src/app.js`, and examples are in `src/samples.js`. The same files run from a local folder and from the website.

For browser checks, run `npm ci`, `npx playwright install chromium`, `npm run build`, and `npm run test:browser`. The browser script starts its own local server, checks actual downloads and the offline build, and saves screenshots in `.qa/`. Set `BROWSER_CHANNEL=chrome` to use an installed Google Chrome instead. Playwright is a development dependency only; it is not shipped with the app.

The parser handles common quoting rules documented in [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180.html), with the TSV and delimiter options described above. Tests cover malformed input, row matching, composite keys, schema changes, comparison rules, export escaping and large tables. GitHub Actions tests and builds the app on Windows and Linux, with real browser checks on Linux.

MIT licensed. A project by [Umut Alisoglu](https://alisoglu.com/).
