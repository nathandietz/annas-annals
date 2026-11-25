const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const headers = ['id','isbn','title','author','language','notes','created_at','publisher','publication_year','shelf_location','category','description','series_name','volume_number','pages','updated_at'];
function storage(initial = {}) { const data = new Map(Object.entries(initial)); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k) }; }
async function openWindow(shared, responseStatus = 200, mobile = false, editable = true, { tabStorage = storage(), permissionReady } = {}) {
  const elements = {}, handlers = {}, requests = [], scanners = [], timers = [];
  const el = id => elements[id] ||= { hidden: false, value: '', textContent: '', children: [], classList: { values: new Set(), toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); }, remove(name) { this.values.delete(name); }, add(name) { this.values.add(name); }, contains(name) { return this.values.has(name); } }, addEventListener(type, fn) { handlers[id + ':' + type] = fn; }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute() {}, append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } };
  let deletedCache;
  let navigatedTo;
  const window = { LIBRARY_CONFIG: {}, location: { href:'https://example.com/annals/?view=library', replace: value => { navigatedTo = value; } }, caches: { keys: async () => deletedCache ? [] : ['annas-annals-covers-v1'], open: async () => ({ keys: async () => [{}, {}] }), delete: async name => { deletedCache = name; } }, navigator: { storage: { estimate: async () => ({usage: 1048576}) } }, matchMedia: () => ({ matches: mobile }), addEventListener: (type, fn) => { handlers['window:' + type] = fn; } };
  const context = vm.createContext({ URL, document: { getElementById: el, createElement: () => ({ textContent: '', setAttribute() {}, addEventListener() {}, append() {} }) }, window, localStorage: shared, sessionStorage: tabStorage, findDuplicateGroups: () => [], normalizeIsbn: require('../isbn.js').normalizeIsbn, matchBook: () => ({kind:'exact', books:[]}), createLibraryScanner: () => { const scanner = { stops: 0, start: async (callback, onStatus) => { scanner.decoded = callback; onStatus('Starting camera…'); }, hold: duration => { scanner.holdDuration = duration; }, stop: async () => { scanner.stops++; } }; scanners.push(scanner); return scanner; }, setTimeout: fn => timers.push(fn) - 1, clearTimeout: id => { if (id !== undefined) timers[id] = () => {}; }, fetch: async (url, options) => { requests.push({url, options}); if (url.includes('capabilities(canEdit)') && permissionReady) await permissionReady; return { ok: responseStatus === 200, status: responseStatus, json: async () => url.includes('capabilities(canEdit)') ? { capabilities: { canEdit: editable } } : url.includes('fields=properties') ? { properties: {title: 'My library'}, sheets: [{properties: {title:'Books', gridProperties:{frozenRowCount:1}}}] } : { values: [headers] } }; }, console });
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { el, handlers, requests, scanners, timers, window, navigatedTo: () => navigatedTo, cacheDeleted: () => deletedCache };
}
const sheetKey = 'annas-annals-sheet-id', sessionKey = 'annas-annals-google-session';
test('a new window restores a valid session without reconnecting', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const first = await openWindow(shared), second = await openWindow(shared);
  for (const view of [first, second]) { assert.equal(view.el('library').hidden, false); assert.equal(view.el('connect').hidden, true); assert.equal(view.requests.length, 3); assert.equal(view.el('add').hidden, false); }
});
test('desktop reload keeps Add book in place while editor access is verified once', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const tabStorage = storage();
  await openWindow(shared, 200, false, true, { tabStorage });

  let finishPermission;
  const permissionReady = new Promise(resolve => { finishPermission = resolve; });
  const view = await openWindow(shared, 200, false, true, { tabStorage, permissionReady });
  assert.equal(view.el('library').hidden, false);
  assert.equal(view.el('add').hidden, false);
  assert.equal(view.el('add').disabled, true);
  assert.equal(view.requests.filter(request => request.url.includes('capabilities(canEdit)')).length, 1);

  finishPermission();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.el('add').hidden, false);
  assert.equal(view.el('add').disabled, false);
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

test('the mobile Library tab bar stays full-size while scrolling in either direction', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, 200, true);
  view.handlers['mode-library:click']();
  for (const y of [0, 110, 400, 170, 0]) {
    view.window.scrollY = y;
    view.handlers['window:scroll']();
    assert.equal(view.el('mode-toggle').classList.contains('is-compact'), false, `tab bar at scroll position ${y}`);
    assert.equal(view.el('scroll-top').hidden, y < 300);
  }
});

test('book covers default to off and an explicit preference is respected', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const first = await openWindow(shared);
  assert.equal(first.el('show-covers').checked, false);
  shared.setItem('annas-annals-show-covers', 'true');
  const second = await openWindow(shared);
  assert.equal(second.el('show-covers').checked, true);
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

test('the selected main view is restored when the page is reopened', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const first = await openWindow(shared, 200, true);
  first.handlers['mode-library:click']();
  const second = await openWindow(shared, 200, true);
  assert.equal(second.el('library').hidden, false);
  assert.equal(second.el('scan-view').hidden, true);
  second.handlers['settings-open:click']();
  const third = await openWindow(shared, 200, true);
  assert.equal(third.el('settings-dialog').hidden, false);
});

test('settings shows cached image count and estimated site storage', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared);
  view.handlers['settings-open:click']();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(view.el('cover-cache-info').textContent, /2 cached images/);
  assert.match(view.el('cover-cache-info').textContent, /1(?:\.0)? MB.*site storage/i);
});

test('clear cover cache deletes stored covers and reports completion', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared);
  await view.handlers['clear-cover-cache:click']();
  assert.equal(view.cacheDeleted(), 'annas-annals-covers-v1');
  assert.match(view.el('cover-cache-status').textContent, /cleared/i);
});

test('update app checks the worker and reloads the same URL without a stale document', async () => {
  const view = await openWindow(storage()); let updated = false;
  view.window.navigator.serviceWorker = { getRegistration: async () => ({update: async () => { updated = true; }}) };
  await view.handlers['update-app:click']();
  assert.equal(updated, true);
  const url = new URL(view.navigatedTo());
  assert.equal(url.pathname, '/annals/'); assert.equal(url.searchParams.get('view'), 'library');
  assert.ok(url.searchParams.has('_update'));
});

test('update app reports a worker update failure without navigating', async () => {
  const view = await openWindow(storage());
  view.window.navigator.serviceWorker = { getRegistration: async () => ({update: async () => { throw new Error('offline'); }}) };
  await view.handlers['update-app:click']();
  assert.equal(view.navigatedTo(), undefined);
  assert.match(view.el('update-app-status').textContent, /could not/i);
  assert.equal(view.el('update-app').disabled, false);
});

test('update app reloads even without a service worker', async () => {
  const view = await openWindow(storage());
  await view.handlers['update-app:click']();
  assert.ok(new URL(view.navigatedTo()).searchParams.has('_update'));
});

test('scan button opens and closes its connected panel', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, 200, true);
  view.el('check-camera').hidden = true;
  await view.handlers['scan-start:click']();
  assert.equal(view.el('check-camera').hidden, false);
  assert.equal(view.el('scan-start').attributes['aria-expanded'], 'true');
  assert.match(view.el('check-status').textContent, /Keep the entire barcode in view/);
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
  assert.equal(view.el('check-camera').hidden, false);
  assert.equal(view.el('check-camera').classList.contains('camera-standby'), true);
  assert.equal(view.el('scan-start').attributes['aria-expanded'], 'false');
  await view.handlers['scan-start:click']();
  assert.equal(view.el('check-camera').classList.contains('camera-standby'), false);
  assert.equal(view.el('scan-start').attributes['aria-expanded'], 'true');
  view.handlers['mode-library:click']();
  assert.equal(view.scanners[1].stops, 1);
});

