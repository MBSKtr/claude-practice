# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`expenses` is a single-file Node.js CLI that reads a CSV of transactions and prints spending totals per month and per category.

**Hard constraint: no external packages.** Built-in Node modules only (`node:` prefixed). `package.json` has no `dependencies` or `devDependencies` and should stay that way — do not introduce a CSV parser, CLI framework, or test runner from npm. Tests use the built-in `node:test` runner.

## Commands

```bash
node expenses.js              # report on ./expenses.csv
node expenses.js path/to.csv  # report on another file
node expenses.js --json       # the same summary as one JSON object on stdout
node expenses.js --json f.csv # flag and file in either order
npm start                     # same as `node expenses.js` (no args passthrough)
npm test                      # node --test, runs expenses.test.js
node --test --test-name-pattern 'topCategory'   # run a single test by name
node --check expenses.js      # syntax check; there is no build or lint step
```

`expenses.test.js` covers the pure helpers directly and shells out to the CLI for two end-to-end cases, so its assertions pin the exact totals produced by the sample `expenses.csv` — editing that CSV means updating those expectations.

## Input format

CSV with a header row containing `date`, `category`, `amount` (case-insensitive, order-independent — columns are located by name, extra columns are ignored). `date` must be `YYYY-MM-DD`; the month bucket is `date.slice(0, 7)`, so no `Date` object is ever constructed and there are no timezone effects. Any malformed row aborts the whole run with a `file:line` message on stderr and exit code 1 — the parser is strict, not lenient, by design. A blank or whitespace-only `amount` is rejected, not coerced: `Number('')` is `0`, so the explicit empty check in `parseCsv` is the only thing stopping a missing cell from being reported as `0.00`. Keep it ahead of the `Number.isFinite` check.

## Architecture

`expenses.js` is a pipeline of small pure functions with all I/O confined to `main()`:

- `splitLine` — one-line CSV field splitter that handles double-quoted fields containing commas and `""` escapes. This exists so the tool stays dependency-free; extend it here rather than reaching for a library.
- `parseCsv` — validates the header, then validates and normalizes each row into `{ month, category, amount }`. Rows lose their day-of-month at this point; anything needing full dates must change this shape.
- `totalBy(rows, key)` — the single aggregation primitive, returning a `Map`. Both reports are built from it; a new breakdown (e.g. per year) should be another `totalBy` call, not new summing logic.
- `summarize(rows, file)` — the whole report as a plain object. Both output modes render this one value, which is what stops the JSON and the tables disagreeing; `main()` never re-derives a total for printing. A new figure belongs here first, then in each renderer.
- `round2` — rounds to cents for JSON, where totals stay numbers. `money` (strings, trailing zeros) is for the text tables only. Do not swap them: `4350` and `"4350.00"` are both correct, for different consumers.
- `parseArgs(argv)` — hand-rolled flag handling, strict about unknown options and extra positionals. `node:util`'s `parseArgs` is deliberately not used: it is experimental on Node 18, which CI still covers.
- `topCategory` — the single highest-spending category, built on `totalBy`.
- `byAmountDesc` — the shared comparator for `[label, amount]` entries: largest first, ties broken on label. Both the category table and `topCategory` sort with it, which is what keeps the table's first row and the `Top category` line in agreement. Change the ordering here, not in one caller.
- `printTable` — column widths are computed from the entries, so alignment adapts to the data.

Sort orders are deliberate: months ascending as `YYYY-MM` strings (which sort chronologically without parsing), categories descending by amount so the largest spend leads.

Errors are thrown as plain `Error`s from anywhere in the pipeline and caught once at the bottom of the file, which prefixes `expenses: ` and exits 1. Keep that single exit point — do not call `process.exit` from inner functions.

Amounts are plain JavaScript numbers, formatted with `toFixed(2)` only at print time. Currency is not tracked or displayed.

The `--json` shape is a public contract, not an internal dump: `months` and `categories` are arrays because their order carries meaning that an object would not promise to keep, and totals are numbers so a consumer can do arithmetic without parsing strings. Changing a key or a nesting level breaks whatever is reading it. Errors are deliberately *not* JSON — they stay as `expenses: ...` on stderr with exit 1, so a caller checks the exit code rather than parsing stdout to discover a failure. `--json` must also stay the only thing on stdout in that mode, or piping it breaks.

The CLI entry point is guarded by `require.main === module` and the helpers are exported via `module.exports`, so requiring the file from a test never runs the program. Keep that guard in place.
