const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findDuplicateGroups } = require('../assets/js/duplicates.js');
const { normalizeIsbn } = require('../assets/js/isbn.js');
test('groups equivalent ISBNs and matching titles with authors', () => {
  const books = [{ title: 'Book', author: 'Writer', isbn: '0-306-40615-2' }, { title: ' book ', author: 'WRITER', isbn: '9780306406157' }];
  const groups = findDuplicateGroups(books, normalizeIsbn);
  assert.equal(groups.length, 2); assert.ok(groups.every(group => group.books.length === 2));
});
test('does not group missing author, missing ISBN, or invalid ISBN', () => {
  const books = [{ title: 'Book', author: '', isbn: '123' }, { title: 'Book', author: '', isbn: '123' }];
  assert.deepEqual(findDuplicateGroups(books, normalizeIsbn), []);
});
