#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE = 'expenses.csv';
const REQUIRED_COLUMNS = ['date', 'category', 'amount'];

// Splits one CSV line, honouring double-quoted fields that may contain commas.
function splitLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

function parseCsv(text, file) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  if (lines.length === 0) {
    throw new Error(`${file} is empty`);
  }

  const header = splitLine(lines[0]).map((h) => h.toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((col) => !header.includes(col));
  if (missing.length > 0) {
    throw new Error(`${file} is missing required column(s): ${missing.join(', ')}`);
  }

  const index = {
    date: header.indexOf('date'),
    category: header.indexOf('category'),
    amount: header.indexOf('amount'),
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitLine(lines[i]);
    const lineNo = i + 1;

    const date = fields[index.date] || '';
    const category = fields[index.category] || '';
    // Number('') is 0, so an empty amount must be rejected before the
    // isFinite check or a blank cell silently becomes 0.00.
    const rawAmount = fields[index.amount] || '';
    const amount = Number(rawAmount);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`${file}:${lineNo}: date must be YYYY-MM-DD, got "${date}"`);
    }
    if (category === '') {
      throw new Error(`${file}:${lineNo}: category is empty`);
    }
    if (rawAmount === '') {
      throw new Error(`${file}:${lineNo}: amount is empty`);
    }
    if (!Number.isFinite(amount)) {
      throw new Error(`${file}:${lineNo}: amount is not a number, got "${rawAmount}"`);
    }

    rows.push({ month: date.slice(0, 7), category, amount });
  }

  if (rows.length === 0) {
    throw new Error(`${file} has a header but no data rows`);
  }
  return rows;
}

// Sums `amount` into a Map keyed by the given row property.
function totalBy(rows, key) {
  const totals = new Map();
  for (const row of rows) {
    totals.set(row[key], (totals.get(row[key]) || 0) + row.amount);
  }
  return totals;
}

// Orders [label, amount] entries largest first, breaking ties on the label so
// the category table and the "Top category" line can never disagree.
function byAmountDesc(a, b) {
  if (b[1] !== a[1]) return b[1] - a[1];
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

// Highest-spending category, or null when there are no rows.
function topCategory(rows) {
  const [top] = [...totalBy(rows, 'category')].sort(byAmountDesc);
  return top === undefined ? null : { category: top[0], amount: top[1] };
}

// Rounds to cents for JSON output, where numbers stay numbers rather than
// being formatted into strings the consumer would have to parse back.
function round2(value) {
  return Number(value.toFixed(2));
}

// The whole report as data. Both output modes render this, so the JSON and the
// tables cannot drift apart. Its shape is the tool's machine-readable contract:
// months and categories are arrays because their order is meaningful.
function summarize(rows, file, month = null) {
  const top = topCategory(rows);
  return {
    file,
    month,
    transactions: rows.length,
    grandTotal: round2(rows.reduce((sum, row) => sum + row.amount, 0)),
    months: [...totalBy(rows, 'month')]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, total]) => ({ month, total: round2(total) })),
    categories: [...totalBy(rows, 'category')]
      .sort(byAmountDesc)
      .map(([category, total]) => ({ category, total: round2(total) })),
    topCategory: top === null ? null : { category: top.category, total: round2(top.amount) },
  };
}

function money(value) {
  return value.toFixed(2);
}

function printTable(title, entries) {
  const labelWidth = Math.max(...entries.map(([label]) => label.length));
  const amountWidth = Math.max(...entries.map(([, value]) => money(value).length));

  console.log(title);
  for (const [label, value] of entries) {
    console.log(`  ${label.padEnd(labelWidth)}  ${money(value).padStart(amountWidth)}`);
  }
  console.log('');
}

// Hand-rolled rather than pulled from a library, and deliberately strict: an
// unrecognized flag is a mistake worth reporting, not something to ignore.
function parseArgs(argv) {
  let file = null;
  let month = null;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--month' || arg.startsWith('--month=')) {
      // Both --month 2026-03 and --month=2026-03; the second is what people
      // type out of habit, and silently ignoring it would be worse than
      // either supporting it or rejecting it.
      const value = arg === '--month' ? argv[++i] : arg.slice('--month='.length);
      if (value === undefined || value === '') {
        throw new Error('--month needs a value, e.g. --month 2026-03');
      }
      if (!/^[0-9]{4}-[0-9]{2}$/.test(value)) {
        throw new Error(`--month must be YYYY-MM, got "${value}"`);
      }
      month = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (file === null) {
      file = arg;
    } else {
      throw new Error(`unexpected extra argument: ${arg}`);
    }
  }

  return { file: file === null ? DEFAULT_FILE : file, json, month };
}

function main() {
  const { file, json, month } = parseArgs(process.argv.slice(2));
  const resolved = path.resolve(file);

  let text;
  try {
    text = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`no such file: ${file}`);
    }
    throw err;
  }

  const parsed = parseCsv(text, file);
  const rows = month === null ? parsed : parsed.filter((row) => row.month === month);

  // An empty result is reported rather than printed: printTable has no columns
  // to measure and there would be no top category to name.
  if (rows.length === 0) {
    throw new Error(`no transactions for ${month} in ${file}`);
  }

  const summary = summarize(rows, file, month);

  if (json) {
    // The only thing on stdout, so the output can be piped straight into a
    // JSON consumer without stripping a header first.
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const scope = summary.month === null ? '' : `, ${summary.month} only`;
  console.log(`Expense report for ${file}${scope} (${summary.transactions} transactions)\n`);
  printTable('Total per month', summary.months.map((m) => [m.month, m.total]));
  printTable('Total per category', summary.categories.map((c) => [c.category, c.total]));
  console.log(`Grand total: ${money(summary.grandTotal)}`);
  console.log(`Top category: ${summary.topCategory.category} (${money(summary.topCategory.total)})`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`expenses: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  splitLine,
  parseCsv,
  totalBy,
  byAmountDesc,
  topCategory,
  round2,
  summarize,
  parseArgs,
  money,
};
