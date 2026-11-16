const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const headers = ['id','isbn','title','author','language','notes','created_at','publisher','publication_year','shelf_location','category','description','series_name','volume_number','pages','updated_at'];
function storage(initial = {}) { const data = new Map(Object.entries(initial)); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k) }; }
async function openWindow(shared, responseStatus = 200, mobile = false, editable = true) {
  const elements = {}, handlers = {}, requests = [], scanners = [], timers = [];
  const el = id => elements[id] ||= { hidden: false, value: '', textContent: '', children: [], classList: { values: new Set(), toggle() {}, remove(name) { this.values.delete(name); }, add(name) { this.values.add(name); }, contains(name) { return this.values.has(name); } }, addEventListener(type, fn) { handlers[id + ':' + type] = fn; }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute() {}, append(child) { this.children.push(child); }, replaceChildren() { this.children = []; } };
  const window = { LIBRARY_CONFIG: {}, matchMedia: () => ({ matches: mobile }), addEventListener: (type, fn) => { handlers['window:' + type] = fn; } };
  const context = vm.createContext({ document: { getElementById: el, createElement: () => ({ textContent: '', setAttribute() {}, addEventListener() {}, append() {} }) }, window, localStorage: shared, sessionStorage: storage(), findDuplicateGroups: () => [], normalizeIsbn: require('../isbn.js').normalizeIsbn, matchBook: () => ({kind:'exact', books:[]}), createLibraryScanner: () => { const scanner = { stops: 0, start: async callback => { scanner.decoded = callback; }, hold: duration => { scanner.holdDuration = duration; }, stop: async () => { scanner.stops++; } }; scanners.push(scanner); return scanner; }, setTimeout: fn => { timers.push(fn); }, fetch: async (url, options) => { requests.push({url, options}); return { ok: responseStatus === 200, status: responseStatus, json: async () => url.includes('capabilities(canEdit)') ? { capabilities: { canEdit: editable } } : url.includes('fields=properties') ? { properties: {title: 'My library'}, sheets: [{properties: {title:'Books', gridProperties:{frozenRowCount:1}}}] } : { values: [headers] } }; }, console });
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { el, handlers, requests, scanners, timers };
}
const sheetKey = 'annas-annals-sheet-id', sessionKey = 'annas-annals-google-session';
test('a new window restores a valid session without reconnecting', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const first = await openWindow(shared), second = await openWindow(shared);
  for (const view of [first, second]) { assert.equal(view.el('library').hidden, false); assert.equal(view.el('connect').hidden, true); assert.equal(view.requests.length, 3); assert.equal(view.el('add').hidden, false); }
});
test('an expired session is cleared and requires reconnection', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'expired', expiresAt: Date.now() - 1000 }) });
  const view = await openWindow(shared);
  assert.equal(view.requests.length, 0); assert.equal(shared.getItem(sessionKey), null); assert.equal(view.el('connect').hidden, false);
});
test('disconnect in another window clears the current window', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared);
  view.handlers['window:storage']({ key: sessionKey, newValue: null });
  assert.equal(view.el('library').hidden, true); assert.equal(view.el('connect').hidden, false); assert.equal(shared.getItem(sheetKey), null);
});

test('mobile opens scan view and viewers cannot add books', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, 200, true, false);
  assert.equal(view.el('scan-view').hidden, false);
  assert.equal(view.el('library').hidden, true);
  assert.equal(view.el('add').hidden, true);
  view.handlers['mode-library:click']();
  assert.equal(view.el('library').hidden, false);
  assert.equal(view.el('scan-view').hidden, true);
});

test('settings is a view and switching back restores the library', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared);
  view.handlers['settings-open:click']();
  assert.equal(view.el('settings-dialog').hidden, false);
  assert.equal(view.el('scan-view').hidden, true);
  assert.equal(view.el('library').hidden, true);
  view.handlers['mode-library:click']();
  assert.equal(view.el('settings-dialog').hidden, true);
  assert.equal(view.el('library').hidden, false);
});

test('scan button opens and closes its connected panel', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, 200, true);
  view.el('check-camera').hidden = true;
  await view.handlers['scan-start:click']();
  assert.equal(view.el('check-camera').hidden, false);
  assert.equal(view.el('scan-start').attributes['aria-expanded'], 'true');
  await view.handlers['scan-start:click']();
  assert.equal(view.el('check-camera').hidden, true);
  assert.equal(view.el('scan-start').attributes['aria-expanded'], 'false');
});

test('a scanned barcode highlights the guide before the scanner closes', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, 200, true);
  view.el('check-camera').hidden = true;
  await view.handlers['scan-start:click']();
  const done = view.scanners[1].decoded('9780306406157');
  assert.equal(view.el('check-preview').classList.contains('recognized'), true);
  assert.equal(view.el('check-camera').hidden, false);
  await view.handlers['scan-start:click']();
  view.timers[0]();
  await done;
  assert.equal(view.el('check-result').hidden, true);
});

test('a successful scan holds the camera briefly and leaving scan releases it', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, 200, true);
  view.el('check-camera').hidden = true;
  await view.handlers['scan-start:click']();
  const done = view.scanners[1].decoded('9780306406157');
  view.timers[0]();
  await done;
  assert.equal(view.scanners[1].holdDuration, 30000);
  assert.equal(view.scanners[1].stops, 0);
  assert.equal(view.el('check-camera').hidden, true);
  view.handlers['mode-library:click']();
  assert.equal(view.scanners[1].stops, 1);
});

