'use strict';
// Canonical storage is the 13-digit ISBN without separators.
function normalizeIsbn(value) {
  const text = String(value || '').trim();
  if (!text || /[^0-9Xx\s-]/.test(text)) return '';
  const isbn = text.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce((total, digit, i) => total + (digit === 'X' ? 10 : Number(digit)) * (10 - i), 0);
    if (sum % 11 !== 0) return '';
    const prefix = '978' + isbn.slice(0, 9);
    const check = (10 - [...prefix].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0) % 10) % 10;
    return prefix + check;
  }
  if (!/^97[89]\d{10}$/.test(isbn)) return '';
  const sum = [...isbn].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0);
  return sum % 10 === 0 ? isbn : '';
}
if (typeof module !== 'undefined') module.exports = { normalizeIsbn };
