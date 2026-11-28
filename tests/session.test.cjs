const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { installTemplates } = require('./helpers/templates.cjs');
const headers = ['id','isbn','title','author','language','notes','created_at','publisher','publication_year','shelf_location','category','description','series_name','volume_number','pages','updated_at'];
function storage(initial = {}) { const data = new Map(Object.entries(initial)); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k) }; }
async function openWindow(shared, responseStatus = 200, mobile = false, editable = true, { tabStorage = storage(), permissionReady, now = Date.now, refreshDelay = queueMicrotask, standalone = false, google, gapi, bookRows = [], invalidSheet } = {}) {
  const elements = {}, handlers = {}, requests = [], scanners = [], timers = [];
  const document = { getElementById: id => el(id), createElement: () => ({ textContent: '', setAttribute() {}, addEventListener() {}, append() {} }), addEventListener: (type, fn) => { handlers['document:' + type] = fn; } };
  const el = id => elements[id] ||= { hidden: false, value: '', textContent: '', children: [], classList: { values: new Set(), toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); }, remove(name) { this.values.delete(name); }, add(name) { this.values.add(name); }, contains(name) { return this.values.has(name); } }, addEventListener(type, fn) { handlers[id + ':' + type] = fn; }, style: { setProperty(name, value) { this[name] = value; } }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute() {}, append(...children) { for (const child of children) child.parent = this; this.children.push(...children); }, replaceChildren(...children) { this.children = []; this.append(...children); } };
  installTemplates(el);
  let navigatedTo;
  const window = { LIBRARY_CONFIG: {}, innerHeight: 874, location: { href:'https://example.com/annals/?view=library', replace: value => { navigatedTo = value; } }, navigator: {}, matchMedia: query => ({ matches: query === '(display-mode: standalone)' ? standalone : mobile }), addEventListener: (type, fn) => { handlers['window:' + type] = fn; } };
  const context = vm.createContext({ URL, Date: class extends Date { static now() { return now(); } }, document, window, localStorage: shared, sessionStorage: tabStorage, findDuplicateGroups: () => [], normalizeIsbn: require('../assets/js/isbn.js').normalizeIsbn, matchBook: () => ({kind:'exact', books:[]}), createLibraryScanner: () => { const scanner = { stops: 0, start: async (callback, onStatus) => { scanner.decoded = callback; onStatus?.('Starting camera…'); onStatus?.('Keep the entire barcode in view, including blank space at both ends. Hold steady in good light.'); }, hold: duration => { scanner.holdDuration = duration; }, stop: async () => { scanner.stops++; } }; scanners.push(scanner); return scanner; }, setTimeout: (fn, delay) => delay === 1000 ? refreshDelay(fn) : timers.push(Object.assign(fn, { delay })) - 1, clearTimeout: id => { if (id !== undefined) timers[id] = () => {}; }, fetch: async (url, options) => { requests.push({url, options}); if (url.includes('capabilities(canEdit)') && permissionReady) await permissionReady; const status = typeof responseStatus === 'function' ? responseStatus(url, options) : responseStatus; return { ok: status === 200, status, json: async () => url.includes('capabilities(canEdit)') ? { capabilities: { canEdit: editable } } : url.includes('fields=properties') ? { properties: {title: 'My library'}, sheets: [{properties: {title:'Books', gridProperties:{frozenRowCount:1}}}] } : { values: invalidSheet && url.includes('/spreadsheets/' + invalidSheet + '/') ? [['Title']] : [headers, ...bookRows] } }; }, console });
  if (google) {
    Object.assign(window, { google, gapi, LIBRARY_CONFIG: { clientId: 'client', apiKey: 'key', appId: 'app' } });
    Object.assign(context, { google, gapi });
  }
  for (const script of ['book-lookup.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js', script), 'utf8'), context);
  }
  await new Promise(resolve => setImmediate(resolve));
  return { el, handlers, requests, scanners, timers, window, document, navigatedTo: () => navigatedTo };
}
const sheetKey = 'annas-annals-sheet-id', sessionKey = 'annas-annals-google-session';
test('a new window restores a valid session without reconnecting', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const first = await openWindow(shared), second = await openWindow(shared);
  for (const view of [first, second]) { assert.equal(view.el('library').hidden, false); assert.equal(view.el('connect').hidden, true); assert.equal(view.requests.length, 3); assert.equal(view.el('add').hidden, false); }
});
function googlePickerFixture() {
  let authorize, pickSheet;
  const google = {
    accounts: { oauth2: { initTokenClient: ({ callback }) => ({ requestAccessToken() { authorize = callback; } }) } },
    picker: {
      ViewId: { SPREADSHEETS: 'spreadsheets' }, Action: { PICKED: 'picked' },
      DocsView: class { setOwnedByMe() { return this; } },
      PickerBuilder: class {
        addView() { return this; }
        setOAuthToken() { return this; }
        setDeveloperKey() { return this; }
        setAppId() { return this; }
        setCallback(callback) { pickSheet = callback; return this; }
        build() { return { setVisible() {} }; }
      }
    }
  };
  const gapi = { load: (_name, { callback }) => callback() };
  return { google, gapi, authorize: response => authorize(response), pickSheet: result => pickSheet(result) };
}
test('a first connection and reconnect open the selected Sheet without an indicator delay', async () => {
  const { google, gapi, authorize, pickSheet } = googlePickerFixture();
  for (const remembered of [false, true]) {
    const shared = storage(remembered ? { [sheetKey]: 'sheet' } : {});
    const view = await openWindow(shared, 200, false, true, { google, gapi, refreshDelay() {} });
    if (remembered) {
      view.handlers['mode-scan:click']();
      view.handlers['scan-start:click']();
    } else {
      view.handlers['signin:click']();
    }
    const connection = authorize({ access_token: 'token', expires_in: 120 });
    if (!remembered) pickSheet({ action: 'picked', docs: [{ id: 'sheet' }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(view.el('connect').hidden, true, remembered ? 'reconnect' : 'first connection');
    assert.match(view.el('status').textContent, /^Updated at \d{1,2}:\d{2} [ap]m$/);
    if (remembered) {
      assert.equal(view.el('scan-view').hidden, false);
      assert.equal(view.el('scan-start').textContent, 'Scan Book');
      assert.equal(view.el('disconnect').disabled, false);
    }
    await connection;
  }
});
test('Settings switches to a different library only after its Sheet can be loaded', async () => {
  const initialSession = JSON.stringify({ token: 'original-token', expiresAt: Date.now() + 120000 });
  const shared = storage({ [sheetKey]: 'original', [sessionKey]: initialSession });
  const tabStorage = storage();
  const { google, gapi, authorize, pickSheet } = googlePickerFixture();
  const view = await openWindow(shared, 200, false, true, { google, gapi, tabStorage, invalidSheet: 'incompatible' });
  view.handlers['settings-open:click']();
  assert.equal(view.el('choose-sheet').hidden, false);
  const originalSnapshot = tabStorage.getItem('annas-annals-catalog-snapshot');
  const beginChoice = async () => {
    view.handlers['choose-sheet:click']();
    await authorize({ access_token: 'new-token', expires_in: 120 });
    assert.equal(shared.getItem(sessionKey), initialSession);
    assert.equal(tabStorage.getItem('annas-annals-catalog-snapshot'), originalSnapshot);
  };

  await beginChoice();
  await pickSheet({ action: 'cancel' });
  assert.equal(shared.getItem(sheetKey), 'original');
  await beginChoice();
  await pickSheet({ action: 'picked', docs: [{ id: 'incompatible' }] });
  assert.equal(shared.getItem(sheetKey), 'original');
  assert.equal(shared.getItem(sessionKey), initialSession);
  assert.match(view.el('library-link').href, /spreadsheets\/d\/original\/edit$/);
  assert.equal(view.el('disconnect').disabled, false);

  await beginChoice();
  await pickSheet({ action: 'picked', docs: [{ id: 'replacement' }] });
  assert.equal(shared.getItem(sheetKey), 'replacement');
  assert.equal(JSON.parse(shared.getItem(sessionKey)).token, 'new-token');
  assert.equal(JSON.parse(tabStorage.getItem('annas-annals-catalog-snapshot')).sheetId, 'replacement');
  assert.match(view.el('library-link').href, /spreadsheets\/d\/replacement\/edit$/);
  assert.equal(view.el('settings-dialog').hidden, false);
  assert.ok(view.requests.some(({ url, options }) => url.includes('/spreadsheets/replacement/values/') && options.headers.Authorization === 'Bearer new-token'));
});

test('restoring a session without a cached catalog opens the Sheet without an indicator delay', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, 200, false, true, { refreshDelay() {} });
  assert.equal(view.el('connect').hidden, true);
  assert.match(view.el('status').textContent, /^Updated at \d{1,2}:\d{2} [ap]m$/);
});
test('a fast refresh of a cached catalog keeps its progress indicator visible for one second', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const tabStorage = storage();
  await openWindow(shared, 200, false, true, { tabStorage });
  let finishDelay;
  const view = await openWindow(shared, 200, false, true, { tabStorage, refreshDelay: fn => { finishDelay = fn; } });
  const status = view.el('status');

  assert.equal(status.textContent, 'Refreshing');
  assert.equal(status.classList.contains('is-refreshing'), true);
  assert.equal(typeof finishDelay, 'function');

  finishDelay();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(status.textContent, /^Updated at \d{1,2}:\d{2} [ap]m$/);
  assert.equal(status.classList.contains('is-refreshing'), false);
});
test('only a standalone pull from the top refreshes the catalog', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const browser = await openWindow(shared, 200, true);
  assert.equal(browser.handlers['window:touchmove'], undefined);

  let finishHeader, finishPullExit;
  const app = await openWindow(shared, 200, true, true, {
    standalone: true,
    refreshDelay: done => { finishHeader = done; }
  });
  const indicator = app.el('pull-refresh');
  const pullExit = new Promise(resolve => { finishPullExit = resolve; });
  indicator.getAnimations = () => [{ finished: pullExit }];
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
  assert.equal(app.el('status').textContent, 'Refreshing');
  assert.equal(pull(120), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requests.length, initialRequests + 2);
  assert.equal(displacement(), 0);
  assert.equal(indicator.hidden, false);
  assert.equal(app.el('status').textContent, 'Refreshing');
  assert.equal(typeof finishHeader, 'function');

  finishPullExit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(indicator.hidden, true);
  assert.equal(indicator.classList.contains('is-armed'), false);
  assert.equal(app.el('status').textContent, 'Refreshing');
  assert.equal(app.el('status').classList.contains('is-refreshing'), true);
  assert.equal(pull(120), true);
  assert.equal(app.requests.length, initialRequests + 2);

  finishHeader();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.el('status').textContent, /^Updated at \d{1,2}:\d{2} [ap]m$/);
  assert.equal(app.el('status').classList.contains('is-refreshing'), false);
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

test('the header shows the whole library count and the local time of the last update', async () => {
  let now = new Date(2026, 10, 27, 11, 53).getTime();
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: now + 120000 }) });
  const bookRows = [['1', '', 'First book'], ['2', '', 'Second book']];
  const view = await openWindow(shared, 200, true, true, { now: () => now, bookRows });
  const count = view.el('library-count'), status = view.el('status');
  assert.equal(count.hidden, false);
  assert.equal(count.textContent, '2 Books');
  assert.equal(status.textContent, 'Updated at 11:53 am');

  now += 60000;
  view.handlers['mode-library:click']();
  view.el('search').value = 'First book';
  view.handlers['search:input']();
  assert.equal(view.el('books').children.length, 1);
  assert.equal(count.textContent, '2 Books');
  view.handlers['settings-open:click']();
  assert.equal(status.textContent, 'Updated at 11:53 am');

  view.handlers['disconnect:click']();
  assert.equal(view.el('library-count').hidden, true);
  assert.equal(view.el('header-meta').hidden, true);
  assert.equal(view.el('status').textContent, '');
  assert.equal(view.el('library-link').textContent, 'No Connected Library');
  assert.equal(view.el('add').hidden, false);
  assert.equal(view.el('add').disabled, true);
  assert.equal(view.el('library-sort').disabled, true);
});

test('connection feedback appears beside the connect controls', async () => {
  const view = await openWindow(storage());
  assert.equal(view.el('status').textContent, '');
  view.handlers['signin:click']();
  assert.equal(view.el('status').textContent, '');
  assert.match(view.el('connect-status').textContent, /^Setup needed:/);
});

test('desktop reload keeps editor controls in place while access is verified once', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const tabStorage = storage();
  const first = await openWindow(shared, 200, false, true, { tabStorage });
  first.handlers['settings-open:click']();

  let finishPermission;
  const permissionReady = new Promise(resolve => { finishPermission = resolve; });
  const view = await openWindow(shared, 200, false, true, { tabStorage, permissionReady });
  assert.equal(view.el('settings-dialog').hidden, false);
  assert.equal(view.el('add').hidden, false);
  assert.equal(view.el('add').disabled, true);
  for (const id of ['import-open', 'upgrade-library']) {
    assert.equal(view.el(id).hidden, false, id);
    assert.equal(view.el(id).disabled, true, id);
  }
  assert.equal(view.requests.filter(request => request.url.includes('capabilities(canEdit)')).length, 1);

  finishPermission();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.el('add').hidden, false);
  assert.equal(view.el('add').disabled, false);
  for (const id of ['import-open', 'upgrade-library']) {
    assert.equal(view.el(id).hidden, false, id);
    assert.equal(view.el(id).disabled, false, id);
  }
});

test('an expired session is cleared and requires reconnection', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'expired', expiresAt: Date.now() - 1000 }) });
  const view = await openWindow(shared);
  assert.equal(view.requests.length, 0); assert.equal(shared.getItem(sessionKey), null); assert.equal(view.el('connect').hidden, false);
  assert.equal(view.el('library').hidden, false);
  assert.equal(view.el('search').disabled, true);
  assert.equal(view.el('signin').textContent, 'Reconnect to Google Sheet');
  assert.match(view.el('connect-status').textContent, /expired/i);
  view.handlers['settings-open:click']();
  assert.equal(view.el('choose-sheet').hidden, false);
});
test('token expiry returns to Library and closes the open editor', async () => {
  let now = 1000000;
  const expiresAt = now + 120000;
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt }) });
  const tabStorage = storage();
  const { google, gapi, authorize } = googlePickerFixture();
  const view = await openWindow(shared, 200, true, true, { now: () => now, tabStorage, google, gapi });
  const editor = view.el('editor');
  editor.open = true;
  editor.close = () => { editor.open = false; view.handlers['editor:close'](); };

  const expiry = view.timers.find(timer => timer.delay === 120000);
  assert.equal(typeof expiry, 'function');
  now = expiresAt;
  expiry();
  assert.equal(editor.open, false);
  assert.equal(view.el('scan-view').hidden, true);
  assert.equal(view.el('library').hidden, false);
  assert.equal(view.el('connect').hidden, false);
  assert.equal(view.el('header-meta').hidden, true);
  assert.equal(view.el('signin').textContent, 'Reconnect to Google Sheet');
  assert.match(view.el('connect-status').textContent, /expired/i);
  assert.equal(shared.getItem(sheetKey), 'sheet');
  assert.equal(shared.getItem(sessionKey), null);
  assert.equal(tabStorage.getItem('annas-annals-catalog-snapshot'), null);

  view.handlers['signin:click']();
  await authorize({ access_token: 'new-token', expires_in: 120 });
  assert.equal(view.el('connect').hidden, true);
  assert.equal(view.el('connect-status').hidden, true);
  assert.match(view.el('library-link').href, /spreadsheets\/d\/sheet\/edit$/);
});

test('returning to the app checks expiry even if the timer has not run', async () => {
  let now = 1000000;
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: now + 120000 }) });
  const view = await openWindow(shared, 200, true, true, { now: () => now });
  view.handlers['settings-open:click']();
  now += 120001;
  view.handlers['document:visibilitychange']();
  assert.equal(view.el('settings-dialog').hidden, true);
  assert.equal(view.el('connect').hidden, false);
});

test('a Google authorization rejection returns to reconnect during a pull refresh', async () => {
  let responseStatus = 200;
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, () => responseStatus, true, true, { standalone: true, refreshDelay() {} });
  view.handlers['settings-open:click']();
  responseStatus = 401;
  const touch = clientY => ({ identifier: 1, clientX: 100, clientY });
  view.handlers['window:touchstart']({ target: {}, touches: [touch(100)] });
  view.handlers['window:touchmove']({ touches: [touch(500)], cancelable: true, preventDefault() {} });
  await view.handlers['window:touchend']({ changedTouches: [touch(500)] });
  assert.equal(view.el('settings-dialog').hidden, true);
  assert.equal(view.el('connect').hidden, false);
  assert.equal(view.el('status').textContent, '');
  assert.equal(shared.getItem(sheetKey), 'sheet');
});

test('a Google authorization rejection while checking Drive permissions returns to reconnect', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, url => url.includes('capabilities(canEdit)') ? 401 : 200);
  assert.equal(view.el('connect').hidden, false);
  assert.match(view.el('connect-status').textContent, /expired/i);
  assert.equal(shared.getItem(sheetKey), 'sheet');
});

test('expiry in another window preserves the remembered Sheet', async () => {
  const session = JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 });
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: session });
  const view = await openWindow(shared);
  shared.removeItem(sessionKey);
  view.handlers['window:storage']({ key: sessionKey, oldValue: session, newValue: null });
  assert.equal(view.el('connect').hidden, false);
  assert.equal(view.el('signin').textContent, 'Reconnect to Google Sheet');
  assert.equal(shared.getItem(sheetKey), 'sheet');
});

test('disconnect in another window clears the current window', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared);
  const oldValue = shared.getItem(sessionKey);
  shared.removeItem(sheetKey);
  shared.removeItem(sessionKey);
  view.handlers['window:storage']({ key: sessionKey, oldValue, newValue: null });
  assert.equal(view.el('library').hidden, false);
  assert.equal(view.el('connect').hidden, false);
  assert.equal(view.el('mode-toggle').hidden, false);
  assert.equal(view.el('search').disabled, true);
  assert.equal(shared.getItem(sheetKey), null);
});

test('disconnected navigation defaults to Library with a disabled search', async () => {
  const shared = storage({ 'annas-annals-main-view': 'scan' });
  const view = await openWindow(shared, 200, true);
  assert.equal(view.el('mode-toggle').hidden, false);
  assert.equal(view.el('mode-library').attributes['aria-pressed'], 'true');
  assert.equal(view.el('library').hidden, false);
  assert.equal(view.el('connect').hidden, false);
  assert.equal(view.el('search').disabled, true);
  assert.equal(view.el('add').hidden, false);
  assert.equal(view.el('add').disabled, true);
  assert.equal(view.el('library-sort').disabled, true);
  assert.equal(view.el('catalog-content').hidden, true);

  view.handlers['mode-scan:click']();
  assert.equal(view.el('scan-view').hidden, false);
  assert.equal(view.el('check-home').hidden, false);
  assert.equal(view.el('scan-controls').hidden, false);
  assert.equal(view.el('check-add').hidden, false);
  for (const id of ['scan-search', 'check-add', 'check-isbn-open', 'check-photo-open']) {
    assert.equal(view.el(id).disabled, true, id);
  }
  assert.equal(Boolean(view.el('scan-start').disabled), false);
  assert.equal(view.el('scan-start').textContent, 'Connect to a Library to Scan a Book');
  assert.equal(view.el('scan-start').classList.contains('connect-button'), true);
  view.handlers['scan-start:click']();
  assert.match(view.el('check-status').textContent, /^Setup needed:/);
  assert.equal(view.el('check-camera').hidden, true);

  let defaultPrevented = false;
  view.handlers['library-link:click']({ preventDefault() { defaultPrevented = true; } });
  assert.equal(defaultPrevented, true);
  assert.equal(view.el('library').hidden, false);
  assert.equal(view.el('scan-view').hidden, true);
  assert.match(view.el('connect-status').textContent, /^Setup needed:/);

  view.handlers['settings-open:click']();
  assert.equal(view.el('settings-dialog').hidden, false);
  assert.equal(view.el('settings-library-tools').hidden, false);
  assert.equal(view.el('settings-library-connection').hidden, false);
  for (const id of ['duplicates-toggle', 'upgrade-library', 'import-open', 'export-csv', 'disconnect']) {
    assert.equal(view.el(id).hidden, false, id);
    assert.equal(view.el(id).disabled, true, id);
  }
  assert.equal(view.el('signin').textContent, 'Connect Google Sheet');
  assert.equal(view.el('choose-sheet').hidden, true);
  assert.equal(Boolean(view.el('new-library').disabled), false);
  assert.equal(Boolean(view.el('update-app').disabled), false);
  assert.equal(view.requests.length, 0);
});

test('mobile opens scan view and viewers cannot add books', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, 200, true, false);
  assert.equal(view.el('scan-view').hidden, false);
  assert.equal(view.el('library').hidden, true);
  assert.equal(view.el('add').hidden, true);
  assert.equal(view.el('check-add').hidden, true);
  assert.equal(view.el('import-open').hidden, true);
  assert.equal(view.el('import-open').disabled, true);
  assert.equal(view.el('scan-search').disabled, false);
  assert.equal(view.el('library-sort').disabled, false);
  assert.equal(Boolean(view.el('scan-start').disabled), false);
  assert.equal(view.el('scan-start').textContent, 'Scan Book');
  assert.equal(view.el('scan-start').classList.contains('connect-button'), false);
  assert.equal(view.el('check-isbn-open').disabled, false);
  assert.equal(view.el('check-photo-open').disabled, false);
  assert.match(view.el('library-link').href, /^https:\/\/docs\.google\.com\/spreadsheets\//);
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

test('fallback thumbnails default to visible and the setting persists', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const first = await openWindow(shared);
  assert.equal(first.el('show-fallback-covers').checked, true);
  first.el('show-fallback-covers').checked = false;
  first.handlers['show-fallback-covers:change']();
  const second = await openWindow(shared);
  assert.equal(second.el('show-fallback-covers').checked, false);
});

test('settings is a view and switching back restores the library', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared);
  view.handlers['settings-open:click']();
  assert.equal(view.el('settings-dialog').hidden, false);
  assert.equal(view.el('connect').hidden, true);
  assert.equal(view.el('choose-sheet').hidden, false);
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
  assert.equal(view.el('connect').hidden, false);
  view.handlers['settings-open:click']();
  await view.handlers['update-app:click']();
  assert.ok(new URL(view.navigatedTo()).searchParams.has('_update'));
  assert.equal(view.el('update-app-status').textContent, 'Reloading app…');
  assert.equal(view.requests.length, 0);
});

test('the scan button opens and closes the camera in the same control', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, 200, true);
  view.el('check-camera').hidden = true;
  const tips = view.el('check-guidance');
  assert.match(tips.textContent, /Keep the entire barcode in view/);
  await view.handlers['scan-start:click']();
  assert.equal(view.el('check-camera').hidden, false);
  assert.equal(view.el('scan-start').attributes['aria-expanded'], 'true');
  assert.equal(view.el('scan-start').textContent, 'Close scanner');
  assert.equal(view.el('check-status').textContent, '');
  assert.match(tips.textContent, /Keep the entire barcode in view/);
  await view.handlers['scan-start:click']();
  assert.equal(view.el('check-camera').hidden, true);
  assert.equal(view.el('scan-start').attributes['aria-expanded'], 'false');
  assert.equal(view.el('scan-start').textContent, 'Scan Book');
  assert.match(tips.textContent, /Keep the entire barcode in view/);
});

test('typing in Check closes the camera and reveals search results', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, 200, true);
  await view.handlers['scan-start:click']();
  view.el('scan-search').value = 'Water';
  view.handlers['scan-search:input']();
  assert.equal(view.el('check-camera').hidden, true);
  assert.equal(view.el('scan-start').textContent, 'Scan Book');
  assert.equal(view.el('scan-books').hidden, false);
  assert.equal(view.scanners[1].stops, 1);
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
  view.timers.at(-1)();
  await done;
  assert.equal(view.el('check-result').hidden, true);
});

test('a successful scan holds the camera briefly and leaving scan releases it', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const view = await openWindow(shared, 200, true);
  view.el('check-camera').hidden = true;
  await view.handlers['scan-start:click']();
  const done = view.scanners[1].decoded('9780306406157');
  view.timers.at(-1)();
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

