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

function main() {
  const file = process.argv[2] || DEFAULT_FILE;
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

  const rows = parseCsv(text, file);

  // Months sort naturally as YYYY-MM strings; categories go largest spend first.
  const byMonth = [...totalBy(rows, 'month')].sort((a, b) => a[0].localeCompare(b[0]));
  const byCategory = [...totalBy(rows, 'category')].sort(byAmountDesc);
  const grandTotal = rows.reduce((sum, row) => sum + row.amount, 0);

  console.log(`Expense report for ${file} (${rows.length} transactions)\n`);
  printTable('Total per month', byMonth);
  printTable('Total per category', byCategory);
  console.log(`Grand total: ${money(grandTotal)}`);

  const top = topCategory(rows);
  console.log(`Top category: ${top.category} (${money(top.amount)})`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`expenses: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { splitLine, parseCsv, totalBy, byAmountDesc, topCategory, money };
