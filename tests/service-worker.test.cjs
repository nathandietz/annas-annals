const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('cover images are reused offline and clearing the cache removes them', async () => {
  const events = {}, entries = new Map(); let online = true, requests = 0;
  const cache = { match: async req => entries.get(req.url), put: async (req, res) => entries.set(req.url, res), keys: async () => [...entries.keys()].map(url => ({url})), delete: async req => entries.delete(req.url) };
  const caches = { open: async () => cache, delete: async () => { entries.clear(); return true; } };
  const self = { addEventListener: (type, fn) => { events[type] = fn; }, skipWaiting() {}, clients: { claim() {} } };
  vm.runInNewContext(fs.readFileSync('service-worker.js', 'utf8'), { self, caches, URL, fetch: async (_request, options) => { requests++; if (!online) throw new Error('offline'); assert.equal(options?.mode, 'cors'); return { ok:true, type:'cors', clone() { return this; } }; }, Promise, console });
  const request = { url:'https://covers.openlibrary.org/b/isbn/9780140328721-S.jpg?default=false', method:'GET', destination:'image' };
  async function get() { let response; const waits = []; events.fetch({request, respondWith(p) { response = p; }, waitUntil(p) { waits.push(p); }}); const result = await response; await Promise.all(waits); return result; }
  assert.ok(await get()); online = false; assert.ok(await get()); assert.equal(requests, 1);
  let done; events.message({data:{type:'CLEAR_COVER_CACHE'}, ports:[{postMessage(value) { done = value; }}], waitUntil(p) { this.work = p; }});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(done.ok, true); assert.equal(entries.size, 0);
  await assert.rejects(get(), /offline/);
});

test('service worker leaves unrelated requests to the browser', () => {
  const events = {}, self = { addEventListener: (type, fn) => { events[type] = fn; } };
  vm.runInNewContext(fs.readFileSync('service-worker.js', 'utf8'), {self, URL});
  let handled = false; events.fetch({request:{url:'https://sheets.googleapis.com/v4/spreadsheets/abc', method:'GET', destination:''}, respondWith() { handled = true; }});
  assert.equal(handled, false);
});

test('clearing during an in-flight cover request does not put the image back', async () => {
  const events = {}, entries = new Map(); let finishFetch;
  const cache = { match: async req => entries.get(req.url), put: async (req, res) => entries.set(req.url, res), keys: async () => [], delete: async () => {} };
  const self = { addEventListener: (type, fn) => { events[type] = fn; } };
  const caches = { open: async () => cache, delete: async () => { entries.clear(); } };
  vm.runInNewContext(fs.readFileSync('service-worker.js', 'utf8'), { self, caches, URL, Promise, fetch: () => new Promise(resolve => { finishFetch = resolve; }) });
  let response, clearWork;
  events.fetch({ request:{url:'https://covers.openlibrary.org/b/isbn/9780140328721-S.jpg',method:'GET',destination:'image'}, respondWith(p) { response = p; } });
  await new Promise(resolve => setImmediate(resolve));
  events.message({data:{type:'CLEAR_COVER_CACHE'}, ports:[], waitUntil(p) { clearWork = p; }});
  finishFetch({ok:true, type:'basic', clone() { return this; }});
  await Promise.all([response, clearWork]);
  assert.equal(entries.size, 0);
});
