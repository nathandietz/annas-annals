const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchBook } = require('../assets/js/book-match.js');
const books = [{ isbn: '0-306-40615-2', title: 'The Book', author: 'Jane Doe' }];
test('equivalent ISBN formats identify the same edition', () => assert.equal(matchBook('9780306406157', null, books).kind, 'exact'));
test('different editions can match by title and author', () => assert.equal(matchBook('9780140328721', {title: '  the book ', author: 'JANE DOE'}, books).kind, 'possible'));
test('missing metadata cannot prove absence', () => assert.equal(matchBook('9780140328721', {title: 'The Book'}, books).kind, 'unknown'));
test('identified unmatched books report no match', () => assert.equal(matchBook('9780140328721', {title: 'Another', author: 'Jane Doe'}, books).kind, 'none'));
