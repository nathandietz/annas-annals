const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { findDuplicateGroups } = require('../duplicates.js');
const { normalizeIsbn } = require('../isbn.js');

async function fixture({ legacy = false, extraData = false, nine = false, reordered = false } = {}) {
  const handlers = {}, elements = {}, requests = [];
  const headers = ['id', 'isbn', 'title', 'author', 'language', 'notes', 'created_at', 'publisher', 'publication_year', 'shelf_location', 'category', 'description', 'series_name', 'volume_number', 'pages', 'updated_at'];
  if (legacy) headers.splice(7);
  if (nine) headers.splice(9);
  let row = ['id-1', '9780306406157', 'Original', 'Author', '', '', '2026-01-01', ...(extraData ? ['occupied'] : [])];
  if (reordered) { [headers[0], headers[2]] = [headers[2], headers[0]]; [row[0], row[2]] = [row[2], row[0]]; }
  function element(id) { return elements[id] ||= { hidden: false, value: '', textContent: '', disabled: false, classList: { toggle() {}, add() {}, remove() {} }, children: [], addEventListener(type, fn) { handlers[id + ':' + type] = fn; this['on' + type] = fn; }, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); }, setAttribute() {}, removeAttribute() {}, showModal() {}, close() {}, reset() {} }; }
  const form = element('book-form'); form.elements = Object.fromEntries(['isbn','title','author','language','notes','publisher','publication_year','shelf_location','category','description','series_name','volume_number','pages'].map(k => [k, { value: '' }]));
  const localStorage = { getItem: key => key === 'annas-annals-sheet-id' ? 'sheet-id' : key === 'annas-annals-google-session' ? JSON.stringify({ token: 'token', expiresAt: Date.now() + 60000 }) : null, setItem() {}, removeItem() {} };
  const sessionStorage = { getItem: () => JSON.stringify({ token: 'token', expiresAt: Date.now() + 60000 }), setItem() {}, removeItem() {} };
  const context = vm.createContext({ document: { getElementById: element, createElement: tag => element('created-' + tag + '-' + Math.random()) }, window: { LIBRARY_CONFIG: {}, confirm: () => true, addEventListener() {} }, localStorage, sessionStorage, createLibraryScanner: () => ({ stop: async () => {} }), normalizeIsbn, findDuplicateGroups, setTimeout: () => 1, clearTimeout: () => {}, crypto: { randomUUID: () => 'new-id' }, fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => url.includes('fields=properties') ? { properties: { title: 'Library' }, sheets: [{ properties: { title: 'Books', gridProperties: { frozenRowCount: 1 } } }] } : url.includes('fields=sheets') ? { sheets: [{ properties: { title: 'Books', sheetId: 0 } }] } : { values: [headers, row] } }; }, console });
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const card = element('books').children[0];
  const edit = card.children.find(child => child.className === 'book-actions').children.find(child => child.className.includes('book-edit'));
  assert.ok(edit);
  edit.onclick({ stopPropagation() {} });
  return { handlers, form, requests, element, changeRow: value => { row = value; } };
}

test('editing checks the fresh row before writing', async () => {
  const f = await fixture(); f.form.elements.title.value = 'Updated';
  await f.handlers['book-form:submit']({ preventDefault() {}, currentTarget: f.form });
  const writes = f.requests.filter(r => r.url.includes('values:batchUpdate'));
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0].options.body).data.find(item => item.range.endsWith('C2')).values[0][0], 'Updated');
});

test('editing and deletion stop when the sheet row has changed', async () => {
  const f = await fixture(); f.changeRow(['id-1', '9780306406157', 'Changed elsewhere', 'Author', '', '', '2026-01-01']);
  await f.handlers['book-form:submit']({ preventDefault() {}, currentTarget: f.form });
  assert.match(f.element('form-status').textContent, /changed in the Sheet/);
  await f.handlers['delete:click']();
  await f.handlers['delete:click']();
  assert.match(f.element('form-status').textContent, /changed in the Sheet/);
  assert.equal(f.requests.filter(r => ['PUT', 'POST'].includes(r.options?.method)).length, 0);
});


test('older library update writes only the new header cells', async () => {
  const f = await fixture({ legacy: true });
  f.handlers['upgrade-library:click']();
  await f.handlers['confirm-upgrade:click']();
  const writes = f.requests.filter(r => r.url.endsWith(':batchUpdate'));
  assert.equal(writes.length, 1);
  const requests = JSON.parse(writes[0].options.body).requests;
  assert.equal(requests[0].updateCells.start.columnIndex, 7);
  assert.deepEqual(requests[0].updateCells.rows[0].values.map(v => v.userEnteredValue.stringValue), ['publisher', 'publication_year', 'shelf_location', 'category', 'description', 'series_name', 'volume_number', 'pages', 'updated_at']);
  assert.ok(requests.some(request => request.moveDimension));
});

test('older library update refuses to overwrite occupied columns', async () => {
  const f = await fixture({ legacy: true, extraData: true });
  f.handlers['upgrade-library:click']();
  await f.handlers['confirm-upgrade:click']();
  assert.equal(f.requests.filter(r => r.options?.method === 'PUT').length, 0);
  assert.match(f.element('status').textContent, /data have no header/);
});


test('nine-column library adds all missing columns', async () => {
  const f = await fixture({ nine: true });
  f.handlers['upgrade-library:click']();
  await f.handlers['confirm-upgrade:click']();
  const writes = f.requests.filter(r => r.url.endsWith(':batchUpdate'));
  assert.equal(writes.length, 1);
  const first = JSON.parse(writes[0].options.body).requests[0].updateCells;
  assert.equal(first.start.columnIndex, 9);
  assert.deepEqual(first.rows[0].values.map(v => v.userEnteredValue.stringValue), ['shelf_location', 'category', 'description', 'series_name', 'volume_number', 'pages', 'updated_at']);
});

test('saving a book includes its shelf location', async () => {
  const f = await fixture();
  f.form.elements.shelf_location.value = 'Living room, top shelf';
  await f.handlers['book-form:submit']({ preventDefault() {}, currentTarget: f.form });
  const write = f.requests.find(r => r.url.includes('values:batchUpdate'));
  assert.equal(JSON.parse(write.options.body).data.find(item => item.range.endsWith('J2')).values[0][0], 'Living room, top shelf');
});


test('cancelling a library update does not write to the Sheet', async () => {
  const f = await fixture({ nine: true });
  f.handlers['upgrade-library:click']();
  f.handlers['cancel-upgrade:click']();
  assert.equal(f.requests.filter(r => r.options?.method === 'PUT').length, 0);
});


test('saving book details assigns an updated timestamp', async () => {
  const f = await fixture(); f.form.elements.category.value = 'History'; f.form.elements.pages.value = '240';
  await f.handlers['book-form:submit']({ preventDefault() {}, currentTarget: f.form });
  const data = JSON.parse(f.requests.find(r => r.url.includes('values:batchUpdate')).options.body).data;
  assert.equal(data.find(item => item.range.endsWith('K2')).values[0][0], 'History'); assert.equal(data.find(item => item.range.endsWith('O2')).values[0][0], '240'); assert.ok(!Number.isNaN(Date.parse(data.find(item => item.range.endsWith('P2')).values[0][0])));
});


test('editing locates book and writes values using reordered headers', async () => {
  const f = await fixture({ reordered: true }); f.form.elements.title.value = 'Reordered title';
  await f.handlers['book-form:submit']({ preventDefault() {}, currentTarget: f.form });
  const write = f.requests.find(r => r.url.includes('values:batchUpdate'));
  const cells = JSON.parse(write.options.body).data;
  assert.equal(cells.find(item => item.range.endsWith('A2')).values[0][0], 'Reordered title');
  assert.equal(cells.find(item => item.range.endsWith('C2')).values[0][0], 'id-1');
});


test('cancelling book deletion does not write to the Sheet', async () => {
  const f = await fixture(); await f.handlers['delete:click']();
  assert.equal(f.requests.filter(r => r.url.includes('batchClear')).length, 0);
});


test('library update includes freezing the header row', async () => {
  const f = await fixture({ nine: true });
  f.handlers['upgrade-library:click'](); await f.handlers['confirm-upgrade:click']();
  const write = f.requests.find(r => r.url.endsWith(':batchUpdate'));
  const freeze = JSON.parse(write.options.body).requests.find(r => r.updateSheetProperties);
  assert.equal(freeze.updateSheetProperties.properties.gridProperties.frozenRowCount, 1);
});
