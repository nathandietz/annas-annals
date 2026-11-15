const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, formatCsv } = require('../csv.js');
test('CSV round trips quotes, commas, Unicode, and multiline fields', () => {
  const rows = [['title', 'notes'], ['A, B', 'He said "hello"\nnext line'], ['മലയാളം', '']];
  assert.deepEqual(parseCsv(formatCsv(rows)), rows);
});
test('CSV rejects malformed quoting', () => { assert.throws(() => parseCsv('title\n"unterminated')); assert.throws(() => parseCsv('"x"oops')); });
