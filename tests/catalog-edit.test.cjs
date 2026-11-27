const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { installTemplates } = require('./helpers/templates.cjs');
const { findDuplicateGroups } = require('../assets/js/duplicates.js');
const { normalizeIsbn } = require('../assets/js/isbn.js');
const { matchBook } = require('../assets/js/book-match.js');

async function fixture({ initialRow, legacy = false, extraData = false, nine = false, reordered = false, deferLookup = false, bookData = null, editionData = null, workData = null, googleData = null, googleFails = false } = {}) {
  let scanTimer, resolveLookup;
  const lookupWait = new Promise(resolve => { resolveLookup = resolve; });
  const handlers = {}, elements = {}, requests = [];
  const headers = ['id', 'isbn', 'title', 'author', 'language', 'notes', 'created_at', 'publisher', 'publication_year', 'shelf_location', 'category', 'description', 'series_name', 'volume_number', 'pages', 'updated_at'];
  if (legacy) headers.splice(7);
  if (nine) headers.splice(9);
  const addedRows = [];
  let row = initialRow || ['id-1', '9780306406157', 'Original', 'Author', '', '', '2026-01-01', ...(extraData ? ['occupied'] : [])];
  if (reordered) { [headers[0], headers[2]] = [headers[2], headers[0]]; [row[0], row[2]] = [row[2], row[0]]; }
  function element(id) { return elements[id] ||= { hidden: false, value: '', textContent: '', disabled: false, classList: { toggle() {}, add() {}, remove() {} }, children: [], addEventListener(type, fn) { handlers[id + ':' + type] = fn; this['on' + type] = fn; }, replaceChildren(...children) { this.children = []; this.append(...children); }, append(...children) { for (const child of children) child.parent = this; this.children.push(...children); }, setAttribute() {}, removeAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; }, reset() {} }; }
  const form = element('book-form'); form.elements = Object.fromEntries(['isbn','title','author','language','notes','publisher','publication_year','shelf_location','category','description','series_name','volume_number','pages'].map(k => [k, { value: '' }]));
  installTemplates(element);
  const localStorage = { getItem: key => key === 'annas-annals-show-covers' ? 'true' : key === 'annas-annals-sheet-id' ? 'sheet-id' : key === 'annas-annals-google-session' ? JSON.stringify({ token: 'token', expiresAt: Date.now() + 60000 }) : null, setItem() {}, removeItem() {} };
  const sessionStorage = { getItem: () => JSON.stringify({ token: 'token', expiresAt: Date.now() + 60000 }), setItem() {}, removeItem() {} };
  const context = vm.createContext({ document: { getElementById: element, createElement: tag => element('created-' + tag + '-' + Math.random()) }, window: { LIBRARY_CONFIG: {apiKey:'test-key'}, confirm: () => true, addEventListener() {} }, localStorage, sessionStorage, createLibraryScanner: () => ({ stop: async () => {} }), normalizeIsbn, matchBook, findDuplicateGroups, setTimeout: (fn, delay) => { if (delay === 400) scanTimer = fn; if (delay === 1000) queueMicrotask(fn); return 1; }, clearTimeout: () => {}, crypto: { randomUUID: () => 'new-id' }, fetch: async (url, options) => { requests.push({ url, options }); if (googleFails && url.includes('googleapis.com/books/')) throw new Error('unavailable'); if (deferLookup && url.includes('openlibrary.org')) return lookupWait; if (url.includes(':append') && options?.body) addedRows.push(JSON.parse(options.body).values[0]); return { ok: true, json: async () => url.includes('googleapis.com/books/') ? {items:googleData ? [{volumeInfo:googleData}] : []} : url.includes('openlibrary.org/api/books') ? { 'ISBN:9780140328721': bookData } : url.includes('openlibrary.org/books/') ? editionData : url.includes('openlibrary.org/works/') ? workData : url.includes('capabilities(canEdit)') ? { capabilities: { canEdit: true } } : url.includes('fields=properties') ? { properties: { title: 'Library' }, sheets: [{ properties: { title: 'Books', gridProperties: { frozenRowCount: 1 } } }] } : url.includes('fields=sheets') ? { sheets: [{ properties: { title: 'Books', sheetId: 0 } }] } : { values: [headers, row, ...addedRows] } }; }, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const card = element('books').children[0];
  const edit = card.children.find(child => child.className === 'book-actions').children.find(child => child.className.includes('book-edit'));
  assert.ok(edit);
  edit.onclick({ stopPropagation() {} });
  return { handlers, form, requests, element, runScanTimer: () => scanTimer(), resolveLookup, changeRow: value => { row = value; } };
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

test('saving an edit returns to the same book with its saved details', async () => {
  const f = await fixture();
  f.form.elements.title.value = 'Updated title';
  f.form.elements.shelf_location.value = 'Top shelf';
  await f.handlers['book-form:submit']({ preventDefault() {}, currentTarget: f.form });
  assert.equal(f.element('editor').open, true);
  assert.equal(f.element('book-editor-fields').hidden, true);
  assert.equal(f.element('book-details-title').textContent, 'Updated title');
  assert.equal(f.element('book-details-copy').children[0].children[1].textContent, 'Top shelf');
  assert.equal(f.element('form-status').textContent, 'Changes saved.');
});

test('cancel returns to the saved details and restores the original draft values', async () => {
  const f = await fixture();
  f.form.elements.title.value = 'Discarded title';
  await f.handlers['cancel-edit:click']();
  assert.equal(f.element('editor').open, true);
  assert.equal(f.element('book-editor-fields').hidden, true);
  assert.equal(f.element('book-details-title').textContent, 'Original');
  f.handlers['edit-from-details:click']();
  assert.equal(f.form.elements.title.value, 'Original');
});

test('cards show identification and shelf information while details retain the other fields', async () => {
  const f = await fixture({
    initialRow: ['id-1','9780306406157','Original','Author','English','Notes','2026-01-01','Publisher','1991','Top shelf','Fiction','Description','Series','2','240','2026-01-01']
  });
  const details = f.element('books').children[0].children[0].children.find(child => child.className === 'book-details');
  assert.deepEqual(details.children.filter(child => !child.hidden).map(child => child.textContent), ['Original','Author','Series · Vol. 2','Top shelf']);
  f.element('books').children[0].onclick();
  assert.equal(f.form.elements.publisher.value, 'Publisher');
  assert.equal(f.form.elements.category.value, 'Fiction');
  assert.equal(f.form.elements.pages.value, '240');
});

test('catalog list binds HTML template fields, sort controls, and literal titles', async () => {
  const title = '<em>Original</em>';
  const f = await fixture({ initialRow: ['id-1', '9780306406157', title, 'Author'] });
  f.handlers['view-list:click']();

  const table = () => f.element('books').children[0];
  const titleHeader = () => table().querySelector('[data-sort]');
  const row = () => table().querySelector('tbody').children[0];
  assert.equal(row().querySelector('.book-title-button').textContent, title);
  assert.equal(row().querySelector('.book-title-button').children.length, 0);
  assert.equal(row().querySelector('[data-book="publisher"]').textContent, '—');
  titleHeader().querySelector('button').onclick();
  assert.equal(titleHeader().getAttribute('aria-sort'), 'ascending');
  titleHeader().querySelector('button').onclick();
  assert.equal(titleHeader().getAttribute('aria-sort'), 'descending');
  row().querySelector('.book-title-button').onclick({ stopPropagation() {} });
  assert.equal(f.element('book-details-title').textContent, title);
});

test('book details use a Library label and readable language without changing the saved language code', async () => {
  const f = await fixture({ initialRow: ['id-1', '9780306406157', 'Original', 'Author', 'en', '', '2026-01-01'] });
  f.element('books').children[0].onclick();
  assert.equal(f.element('close-editor').textContent, '‹ Library');
  assert.deepEqual(f.element('book-details-edition').children.map(row => row.children[1].textContent), ['English', '9780306406157']);
  assert.equal(f.form.elements.language.value, 'en');
});

test('a saved download preference does not trigger cover requests in the catalog or editor', async () => {
  const f = await fixture({ googleData: {
    industryIdentifiers: [{ identifier: '9780306406157' }],
    imageLinks: { thumbnail: 'http://books.google.com/books/content?id=edition' }
  } });
  const book = f.element('books').children[0];
  book.onclick();
  f.handlers['edit-from-details:click']();
  await f.handlers['add:click']();
  f.handlers['view-list:click']();
  f.handlers['mode-scan:click']();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.filter(({ url }) => url.includes('googleapis.com/books/') || url.includes('covers.openlibrary.org')).length, 0);
});

test('the fallback preference controls the local thumbnails in cards, list, and details', async () => {
  const f = await fixture();
  const cardCover = () => f.element('books').children[0].children[0].children[0];
  assert.equal(cardCover().children.length, 1);
  const [fallback] = cardCover().children;
  assert.equal(fallback.className, 'book-cover-fallback');
  assert.equal(fallback.textContent, '');
  assert.equal(fallback.children.length, 0);

  f.element('books').children[0].onclick();
  assert.equal(f.element('book-cover-panel').hidden, false);
  assert.equal(f.element('book-options').hidden, true);
  f.handlers['edit-from-details:click']();
  assert.equal(f.element('book-cover-panel').hidden, true);
  assert.equal(f.element('book-options').hidden, false);
  f.handlers['cancel-edit:click']();

  f.handlers['view-list:click']();
  const listCover = () => f.element('books').children[0].children[1].children[0].children[0].children[0];
  assert.equal(listCover().children[0].className, 'book-cover-fallback');
  f.element('show-fallback-covers').checked = false;
  f.handlers['show-fallback-covers:change']();
  assert.equal(f.element('book-cover-panel').hidden, true);
  assert.equal(listCover().hidden, true);
  f.handlers['view-card:click']();
  assert.equal(cardCover().hidden, true);
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

test('adding a book clears the scan result and shows the new book first', async () => {
  const f = await fixture();
  f.element('check-result').hidden = false;
  f.handlers['add:click']();
  f.form.elements.title.value = 'New arrival';
  f.form.elements.author.value = 'Another author';
  f.form.elements.isbn.value = '9780140328721';
  await f.handlers['book-form:submit']({ preventDefault() {}, currentTarget: f.form });
  assert.equal(f.element('check-result').hidden, true);
  const title = f.element('books').children[0].children[0].children.find(child => child.className === 'book-details').children[0];
  assert.equal(title.children[0].textContent, 'New arrival');
});

test('Check and Library search the same catalog fields and Check can open Add book', async () => {
  const f = await fixture({
    initialRow: ['id-1', '9780306406157', 'Original', 'Author', '', '', '2026-01-01', '', '', 'Top shelf']
  });
  f.element('search').value = 'Top shelf';
  f.handlers['search:input']();
  assert.equal(f.element('books').children.length, 1);
  f.handlers['mode-scan:click']();
  f.element('scan-search').value = 'Top shelf';
  f.handlers['scan-search:input']();
  assert.equal(f.element('scan-books').children.length, 1);

  await f.handlers['check-add:click']();
  assert.equal(f.element('editor').open, true);
  assert.equal(f.element('editor-title').textContent, 'Add a book');
  assert.equal(f.form.elements.title.value, '');
});

test('Check and Library carry search text between tabs and can clear it from either tab', async () => {
  const f = await fixture();
  f.element('search').value = 'Original';
  f.handlers['search:input']();
  f.handlers['mode-scan:click']();
  assert.equal(f.element('scan-search').value, 'Original');
  assert.equal(f.element('scan-books').children.length, 1);
  assert.equal(f.element('check-search-clear').hidden, false);

  f.element('scan-search').value = 'Missing book';
  f.handlers['scan-search:input']();
  f.handlers['mode-library:click']();
  assert.equal(f.element('search').value, 'Missing book');
  assert.equal(f.element('books').children.length, 0);
  f.handlers['library-search-clear:click']();
  assert.equal(f.element('search').value, '');
  assert.equal(f.element('scan-search').value, '');
  assert.equal(f.element('books').children.length, 1);
  assert.equal(f.element('library-search-clear').hidden, true);

  f.handlers['mode-scan:click']();
  f.element('scan-search').value = 'Original';
  f.handlers['scan-search:input']();
  f.handlers['check-search-clear:click']();
  assert.equal(f.element('search').value, '');
  assert.equal(f.element('scan-search').value, '');
  assert.equal(f.element('scan-books').hidden, true);
  assert.equal(f.element('check-search-clear').hidden, true);
});

test('a possible match shows the owned edition and adds the scanned edition', async () => {
  const f = await fixture({
    initialRow: ['id-1', '9780306406157', 'Original', 'Author', '', '', '2026-01-01', 'Owned Publisher', '1991', 'Living room · Shelf 2'],
    bookData: { title: 'Original', authors: [{ name: 'Author' }], publishers: [{ name: 'New Publisher' }] }
  });
  f.handlers['mode-scan:click']();
  f.element('scan-search').value = '9780140328721';
  f.handlers['scan-search:input']();
  await f.runScanTimer();
  await new Promise(resolve => setImmediate(resolve));

  const result = f.element('check-result');
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const contents = descendants(result);
  assert.equal(result.children[0].textContent, 'Possible match');
  assert.ok(contents.some(child => child.textContent.includes('Owned Publisher') && child.textContent.includes('9780306406157')));
  assert.ok(contents.some(child => child.textContent === 'Living room · Shelf 2'));
  const add = contents.find(child => child.textContent === 'Add this edition anyway');
  assert.equal(add.className, 'check-primary');
  add.onclick();
  assert.equal(f.form.elements.isbn.value, '9780140328721');
  assert.equal(f.form.elements.publisher.value, 'New Publisher');
  assert.equal(f.form.elements.shelf_location.value, '');
  await f.handlers['book-form:submit']({ preventDefault() {}, currentTarget: f.form });
  const write = f.requests.find(request => request.url.includes(':append'));
  assert.equal(JSON.parse(write.options.body).values[0][1], '9780140328721');
});

test('shows the local ISBN result while the edition lookup is pending', async () => {
  const f = await fixture({ deferLookup: true });
  f.handlers['mode-scan:click']();
  f.element('scan-search').value = '9780140328721';
  f.handlers['scan-search:input']();
  await f.runScanTimer();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.element('check-result').children[0].textContent, 'Checking your library…');
  f.resolveLookup({ ok: true, json: async () => ({}) });
});

test('adding a scanned book fills available edition details from the existing lookup', async () => {
  const f = await fixture({ bookData: { title:'Matilda', authors:[{name:'Roald Dahl'}], publishers:[{name:'Puffin'}], publish_date:'1988', languages:[{key:'/languages/eng'}], number_of_pages:240, subjects:[{name:'Fiction'}] } });
  f.handlers['mode-scan:click']();
  f.element('scan-search').value = '9780140328721';
  f.handlers['scan-search:input']();
  await f.runScanTimer();
  await new Promise(resolve => setImmediate(resolve));
  const add = f.element('check-result').children.find(child => child.className === 'check-result-actions').children.find(child => child.textContent === 'Add book');
  assert.ok(add); add.onclick();
  for (const [key, value] of Object.entries({isbn:'9780140328721', title:'Matilda', author:'Roald Dahl', publisher:'Puffin', publication_year:'1988', language:'eng', pages:'240', category:'Fiction'})) assert.equal(f.form.elements[key].value, value);
  assert.equal(f.form.elements.shelf_location.value, '');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.element('book-cover-panel').hidden, false);
  assert.equal(f.requests.filter(r => r.url.includes('googleapis.com/books/')).length, 1);
  assert.equal(f.requests.filter(r => r.url.includes('openlibrary.org/api/books')).length, 1);
});

test('scan lookup prefers Google Books and keeps one category', async () => {
  const f = await fixture({ googleData: { industryIdentifiers:[{type:'ISBN_13',identifier:'9780140328721'}], title:'Google title', authors:['Roald Dahl'], mainCategory:'Juvenile Fiction', categories:['Juvenile Fiction','Fantasy'], pageCount:240 }, bookData: {title:'Other title', authors:[{name:'Roald Dahl'}], publishers:[{name:'Puffin'}], subjects:[{name:'Children'},{name:'Fiction'}]} });
  f.handlers['mode-scan:click'](); f.element('scan-search').value = '9780140328721'; f.handlers['scan-search:input'](); await f.runScanTimer();
  await new Promise(resolve => setImmediate(resolve));
  f.element('check-result').children.find(child => child.className === 'check-result-actions').children.find(child => child.textContent === 'Add book').onclick();
  assert.equal(f.form.elements.title.value, 'Google title');
  assert.equal(f.form.elements.category.value, 'Juvenile Fiction');
  assert.equal(f.form.elements.publisher.value, 'Puffin');
});

test('scan lookup uses one Open Library subject if Google Books fails', async () => {
  const f = await fixture({ googleFails:true, bookData:{title:'Matilda', authors:[{name:'Roald Dahl'}], subjects:[{name:'Fantasy, juvenile fiction'},{name:'Children'}]} });
  f.handlers['mode-scan:click'](); f.element('scan-search').value = '9780140328721'; f.handlers['scan-search:input'](); await f.runScanTimer();
  await new Promise(resolve => setImmediate(resolve));
  f.element('check-result').children.find(child => child.className === 'check-result-actions').children.find(child => child.textContent === 'Add book').onclick();
  assert.equal(f.form.elements.category.value, 'Fantasy, juvenile fiction');
});

test('manual lookup identifies the source of each suggestion and retains user-entered values', async () => {
  const f = await fixture({ googleData:{industryIdentifiers:[{identifier:'9780140328721'}], title:'Google title', authors:['Roald Dahl'], mainCategory:'Fiction'}, bookData:{title:'Open Library title', publishers:[{name:'Open publisher'}]} });
  f.handlers['add:click']();
  f.form.elements.isbn.value = '9780140328721';
  f.form.elements.title.value = 'My title';
  f.form.elements.publisher.value = 'My publisher';
  f.form.elements.category.value = '';
  await f.handlers['lookup:click']();
  assert.equal(f.form.elements.title.value, 'My title');
  assert.equal(f.form.elements.category.value, 'Fiction');
  const title = f.element('lookup-suggestions').children.find(child => child.children[0].textContent === 'Title: Google title');
  const publisher = f.element('lookup-suggestions').children.find(child => child.children[0].textContent === 'Publisher: Open publisher');
  assert.equal(title.children[1].textContent, 'Source: Google Books');
  assert.equal(publisher.children[1].textContent, 'Source: Open Library');
  assert.match(f.element('lookup-status').textContent, /Google Books.*Open Library/);
});

test('manual lookup shows Google results before a slow Open Library response and preserves edits', async () => {
  const f = await fixture({ deferLookup:true, googleData:{industryIdentifiers:[{identifier:'9780140328721'}], title:'Google title', authors:['Roald Dahl'], mainCategory:'Fiction'} });
  f.handlers['add:click'](); f.form.elements.isbn.value = '9780140328721'; f.form.elements.title.value = ''; f.form.elements.category.value = '';
  const pending = f.handlers['lookup:click']();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.form.elements.title.value, 'Google title');
  assert.match(f.element('lookup-status').textContent, /Google Books/);
  f.form.elements.title.value = 'My corrected title';
  f.resolveLookup({ ok:true, json:async () => ({'ISBN:9780140328721':{title:'Other title', publishers:[{name:'Puffin'}]}}) });
  await pending;
  assert.equal(f.form.elements.title.value, 'My corrected title');
  assert.equal(f.form.elements.publisher.value, 'Puffin');
});

test('edition and work details fill asynchronously without replacing what the user typed', async () => {
  const f = await fixture({ bookData: { title:'Matilda', authors:[{name:'Roald Dahl'}], url:'https://openlibrary.org/books/OL123M/Matilda' }, editionData: { series:['Children’s books'], works:[{key:'/works/OL12W'}] }, workData: { description:{value:'A young reader discovers her powers.'} } });
  f.handlers['mode-scan:click']();
  f.element('scan-search').value = '9780140328721';
  f.handlers['scan-search:input'](); await f.runScanTimer();
  await new Promise(resolve => setImmediate(resolve));
  f.element('check-result').children.find(child => child.className === 'check-result-actions').children.find(child => child.textContent === 'Add book').onclick();
  f.form.elements.description.value = 'My own description';
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.form.elements.series_name.value, 'Children’s books');
  assert.equal(f.form.elements.description.value, 'My own description');
  assert.equal(f.requests.filter(r => r.url.includes('/works/OL12W.json')).length, 1);
});
