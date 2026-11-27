'use strict';
function findDuplicateGroups(books, normalize) {
  const groups = new Map();
  for (const book of books) {
    const isbn = normalize(book.isbn || '');
    const title = (book.title || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    const author = (book.author || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    const keys = [];
    if (isbn) keys.push(['isbn:' + isbn, 'Matching ISBN: ' + isbn]);
    if (title && author) keys.push(['title:' + title + '\u0000' + author, 'Matching title and author']);
    for (const [key, reason] of keys) {
      if (!groups.has(key)) groups.set(key, { reason, books: [] });
      groups.get(key).books.push(book);
    }
  }
  return [...groups.values()].filter(group => group.books.length > 1);
}
if (typeof module !== 'undefined') module.exports = { findDuplicateGroups };
