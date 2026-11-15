const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeIsbn } = require('../isbn.js');

async function fixture({ legacy = false, extraData = false } = {}) {
  const handlers = {}, elements = {}, requests = [];
  const headers = ['id', 'isbn', 'title', 'author', 'language', 'notes', 'created_at', 'publisher', 'publication_year'];
  if (legacy) headers.splice(7);
  let row = ['id-1', '9780306406157', 'Original', 'Author', '', '', '2026-01-01', ...(extraData ? ['occupied'] : [])];
  function element(id) { return elements[id] ||= { hidden: false, value: '', textContent: '', disabled: false, children: [], addEventListener(type, fn) { handlers[id + ':' + type] = fn; }, replaceChildren() { this.children = []; }, append(child) { this.children.push(child); }, setAttribute() {}, removeAttribute() {}, showModal() {}, close() {}, reset() {} }; }
  const form = element('book-form'); form.elements = Object.fromEntries(['isbn','title','author','language','notes','publisher','publication_year'].map(k => [k, { value: '' }]));
  const localStorage = { getItem: () => 'sheet-id', setItem() {}, removeItem() {} };
  const sessionStorage = { getItem: () => JSON.stringify({ token: 'token', expiresAt: Date.now() + 60000 }), setItem() {}, removeItem() {} };
  const context = vm.createContext({ document: { getElementById: element, createElement: tag => element('created-' + tag + '-' + Math.random()) }, window: { LIBRARY_CONFIG: {}, confirm: () => true }, localStorage, sessionStorage, createLibraryScanner: () => ({ stop: async () => {} }), normalizeIsbn, crypto: { randomUUID: () => 'new-id' }, fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => url.includes('fields=properties') ? { properties: { title: 'Library' } } : { values: [headers, row] } }; }, console });
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const card = element('books').children[0];
  const edit = card.children.find(child => child.textContent === 'Edit details');
  assert.ok(edit);
  const click = Object.entries(handlers).find(([key]) => key.startsWith('created-button-') && key.endsWith(':click'))[1];
  click();
  return { handlers, form, requests, element, changeRow: value => { row = value; } };
}

test('editing checks the fresh row before writing', async () => {
  const f = await fixture(); f.form.elements.title.value = 'Updated';
  await f.handlers['book-form:submit']({ preventDefault() {}, currentTarget: f.form });
  const writes = f.requests.filter(r => r.options?.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0].options.body).values[0][2], 'Updated');
});

test('editing and deletion stop when the sheet row has changed', async () => {
  const f = await fixture(); f.changeRow(['id-1', '9780306406157', 'Changed elsewhere', 'Author', '', '', '2026-01-01']);
  await f.handlers['book-form:submit']({ preventDefault() {}, currentTarget: f.form });
  assert.match(f.element('form-status').textContent, /changed in the Sheet/);
  await f.handlers['delete:click']();
  assert.match(f.element('form-status').textContent, /changed in the Sheet/);
  assert.equal(f.requests.filter(r => ['PUT', 'POST'].includes(r.options?.method)).length, 0);
});


test('older library update writes only the new header cells', async () => {
  const f = await fixture({ legacy: true });
  await f.handlers['upgrade-library:click']();
  const writes = f.requests.filter(r => r.options?.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.match(decodeURIComponent(writes[0].url), /Books'!H1:I1/);
  assert.deepEqual(JSON.parse(writes[0].options.body).values, [['publisher', 'publication_year']]);
});

test('older library update refuses to overwrite occupied columns', async () => {
  const f = await fixture({ legacy: true, extraData: true });
  await f.handlers['upgrade-library:click']();
  assert.equal(f.requests.filter(r => r.options?.method === 'PUT').length, 0);
  assert.match(f.element('status').textContent, /contain data/);
});
