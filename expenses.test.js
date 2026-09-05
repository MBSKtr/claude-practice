'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  splitLine,
  parseCsv,
  totalBy,
  byAmountDesc,
  topCategory,
  money,
} = require('./expenses.js');

const CLI = path.join(__dirname, 'expenses.js');

// cwd is pinned: expenses.js resolves its CSV argument relative to process.cwd(),
// so without this the CLI tests pass or fail depending on where they are run from.
function runCli(args = [], cwd = __dirname) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd, stdio: 'pipe' });
}

// Writes a throwaway CSV and removes it afterwards.
function withCsv(contents, fn) {
  const file = path.join(os.tmpdir(), `expenses-test-${process.pid}-${Math.random().toString(36).slice(2)}.csv`);
  fs.writeFileSync(file, contents);
  try {
    return fn(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const CSV = [
  'date,category,amount',
  '2026-01-05,Groceries,10.00',
  '2026-01-20,Rent,100.00',
  '2026-02-05,Groceries,25.50',
].join('\n');

test('splitLine handles quoted fields containing commas and escaped quotes', () => {
  assert.deepStrictEqual(splitLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepStrictEqual(splitLine('2026-01-05,"Food, takeaway",12.00'), [
    '2026-01-05',
    'Food, takeaway',
    '12.00',
  ]);
  assert.deepStrictEqual(splitLine('x,"say ""hi""",1'), ['x', 'say "hi"', '1']);
});

test('parseCsv normalizes rows and derives the month from the date', () => {
  assert.deepStrictEqual(parseCsv(CSV, 'test.csv'), [
    { month: '2026-01', category: 'Groceries', amount: 10 },
    { month: '2026-01', category: 'Rent', amount: 100 },
    { month: '2026-02', category: 'Groceries', amount: 25.5 },
  ]);
});

test('parseCsv locates columns by name, not position', () => {
  const reordered = 'amount,date,category\n5.00,2026-03-01,Books';
  assert.deepStrictEqual(parseCsv(reordered, 'test.csv'), [
    { month: '2026-03', category: 'Books', amount: 5 },
  ]);
});

test('parseCsv rejects malformed input with a file:line message', () => {
  assert.throws(() => parseCsv('date,category\n2026-01-01,Rent', 'test.csv'), /missing required column/);
  assert.throws(() => parseCsv('date,category,amount\n01-01-2026,Rent,5', 'test.csv'), /test\.csv:2/);
  assert.throws(() => parseCsv('date,category,amount\n2026-01-01,Rent,abc', 'test.csv'), /amount is not a number/);
  assert.throws(() => parseCsv('date,category,amount', 'test.csv'), /no data rows/);
});

test('totalBy sums amounts per key', () => {
  const rows = parseCsv(CSV, 'test.csv');
  assert.deepStrictEqual([...totalBy(rows, 'month')], [
    ['2026-01', 110],
    ['2026-02', 25.5],
  ]);
  assert.deepStrictEqual([...totalBy(rows, 'category')], [
    ['Groceries', 35.5],
    ['Rent', 100],
  ]);
});

test('byAmountDesc orders largest first and breaks ties on label', () => {
  const entries = [['Zoo', 50], ['Apples', 50], ['Rent', 100]];
  assert.deepStrictEqual([...entries].sort(byAmountDesc), [
    ['Rent', 100],
    ['Apples', 50],
    ['Zoo', 50],
  ]);
});

test('topCategory returns the highest-spending category', () => {
  const rows = parseCsv(CSV, 'test.csv');
  assert.deepStrictEqual(topCategory(rows), { category: 'Rent', amount: 100 });
});

test('topCategory sums across months rather than picking a single largest row', () => {
  const rows = parseCsv(
    ['date,category,amount', '2026-01-01,Rent,60.00', '2026-01-02,Food,40.00', '2026-02-02,Food,40.00'].join('\n'),
    'test.csv',
  );
  assert.deepStrictEqual(topCategory(rows), { category: 'Food', amount: 80 });
});

test('topCategory breaks ties on category name for stable output', () => {
  const rows = parseCsv(
    ['date,category,amount', '2026-01-01,Zoo,50.00', '2026-01-02,Apples,50.00'].join('\n'),
    'test.csv',
  );
  assert.deepStrictEqual(topCategory(rows), { category: 'Apples', amount: 50 });
});

test('topCategory returns null when there are no rows', () => {
  assert.strictEqual(topCategory([]), null);
});

test('money formats to two decimal places', () => {
  assert.strictEqual(money(5), '5.00');
  assert.strictEqual(money(1234.5), '1234.50');
});

test('CLI prints the top category for the sample file', () => {
  const output = runCli();
  assert.match(output, /Total per month/);
  assert.match(output, /Total per category/);
  assert.match(output, /Grand total: 5225\.69/);
  assert.match(output, /Top category: Rent \(4350\.00\)/);
});

test('CLI reads an absolute path regardless of the working directory', () => {
  withCsv('date,category,amount\n2026-04-01,Books,7.50\n', (csv) => {
    const output = runCli([csv], os.homedir());
    assert.match(output, /Top category: Books \(7\.50\)/);
  });
});

test('CLI top line agrees with the first row of the category table on a tie', () => {
  withCsv('date,category,amount\n2026-01-01,Zoo,50.00\n2026-01-02,Apples,50.00\n', (csv) => {
    const lines = runCli([csv]).split('\n');
    const header = lines.findIndex((line) => line.startsWith('Total per category'));
    const firstRow = lines.slice(header + 1).find((line) => line.trim() !== '');
    assert.match(firstRow, /Apples/);
    assert.match(lines.join('\n'), /Top category: Apples \(50\.00\)/);
  });
});

test('CLI exits 1 with a message when the file is missing', () => {
  assert.throws(
    () => runCli(['nope.csv']),
    (err) => {
      assert.strictEqual(err.status, 1);
      assert.match(err.stderr, /expenses: no such file: nope\.csv/);
      return true;
    },
  );
});
