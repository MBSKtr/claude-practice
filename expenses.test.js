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
  round2,
  summarize,
  parseArgs,
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
  const name = 'expenses-test-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.csv';
  const file = path.join(os.tmpdir(), name);
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

test('parseCsv rejects a blank amount rather than treating it as 0', () => {
  // Number('') === 0, so without an explicit guard a blank cell would be
  // silently reported as 0.00 and the row would count toward the totals.
  assert.strictEqual(Number(''), 0);
  assert.throws(
    () => parseCsv('date,category,amount\n2026-01-01,Rent,', 'test.csv'),
    /test\.csv:2: amount is empty/,
  );
});

test('parseCsv rejects a whitespace-only or missing amount field', () => {
  assert.throws(() => parseCsv('date,category,amount\n2026-01-01,Rent,   ', 'test.csv'), /amount is empty/);
  assert.throws(() => parseCsv('date,category,amount\n2026-01-01,Rent', 'test.csv'), /amount is empty/);
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

test('round2 rounds to cents and returns a number, not a string', () => {
  assert.strictEqual(round2(0.1 + 0.2), 0.3);
  assert.strictEqual(round2(1234.567), 1234.57);
  assert.strictEqual(typeof round2(5), 'number');
});

test('summarize produces the documented shape', () => {
  const rows = parseCsv(CSV, 'test.csv');
  assert.deepStrictEqual(summarize(rows, 'test.csv'), {
    file: 'test.csv',
    transactions: 3,
    grandTotal: 135.5,
    months: [
      { month: '2026-01', total: 110 },
      { month: '2026-02', total: 25.5 },
    ],
    categories: [
      { category: 'Rent', total: 100 },
      { category: 'Groceries', total: 35.5 },
    ],
    topCategory: { category: 'Rent', total: 100 },
  });
});

test('summarize keeps months chronological and categories largest first', () => {
  const rows = parseCsv(
    [
      'date,category,amount',
      '2026-03-01,Small,1.00',
      '2026-01-01,Big,100.00',
      '2026-02-01,Medium,50.00',
    ].join('\n'),
    'test.csv',
  );
  const summary = summarize(rows, 'test.csv');
  assert.deepStrictEqual(summary.months.map((m) => m.month), ['2026-01', '2026-02', '2026-03']);
  assert.deepStrictEqual(summary.categories.map((c) => c.category), ['Big', 'Medium', 'Small']);
});

test('summarize reports floating-point sums rounded to cents', () => {
  const rows = parseCsv(
    ['date,category,amount', '2026-01-01,A,0.10', '2026-01-02,A,0.20'].join('\n'),
    'test.csv',
  );
  const summary = summarize(rows, 'test.csv');
  assert.strictEqual(summary.grandTotal, 0.3);
  assert.strictEqual(summary.categories[0].total, 0.3);
});

test('summarize handles an empty row list without throwing', () => {
  assert.deepStrictEqual(summarize([], 'test.csv'), {
    file: 'test.csv',
    transactions: 0,
    grandTotal: 0,
    months: [],
    categories: [],
    topCategory: null,
  });
});

test('parseArgs defaults to expenses.csv in text mode', () => {
  assert.deepStrictEqual(parseArgs([]), { file: 'expenses.csv', json: false });
});

test('parseArgs accepts a file, the --json flag, or both in either order', () => {
  assert.deepStrictEqual(parseArgs(['other.csv']), { file: 'other.csv', json: false });
  assert.deepStrictEqual(parseArgs(['--json']), { file: 'expenses.csv', json: true });
  assert.deepStrictEqual(parseArgs(['--json', 'other.csv']), { file: 'other.csv', json: true });
  assert.deepStrictEqual(parseArgs(['other.csv', '--json']), { file: 'other.csv', json: true });
});

test('parseArgs rejects unknown options and extra arguments', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown option: --nope/);
  assert.throws(() => parseArgs(['-j']), /unknown option: -j/);
  assert.throws(() => parseArgs(['a.csv', 'b.csv']), /unexpected extra argument: b\.csv/);
});

test('CLI prints the top category for the sample file', () => {
  const output = runCli();
  assert.match(output, /Total per month/);
  assert.match(output, /Total per category/);
  assert.match(output, /Grand total: 5225\.69/);
  assert.match(output, /Top category: Rent \(4350\.00\)/);
});

test('CLI --json emits nothing but a parseable JSON object', () => {
  const summary = JSON.parse(runCli(['--json']));
  assert.strictEqual(summary.file, 'expenses.csv');
  assert.strictEqual(summary.transactions, 15);
  assert.strictEqual(summary.grandTotal, 5225.69);
  assert.deepStrictEqual(summary.topCategory, { category: 'Rent', total: 4350 });
  assert.strictEqual(summary.months.length, 3);
  assert.deepStrictEqual(summary.months[0], { month: '2026-01', total: 1741.47 });
});

test('CLI --json agrees with the text report on the same file', () => {
  const summary = JSON.parse(runCli(['--json']));
  const text = runCli();
  assert.ok(text.includes('Grand total: ' + summary.grandTotal.toFixed(2)));
  assert.ok(text.includes('(' + summary.topCategory.total.toFixed(2) + ')'));
  assert.ok(text.includes(summary.transactions + ' transactions'));
});

test('CLI --json accepts a file argument', () => {
  withCsv('date,category,amount\n2026-04-01,Books,7.50\n', (csv) => {
    const summary = JSON.parse(runCli(['--json', csv]));
    assert.strictEqual(summary.transactions, 1);
    assert.deepStrictEqual(summary.categories, [{ category: 'Books', total: 7.5 }]);
  });
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

test('CLI reports a blank amount with file:line and exits 1', () => {
  withCsv('date,category,amount\n2026-01-01,Rent,100.00\n2026-01-02,Food,\n', (csv) => {
    assert.throws(
      () => runCli([csv]),
      (err) => {
        assert.strictEqual(err.status, 1);
        assert.match(err.stderr, /expenses: .*:3: amount is empty/);
        return true;
      },
    );
  });
});

test('CLI reports parse errors on stderr in --json mode too, not as JSON', () => {
  // Machine-readable output does not imply machine-readable failures: a
  // consumer checks the exit code, it does not parse stdout to find out.
  withCsv('date,category,amount\n2026-01-01,Rent,oops\n', (csv) => {
    assert.throws(
      () => runCli(['--json', csv]),
      (err) => {
        assert.strictEqual(err.status, 1);
        assert.strictEqual(err.stdout, '');
        assert.match(err.stderr, /expenses: .*:2: amount is not a number/);
        return true;
      },
    );
  });
});

test('CLI exits 1 on an unknown option', () => {
  assert.throws(
    () => runCli(['--nope']),
    (err) => {
      assert.strictEqual(err.status, 1);
      assert.match(err.stderr, /expenses: unknown option: --nope/);
      return true;
    },
  );
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
