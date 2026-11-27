'use strict';
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += c; }
    else if (c === '"') { if (field || closed) throw new Error('Unexpected quote in CSV.'); quoted = true; }
    else if (c === ',' || c === '\n' || c === '\r') { row.push(field); field = ''; closed = false; if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; } }
    else { if (closed) throw new Error('Unexpected text after a quoted field.'); field += c; }
  }
  if (quoted) throw new Error('Unclosed quoted field in CSV.');
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(value => value !== ''));
}
function formatCsv(rows) { return rows.map(row => row.map(value => { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }).join(',')).join('\r\n') + '\r\n'; }
if (typeof module !== 'undefined') module.exports = { parseCsv, formatCsv };
