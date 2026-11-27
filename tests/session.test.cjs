const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const headers = ['id','isbn','title','author','language','notes','created_at','publisher','publication_year','shelf_location','category','description','series_name','volume_number','pages','updated_at'];
function storage(initial = {}) { const data = new Map(Object.entries(initial)); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k) }; }
async function openWindow(shared, responseStatus = 200, mobile = false, editable = true, { tabStorage = storage(), permissionReady, now = Date.now, refreshDelay = queueMicrotask, standalone = false } = {}) {
  const elements = {}, handlers = {}, requests = [], scanners = [], timers = [];
  const el = id => elements[id] ||= { hidden: false, value: '', textContent: '', children: [], classList: { values: new Set(), toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); }, remove(name) { this.values.delete(name); }, add(name) { this.values.add(name); }, contains(name) { return this.values.has(name); } }, addEventListener(type, fn) { handlers[id + ':' + type] = fn; }, style: { setProperty(name, value) { this[name] = value; } }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute() {}, append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } };
  let deletedCache;
  let navigatedTo, tickUpdateAge;
  const window = { LIBRARY_CONFIG: {}, innerHeight: 874, location: { href:'https://example.com/annals/?view=library', replace: value => { navigatedTo = value; } }, caches: { keys: async () => deletedCache ? [] : ['annas-annals-covers-v1'], open: async () => ({ keys: async () => [{}, {}] }), delete: async name => { deletedCache = name; } }, navigator: { storage: { estimate: async () => ({usage: 1048576}) } }, matchMedia: query => ({ matches: query === '(display-mode: standalone)' ? standalone : mobile }), setInterval: (fn, delay) => { if (delay === 60000) tickUpdateAge = fn; }, addEventListener: (type, fn) => { handlers['window:' + type] = fn; } };
  const context = vm.createContext({ URL, Date: class extends Date { static now() { return now(); } }, document: { getElementById: el, createElement: () => ({ textContent: '', setAttribute() {}, addEventListener() {}, append() {} }) }, window, localStorage: shared, sessionStorage: tabStorage, findDuplicateGroups: () => [], normalizeIsbn: require('../isbn.js').normalizeIsbn, matchBook: () => ({kind:'exact', books:[]}), createLibraryScanner: () => { const scanner = { stops: 0, start: async (callback, onStatus) => { scanner.decoded = callback; onStatus('Starting camera…'); }, hold: duration => { scanner.holdDuration = duration; }, stop: async () => { scanner.stops++; } }; scanners.push(scanner); return scanner; }, setTimeout: (fn, delay) => delay === 1000 ? refreshDelay(fn) : timers.push(fn) - 1, clearTimeout: id => { if (id !== undefined) timers[id] = () => {}; }, fetch: async (url, options) => { requests.push({url, options}); if (url.includes('capabilities(canEdit)') && permissionReady) await permissionReady; return { ok: responseStatus === 200, status: responseStatus, json: async () => url.includes('capabilities(canEdit)') ? { capabilities: { canEdit: editable } } : url.includes('fields=properties') ? { properties: {title: 'My library'}, sheets: [{properties: {title:'Books', gridProperties:{frozenRowCount:1}}}] } : { values: [headers] } }; }, console });
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { el, handlers, requests, scanners, timers, window, tickUpdateAge, navigatedTo: () => navigatedTo, cacheDeleted: () => deletedCache };
}
const sheetKey = 'annas-annals-sheet-id', sessionKey = 'annas-annals-google-session';
test('a new window restores a valid session without reconnecting', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const first = await openWindow(shared), second = await openWindow(shared);
  for (const view of [first, second]) { assert.equal(view.el('library').hidden, false); assert.equal(view.el('connect').hidden, true); assert.equal(view.requests.length, 3); assert.equal(view.el('add').hidden, false); }
});
test('a fast catalog refresh keeps its progress indicator visible for one second', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  let finishDelay;
  const view = await openWindow(shared, 200, false, true, { refreshDelay: fn => { finishDelay = fn; } });
  const status = view.el('status');

  assert.equal(status.textContent, 'Refreshing Catalog');
  assert.equal(status.classList.contains('is-refreshing'), true);
  assert.equal(typeof finishDelay, 'function');

  finishDelay();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(status.textContent, 'Updated just now');
  assert.equal(status.classList.contains('is-refreshing'), false);
});
test('only a standalone pull from the top refreshes the catalog', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const browser = await openWindow(shared, 200, true);
  assert.equal(browser.handlers['window:touchmove'], undefined);

  let spinnerDelays = 0;
  const app = await openWindow(shared, 200, true, true, {
    standalone: true,
    refreshDelay: done => { if (++spinnerDelays === 1) queueMicrotask(done); }
  });
  const spokes = app.el('pull-refresh-spokes').children;
  spokes.push(...Array.from({ length: 8 }, () => ({ style: { setProperty(name, value) { this[name] = value; } } })));
  const opacities = () => spokes.map(spoke => Number(spoke.style['--spoke-opacity']));
  const pull = (distance, across = 0, duringPull = () => {}, end = true) => {
    const touch = (x, y) => ({ identifier: 1, clientX: x, clientY: y });
    let prevented = false;
    const target = { closest: () => null };
    app.handlers['window:touchstart']({ target, touches: [touch(100, 160)] });
    app.handlers['window:touchmove']({ touches: [touch(100 + across, 160 + distance)], cancelable: true, preventDefault: () => { prevented = true; } });
    duringPull();
    if (end) app.handlers['window:touchend']({ changedTouches: [touch(100 + across, 160 + distance)] });
    return prevented;
  };

  const initialRequests = app.requests.length;
  app.window.scrollY = 30;
  assert.equal(pull(120), false);
  app.window.scrollY = 0;
  assert.equal(pull(15, 70), false);
  const page = app.el('app-page');
  const displacement = () => parseFloat(page.style['--pull-distance']);
  assert.equal(pull(25, 0, () => {
    assert.ok(displacement() > 0);
    assert.equal(page.classList.contains('is-pulling'), true);
  }), true);
  assert.equal(displacement(), 0);
  assert.equal(page.classList.contains('is-pulling'), false);
  assert.equal(app.el('pull-refresh').hidden, true);
  assert.equal(app.requests.length, initialRequests);
  assert.equal(pull(160, 0, () => {
    const values = opacities();
    assert.equal(values[0], 1);
    assert.equal(values.at(-1), 0);
    assert.ok(values.some(value => value > 0 && value < 1));
  }), true);
  assert.equal(app.requests.length, initialRequests);

  let draggedDistance, longerDistance;
  assert.equal(pull(800, 0, () => { longerDistance = displacement(); }, false), true);
  app.handlers['window:touchcancel']();
  assert.equal(pull(400, 0, () => {
    draggedDistance = displacement();
    assert.equal(app.el('pull-refresh').classList.contains('is-armed'), true);
    assert.equal(app.requests.length, initialRequests);
  }), true);
  assert.ok(longerDistance > draggedDistance);
  assert.ok(longerDistance - draggedDistance < draggedDistance);
  assert.deepEqual(opacities(), Array(8).fill(1));
  assert.equal(displacement(), 0);
  assert.equal(app.el('pull-refresh').hidden, false);
  assert.equal(app.el('status').textContent, 'Refreshing Catalog');
  assert.equal(pull(120), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spinnerDelays, 1);
  assert.equal(app.requests.length, initialRequests + 2);
  assert.equal(displacement(), 0);
  assert.equal(app.el('pull-refresh').hidden, true);
  assert.equal(app.el('pull-refresh').classList.contains('is-armed'), false);
  assert.equal(app.el('status').textContent, 'Updated just now');
});

test('the pull threshold requests a single haptic pulse per gesture', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const app = await openWindow(shared, 200, true, true, { standalone: true });
  const pulses = [];
  app.window.navigator.vibrate = duration => pulses.push(duration);
  const touch = clientY => ({ identifier: 1, clientX: 100, clientY });
  const start = () => app.handlers['window:touchstart']({ target: {}, touches: [touch(100)] });
  const move = clientY => app.handlers['window:touchmove']({
    touches: [touch(clientY)], cancelable: true, preventDefault() {}
  });

  start();
  move(260);
  assert.deepEqual(pulses, []);
  move(500);
  assert.deepEqual(pulses, [12]);
  move(600);
  move(260);
  move(500);
  assert.deepEqual(pulses, [12]);

  app.handlers['window:touchcancel']();
  start();
  move(500);
  assert.deepEqual(pulses, [12, 12]);
});

test('catalog update age advances and stays in the header across views', async () => {
  let now = Date.now();
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: now + 120000 }) });
  const view = await openWindow(shared, 200, true, true, { now: () => now });
  const status = view.el('status');
  assert.equal(status.textContent, 'Updated just now');

  now += 60000;
  view.tickUpdateAge();
  assert.equal(status.textContent, 'Updated 1 minute ago');
  view.handlers['mode-library:click']();
  view.handlers['settings-open:click']();
  assert.equal(view.el('library-meta').children.includes(status), false);
  assert.equal(view.el('settings-meta').children.includes(status), false);

  now += 60000;
  view.tickUpdateAge();
  assert.equal(status.textContent, 'Updated 2 minutes ago');
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

test('cover preferences default to fallback thumbnails and persist independently', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const first = await openWindow(shared);
  assert.equal(first.el('show-covers').checked, false);
  assert.equal(first.el('show-fallback-covers').checked, true);
  first.el('show-covers').checked = true;
  first.handlers['show-covers:change']();
  first.el('show-fallback-covers').checked = false;
  first.handlers['show-fallback-covers:change']();
  const second = await openWindow(shared);
  assert.equal(second.el('show-covers').checked, true);
  assert.equal(second.el('show-fallback-covers').checked, false);
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

