'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const config = window.LIBRARY_CONFIG;
  window.addEventListener('scroll', () => { $('scroll-top').hidden = window.scrollY < 300; }, { passive: true });
  $('scroll-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  if (typeof ResizeObserver !== 'undefined' && document.documentElement) {
    const toolbar = document.querySelector('.toolbar');
    if (toolbar) new ResizeObserver(() => document.documentElement.style.setProperty('--toolbar-height', toolbar.offsetHeight + 'px')).observe(toolbar);
  }
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const headers = ['id', 'isbn', 'title', 'author', 'language', 'notes', 'created_at', 'publisher', 'publication_year', 'shelf_location', 'category', 'description', 'series_name', 'volume_number', 'pages', 'updated_at'];
  const preferredHeaders = ['title', 'author', 'series_name', 'volume_number', 'isbn', 'publisher', 'publication_year', 'category', 'language', 'pages', 'shelf_location', 'description', 'notes', 'id', 'created_at', 'updated_at'];
  let sheetHeaders = [], headerFrozen = false;
  function column(index) { let n = index + 1, out = ''; while (n) { n--; out = String.fromCharCode(65 + n % 26) + out; n = Math.floor(n / 26); } return out; }
  function readHeaders(row) {
    const names = row || [];
    const positions = new Map();
    names.forEach((name, index) => { if (name) positions.set(name, [...(positions.get(name) || []), column(index)]); });
    const duplicates = [...positions].filter(([, cols]) => cols.length > 1);
    if (duplicates.length) throw new Error('Duplicate column headers: ' + duplicates.map(([name, cols]) => '“' + name + '” in columns ' + cols.join(', ')).join('; ') + '. Rename or remove the duplicate headers in the Sheet, then refresh.');
    for (const key of ['id', 'title']) if (!names.includes(key)) throw new Error('Missing required column: ' + key);
    return names;
  }
  function missingHeaders() { return headers.filter(key => !sheetHeaders.includes(key)); }
  function desiredOrder(names) { return [...preferredHeaders.filter(key => names.includes(key)), ...names.filter(key => !headers.includes(key))]; }
  function needsUpdate() { return !headerFrozen || missingHeaders().length > 0 || JSON.stringify(sheetHeaders) !== JSON.stringify(desiredOrder(sheetHeaders)); }
  function record(row, names) { return Object.fromEntries(headers.map(key => [key, names.indexOf(key) < 0 ? '' : String(row[names.indexOf(key)] ?? '')])); }
  const storageKey = 'annas-annals-sheet-id';
  const sessionKey = 'annas-annals-google-session';
  const cacheKey = 'annas-annals-catalog-snapshot';
  let token = '', sheetId = '', books = [], pickerReady = false, busy = false, creatingLibrary = false, libraryWidth = 16;
  let rememberedSheet = '', editingBook = null, viewMode = 'card', duplicatesMode = false, sortField = '', sortDirection = 1;
  try { const savedView = localStorage.getItem('annas-annals-view'); if (['card', 'list'].includes(savedView)) viewMode = savedView; } catch {}
  try { rememberedSheet = localStorage.getItem(storageKey) || ''; } catch {}
  const scanner = createLibraryScanner();
  const checkScanner = createLibraryScanner('check-qr-reader');
  const scanGuidance = 'Keep the entire barcode in view, including blank space at both ends. Hold steady in good light.';
  let mainView = window.matchMedia?.('(max-width: 700px)').matches ? 'scan' : 'library', canEdit = false, checkSequence = 0;
  let lastCatalogUpdate = 0, showingUpdateAge = false;
  const status = message => { showingUpdateAge = false; $('status').textContent = message; };
  function showUpdateAge() {
    if (!showingUpdateAge || !lastCatalogUpdate) return;
    const minutes = Math.max(0, Math.floor((Date.now() - lastCatalogUpdate) / 60000));
    $('status').textContent = minutes === 0 ? 'Updated just now' : 'Updated ' + minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
  }
  window.setInterval?.(showUpdateAge, 60000);
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
  function showLibrary() { $('mode-toggle').hidden = false; checkPermission(); $('library-name').href = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId) + '/edit'; $('connect').hidden = true; $('library').hidden = false; $('disconnect').hidden = false; $('new-library-connected').hidden = false; $('transfer-actions').hidden = false;   $('library-actions').hidden = false; $('view-switcher').hidden = false; $('search').disabled = false; setMainView(mainView); }
  updateConnect();
  function clearSession() { document.querySelector?.('.site-header')?.append($('status')); canEdit = false; checkSequence++; checkScanner.stop?.().catch(() => {}); $('mode-toggle').hidden = true; $('scan-view').hidden = true; setCameraOpen(false); try { localStorage.removeItem(sessionKey); sessionStorage.removeItem(cacheKey); } catch {} token = ''; sheetId = ''; books = []; $('count').textContent = ''; duplicatesMode = false; $('all-books').hidden = true; $('library-name').textContent = 'Your library'; $('library-name').removeAttribute('href'); $('books').replaceChildren(); $('search').value = ''; $('search').disabled = true; $('library-actions').hidden = true; $('view-switcher').hidden = true; $('library').hidden = true; $('connect').hidden = false; $('disconnect').hidden = true; $('new-library-connected').hidden = true; $('transfer-actions').hidden = true; $('settings-dialog').hidden = true;  }
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
      api('/values/' + encodeURIComponent("'Books'!A:ZZ")),
      api('?fields=properties(title),sheets(properties(title,gridProperties(frozenRowCount)))')
    ]);
    const rows = data.values || [];
    const foundHeaders = rows[0] || [];
    sheetHeaders = readHeaders(foundHeaders); libraryWidth = sheetHeaders.length;
    headerFrozen = (spreadsheet.sheets?.find(item => item.properties?.title === 'Books')?.properties?.gridProperties?.frozenRowCount || 0) >= 1;
    $('upgrade-library').hidden = !canEdit || !needsUpdate();
    books = rows.slice(1).map(row => record(row, sheetHeaders)).filter(book => book.title).sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    $('library-name').textContent = spreadsheet.properties?.title || 'Your library';
    const updatedAt = Date.now();
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ sheetId, title: $('library-name').textContent, books, updatedAt, sheetHeaders, headerFrozen })); } catch {}
    render(); lastCatalogUpdate = updatedAt; showingUpdateAge = true; showUpdateAge();
  }
  function render() {
    $('duplicates-toggle').setAttribute('aria-pressed', String(duplicatesMode));
    $('all-books').hidden = !duplicatesMode;
    const duplicateReasons = new Map();
    if (duplicatesMode) for (const group of findDuplicateGroups(books, normalizeIsbn)) for (const book of group.books) {
      if (!duplicateReasons.has(book)) duplicateReasons.set(book, []);
      duplicateReasons.get(book).push(group.reason);
    }
    const query = $('search').value.trim().toLocaleLowerCase();
    const filtered = books.filter(book => (!duplicatesMode || duplicateReasons.has(book)) && [book.title, book.author, book.isbn, book.shelf_location, book.category, book.series_name, book.description].some(value => value.toLocaleLowerCase().includes(query)));
    if (viewMode === 'list' && sortField) filtered.sort((a, b) => {
      const left = a[sortField].trim(), right = b[sortField].trim();
      if (!left || !right) return left ? -1 : right ? 1 : 0;
      return sortDirection * left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
    });
    const container = $('books'); container.replaceChildren(); container.className = 'books view-' + viewMode;
    for (const mode of ['card', 'list']) $('view-' + mode).setAttribute('aria-pressed', String(viewMode === mode));
    let listBody;
    if (viewMode === 'list') {
      const table = document.createElement('table'); table.className = 'catalog-table';
      const head = document.createElement('thead'), row = document.createElement('tr');
      for (const [label, field] of [['Title','title'], ['Author','author'], ['Publisher','publisher'], ['Category','category'], ['Location','shelf_location'], ['Actions','']]) {
        const cell = document.createElement('th'); cell.scope = 'col';
        if (!field) cell.textContent = label;
        else {
          if (sortField === field) cell.setAttribute('aria-sort', sortDirection === 1 ? 'ascending' : 'descending');
          const button = document.createElement('button'); button.type = 'button'; button.className = 'sort-button';
          button.textContent = label;
          const indicator = document.createElement('span'); indicator.className = 'sort-indicator' + (sortField === field ? (sortDirection === 1 ? ' ascending' : ' descending') : ''); indicator.setAttribute('aria-hidden', 'true');
          indicator.textContent = 'unfold_more'; button.append(indicator);
          button.setAttribute('aria-label', 'Sort by ' + label + (sortField === field && sortDirection === 1 ? ', descending' : ', ascending'));
          button.addEventListener('click', () => { sortDirection = sortField === field ? -sortDirection : 1; sortField = field; render(); });
          cell.append(button);
        }
        row.append(cell);
      }
      head.append(row); table.append(head); listBody = document.createElement('tbody'); table.append(listBody); container.append(table);
    }
    for (const book of filtered) {
      if (viewMode === 'list') {
        const row = document.createElement('tr'); row.className = 'book-row'; row.addEventListener('click', () => showDetails(book));
        for (const [index, value] of [book.title, book.author, book.publisher, book.category, book.shelf_location].entries()) {
          const cell = document.createElement('td');
          if (index === 0) { const title = document.createElement('button'); title.type = 'button'; title.className = 'book-title-button'; title.textContent = value; title.addEventListener('click', event => { event.stopPropagation(); showDetails(book); }); cell.append(title); }
          else cell.textContent = value || '—';
          if (index === 0 && duplicatesMode) { const reason = document.createElement('div'); reason.className = 'duplicate-reason'; reason.textContent = duplicateReasons.get(book).join(' · '); cell.append(reason); }
          row.append(cell);
        }
        const actions = document.createElement('td'); actions.className = 'list-actions';
        const edit = document.createElement('button'); edit.hidden = !canEdit; edit.type = 'button'; edit.className = 'secondary' + (book.id ? ' icon-button' : ''); edit.title = book.id ? 'Edit details' : 'Assign ID'; edit.setAttribute('aria-label', (book.id ? 'Edit ' : 'Assign ID to ') + book.title);
        if (book.id) { const icon = document.createElement('span'); icon.className = 'material-symbol'; icon.textContent = 'edit'; icon.setAttribute('aria-hidden', 'true'); edit.append(icon); } else edit.textContent = 'Assign ID';
        edit.addEventListener('click', event => { event.stopPropagation(); if (book.id) openEditor(book); else assignBookId(book, edit); }); actions.append(edit);
        row.append(actions); listBody.append(row); continue;
      }
      const card = document.createElement('article'); card.className = 'book'; card.addEventListener('click', () => showDetails(book));
      const content = document.createElement('div'); content.className = 'book-content';
      const cover = document.createElement('div'); cover.className = 'cover-placeholder'; cover.setAttribute('aria-hidden', 'true'); cover.textContent = '▤'; content.append(cover);
      const details = document.createElement('div'); details.className = 'book-details';
      for (const [tag, value] of [['h3', book.title], ['p', book.author], ['p', book.publisher], ['p', book.publication_year], ['p', book.language], ['p', book.shelf_location], ['p', book.category], ['p', book.series_name ? book.series_name + (book.volume_number ? ' · Vol. ' + book.volume_number : '') : ''], ['p', book.pages ? book.pages + ' pages' : ''], ['p', book.isbn]]) {
        if (value) { const el = document.createElement(tag); if (tag === 'h3') { const title = document.createElement('button'); title.type = 'button'; title.className = 'book-title-button'; title.textContent = value; title.addEventListener('click', event => { event.stopPropagation(); showDetails(book); }); el.append(title); } else el.textContent = value; details.append(el); }
      }
      if (duplicatesMode) { const reason = document.createElement('p'); reason.className = 'duplicate-reason'; reason.textContent = duplicateReasons.get(book).join(' · '); details.append(reason); }
      content.append(details); card.append(content);
      const actions = document.createElement('div'); actions.className = 'book-actions';
      const edit = document.createElement('button'); edit.hidden = !canEdit; edit.type = 'button'; edit.className = 'secondary book-edit'; edit.title = 'Edit details'; edit.setAttribute('aria-label', 'Edit ' + book.title);
      if (!book.id) {
        edit.textContent = 'Assign ID'; edit.setAttribute('aria-label', 'Assign ID to ' + book.title);
        const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'This book needs an ID before it can be edited.'; card.append(hint);
        edit.addEventListener('click', event => { event.stopPropagation(); assignBookId(book, edit); });
      } else { const icon = document.createElement('span'); icon.className = 'material-symbol'; icon.textContent = 'edit'; icon.setAttribute('aria-hidden', 'true'); edit.append(icon); edit.addEventListener('click', event => { event.stopPropagation(); openEditor(book); }); }
      actions.append(edit); card.append(actions);
      $('books').append(card);
    }
    $('count').textContent = filtered.length + (filtered.length === 1 ? ' Book' : ' Books'); renderScanBooks();
  }

  async function checkPermission() {
    const currentSheet = sheetId;
    canEdit = false; $('add').hidden = true; $('import-open').hidden = true; $('upgrade-library').hidden = true;
    try {
      const response = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(currentSheet) + '?fields=capabilities(canEdit)', { headers: { Authorization: 'Bearer ' + token } });
      const data = await response.json();
      if (sheetId !== currentSheet) return;
      canEdit = response.ok && data.capabilities?.canEdit === true;
      $('add').hidden = !canEdit; $('import-open').hidden = !canEdit; $('upgrade-library').hidden = !canEdit || !needsUpdate(); render();
    } catch { if (sheetId === currentSheet) status('Could not check editing access. You can still browse and scan.'); }
  }
  function setMainView(view) {
    mainView = view;
    $(view === 'scan' ? 'scan-meta' : view === 'settings' ? 'settings-meta' : 'library-meta').append($('status'));
    $('scan-view').hidden = view !== 'scan';
    $('library').hidden = view !== 'library';
    $('settings-dialog').hidden = view !== 'settings';
    const toolbar = document.querySelector?.('.toolbar'); if (toolbar) toolbar.hidden = view !== 'library';
    for (const name of ['scan', 'library', 'settings']) $(name === 'settings' ? 'settings-open' : 'mode-' + name).setAttribute('aria-pressed', String(name === view));
    if (view !== 'scan') { checkSequence++; checkScanner.stop?.().catch(() => {}); setCameraOpen(false); }
  }
  $('mode-scan').addEventListener('click', () => setMainView('scan'));
  $('mode-library').addEventListener('click', () => setMainView('library'));
  $('library-scan').addEventListener('click', () => setMainView('scan'));
  function renderScanBooks() {
    const container = $('scan-books'); container.replaceChildren();
    const query = $('scan-search').value.trim().toLocaleLowerCase();
    const isbnQuery = query.replace(/[\s-]/g, '');
    const filtered = books.filter(book => [book.title, book.author].some(value => (value || '').toLocaleLowerCase().includes(query)) || (isbnQuery && (book.isbn || '').toLocaleLowerCase().replace(/[\s-]/g, '').includes(isbnQuery)));
    $('scan-count').textContent = filtered.length + (filtered.length === 1 ? ' book' : ' books');
    for (const book of filtered) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'scan-book';
      const title = document.createElement('strong'); title.textContent = book.title;
      const author = document.createElement('span'); author.textContent = book.author || 'Unknown author';
      button.append(title, author); button.addEventListener('click', () => showDetails(book)); container.append(button);
    }
  }
  let scanSearchTimer;
  $('scan-search').addEventListener('input', () => {
    checkSequence++; clearTimeout(scanSearchTimer); $('check-result').hidden = true; renderScanBooks();
    const query = $('scan-search').value.trim();
    if (normalizeIsbn(query)) scanSearchTimer = setTimeout(async () => {
      await checkScanner.stop(); setCameraOpen(false);
      if ($('scan-search').value.trim() === query && mainView === 'scan') checkIsbn(query);
    }, 400);
  });
  async function checkIsbn(value) {
    const sequence = ++checkSequence, isbn = normalizeIsbn(value);
    const result = $('check-result'); result.hidden = false; result.replaceChildren();
    if (!isbn) { result.textContent = 'Enter a valid ISBN-10 or ISBN-13.'; return; }

    let match = matchBook(isbn, null, books), metadata = null;
    if (match.kind !== 'exact') {
      const heading = document.createElement('h2'); heading.textContent = 'No ISBN Match Found';
      const detail = document.createElement('p'); detail.textContent = 'Checking Title & Author';
      result.append(heading, detail);
      try {
        const response = await fetch('https://openlibrary.org/api/books?bibkeys=' + encodeURIComponent('ISBN:' + isbn) + '&format=json&jscmd=data');
        if (!response.ok) throw new Error('Lookup unavailable');
        const data = (await response.json())['ISBN:' + isbn];
        if (data) metadata = { title: data.title || '', author: (data.authors || []).map(a => a.name).filter(Boolean).join(', ') };
        match = matchBook(isbn, metadata, books);
      } catch { match = { kind: 'unknown', books: [] }; }
    }
    if (sequence !== checkSequence || mainView !== 'scan') return;
    result.replaceChildren();
    const heading = document.createElement('h2'); heading.textContent = {exact:'Already in your library', possible:'Likely already in your library', none:'No Book Match Found', unknown:'No ISBN Match Found'}[match.kind]; result.append(heading);
    const detail = document.createElement('p'); detail.textContent = match.kind === 'unknown' ? 'Could not check for other editions. Search by title or author to check manually.' : match.kind === 'possible' ? 'The title and author match a book you own; this may be another edition.' : metadata ? [metadata.title, metadata.author].filter(Boolean).join(' — ') : ''; result.append(detail);
    for (const book of match.books) { const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = [book.title, book.author].filter(Boolean).join(' — '); button.addEventListener('click', () => showDetails(book)); result.append(button); }
    if (canEdit && match.kind !== 'exact') { const add = document.createElement('button'); add.type = 'button'; add.textContent = match.kind === 'possible' ? 'Add this edition anyway' : 'Add book'; add.addEventListener('click', () => { openEditor(); $('book-form').elements.isbn.value = isbn; if (metadata) { $('book-form').elements.title.value = metadata.title; $('book-form').elements.author.value = metadata.author; } }); result.append(add); }
    const again = document.createElement('button'); again.type = 'button'; again.className = 'secondary'; again.textContent = 'Scan another book'; again.addEventListener('click', startCheckScanner); result.append(again);
  }
  let cameraOpen = false;
  function setCameraOpen(open, standby = false) {
    cameraOpen = open;
    $('check-camera').hidden = !open && !standby;
    $('check-camera').classList.toggle('camera-standby', standby);
    $('check-camera').inert = standby;
    $('scan-start').setAttribute('aria-expanded', String(open));
  }
  async function closeCheckScanner() {
    checkSequence++; setCameraOpen(false);
    await checkScanner.stop();
  }
  async function startCheckScanner() {
    const scanId = ++checkSequence;
    setCameraOpen(true); $('check-result').hidden = true; $('check-status').textContent = scanGuidance; $('check-preview').classList.remove('recognized'); $('check-preview').classList.add('loading');
    try {
      await checkScanner.start(async value => {
        if (scanId !== checkSequence || $('check-camera').hidden) return;
        $('check-preview').classList.add('recognized');
        await new Promise(resolve => setTimeout(resolve, 500));
        if (scanId !== checkSequence || $('check-camera').hidden) return;
        checkScanner.hold(30000);
        setCameraOpen(false, true); checkIsbn(value);
      }, value => { if (value !== 'Starting camera…') $('check-status').textContent = value; });
      if (scanId === checkSequence) $('check-preview').classList.remove('loading');
    } catch (error) {
      if (scanId === checkSequence && !$('check-camera').hidden) { $('check-preview').classList.remove('loading'); $('check-status').textContent = message(error); }
    }
  }
  $('scan-start').addEventListener('click', () => cameraOpen ? closeCheckScanner() : startCheckScanner());
  $('check-stop').addEventListener('click', closeCheckScanner);
  document.addEventListener?.('visibilitychange', () => {
    if (document.hidden) { checkSequence++; setCameraOpen(false); checkScanner.stop().catch(() => {}); }
  });
  $('check-form').addEventListener('submit', event => { event.preventDefault(); });
  $('check-photo').addEventListener('change', async event => { try { const value = await checkScanner.scanFile(event.target.files[0]); if (value) { await checkScanner.stop(); setCameraOpen(false); checkIsbn(value); } } catch { $('check-status').textContent = 'No barcode found. Try another photo or enter the ISBN manually.'; } });

  $('duplicates-toggle').addEventListener('click', () => { duplicatesMode = true; setMainView('library'); render(); });
  $('all-books').addEventListener('click', () => { duplicatesMode = false; render(); });
  async function assignBookId(book, button) {
    if (busy) return;
    if (!sheetHeaders.includes('updated_at')) { status('Update the library before assigning an ID so the update time can be recorded.'); return; }
    busy = true; button.disabled = true; status('Checking the book before assigning an ID…');
    try {
      const data = await api('/values/' + encodeURIComponent("'Books'!A:ZZ"));
      const rows = data.values || [];
      if (JSON.stringify(rows[0] || []) !== JSON.stringify(sheetHeaders)) throw new Error('The headers changed. Refresh and try again.');
      const matches = [];
      rows.slice(1).forEach((row, index) => {
        const candidate = record(row, sheetHeaders);
        if (!candidate.id && headers.every(key => candidate[key] === book[key])) matches.push(index + 2);
      });
      if (matches.length !== 1) throw new Error(matches.length ? 'More than one matching row has no ID. Make the rows distinct in the Sheet first.' : 'This row changed or already has an ID. Refresh and try again.');
      const id = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      await api('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: [
        { range: "'Books'!" + column(sheetHeaders.indexOf('id')) + matches[0], values: [[id]] },
        { range: "'Books'!" + column(sheetHeaders.indexOf('updated_at')) + matches[0], values: [[timestamp]] }
      ] }) });
      try { await refresh(); status('ID assigned. You can now edit the book.'); }
      catch (error) { status('ID assigned, but refresh failed: ' + message(error)); }
    } catch (error) { status('Could not confirm ID assignment: ' + message(error) + ' Refresh before trying again.'); }
    finally { busy = false; button.disabled = false; }
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
          data: [{ startRow: 0, startColumn: 0, rowData: [{ values: preferredHeaders.map(header => ({ userEnteredValue: { stringValue: header } })) }] }] }]
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
      try { localStorage.setItem(sessionKey, JSON.stringify({ token, expiresAt: Date.now() + Number(response.expires_in) * 1000 })); } catch {}
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
    try { session = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch {}
    if (!session?.token || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now() + 30000) {
      try { localStorage.removeItem(sessionKey); } catch {}
      $('connect').hidden = false; status('Reconnect to your Google Sheet to continue.');
      return;
    }
    token = session.token; sheetId = rememberedSheet;
    let cached = false;
    try {
      const snapshot = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (snapshot?.sheetId === sheetId && Array.isArray(snapshot.books) && snapshot.books.every(book => headers.every(key => typeof book[key] === 'string')) && Number.isFinite(snapshot.updatedAt) && Array.isArray(snapshot.sheetHeaders)) {
        sheetHeaders = readHeaders(snapshot.sheetHeaders); headerFrozen = snapshot.headerFrozen === true; libraryWidth = sheetHeaders.length; $('upgrade-library').hidden = !canEdit || !needsUpdate();
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
    $('new-library-name').value = 'My Library';
    $('new-library-dialog').showModal();
    $('new-library-name').focus(); $('new-library-name').select();
  }
  $('cancel-new-library').addEventListener('click', () => $('new-library-dialog').close());
  $('new-library-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('new-library-name').value.trim();
    if (!name || creatingLibrary) return;
    $('new-library-dialog').close();
    if (token) createLibrary(name).catch(error => status(message(error)));
    else connect('create', name);
  });
  $('new-library').addEventListener('click', requestNewLibrary);
  $('settings-open').addEventListener('click', () => setMainView('settings'));
  $('new-library-connected').addEventListener('click', requestNewLibrary);
  $('disconnect').addEventListener('click', () => { clearSession(); rememberSheet(''); status('Disconnected. No catalog is stored in this tab.'); });
  window.addEventListener('storage', event => {
    if (event.key === sessionKey && !event.newValue && token) { clearSession(); rememberSheet(''); status('Disconnected in another window.'); }
  });
  $('upgrade-library').addEventListener('click', () => {
    if (busy || !libraryWidth || !needsUpdate()) return;
    const labels = { publisher: 'Publisher', publication_year: 'Publication year', shelf_location: 'Shelf location', category: 'Category', description: 'Description', series_name: 'Series name', volume_number: 'Volume number', pages: 'Pages', updated_at: 'Updated at' };
    const list = $('upgrade-columns'); list.replaceChildren();
    missingHeaders().forEach(key => {
      const item = document.createElement('li'); item.textContent = 'Add ' + (labels[key] || key); list.append(item);
    });
    if (!headerFrozen) { const item = document.createElement('li'); item.textContent = 'Freeze the header row.'; list.append(item); }
    if (JSON.stringify(sheetHeaders) !== JSON.stringify(desiredOrder(sheetHeaders)) || missingHeaders().length) { const item = document.createElement('li'); item.textContent = 'Reorder library columns into the standard layout; custom columns follow.'; list.append(item); }
    $('upgrade-dialog').showModal();
  });
  $('cancel-upgrade').addEventListener('click', () => $('upgrade-dialog').close());
  $('confirm-upgrade').addEventListener('click', async () => {
    if (busy || !libraryWidth || !needsUpdate()) return;
    $('upgrade-dialog').close(); busy = true; $('upgrade-library').disabled = true;
    try {
      status('Checking library columns…');
      const [data, metadata] = await Promise.all([
        api('/values/' + encodeURIComponent("'Books'!A:ZZ") + '?valueRenderOption=FORMULA'),
        api('?fields=sheets(properties(sheetId,title,gridProperties(frozenRowCount)))')
      ]);
      const rows = data.values || [], names = readHeaders(rows[0] || []);
      if (JSON.stringify(names) !== JSON.stringify(sheetHeaders)) throw new Error('The headers changed. Refresh before updating.');
      if (names.some(name => !name) || rows.some(row => row.slice(names.length).some(value => value !== ''))) throw new Error('Some columns with data have no header. Give each column a unique name before updating.');
      if (rows.some(row => row.some(value => typeof value === 'string' && value.startsWith('=')))) throw new Error('The Books tab contains formulas. Review their references before changing the columns.');
      const sheet = metadata.sheets?.find(item => item.properties?.title === 'Books');
      if (!sheet) throw new Error('Books tab not found.');
      const id = sheet.properties.sheetId, missing = missingHeaders(), current = [...names, ...missing], requests = [];
      if (missing.length) requests.push({ updateCells: { start: { sheetId: id, rowIndex: 0, columnIndex: names.length }, rows: [{ values: missing.map(value => ({ userEnteredValue: { stringValue: value } })) }], fields: 'userEnteredValue' } });
      desiredOrder(current).forEach((key, target) => {
        const source = current.indexOf(key);
        if (source === target) return;
        requests.push({ moveDimension: { source: { sheetId: id, dimension: 'COLUMNS', startIndex: source, endIndex: source + 1 }, destinationIndex: target } });
        current.splice(target, 0, current.splice(source, 1)[0]);
      });
      requests.push({ updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: Math.max(1, sheet.properties.gridProperties?.frozenRowCount || 0) } }, fields: 'gridProperties.frozenRowCount' } });
      if (requests.length) await api(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
      await refresh(); status('Library updated.');
    } catch (error) { status('Library update failed: ' + message(error)); }
    finally { busy = false; $('upgrade-library').disabled = false; }
  });
  let importRows = [], importReading = 0;
  $('import-open').addEventListener('click', () => {
    importRows = []; $('import-file').value = ''; $('import-status').textContent = 'Select a CSV file.'; $('import-confirm').disabled = true; $('import-dialog').showModal();
  });
  $('import-cancel').addEventListener('click', () => { if (!busy) { importReading++; $('import-dialog').close(); } });
  $('import-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); else importReading++; });
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files[0], request = ++importReading; importRows = []; $('import-confirm').disabled = true;
    if (!file) { $('import-status').textContent = 'Select a CSV file.'; return; }
    if (file.size > 2 * 1024 * 1024) { $('import-status').textContent = 'CSV must be 2 MB or smaller.'; return; }
    try {
      const rows = parseCsv(await file.text()); if (request !== importReading) return;
      const columns = rows.shift()?.map(value => value.trim()) || [];
      if (!columns.includes('title')) throw new Error('CSV must include a title column.');
      if (new Set(columns).size !== columns.length || columns.some(key => !headers.includes(key))) throw new Error('CSV contains duplicate or unrecognized column names.');
      if (rows.length > 1000) throw new Error('Import at most 1,000 books at a time.');
      if (rows.some(row => row.length > columns.length)) throw new Error('A CSV row has more fields than the header.');
      importRows = rows.map(row => Object.fromEntries(columns.map((key, i) => [key, (row[i] || '').trim()])));
      if (!importRows.length || importRows.some(book => !book.title)) throw new Error('Every imported row needs a title.');
      if (importRows.some(book => book.isbn && !normalizeIsbn(book.isbn))) throw new Error('A row has an invalid ISBN. Correct it or leave it blank.');
      $('import-status').textContent = importRows.length + ' books ready to check. Existing matches will be skipped; new IDs are assigned.';
      $('import-confirm').disabled = false;
    } catch (error) { if (request === importReading) $('import-status').textContent = message(error); }
  });
  $('import-confirm').addEventListener('click', async () => {
    if (busy || !importRows.length) return;
    if (missingHeaders().length) { $('import-status').textContent = 'Update the library before importing.'; return; }
    busy = true; $('import-confirm').disabled = true; $('import-cancel').disabled = true; $('import-file').disabled = true;
    try {
      $('import-status').textContent = 'Checking current library…';
      const data = await api('/values/' + encodeURIComponent("'Books'!A:ZZ"));
      const rows = data.values || [];
      if (JSON.stringify(rows[0] || []) !== JSON.stringify(sheetHeaders)) throw new Error('Sheet headers changed. Refresh before importing.');
      const existing = rows.slice(1).map(row => record(row, sheetHeaders));
      const isbns = new Set(existing.map(book => normalizeIsbn(book.isbn)).filter(Boolean));
      const titles = new Set(existing.filter(book => book.title).map(book => (book.title.trim() + '\u0000' + book.author.trim()).toLocaleLowerCase()));
      const timestamp = new Date().toISOString(), additions = [];
      for (const book of importRows) {
        const isbn = book.isbn ? normalizeIsbn(book.isbn) : '';
        const identity = (book.title + '\u0000' + (book.author || '')).toLocaleLowerCase();
        if ((isbn && isbns.has(isbn)) || titles.has(identity)) continue;
        if (isbn) isbns.add(isbn); titles.add(identity);
        const values = { ...book, isbn, id: crypto.randomUUID(), created_at: timestamp, updated_at: timestamp };
        additions.push(sheetHeaders.map(key => values[key] || ''));
      }
      if (!additions.length) { $('import-status').textContent = 'No new books to import; all rows match existing books or earlier rows in the file.'; return; }
      $('import-status').textContent = 'Importing ' + additions.length + ' books…';
      await api('/values/' + encodeURIComponent("'Books'!A:ZZ") + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: additions }) });
      const skipped = importRows.length - additions.length; importRows = [];
      const result = 'Imported ' + additions.length + ' books' + (skipped ? '; skipped ' + skipped + ' matches.' : '.');
      $('import-dialog').close();
      status(result + ' Refreshing catalog…');
      refresh().then(() => status(result)).catch(error => status(result + ' Catalog refresh failed: ' + message(error)));
    } catch (error) { $('import-status').textContent = 'Import failed or could not be confirmed: ' + message(error) + ' Refresh and check the Sheet before retrying.'; }
    finally { busy = false; $('import-confirm').disabled = !importRows.length; $('import-cancel').disabled = false; $('import-file').disabled = false; }
  });
  $('export-csv').addEventListener('click', () => {
    const csv = formatCsv([headers, ...books.map(book => headers.map(key => book[key] || ''))]);
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'library-export.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('refresh').addEventListener('click', () => refresh().catch(error => status(message(error))));
  for (const mode of ['card', 'list']) $('view-' + mode).addEventListener('click', () => {
    viewMode = mode; try { localStorage.setItem('annas-annals-view', mode); } catch {} render();
  });
  $('search').addEventListener('input', render);
  let editMode = false, deleteArmed = false, deleteTimer;
  function resetDelete() {
    deleteArmed = false; clearTimeout(deleteTimer);
    $('delete').textContent = 'Delete book'; $('delete').classList.remove('upgrade-button'); $('delete').classList.add('secondary');
  }
  const editableFields = ['isbn', 'title', 'author', 'publisher', 'publication_year', 'language', 'shelf_location', 'category', 'description', 'series_name', 'volume_number', 'pages', 'notes'];
  function setEditorMode(editable) {
    resetDelete();
    editMode = editable;
    const form = $('book-form');
    for (const key of editableFields) form.elements[key].readOnly = !editable;
    $('editor').classList.toggle('view-mode', !editable);
    $('editor-title').textContent = editingBook ? (editable ? 'Edit book' : 'Book details') : 'Add a book';
    $('lookup-actions').hidden = !editable;
    $('lookup-results').hidden = true;
    $('save').hidden = !editable;
    $('cancel-edit').hidden = !editable || !editingBook;
    $('delete').hidden = !editable || !editingBook?.id;
    $('edit-from-details').hidden = !canEdit || editable || !editingBook?.id;
  }
  function showDetails(book) { openEditor(book, false); }
  $('edit-from-details').addEventListener('click', () => setEditorMode(true));
  $('cancel-edit').addEventListener('click', async () => {
    if (busy || !editingBook) return;
    try { await stopScanner(); } catch {}
    for (const key of editableFields) $('book-form').elements[key].value = editingBook[key] || '';
    $('lookup-suggestions').replaceChildren(); formStatus(''); setEditorMode(false);
  });
  function openEditor(book = null, editable = true) {
    editingBook = book ? { ...book } : null;
    const form = $('book-form'); form.reset();
    for (const key of editableFields) form.elements[key].value = book?.[key] || '';
    $('lookup-suggestions').replaceChildren(); formStatus('');
    setEditorMode(editable); $('editor').showModal();
  }
  $('add').addEventListener('click', () => openEditor());
  async function findUnchangedBook(original) {
    const data = await api('/values/' + encodeURIComponent("'Books'!A:ZZ"));
    const rows = data.values || [];
    if (JSON.stringify(rows[0] || []) !== JSON.stringify(sheetHeaders)) throw new Error('The Books headers changed. Refresh and check the Sheet before continuing.');
    const matches = [];
    rows.slice(1).forEach((row, index) => { if (String(row[sheetHeaders.indexOf('id')] ?? '') === original.id) matches.push({ row, number: index + 2 }); });
    if (matches.length !== 1) throw new Error(matches.length ? 'This book ID appears more than once in the Sheet. Resolve the duplicates before editing.' : 'This book was removed or its ID changed. Close this window and refresh the catalog.');
    const current = headers.map(key => record(matches[0].row, sheetHeaders)[key]);
    if (current.some((value, index) => value !== String(original[headers[index]] ?? ''))) throw new Error('This book changed in the Sheet since you opened it. Your changes were not saved. Close this window, refresh, and review the latest version.');
    return matches[0].number;
  }
  async function finishChange(label) {
    $('editor').close(); status(label + ' Refreshing catalog…');
    try { await refresh(); } catch (error) { status(label + ' Refresh failed: ' + message(error)); }
  }
  $('delete').addEventListener('click', async () => {
    if (busy || !editingBook) return;
    if (!deleteArmed) {
      deleteArmed = true; $('delete').textContent = 'Confirm delete';
      $('delete').classList.remove('secondary'); $('delete').classList.add('upgrade-button');
      formStatus('Click Confirm delete to remove this book.');
      deleteTimer = setTimeout(() => { resetDelete(); formStatus(''); }, 5000);
      return;
    }
    resetDelete();
    busy = true; $('save').disabled = true; $('delete').disabled = true; formStatus('Checking for changes…');
    try {
      const rowNumber = await findUnchangedBook(editingBook);
      await api('/values:batchClear', { method: 'POST', body: JSON.stringify({ ranges: headers.filter(key => sheetHeaders.includes(key)).map(key => "'Books'!" + column(sheetHeaders.indexOf(key)) + rowNumber) }) });
      await finishChange('Book deleted.');
    } catch (error) { formStatus(message(error)); }
    finally { busy = false; $('save').disabled = false; $('delete').disabled = false; }
  });
  let editorScanSequence = 0;
  async function stopScanner() { editorScanSequence++; await scanner.stop(); $('scan-area').hidden = true; }
  $('close-editor').addEventListener('click', async () => { resetDelete(); await stopScanner(); $('editor').close(); });
  $('editor').addEventListener('cancel', () => { editorScanSequence++; resetDelete(); scanner.stop().catch(() => {}); $('scan-area').hidden = true; });
  $('scan').addEventListener('click', async () => {
    const scanId = ++editorScanSequence;
    $('scan-area').hidden = false; $('scan-status').textContent = scanGuidance; $('editor-preview').classList.remove('recognized'); $('editor-preview').classList.add('loading');
    try {
      await scanner.start(async text => {
        if (scanId !== editorScanSequence || $('scan-area').hidden) return;
        $('editor-preview').classList.add('recognized');
        await new Promise(resolve => setTimeout(resolve, 500));
        if (scanId !== editorScanSequence || $('scan-area').hidden) return;
        $('book-form').elements.isbn.value = text;
        await stopScanner(); formStatus('Barcode captured. Look up the ISBN or enter the details.');
      }, text => { if (text !== 'Starting camera…') $('scan-status').textContent = text; });
      if (scanId === editorScanSequence) $('editor-preview').classList.remove('loading');
    } catch (error) { if (scanId === editorScanSequence && !$('scan-area').hidden) { $('editor-preview').classList.remove('loading'); $('scan-status').textContent = message(error); } }
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
    event.preventDefault(); if (busy || !editMode) return;
    if (missingHeaders().length) { formStatus('Update the library before saving book details. Close this window and choose Update library.'); return; }
    const form = event.currentTarget, enteredIsbn = form.elements.isbn.value.trim();
    const isbn = normalizeIsbn(enteredIsbn);
    if (enteredIsbn && !isbn) { formStatus('Enter a valid ISBN-10 or ISBN-13, or leave it blank.'); return; }
    if (isbn) form.elements.isbn.value = isbn;
    if (isbn && books.some(book => book.id !== editingBook?.id && normalizeIsbn(book.isbn) === isbn)) { formStatus('This ISBN is already in the catalog.'); return; }
    busy = true; $('save').disabled = true; $('delete').disabled = true; formStatus('Saving…');
    try {
      const row = [editingBook?.id || crypto.randomUUID(), isbn, form.elements.title.value.trim(), form.elements.author.value.trim(), form.elements.language.value.trim(), form.elements.notes.value.trim(), editingBook?.created_at || new Date().toISOString(), form.elements.publisher.value.trim(), form.elements.publication_year.value.trim(), form.elements.shelf_location.value.trim(), form.elements.category.value.trim(), form.elements.description.value.trim(), form.elements.series_name.value.trim(), form.elements.volume_number.value.trim(), form.elements.pages.value.trim(), new Date().toISOString()];
      if (!row[2]) throw new Error('Enter a title.');
      const valuesByHeader = Object.fromEntries(headers.map((key, index) => [key, row[index]]));
      if (editingBook) {
        const rowNumber = await findUnchangedBook(editingBook);
        await api('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: headers.map(key => ({ range: "'Books'!" + column(sheetHeaders.indexOf(key)) + rowNumber, values: [[valuesByHeader[key]]] })) }) });
      } else {
        await api('/values/' + encodeURIComponent("'Books'!A:ZZ") + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: [sheetHeaders.map(key => valuesByHeader[key] || '')] }) });
        checkSequence++; $('check-result').hidden = true; $('check-result').replaceChildren();
        $('scan-search').value = ''; $('search').value = ''; sortField = ''; duplicatesMode = false;
        books.unshift(valuesByHeader); render();
      }
      await finishChange('Book saved.');
    } catch (error) { formStatus('Save failed or could not be confirmed. Refresh the catalog before retrying: ' + message(error)); }
    finally { busy = false; $('save').disabled = false; $('delete').disabled = false; }
  });
})();
