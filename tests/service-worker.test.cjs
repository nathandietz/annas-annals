const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('the service worker clears the legacy cover cache on request', async () => {
  const events = {};
  const self = { addEventListener: (type, handler) => { events[type] = handler; } };
  const storedCaches = new Set(['annas-annals-covers-v1', 'unrelated-cache']);
  const caches = { delete: async name => storedCaches.delete(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../service-worker.js'), 'utf8'), { self, caches });

  let clearWork, result;
  events.message({
    data: { type: 'CLEAR_COVER_CACHE' },
    ports: [{ postMessage: value => { result = value; } }],
    waitUntil: work => { clearWork = work; }
  });
  await clearWork;
  assert.equal(result.ok, true);
  assert.deepEqual([...storedCaches], ['unrelated-cache']);
});
