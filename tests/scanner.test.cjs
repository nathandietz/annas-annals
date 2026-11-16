const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture(behavior = {}) {
  const instances = [];
  const timers = new Map(); let nextTimer = 0;
  const formats = { QR_CODE: 0, EAN_13: 1, EAN_8: 2, UPC_A: 3, UPC_E: 4, CODE_128: 5, CODE_39: 6 };
  const context = vm.createContext({
    window: { isSecureContext: true }, navigator: { mediaDevices: { getUserMedia() {} } },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Html5QrcodeSupportedFormats: formats,
    Html5Qrcode: class {
      constructor(id, config) { this.config = config; this.calls = []; instances.push(this); }
      async start(camera, config, success) {
        this.calls.push({ camera, config }); this.success = success;
        if (behavior.start) await behavior.start(this);
        this.isScanning = true;
      }
      async stop() { assert(this.isScanning); this.isScanning = false; this.stopped = true; }
      pause(pauseVideo) { assert(this.isScanning); assert.equal(pauseVideo, false); this.paused = true; }
      resume() { assert(this.paused); this.paused = false; }
      clear() { assert(!this.isScanning); this.cleared = true; }
      async scanFile(file) {
        assert(!this.isScanning);
        if (behavior.photoFails) throw new Error('No barcode');
        return file.code;
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scanner.js'), 'utf8'), context);
  return { scanner: context.createLibraryScanner(), instances, context, formats, timers };
}

test('a retained camera is reused for the next scan and stops when its hold expires', async () => {
  const f = fixture(); const results = [];
  await f.scanner.start(value => results.push(value), () => {});
  f.instances[0].success('first');
  f.scanner.hold(30000);
  assert.equal(f.instances[0].isScanning, true);
  assert.equal(f.instances[0].paused, true);
  await f.scanner.start(value => results.push(value), () => {});
  assert.equal(f.instances.length, 1);
  assert.equal(f.instances[0].paused, false);
  assert.equal(f.timers.size, 0);
  f.instances[0].success('second');
  assert.deepEqual(results, ['first', 'second']);
  f.scanner.hold(30000);
  const timer = [...f.timers.values()][0];
  assert.equal(timer.delay, 30000);
  timer.fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.instances[0].isScanning, false);
  assert(f.instances[0].cleared);
});

test('stopping a retained camera cancels its expiry timer', async () => {
  const f = fixture();
  await f.scanner.start(() => {}, () => {});
  f.scanner.hold(30000);
  await f.scanner.stop();
  assert.equal(f.timers.size, 0);
  assert.equal(f.instances[0].isScanning, false);
});

test('live decoding examines full frame, includes ISBN format, and accepts only one result', async () => {
  const f = fixture();
  const results = [];
  await f.scanner.start(text => results.push(text), () => {});
  const camera = f.instances[0];
  assert(camera.config.formatsToSupport.includes(f.formats.EAN_13));
  assert.equal(camera.calls[0].config.qrbox, undefined);
  assert.equal(camera.calls[0].config.videoConstraints.width.ideal, 1280);
  camera.success('9780306406157'); camera.success('9780306406157');
  assert.deepEqual(results, ['9780306406157']);
  await f.scanner.stop();
  assert(camera.stopped && camera.cleared);
});

test('closing during camera startup releases camera and ignores late results', async () => {
  let finish;
  const f = fixture({ start: () => new Promise(resolve => { finish = resolve; }) });
  const results = [];
  const starting = f.scanner.start(text => results.push(text), () => {});
  await new Promise(resolve => setImmediate(resolve));
  const stopping = f.scanner.stop();
  finish();
  await Promise.all([starting, stopping]);
  f.instances[0].success('late');
  assert.deepEqual(results, []);
  assert(f.instances[0].stopped && f.instances[0].cleared);
});

test('photo decoding waits for startup and stops camera before reading file', async () => {
  let finish;
  const f = fixture({ start: () => new Promise(resolve => { finish = resolve; }) });
  const starting = f.scanner.start(() => {}, () => {});
  await new Promise(resolve => setImmediate(resolve));
  const photo = f.scanner.scanFile({ code: '9780306406157' });
  finish();
  await starting;
  assert.equal(await photo, '9780306406157');
  assert(f.instances[0].stopped && f.instances[0].cleared);
  await f.scanner.stop();
});

test('camera denial surfaces actionable error and does not retry permission', async () => {
  const f = fixture({ start: async () => { throw { name: 'NotAllowedError' }; } });
  await assert.rejects(f.scanner.start(() => {}, () => {}), /Allow camera access/);
  assert.equal(f.instances[0].calls.length, 1);
  assert(f.instances[0].cleared);
  assert.equal(await f.scanner.scanFile({ code: 'LIB-01001' }), 'LIB-01001');
});

test('desktop camera falls back when environment camera constraint is unsupported', async () => {
  const f = fixture({ start: async instance => {
    if (instance.calls.length === 1) throw { name: 'OverconstrainedError' };
  } });
  await f.scanner.start(() => {}, () => {});
  assert.equal(f.instances[0].calls[1].camera.facingMode, 'user');
  await f.scanner.stop();
});

test('failed photo decoding can be followed by a fresh live scan', async () => {
  const f = fixture({ photoFails: true });
  await assert.rejects(f.scanner.scanFile({}), /No barcode/);
  await f.scanner.start(() => {}, () => {});
  assert(f.instances[0].cleared);
  assert(f.instances[1].isScanning);
  await f.scanner.stop();
});

test('insecure pages show HTTPS guidance', async () => {
  const f = fixture();
  f.context.window.isSecureContext = false;
  await assert.rejects(f.scanner.start(() => {}, () => {}), /HTTPS/);
  assert.equal(f.instances.length, 0);
});

test('canvas preview crops a portrait camera frame to fill the wide view and stops cleanly', () => {
  const f = fixture(); const draws = []; const frames = new Map(); let frameId = 0;
  const video = { videoWidth: 720, videoHeight: 1280, readyState: 2 };
  const preview = { clientWidth: 320, clientHeight: 200, classList: { add() {}, remove() {} }, append() {} };
  const canvas = { className: '', width: 0, height: 0, getContext: () => ({ drawImage: (...args) => draws.push(args) }), remove() {} };
  f.context.document = { getElementById: () => ({ parentElement: preview, querySelector: () => video }), createElement: () => canvas };
  f.context.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
  f.context.cancelAnimationFrame = id => frames.delete(id);
  const renderer = f.context.createCameraPreview('check-qr-reader');
  renderer.start();
  const callback = frames.get(1); frames.delete(1); callback();
  assert.equal(draws.length, 1);
  assert.deepEqual(draws[0].slice(1), [0, 415, 720, 450, 0, 0, 720, 450]);
  renderer.stop();
  assert.equal(frames.size, 0);
});
