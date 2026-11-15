'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const config = window.LIBRARY_CONFIG;
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const headers = ['id', 'isbn', 'title', 'author', 'language', 'notes', 'created_at'];
  let token = '', sheetId = '', books = [], pickerReady = false, busy = false;
  const scanner = createLibraryScanner();
  const status = message => { $('status').textContent = message; };
  const formStatus = message => { $('form-status').textContent = message; };
  function message(error) { return error?.message || 'Something went wrong. Please try again.'; }
  function clearSession() { token = ''; sheetId = ''; books = []; $('books').replaceChildren(); $('library').hidden = true; $('connect').hidden = false; $('disconnect').hidden = true; }
  async function api(path, options = {}) {
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(sheetId) + path, {
      ...options, headers: { Authorization: 'Bearer ' + token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 401 ? 'Google authorization expired. Disconnect and connect again.' : (data.error?.message || 'Google Sheets request failed.'));
    return data;
  }
  async function refresh() {
    status('Loading your catalog…');
    const data = await api('/values/' + encodeURIComponent("'Books'!A:G"));
    const rows = data.values || [];
    if (JSON.stringify(rows[0] || []) !== JSON.stringify(headers)) throw new Error('The Books tab is missing or its header does not match the required format. See the setup guide.');
    books = rows.slice(1).filter(row => row[0] && row[2]).map(row => Object.fromEntries(headers.map((key, i) => [key, row[i] || ''])));
    render(); status('Catalog updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.');
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
        try { await refresh(); $('connect').hidden = true; $('library').hidden = false; $('disconnect').hidden = false; }
        catch (error) { sheetId = ''; status(message(error)); }
      }).build().setVisible(true);
  }
  $('signin').addEventListener('click', () => {
    if (!config.clientId || !config.apiKey || !config.appId) { status('Setup needed: add the Google Cloud identifiers to config.js. See the setup guide.'); return; }
    if (!window.google?.accounts?.oauth2 || !window.gapi) { status('Google sign-in is still loading. Please try again.'); return; }
    const client = google.accounts.oauth2.initTokenClient({ client_id: config.clientId, scope, callback: response => {
      if (response.error) { status('Google authorization was not completed: ' + response.error); return; }
      token = response.access_token;
      if (pickerReady) openPicker(); else gapi.load('picker', { callback: () => { pickerReady = true; openPicker(); }, onerror: () => status('Google Picker could not load. Please try again.'), timeout: 10000, ontimeout: () => status('Google Picker took too long to load. Please try again.') });
    }});
    client.requestAccessToken();
  });
  $('disconnect').addEventListener('click', () => { clearSession(); status('Disconnected. No catalog is stored in this browser.'); });
  $('refresh').addEventListener('click', () => refresh().catch(error => status(message(error))));
  $('search').addEventListener('input', render);
  $('add').addEventListener('click', () => { $('book-form').reset(); formStatus(''); $('editor').showModal(); });
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
    const isbn = $('book-form').elements.isbn.value.replace(/[^0-9Xx]/g, '');
    if (!/^(?:\d{13}|\d{9}[\dXx])$/.test(isbn)) { formStatus('Enter a 10- or 13-digit ISBN first.'); return; }
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
    const form = event.currentTarget, isbn = form.elements.isbn.value.trim();
    if (isbn && books.some(book => book.isbn.replace(/[^0-9Xx]/g, '').toUpperCase() === isbn.replace(/[^0-9Xx]/g, '').toUpperCase())) { formStatus('This ISBN is already in the catalog.'); return; }
    busy = true; $('save').disabled = true; formStatus('Saving…');
    try {
      const row = [crypto.randomUUID(), isbn, form.elements.title.value.trim(), form.elements.author.value.trim(), form.elements.language.value.trim(), form.elements.notes.value.trim(), new Date().toISOString()];
      if (!row[2]) throw new Error('Enter a title.');
      await api('/values/' + encodeURIComponent("'Books'!A:G") + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: [row] }) });
      $('editor').close(); status('Book saved. Refreshing catalog…');
      try { await refresh(); } catch (error) { status('Book saved, but refresh failed: ' + message(error)); }
    } catch (error) { formStatus('Save failed or could not be confirmed. Refresh the catalog before retrying: ' + message(error)); }
    finally { busy = false; $('save').disabled = false; }
  });
})();
