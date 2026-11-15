'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const config = window.LIBRARY_CONFIG;
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const headers = ['id', 'isbn', 'title', 'author', 'language', 'notes', 'created_at', 'publisher', 'publication_year', 'shelf_location'];
  const supportedWidths = [7, 9, 10];
  const storageKey = 'annas-annals-sheet-id';
  const sessionKey = 'annas-annals-google-session';
  const cacheKey = 'annas-annals-catalog-snapshot';
  let token = '', sheetId = '', books = [], pickerReady = false, busy = false, creatingLibrary = false, libraryWidth = 10;
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
  function showLibrary() { $('library-name').href = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId) + '/edit'; $('connect').hidden = true; $('library').hidden = false; $('disconnect').hidden = false; $('new-library-connected').hidden = false; $('library-actions').hidden = false; $('search').disabled = false; }
  updateConnect();
  function clearSession() { try { sessionStorage.removeItem(sessionKey); sessionStorage.removeItem(cacheKey); } catch {} token = ''; sheetId = ''; books = []; $('library-name').textContent = 'Your library'; $('library-name').removeAttribute('href'); $('books').replaceChildren(); $('search').value = ''; $('search').disabled = true; $('library-actions').hidden = true; $('library').hidden = true; $('connect').hidden = false; $('disconnect').hidden = true; $('new-library-connected').hidden = true; }
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
      api('/values/' + encodeURIComponent("'Books'!A:J")),
      api('?fields=properties(title)')
    ]);
    const rows = data.values || [];
    const foundHeaders = rows[0] || [];
    libraryWidth = supportedWidths.find(width => JSON.stringify(foundHeaders) === JSON.stringify(headers.slice(0, width))) || 0;
    if (!libraryWidth) throw new Error('The Books tab headers do not match a supported library. See the setup guide.');
    $('upgrade-library').hidden = libraryWidth === headers.length;
    books = rows.slice(1).filter(row => row[0] && row[2]).map(row => Object.fromEntries(headers.map((key, i) => [key, i < libraryWidth ? String(row[i] ?? '') : ''])));
    $('library-name').textContent = spreadsheet.properties?.title || 'Your library';
    const updatedAt = Date.now();
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ sheetId, title: $('library-name').textContent, books, updatedAt, libraryWidth })); } catch {}
    render(); status('Catalog updated ' + new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.');
  }
  function render() {
    const query = $('search').value.trim().toLocaleLowerCase();
    const filtered = books.filter(book => [book.title, book.author, book.isbn, book.shelf_location].some(value => value.toLocaleLowerCase().includes(query)));
    $('books').replaceChildren();
    for (const book of filtered) {
      const card = document.createElement('article'); card.className = 'book';
      const content = document.createElement('div'); content.className = 'book-content';
      const cover = document.createElement('div'); cover.className = 'cover-placeholder'; cover.setAttribute('aria-hidden', 'true'); cover.textContent = '▤'; content.append(cover);
      const details = document.createElement('div'); details.className = 'book-details';
      for (const [tag, value] of [['h3', book.title], ['p', book.author], ['p', book.publisher], ['p', book.publication_year], ['p', book.language], ['p', book.shelf_location], ['p', book.isbn]]) {
        if (value) { const el = document.createElement(tag); el.textContent = value; details.append(el); }
      }
      content.append(details); card.append(content);
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary book-edit'; edit.textContent = 'Edit details'; edit.setAttribute('aria-label', 'Edit ' + book.title);
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
      if (snapshot?.sheetId === sheetId && Array.isArray(snapshot.books) && snapshot.books.every(book => headers.every(key => typeof book[key] === 'string')) && Number.isFinite(snapshot.updatedAt) && supportedWidths.includes(snapshot.libraryWidth)) {
        libraryWidth = supportedWidths.includes(snapshot.libraryWidth) ? snapshot.libraryWidth : 0; $('upgrade-library').hidden = libraryWidth === headers.length;
        books = snapshot.books; $('library-name').textContent = snapshot.title || 'Your library';
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
  $('upgrade-library').addEventListener('click', () => {
    if (busy || !libraryWidth || libraryWidth === headers.length) return;
    const labels = { publisher: 'Publisher', publication_year: 'Publication year', shelf_location: 'Shelf location' };
    const list = $('upgrade-columns'); list.replaceChildren();
    headers.slice(libraryWidth).forEach((key, index) => {
      const item = document.createElement('li');
      item.textContent = (labels[key] || key) + ' (column ' + String.fromCharCode(65 + libraryWidth + index) + ')';
      list.append(item);
    });
    $('upgrade-dialog').showModal();
  });
  $('cancel-upgrade').addEventListener('click', () => $('upgrade-dialog').close());
  $('confirm-upgrade').addEventListener('click', async () => {
    if (busy || !libraryWidth || libraryWidth === headers.length) return;
    $('upgrade-dialog').close();
    busy = true; $('upgrade-library').disabled = true;
    try {
      status('Checking library columns…');
      const data = await api('/values/' + encodeURIComponent("'Books'!A:J") + '?valueRenderOption=FORMULA');
      const rows = data.values || [];
      if (JSON.stringify(rows[0] || []) !== JSON.stringify(headers.slice(0, libraryWidth))) throw new Error('The headers have changed. Refresh and review the Sheet before updating.');
      if (rows.some(row => row.slice(libraryWidth, headers.length).some(value => value !== ''))) throw new Error('The columns needed for the update contain data. Move that data before updating; nothing was changed.');
      await api('/values/' + encodeURIComponent("'Books'!" + String.fromCharCode(65 + libraryWidth) + '1:J1') + '?valueInputOption=RAW', { method: 'PUT', body: JSON.stringify({ values: [headers.slice(libraryWidth)] }) });
      await refresh(); status('Library updated.');
    } catch (error) { status('Library update failed: ' + message(error)); }
    finally { busy = false; $('upgrade-library').disabled = false; }
  });
  $('refresh').addEventListener('click', () => refresh().catch(error => status(message(error))));
  $('search').addEventListener('input', render);
  function openEditor(book = null) {
    editingBook = book ? { ...book } : null;
    const form = $('book-form'); form.reset();
    for (const key of ['isbn', 'title', 'author', 'publisher', 'publication_year', 'language', 'shelf_location', 'notes']) form.elements[key].value = book?.[key] || '';
    $('editor-title').textContent = book ? 'Edit book' : 'Add a book';
    $('lookup-results').hidden = true; $('lookup-suggestions').replaceChildren();
    $('delete').hidden = !book; formStatus(''); $('editor').showModal();
  }
  $('add').addEventListener('click', () => openEditor());
  async function findUnchangedBook(original) {
    const data = await api('/values/' + encodeURIComponent("'Books'!A:J"));
    const rows = data.values || [];
    if (JSON.stringify(rows[0] || []) !== JSON.stringify(headers.slice(0, libraryWidth))) throw new Error('The Books headers changed. Refresh and check the Sheet before continuing.');
    const matches = [];
    rows.slice(1).forEach((row, index) => { if (row[0] === original.id) matches.push({ row, number: index + 2 }); });
    if (matches.length !== 1) throw new Error(matches.length ? 'This book ID appears more than once in the Sheet. Resolve the duplicates before editing.' : 'This book was removed or its ID changed. Close this window and refresh the catalog.');
    const current = headers.map((key, index) => index < libraryWidth ? String(matches[0].row[index] ?? '') : '');
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
      await api('/values/' + encodeURIComponent("'Books'!A" + rowNumber + (':' + String.fromCharCode(64 + libraryWidth)) + rowNumber) + ':clear', { method: 'POST', body: '{}' });
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
    const form = $('book-form');
    const isbn = normalizeIsbn(form.elements.isbn.value);
    const results = $('lookup-results'), resultStatus = $('lookup-status'), suggestions = $('lookup-suggestions');
    results.hidden = false; suggestions.replaceChildren();
    if (!isbn) { resultStatus.textContent = 'Enter a valid ISBN-10 or ISBN-13.'; return; }
    form.elements.isbn.value = isbn;
    resultStatus.textContent = 'Looking up book details…'; $('lookup').disabled = true;
    const currentBook = editingBook;
    try {
      const response = await fetch('https://openlibrary.org/api/books?bibkeys=' + encodeURIComponent('ISBN:' + isbn) + '&format=json&jscmd=data');
      if (!response.ok) throw new Error('Lookup unavailable. You can enter the details manually.');
      const data = (await response.json())['ISBN:' + isbn];
      if (editingBook !== currentBook || normalizeIsbn(form.elements.isbn.value) !== isbn || !$('editor').open) return;
      if (!data) { resultStatus.textContent = 'No match found. You can enter the details manually.'; return; }
      const values = [
        ['title', 'Title', data.title || ''],
        ['author', 'Author', (data.authors || []).map(a => a.name).filter(Boolean).join(', ')],
        ['publisher', 'Publisher', (data.publishers || []).map(p => p.name).filter(Boolean).join(', ')],
        ['publication_year', 'Publication year', (data.publish_date || '').match(/\b(?:1[0-9]{3}|20[0-9]{2})\b/)?.[0] || ''],
        ['language', 'Language', (data.languages || []).map(language => language.name || language.key?.split('/').pop() || '').filter(Boolean).join(', ')]
      ];
      let filled = 0, alternatives = 0;
      for (const [key, label, value] of values) {
        if (!value) continue;
        if (!form.elements[key].value.trim()) { form.elements[key].value = value; filled++; continue; }
        if (form.elements[key].value.trim() === value) continue;
        alternatives++;
        const item = document.createElement('div'); item.className = 'lookup-suggestion';
        const description = document.createElement('p'); description.textContent = label + ': ' + value;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'Use this ' + label.toLowerCase();
        button.addEventListener('click', () => { form.elements[key].value = value; item.remove(); });
        item.append(description, button); suggestions.append(item);
      }
      resultStatus.textContent = filled ? 'Filled ' + filled + (filled === 1 ? ' empty field.' : ' empty fields.') + ' Review the details and save.' : 'No empty fields were filled. Review the details and save.';
      if (alternatives) resultStatus.textContent += ' Open Library also suggested alternatives below.';
    } catch (error) { resultStatus.textContent = message(error); } finally { $('lookup').disabled = false; }
  });
  $('book-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    if (libraryWidth !== headers.length) { formStatus('Update the library before saving book details. Close this window and choose Update library.'); return; }
    const form = event.currentTarget, enteredIsbn = form.elements.isbn.value.trim();
    const isbn = normalizeIsbn(enteredIsbn);
    if (enteredIsbn && !isbn) { formStatus('Enter a valid ISBN-10 or ISBN-13, or leave it blank.'); return; }
    if (isbn) form.elements.isbn.value = isbn;
    if (isbn && books.some(book => book.id !== editingBook?.id && normalizeIsbn(book.isbn) === isbn)) { formStatus('This ISBN is already in the catalog.'); return; }
    busy = true; $('save').disabled = true; $('delete').disabled = true; formStatus('Saving…');
    try {
      const row = [editingBook?.id || crypto.randomUUID(), isbn, form.elements.title.value.trim(), form.elements.author.value.trim(), form.elements.language.value.trim(), form.elements.notes.value.trim(), editingBook?.created_at || new Date().toISOString(), form.elements.publisher.value.trim(), form.elements.publication_year.value.trim(), form.elements.shelf_location.value.trim()];
      if (!row[2]) throw new Error('Enter a title.');
      if (editingBook) {
        const rowNumber = await findUnchangedBook(editingBook);
        await api('/values/' + encodeURIComponent("'Books'!A" + rowNumber + (':' + String.fromCharCode(64 + libraryWidth)) + rowNumber) + '?valueInputOption=RAW', { method: 'PUT', body: JSON.stringify({ values: [row] }) });
      } else {
        await api('/values/' + encodeURIComponent("'Books'!A:J") + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: [row] }) });
      }
      await finishChange('Book saved.');
    } catch (error) { formStatus('Save failed or could not be confirmed. Refresh the catalog before retrying: ' + message(error)); }
    finally { busy = false; $('save').disabled = false; $('delete').disabled = false; }
  });
})();
