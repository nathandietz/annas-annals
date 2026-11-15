'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const config = window.LIBRARY_CONFIG;
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const headers = ['id', 'isbn', 'title', 'author', 'language', 'notes', 'created_at'];
  const storageKey = 'annas-annals-sheet-id';
  const sessionKey = 'annas-annals-google-session';
  const cacheKey = 'annas-annals-catalog-snapshot';
  let token = '', sheetId = '', books = [], pickerReady = false, busy = false, creatingLibrary = false;
  let rememberedSheet = '', editingBook = null;
  try { rememberedSheet = localStorage.getItem(storageKey) || ''; } catch {}
  const scanner = createLibraryScanner();
  const status = message => { $('status').textContent = message; };
  const formStatus = message => { $('form-status').textContent = message; };
  function message(error) { return error?.message || 'Something went wrong. Please try again.'; }
  function updateConnect() {
    $('signin').textContent = rememberedSheet ? 'Reconnect to Google Sheet' : 'Connect Google Sheet';
    $('choose-sheet').hidden = !rememberedSheet;
  }
  function rememberSheet(id) {
    rememberedSheet = id;
    try { if (id) localStorage.setItem(storageKey, id); else localStorage.removeItem(storageKey); } catch {}
    updateConnect();
  }
  function showLibrary() { $('connect').hidden = true; $('library').hidden = false; $('disconnect').hidden = false; $('library-actions').hidden = false; $('search').disabled = false; }
  updateConnect();
  function clearSession() { try { sessionStorage.removeItem(sessionKey); sessionStorage.removeItem(cacheKey); } catch {} token = ''; sheetId = ''; books = []; $('library-name').textContent = 'A personal library'; $('books').replaceChildren(); $('search').value = ''; $('search').disabled = true; $('library-actions').hidden = true; $('library').hidden = true; $('connect').hidden = false; $('disconnect').hidden = true; }
  async function api(path, options = {}) {
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(sheetId) + path, {
      ...options, headers: { Authorization: 'Bearer ' + token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(response.status === 401 ? 'Google authorization expired. Disconnect and connect again.' : (data.error?.message || 'Google Sheets request failed.')); error.status = response.status; throw error; }
    return data;
  }
  async function refresh() {
    status('Refreshing catalog…');
    const [data, spreadsheet] = await Promise.all([
      api('/values/' + encodeURIComponent("'Books'!A:G")),
      api('?fields=properties(title)')
    ]);
    const rows = data.values || [];
    if (JSON.stringify(rows[0] || []) !== JSON.stringify(headers)) throw new Error('The Books tab is missing or its header does not match the required format. See the setup guide.');
    books = rows.slice(1).filter(row => row[0] && row[2]).map(row => Object.fromEntries(headers.map((key, i) => [key, row[i] || ''])));
    $('library-name').textContent = spreadsheet.properties?.title || 'A personal library';
    const updatedAt = Date.now();
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ sheetId, title: $('library-name').textContent, books, updatedAt })); } catch {}
    render(); status('Catalog updated ' + new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.');
  }
  function render() {
    const query = $('search').value.trim().toLocaleLowerCase();
    const filtered = books.filter(book => [book.title, book.author, book.isbn].some(value => value.toLocaleLowerCase().includes(query)));
    $('books').replaceChildren();
    for (const book of filtered) {
      const card = document.createElement('article'); card.className = 'book';
      for (const [tag, value] of [['h3', book.title], ['p', book.author], ['p', book.isbn], ['p', book.language], ['p', book.notes]]) {
        if (value) { const el = document.createElement(tag); el.textContent = value; card.append(el); }
      }
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', 'Edit ' + book.title);
      edit.addEventListener('click', () => openEditor(book)); card.append(edit);
      $('books').append(card);
    }
    $('count').textContent = filtered.length + (filtered.length === 1 ? ' book' : ' books') + (query ? ' found' : ' in your catalog');
  }
  function openPicker() {
    const mine = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS);
    const shared = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setOwnedByMe(false);
    new google.picker.PickerBuilder().addView(mine).addView(shared).setOAuthToken(token).setDeveloperKey(config.apiKey).setAppId(config.appId)
      .setCallback(async result => {
        if (result.action !== google.picker.Action.PICKED) return;
        sheetId = result.docs[0].id;
        try { await refresh(); rememberSheet(sheetId); showLibrary(); }
        catch (error) { sheetId = ''; status(message(error)); }
      }).build().setVisible(true);
  }
  async function createLibrary(name) {
    if (creatingLibrary) return;
    creatingLibrary = true;
    try {
    status('Creating your library…');
    let response;
    try { response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { title: name },
        sheets: [{ properties: { title: 'Books', gridProperties: { frozenRowCount: 1 } },
          data: [{ startRow: 0, startColumn: 0, rowData: [{ values: headers.map(header => ({ userEnteredValue: { stringValue: header } })) }] }] }]
      })
    });
    } catch { throw new Error('Could not confirm creation. Check Google Drive before trying again.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.spreadsheetId) throw new Error(data.error?.message || 'The creation result could not be confirmed. Check Google Drive before trying again.');
    const previousSheet = sheetId;
    sheetId = data.spreadsheetId;
    rememberSheet(sheetId);
    try { await refresh(); showLibrary(); status('New library created.'); }
    catch (error) {
      sheetId = previousSheet;
      if (previousSheet) rememberSheet(previousSheet);
      throw new Error('The new spreadsheet was created, but could not be opened. Find it in Google Drive and reconnect. ' + message(error));
    }
    } finally { creatingLibrary = false; }
  }
  function connect(mode = 'connect', libraryName = '') {
    if (!config.clientId || !config.apiKey || !config.appId) { status('Setup needed: add the Google Cloud identifiers to config.js. See the setup guide.'); return; }
    if (!window.google?.accounts?.oauth2 || !window.gapi) { status('Google sign-in is still loading. Please try again.'); return; }
    const client = google.accounts.oauth2.initTokenClient({ client_id: config.clientId, scope, callback: async response => {
      if (response.error) { status('Google authorization was not completed: ' + response.error); return; }
      token = response.access_token;
      try { sessionStorage.removeItem(cacheKey); } catch {}
      try { sessionStorage.setItem(sessionKey, JSON.stringify({ token, expiresAt: Date.now() + Number(response.expires_in) * 1000 })); } catch {}
      if (mode === 'create') {
        try { await createLibrary(libraryName); } catch (error) { status(message(error)); }
        return;
      }
      if (rememberedSheet && mode === 'connect') {
        sheetId = rememberedSheet;
        try { await refresh(); showLibrary(); }
        catch (error) { sheetId = ''; status('Could not open the remembered Sheet: ' + message(error) + ' You can choose a different Sheet.'); }
        return;
      }
      if (pickerReady) openPicker(); else gapi.load('picker', { callback: () => { pickerReady = true; openPicker(); }, onerror: () => status('Google Picker could not load. Please try again.'), timeout: 10000, ontimeout: () => status('Google Picker took too long to load. Please try again.') });
    }});
    client.requestAccessToken();
  }
  async function restoreSession() {
    if (!rememberedSheet) { $('connect').hidden = false; status('Connect a private Google Sheet to get started.'); return; }
    let session;
    try { session = JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); } catch {}
    if (!session?.token || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now() + 30000) {
      try { sessionStorage.removeItem(sessionKey); } catch {}
      $('connect').hidden = false; status('Reconnect to your Google Sheet to continue.');
      return;
    }
    token = session.token; sheetId = rememberedSheet;
    let cached = false;
    try {
      const snapshot = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (snapshot?.sheetId === sheetId && Array.isArray(snapshot.books) && snapshot.books.every(book => headers.every(key => typeof book[key] === 'string')) && Number.isFinite(snapshot.updatedAt)) {
        books = snapshot.books; $('library-name').textContent = snapshot.title || 'A personal library';
        render(); showLibrary(); cached = true;
      }
    } catch {}
    try { await refresh(); showLibrary(); }
    catch (error) {
      if (cached && error.status !== 401 && error.status !== 403) {
        status('Showing saved catalog; refresh failed: ' + message(error));
      } else {
        clearSession();
        status('Could not restore your session: ' + message(error) + ' Reconnect to try again.');
      }
    }
  }
  restoreSession();
  $('signin').addEventListener('click', () => connect());
  $('choose-sheet').addEventListener('click', () => connect('choose'));
  function requestNewLibrary() {
    if (creatingLibrary) return;
    const name = window.prompt('Name your new library:', 'My Library');
    if (name === null) return;
    if (!name.trim()) { status('Enter a name for your new library.'); return; }
    if (token) createLibrary(name.trim()).catch(error => status(message(error)));
    else connect('create', name.trim());
  }
  $('new-library').addEventListener('click', requestNewLibrary);
  $('new-library-connected').addEventListener('click', requestNewLibrary);
  $('disconnect').addEventListener('click', () => { clearSession(); rememberSheet(''); status('Disconnected. No catalog is stored in this browser.'); });
  $('refresh').addEventListener('click', () => refresh().catch(error => status(message(error))));
  $('search').addEventListener('input', render);
  function openEditor(book = null) {
    editingBook = book ? { ...book } : null;
    const form = $('book-form'); form.reset();
    for (const key of ['isbn', 'title', 'author', 'language', 'notes']) form.elements[key].value = book?.[key] || '';
    $('editor-title').textContent = book ? 'Edit book' : 'Add a book';
    $('delete').hidden = !book; formStatus(''); $('editor').showModal();
  }
  $('add').addEventListener('click', () => openEditor());
  async function findUnchangedBook(original) {
    const data = await api('/values/' + encodeURIComponent("'Books'!A:G"));
    const rows = data.values || [];
    if (JSON.stringify(rows[0] || []) !== JSON.stringify(headers)) throw new Error('The Books headers changed. Refresh and check the Sheet before continuing.');
    const matches = [];
    rows.slice(1).forEach((row, index) => { if (row[0] === original.id) matches.push({ row, number: index + 2 }); });
    if (matches.length !== 1) throw new Error(matches.length ? 'This book ID appears more than once in the Sheet. Resolve the duplicates before editing.' : 'This book was removed or its ID changed. Close this window and refresh the catalog.');
    const current = headers.map((key, index) => String(matches[0].row[index] ?? ''));
    if (current.some((value, index) => value !== String(original[headers[index]] ?? ''))) throw new Error('This book changed in the Sheet since you opened it. Your changes were not saved. Close this window, refresh, and review the latest version.');
    return matches[0].number;
  }
  async function finishChange(label) {
    $('editor').close(); status(label + ' Refreshing catalog…');
    try { await refresh(); } catch (error) { status(label + ' Refresh failed: ' + message(error)); }
  }
  $('delete').addEventListener('click', async () => {
    if (busy || !editingBook || !window.confirm('Delete “' + editingBook.title + '” from this library?')) return;
    busy = true; $('save').disabled = true; $('delete').disabled = true; formStatus('Checking for changes…');
    try {
      const rowNumber = await findUnchangedBook(editingBook);
      await api('/values/' + encodeURIComponent("'Books'!A" + rowNumber + ':G' + rowNumber) + ':clear', { method: 'POST', body: '{}' });
      await finishChange('Book deleted.');
    } catch (error) { formStatus(message(error)); }
    finally { busy = false; $('save').disabled = false; $('delete').disabled = false; }
  });
  async function stopScanner() { await scanner.stop(); $('scan-area').hidden = true; }
  $('close-editor').addEventListener('click', async () => { await stopScanner(); $('editor').close(); });
  $('editor').addEventListener('cancel', () => { scanner.stop().catch(() => {}); $('scan-area').hidden = true; });
  $('scan').addEventListener('click', async () => {
    $('scan-area').hidden = false;
    try { await scanner.start(async text => { $('book-form').elements.isbn.value = text; await stopScanner(); formStatus('Barcode captured. Look up the ISBN or enter the details.'); }, text => { $('scan-status').textContent = text; }); }
    catch (error) { $('scan-status').textContent = message(error); }
  });
  $('stop-scan').addEventListener('click', () => stopScanner().catch(error => formStatus(message(error))));
  $('photo').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; try { const result = await scanner.scanFile(file); if (result) { $('book-form').elements.isbn.value = result; await stopScanner(); formStatus('Barcode captured. Look up the ISBN or enter the details.'); } } catch { $('scan-status').textContent = 'No barcode found. Try a clearer photo or enter the ISBN manually.'; } });
  $('lookup').addEventListener('click', async () => {
    const isbn = normalizeIsbn($('book-form').elements.isbn.value);
    if (!isbn) { formStatus('Enter a valid ISBN-10 or ISBN-13.'); return; }
    $('book-form').elements.isbn.value = isbn;
    formStatus('Looking up ISBN…'); $('lookup').disabled = true;
    try {
      const response = await fetch('https://openlibrary.org/api/books?bibkeys=' + encodeURIComponent('ISBN:' + isbn) + '&format=json&jscmd=data');
      if (!response.ok) throw new Error('Lookup unavailable. You can enter the details manually.');
      const data = (await response.json())['ISBN:' + isbn];
      if (!data) { formStatus('No match found. You can enter the details manually.'); return; }
      const form = $('book-form'); if (!form.elements.title.value) form.elements.title.value = data.title || ''; if (!form.elements.author.value) form.elements.author.value = (data.authors || []).map(a => a.name).join(', ');
      formStatus('Details found. Review them before saving.');
    } catch (error) { formStatus(message(error)); } finally { $('lookup').disabled = false; }
  });
  $('book-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget, enteredIsbn = form.elements.isbn.value.trim();
    const isbn = normalizeIsbn(enteredIsbn);
    if (enteredIsbn && !isbn) { formStatus('Enter a valid ISBN-10 or ISBN-13, or leave it blank.'); return; }
    if (isbn) form.elements.isbn.value = isbn;
    if (isbn && books.some(book => book.id !== editingBook?.id && normalizeIsbn(book.isbn) === isbn)) { formStatus('This ISBN is already in the catalog.'); return; }
    busy = true; $('save').disabled = true; $('delete').disabled = true; formStatus('Saving…');
    try {
      const row = [editingBook?.id || crypto.randomUUID(), isbn, form.elements.title.value.trim(), form.elements.author.value.trim(), form.elements.language.value.trim(), form.elements.notes.value.trim(), editingBook?.created_at || new Date().toISOString()];
      if (!row[2]) throw new Error('Enter a title.');
      if (editingBook) {
        const rowNumber = await findUnchangedBook(editingBook);
        await api('/values/' + encodeURIComponent("'Books'!A" + rowNumber + ':G' + rowNumber) + '?valueInputOption=RAW', { method: 'PUT', body: JSON.stringify({ values: [row] }) });
      } else {
        await api('/values/' + encodeURIComponent("'Books'!A:G") + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: [row] }) });
      }
      await finishChange('Book saved.');
    } catch (error) { formStatus('Save failed or could not be confirmed. Refresh the catalog before retrying: ' + message(error)); }
    finally { busy = false; $('save').disabled = false; $('delete').disabled = false; }
  });
})();
