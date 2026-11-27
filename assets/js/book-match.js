'use strict';
const isbnNormalizer = typeof module !== 'undefined' ? require('./isbn.js').normalizeIsbn : normalizeIsbn;
function matchBook(isbn, metadata, books) {
  const normalized = isbnNormalizer(isbn);
  const exact = normalized ? books.filter(book => isbnNormalizer(book.isbn || '') === normalized) : [];
  if (exact.length) return { kind: 'exact', books: exact };
  const clean = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const title = clean(metadata?.title), author = clean(metadata?.author);
  if (!title || !author) return { kind: 'unknown', books: [] };
  const possible = books.filter(book => clean(book.title) === title && clean(book.author) === author);
  return { kind: possible.length ? 'possible' : 'none', books: possible };
}
if (typeof module !== 'undefined') module.exports = { matchBook };
