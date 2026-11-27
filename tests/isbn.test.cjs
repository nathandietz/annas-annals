const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIsbn } = require('../assets/js/isbn.js');
test('normalizes ISBN-10 and ISBN-13 to the same ISBN-13', () => {
  assert.equal(normalizeIsbn('0-306-40615-2'), '9780306406157');
  assert.equal(normalizeIsbn('978-0-306-40615-7'), '9780306406157');
  assert.equal(normalizeIsbn('0-8044-2957-X'), '9780804429573');
});
test('rejects invalid check digits, non-ISBN barcodes and unexpected characters', () => {
  for (const value of ['0306406153', '9780306406158', '1234567890128', 'abc9780306406157']) assert.equal(normalizeIsbn(value), '');
});
