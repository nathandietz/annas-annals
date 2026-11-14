const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'backend/Code.gs'), 'utf8');
const response = (data, code = 200) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(data) });
function backend(fetch, properties = { GEMINI_API_KEY: 'test-key' }) {
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => properties[name] || null }) },
    UrlFetchApp: { fetch }, Logger: { log() {} }
  });
  vm.runInContext(source, context);
  return context;
}
const photo = [{ base64: 'data:image/jpeg;base64,aGVsbG8=' }];

test('Gemini defaults to the replacement model and omits unsupported sampling parameters', () => {
  const b = backend((url, options) => {
    assert.match(url, /models\/gemini-3\.8-flash:generateContent$/);
    assert(!url.includes('test-key'));
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    const payload = JSON.parse(options.payload);
    assert.equal(payload.generationConfig.temperature, undefined);
    assert.equal(payload.contents[0].parts[1].inlineData.data, 'aGVsbG8=');
    return response({ candidates: [{ content: { parts: [{ text: '{"title_english":"Photo title"}' }] } }] });
  });
  assert.equal(b.extractWithGeminiVision_(photo).title_english, 'Photo title');
});

test('model can be overridden without editing the backend', () => {
  const b = backend(url => {
    assert.match(url, /models\/gemini-custom-flash:generateContent$/);
    return response({ candidates: [{ content: { parts: [{ text: '{}' }] } }] });
  }, { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'models/gemini-custom-flash' });
  b.extractWithGeminiVision_(photo);
});

test('ISBN results survive an optional Gemini failure with a warning', () => {
  const b = backend(url => {
    if (url.includes('books/v1')) return response({ items: [{ volumeInfo: { title: 'Known title' } }] });
    if (url.includes('openlibrary.org')) return response({});
    return response({ error: { message: 'Model unavailable' } }, 404);
  });
  const result = b.analyzeBookPipeline_({ isbn: '9780306406157', images: photo, forceAiOcr: true });
  assert.equal(result.status, 'ok');
  assert.equal(result.book.Title_English, 'Known title');
  assert.match(result.warnings[0], /photo recognition failed/);
  assert.match(result.book.Cover_Image_URL, /9780306406157-L.jpg\?default=false$/);
});

test('Open Library still fills metadata if Google Books throws a network error', () => {
  const b = backend(url => {
    if (url.includes('books/v1')) throw new Error('Network failure');
    return response({ 'ISBN:9780306406157': { title: 'Fallback title', publish_date: 'May 2019', authors: [{ name: 'Author' }] } });
  });
  const result = b.fetchFromPublicBookAPIs_('9780306406157', '', '');
  assert.equal(result.Title_English, 'Fallback title');
  assert.equal(result.Publish_Year, '2019');
  assert.equal(result.Authors, 'Author');
  assert.match(result.Cover_Image_URL, /covers.openlibrary.org/);
});

test('lookup without results explains the failure instead of returning blank autofill fields', () => {
  const b = backend(() => response({}));
  assert.throws(() => b.analyzeBookPipeline_({ isbn: '9780306406157' }), /No book details found/);
});

test('Gemini empty and blocked responses produce a readable error', () => {
  const b = backend(() => response({ promptFeedback: { blockReason: 'SAFETY' } }));
  assert.throws(() => b.extractWithGeminiVision_(photo), /returned no book details/);
});

function frontend(fetch = async () => ({ json: async () => ({ status: 'ok', book: {} }) })) {
  const context = vm.createContext({
    navigator: {}, localStorage: { getItem: () => '' }, sessionStorage: { getItem: () => '' },
    createLibraryScanner: () => ({}), fetch, alert: text => context.alerts.push(text)
  });
  context.alerts = [];
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('function flatLibraryApp()'));
  vm.runInContext(inline, context);
  return { app: context.flatLibraryApp(), alerts: context.alerts };
}

test('existing books without artwork use their ISBN; broken saved images fall back once', () => {
  const { app } = frontend();
  const book = { ISBN: '978-0-306-40615-7' };
  const url = app.bookCoverUrl(book);
  assert.match(url, /9780306406157-L.jpg\?default=false$/);
  assert.equal(app.bookCoverUrl({ ISBN: 'invalid' }), '');
  const image = { src: 'https://broken.example/cover.jpg', dataset: {}, style: {} };
  app.handleBookCoverError({ target: image }, book);
  assert.equal(image.src, url);
  app.handleBookCoverError({ target: image }, book);
  assert.equal(image.style.display, 'none');
});

test('auto-fill preserves entered fields, sends publisher photos, and displays partial-result warning', async () => {
  const { app, alerts } = frontend(async (url, options) => {
    const data = JSON.parse(options.body).data;
    assert.equal(data.images.length, 1);
    return { json: async () => ({ status: 'ok', book: { Title_English: 'Filled title', Publisher: '' }, warnings: ['Photo lookup failed'] }) };
  });
  app.formBook = { ISBN: '9780306406157', Publisher: 'Keep publisher', publisherCoverBase64: 'aGVsbG8=' };
  await app.runAiPipeline();
  assert.equal(app.formBook.Title_English, 'Filled title');
  assert.equal(app.formBook.Publisher, 'Keep publisher');
  assert.equal(app.loading, false);
  assert.deepEqual(alerts, ['Photo lookup failed']);
});
