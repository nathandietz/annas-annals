const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const headers = ['id','isbn','title','author','language','notes','created_at','publisher','publication_year','shelf_location','category','description','series_name','volume_number','pages','updated_at'];
function storage(initial = {}) { const data = new Map(Object.entries(initial)); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k) }; }
async function openWindow(shared, responseStatus = 200) {
  const elements = {}, handlers = {}, requests = [];
  const el = id => elements[id] ||= { hidden: false, value: '', textContent: '', children: [], classList: { toggle() {} }, addEventListener(type, fn) { handlers[id + ':' + type] = fn; }, setAttribute() {}, removeAttribute() {}, append(child) { this.children.push(child); }, replaceChildren() { this.children = []; } };
  const window = { LIBRARY_CONFIG: {}, addEventListener: (type, fn) => { handlers['window:' + type] = fn; } };
  const context = vm.createContext({ document: { getElementById: el, createElement: () => ({ textContent: '', setAttribute() {}, addEventListener() {}, append() {} }) }, window, localStorage: shared, sessionStorage: storage(), findDuplicateGroups: () => [], createLibraryScanner: () => ({}), fetch: async (url, options) => { requests.push({url, options}); return { ok: responseStatus === 200, status: responseStatus, json: async () => url.includes('fields=properties') ? { properties: {title: 'My library'}, sheets: [{properties: {title:'Books', gridProperties:{frozenRowCount:1}}}] } : { values: [headers] } }; }, console });
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { el, handlers, requests };
}
const sheetKey = 'annas-annals-sheet-id', sessionKey = 'annas-annals-google-session';
test('a new window restores a valid session without reconnecting', async () => {
  const shared = storage({ [sheetKey]: 'sheet', [sessionKey]: JSON.stringify({ token: 'token', expiresAt: Date.now() + 120000 }) });
  const first = await openWindow(shared), second = await openWindow(shared);
  for (const view of [first, second]) { assert.equal(view.el('library').hidden, false); assert.equal(view.el('connect').hidden, true); assert.equal(view.requests.length, 2); }
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
