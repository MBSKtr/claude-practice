'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { splitLine, parseCsv, totalBy, topCategory, money } = require('./expenses.js');

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

test('money formats to two decimal places', () => {
  assert.strictEqual(money(5), '5.00');
  assert.strictEqual(money(1234.5), '1234.50');
});

test('CLI prints the top category for the sample file', () => {
  const output = execFileSync(process.execPath, [path.join(__dirname, 'expenses.js')], {
    encoding: 'utf8',
  });
  assert.match(output, /Total per month/);
  assert.match(output, /Total per category/);
  assert.match(output, /Grand total: 5225\.69/);
  assert.match(output, /Top category: Rent \(4350\.00\)/);
});

test('CLI exits 1 with a message when the file is missing', () => {
  assert.throws(
    () => execFileSync(process.execPath, [path.join(__dirname, 'expenses.js'), 'nope.csv'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }),
    (err) => {
      assert.strictEqual(err.status, 1);
      assert.match(err.stderr, /expenses: no such file: nope\.csv/);
      return true;
    },
  );
});
