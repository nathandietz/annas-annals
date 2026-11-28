'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const cloneTemplate = name => $(name + '-template').content.cloneNode(true);
  const searchBars = [
    ['library-search', 'search', 'add', 'library-search-clear'],
    ['check-search', 'scan-search', 'check-add', 'check-search-clear']
  ];
  for (const [container, inputId, buttonId, clearId] of searchBars) {
    const controls = cloneTemplate('catalog-search');
    controls.querySelector('input').id = inputId;
    controls.querySelector('.catalog-add').id = buttonId;
    controls.querySelector('.search-clear').id = clearId;
    $(container).append(controls);
  }
  const searchInputs = searchBars.map(([, inputId]) => $(inputId));
  const addBookButtons = searchBars.map(([, , buttonId]) => $(buttonId));
  const clearSearchButtons = searchBars.map(([, , , clearId]) => $(clearId));
  let lastLibrarySearch = '';
  function setSearchText(value) {
    for (const input of searchInputs) {
      if (input.value !== value) input.value = value;
    }
    for (const button of clearSearchButtons) button.hidden = !value;
  }
  const config = window.LIBRARY_CONFIG;
  const appName = 'Anna’s Annals';
  window.addEventListener('load', () => {
    window.navigator?.serviceWorker?.register('service-worker.js').catch(() => {});
  });
  const scrollTopButton = $('scroll-top');
  window.addEventListener('scroll', () => {
    const hidden = window.scrollY < 300;
    if (scrollTopButton.hidden !== hidden) scrollTopButton.hidden = hidden;
  }, { passive: true });
  scrollTopButton.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
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
  const editAccessKey = 'annas-annals-edit-access';
  let token = '', sheetId = '', books = [], pickerReady = false, busy = false, creatingLibrary = false, libraryWidth = 16;
  let rememberedSheet = '', editingBook = null, viewMode = 'card', duplicatesMode = false, sortField = '', sortDirection = 1;
  let connectionAttempt = 0;
  let sessionExpiresAt, sessionExpiryTimer;
  const expiredSessionMessage = 'Google authorization expired. Reconnect to your library.';
  const fallbackCoverStorageKey = 'annas-annals-show-fallback-covers';
  let showFallbackCovers = true;
  try { showFallbackCovers = localStorage.getItem(fallbackCoverStorageKey) !== 'false'; } catch {}
  $('show-fallback-covers').checked = showFallbackCovers;
  try { const savedView = localStorage.getItem('annas-annals-view'); if (['card', 'list'].includes(savedView)) viewMode = savedView; } catch {}
  try { rememberedSheet = localStorage.getItem(storageKey) || ''; } catch {}
  const scanner = createLibraryScanner();
  const checkScanner = createLibraryScanner('check-qr-reader');
  const scanGuidance = 'Keep the entire barcode in view, including blank space at both ends. Hold steady in good light.';
  $('check-guidance').textContent = scanGuidance;
  const compactLayout = window.matchMedia?.('(max-width: 700px)');
  let mainView = compactLayout?.matches ? 'scan' : 'library', libraryConnected = false, canEdit = false, checkSequence = 0;
  let showEditingTools = false;
  try { const savedMainView = localStorage.getItem('annas-annals-main-view'); if (['scan', 'library', 'settings'].includes(savedMainView)) mainView = savedMainView; } catch {}
  let pendingHeaderUpdate;
  const headerStatus = $('status');
  const catalogUpdateTime = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true
  });
  const status = (message, refreshing = false) => {
    if (message && !token) return;
    pendingHeaderUpdate = undefined;
    headerStatus.classList.toggle('is-refreshing', refreshing);
    headerStatus.textContent = message;
  };
  function connectionStatus(message) {
    if (libraryConnected) {
      status(message);
      return;
    }
    const feedback = $({ library: 'connect-status', scan: 'check-status', settings: 'settings-connect-status' }[mainView]);
    feedback.textContent = message;
    feedback.hidden = false;
  }
  function updateLibraryCount() {
    const count = $('library-count');
    count.textContent = books.length.toLocaleString('en-US') + (books.length === 1 ? ' Book' : ' Books');
    count.hidden = false;
  }
  function isCatalogRefreshing() {
    return !pendingHeaderUpdate && headerStatus.classList.contains('is-refreshing');
  }
  const formStatus = message => { $('form-status').textContent = message; };
  function message(error) { return error?.message || 'Something went wrong. Please try again.'; }
  function updateConnect() {
    const button = $('signin');
    button.textContent = rememberedSheet ? 'Reconnect to Google Sheet' : 'Connect Google Sheet';
    $('choose-sheet').hidden = !libraryConnected && !rememberedSheet;
  }
  function rememberSheet(id) {
    rememberedSheet = id;
    try { if (id) localStorage.setItem(storageKey, id); else localStorage.removeItem(storageKey); } catch {}
    updateConnect();
  }
  function setLibraryLinkLabel(title) {
    const link = $('library-link');
    const name = typeof title === 'string' ? title.trim() : '';
    link.textContent = name || appName;
    link.title = name
      ? 'Open “' + name + '” in Google Sheets (opens in a new tab)'
      : 'Open the library in Google Sheets (opens in a new tab)';
  }
  function setLibraryConnected(connected) {
    libraryConnected = connected;
    $('connect').hidden = connected;
    updateConnect();
    for (const id of ['header-meta', 'view-switcher', 'catalog-content']) {
      $(id).hidden = !connected;
    }
    for (const id of ['duplicates-toggle', 'export-csv', 'disconnect']) {
      $(id).disabled = !connected;
    }
    for (const input of searchInputs) input.disabled = !connected;
    const sort = $('library-sort');
    sort.disabled = !connected;
    for (const id of ['check-isbn-open', 'check-isbn', 'check-photo-open', 'check-photo']) {
      $(id).disabled = !connected;
    }
    updateScanButton();
    if (!connected) {
      $('import-open').disabled = true;
      $('upgrade-library').disabled = true;
      updateEditingToolVisibility();
      sort.value = '';
      for (const add of addBookButtons) {
        add.classList.remove('awaiting-edit-access');
        add.hidden = false;
        add.disabled = true;
      }
    }
  }
  function showDisconnectedLibrary() {
    setLibraryConnected(false);
    setMainView('library');
  }
  function showLibrary() {
    setLibraryConnected(true);
    checkPermission();
    const link = $('library-link');
    link.href = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(sheetId) + '/edit';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    $('connect-status').hidden = true;
    $('settings-connect-status').hidden = true;
    $('check-status').textContent = '';
    setMainView(mainView);
  }
  updateConnect();
  function clearSession(removeSavedSession = true) {
    connectionAttempt++;
    canEdit = false;
    clearTimeout(sessionExpiryTimer);
    sessionExpiresAt = undefined;
    try { if (removeSavedSession) localStorage.removeItem(sessionKey); } catch {}
    try { sessionStorage.removeItem(cacheKey); sessionStorage.removeItem(editAccessKey); } catch {}
    token = '';
    sheetId = '';
    books = [];
    duplicatesMode = false;
    setSearchText('');
    $('check-isbn').value = '';
    $('all-books').hidden = true;
    $('library-count').hidden = true;
    status('');
    $('connect-status').hidden = true;
    const link = $('library-link');
    link.textContent = 'No Connected Library';
    link.setAttribute('href', '#connect');
    for (const attribute of ['target', 'rel', 'title']) link.removeAttribute(attribute);
    $('books').replaceChildren();
    importReading++;
    for (const id of ['editor', 'import-dialog', 'upgrade-dialog', 'new-library-dialog']) {
      const dialog = $(id);
      if (dialog.open) dialog.close();
    }
    showDisconnectedLibrary();
    window.scrollTo?.(0, 0);
  }
  function readSavedSession() {
    try { return JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch {}
  }
  function expireSession(accessToken) {
    if (!token || token !== accessToken) return;
    clearSession(readSavedSession()?.token === accessToken);
    connectionStatus(expiredSessionMessage);
  }
  function checkSessionExpiry() {
    if (token && Date.now() >= sessionExpiresAt) expireSession(token);
  }
  function activateSession(session) {
    clearTimeout(sessionExpiryTimer);
    token = session.token;
    sessionExpiresAt = session.expiresAt;
    if (Number.isFinite(sessionExpiresAt)) {
      sessionExpiryTimer = setTimeout(checkSessionExpiry, Math.max(0, sessionExpiresAt - Date.now()));
    }
  }
  window.addEventListener('pageshow', checkSessionExpiry);
  async function api(path, options = {}, { id = sheetId, accessToken = token } = {}) {
    const usesActiveSession = accessToken === token;
    if (usesActiveSession) checkSessionExpiry();
    if (!accessToken || (usesActiveSession && accessToken !== token)) throw new Error(expiredSessionMessage);
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id) + path, {
      ...options, headers: { Authorization: 'Bearer ' + accessToken, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    if (response.status === 401) expireSession(accessToken);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(response.status === 401 ? expiredSessionMessage : (data.error?.message || 'Google Sheets request failed.')); error.status = response.status; throw error; }
    if (usesActiveSession && accessToken !== token) throw new Error(expiredSessionMessage);
    return data;
  }
  async function loadCatalog(target) {
    const [data, spreadsheet] = await Promise.all([
      api('/values/' + encodeURIComponent("'Books'!A:ZZ"), undefined, target),
      api('?fields=properties(title),sheets(properties(title,gridProperties(frozenRowCount)))', undefined, target)
    ]);
    const rows = data.values || [];
    const catalogHeaders = readHeaders(rows[0] || []);
    return {
      headers: catalogHeaders,
      headerFrozen: (spreadsheet.sheets?.find(item => item.properties?.title === 'Books')?.properties?.gridProperties?.frozenRowCount || 0) >= 1,
      books: rows.slice(1).map(row => record(row, catalogHeaders)).filter(book => book.title).sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)),
      title: spreadsheet.properties?.title
    };
  }
  function applyCatalog(catalog, updatedAt) {
    sheetHeaders = catalog.headers;
    libraryWidth = sheetHeaders.length;
    headerFrozen = catalog.headerFrozen;
    books = catalog.books;
    setLibraryLinkLabel(catalog.title);
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ sheetId, title: catalog.title, books, updatedAt, sheetHeaders, headerFrozen })); } catch {}
    updateEditingToolVisibility();
    updateLibraryCount();
    render();
  }
  function showCatalogUpdated(updatedAt) {
    status('Updated at ' + catalogUpdateTime.format(updatedAt).toLowerCase());
  }
  async function refresh({ minimumIndicatorTime = 1000, finishIndicatorInBackground = false } = {}) {
    status('Refreshing', true);
    const minimumRefreshTime = minimumIndicatorTime
      ? new Promise(resolve => setTimeout(resolve, minimumIndicatorTime))
      : undefined;
    const refreshSheet = sheetId, refreshToken = token;
    const catalog = await loadCatalog().finally(() =>
      finishIndicatorInBackground || token !== refreshToken ? undefined : minimumRefreshTime);
    if (sheetId !== refreshSheet || token !== refreshToken) return;
    const updatedAt = Date.now();
    applyCatalog(catalog, updatedAt);
    if (finishIndicatorInBackground && minimumRefreshTime) {
      pendingHeaderUpdate = minimumRefreshTime;
      minimumRefreshTime.then(() => {
        if (pendingHeaderUpdate !== minimumRefreshTime) return;
        pendingHeaderUpdate = undefined;
        showCatalogUpdated(updatedAt);
      });
    } else {
      showCatalogUpdated(updatedAt);
    }
  }
  if (window.navigator?.standalone || window.matchMedia?.('(display-mode: standalone)')?.matches) {
    enablePullToRefresh();
  }
  function enablePullToRefresh() {
    const page = $('app-page');
    const indicator = $('pull-refresh');
    const spokes = $('pull-refresh-spokes').children;
    const revealStart = 48, refreshThreshold = 144;
    let origin, distance = 0, refreshing = false, hasPulsed = false;
    page.classList.add('has-pull-refresh');

    function resetPull() {
      origin = undefined;
      distance = 0;
      hasPulsed = false;
      page.classList.remove('is-pulling');
      if (!refreshing) {
        page.style.setProperty('--pull-distance', '0px');
        indicator.classList.remove('is-armed');
        indicator.hidden = true;
      }
    }

    window.addEventListener('touchstart', event => {
      resetPull();
      if (!sheetId || busy || refreshing || isCatalogRefreshing() ||
          window.scrollY > 0 || event.touches.length !== 1 ||
          event.target.closest?.('dialog, input, textarea, select, [contenteditable], .mode-toggle')) return;
      origin = event.touches[0];
    }, { passive: true });

    window.addEventListener('touchmove', event => {
      if (!origin) return;
      const touch = event.touches[0];
      if (!event.cancelable || event.touches.length !== 1 || touch.identifier !== origin.identifier || window.scrollY > 0) {
        resetPull();
        return;
      }
      const down = touch.clientY - origin.clientY;
      const across = Math.abs(touch.clientX - origin.clientX);
      if (!distance && Math.max(Math.abs(down), across) < 8) return;
      if (!distance && down <= across) {
        resetPull();
        return;
      }
      event.preventDefault();
      const resistance = Math.max(0, down) * 0.55;
      const height = window.innerHeight;
      distance = height * resistance / (height + resistance);
      page.classList.add('is-pulling');
      page.style.setProperty('--pull-distance', distance + 'px');
      indicator.hidden = distance <= revealStart;
      const armed = distance >= refreshThreshold;
      indicator.classList.toggle('is-armed', armed);
      if (armed && !hasPulsed) {
        hasPulsed = true;
        window.navigator?.vibrate?.(12);
      }
      const progress = (distance - revealStart) / (refreshThreshold - revealStart);
      for (let index = 0; index < spokes.length; index++) {
        const opacity = Math.max(0, Math.min(1, progress * spokes.length - index));
        spokes[index].style.setProperty('--spoke-opacity', opacity);
      }
    }, { passive: false });

    window.addEventListener('touchend', async event => {
      if (!origin || event.changedTouches[0]?.identifier !== origin.identifier) return;
      if (distance < refreshThreshold || !sheetId || busy || isCatalogRefreshing()) {
        resetPull();
        return;
      }
      refreshing = true;
      resetPull();
      page.style.setProperty('--pull-distance', '0px');
      indicator.classList.add('is-refreshing');
      const spinnerExit = indicator.getAnimations?.()[0]?.finished;
      try {
        await refresh({ finishIndicatorInBackground: true });
      } catch (error) {
        if (sheetId) status('Catalog refresh failed: ' + message(error));
      } finally {
        await spinnerExit?.catch(() => {});
        indicator.classList.remove('is-refreshing');
        refreshing = false;
        resetPull();
      }
    }, { passive: true });
    window.addEventListener('touchcancel', resetPull, { passive: true });
  }
  function catalogSearch(query) {
    const isbnQuery = query.replace(/[\s-]/g, '');
    return book => [book.title, book.author, book.isbn, book.shelf_location, book.category, book.series_name, book.description]
      .some(value => value.toLocaleLowerCase().includes(query))
      || Boolean(isbnQuery && book.isbn.toLocaleLowerCase().replace(/[\s-]/g, '').includes(isbnQuery));
  }
  function render() {
    $('duplicates-toggle').setAttribute('aria-pressed', String(duplicatesMode));
    $('all-books').hidden = !duplicatesMode;
    const duplicateReasons = new Map();
    if (duplicatesMode) for (const group of findDuplicateGroups(books, normalizeIsbn)) for (const book of group.books) {
      if (!duplicateReasons.has(book)) duplicateReasons.set(book, []);
      duplicateReasons.get(book).push(group.reason);
    }
    lastLibrarySearch = $('search').value;
    const query = lastLibrarySearch.trim().toLocaleLowerCase();
    const matchesSearch = catalogSearch(query);
    const filtered = books.filter(book => (!duplicatesMode || duplicateReasons.has(book)) && matchesSearch(book));
    const compact = compactLayout?.matches;
    const layout = compact ? 'card' : viewMode;
    const field = compact ? $('library-sort').value : layout === 'list' ? sortField : '';
    if (field) filtered.sort((a, b) => {
      const left = a[field].trim(), right = b[field].trim();
      if (!left || !right) return left ? -1 : right ? 1 : 0;
      return (compact ? 1 : sortDirection) * left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
    });
    const container = $('books'); container.replaceChildren(); container.className = 'books view-' + layout;
    for (const mode of ['card', 'list']) $('view-' + mode).setAttribute('aria-pressed', String(viewMode === mode));
    const list = layout === 'list';
    let entries = container;
    if (list) {
      const table = cloneTemplate('catalog-table').firstElementChild;
      for (const cell of table.querySelectorAll('[data-sort]')) {
        const field = cell.getAttribute('data-sort');
        const button = cell.querySelector('button');
        const label = button.querySelector('[data-sort-label]').textContent;
        const active = sortField === field;
        if (active) {
          const direction = sortDirection === 1 ? 'ascending' : 'descending';
          cell.setAttribute('aria-sort', direction);
          button.querySelector('.sort-indicator').classList.add(direction);
        }
        button.setAttribute('aria-label', 'Sort by ' + label + (active && sortDirection === 1 ? ', descending' : ', ascending'));
        button.addEventListener('click', () => {
          sortDirection = sortField === field ? -sortDirection : 1;
          sortField = field;
          render();
        });
      }
      entries = table.querySelector('tbody');
      container.append(table);
    }
    for (const book of filtered) {
      const entry = cloneTemplate(list ? 'book-row' : 'book-card').firstElementChild;
      entry.querySelector('.book-cover').hidden = !showFallbackCovers;
      entry.addEventListener('click', () => showDetails(book));
      const title = entry.querySelector('.book-title-button');
      title.textContent = book.title;
      if (!list) entry.querySelector('h3').hidden = !book.title;
      title.addEventListener('click', event => {
        event.stopPropagation();
        showDetails(book);
      });
      const series = [book.series_name, book.volume_number ? 'Vol. ' + book.volume_number : ''].filter(Boolean).join(' · ');
      for (const slot of entry.querySelectorAll('[data-book]')) {
        const field = slot.getAttribute('data-book');
        const value = field === 'series' ? series : book[field];
        slot.textContent = value || (list ? '—' : '');
        slot.hidden = !list && !value;
      }
      const reason = entry.querySelector('.duplicate-reason');
      reason.hidden = !duplicatesMode;
      if (duplicatesMode) reason.textContent = duplicateReasons.get(book).join(' · ');

      const edit = entry.querySelector('[data-edit-book]');
      edit.hidden = !canEdit;
      edit.setAttribute('aria-label', (book.id ? 'Edit ' : 'Assign ID to ') + book.title);
      if (!book.id) {
        edit.textContent = 'Assign ID';
        edit.classList.remove('icon-button');
        if (list) edit.title = 'Assign ID';
        else entry.querySelector('.hint').hidden = false;
      }
      edit.addEventListener('click', event => {
        event.stopPropagation();
        if (book.id) openEditor(book);
        else assignBookId(book, edit);
      });
      entries.append(entry);
    }
    const empty = $('library-empty');
    empty.hidden = filtered.length > 0;
    empty.textContent = query ? 'No books match your search. Try a different title, author, or keyword.' : duplicatesMode ? 'No duplicates found.' : 'Your library is empty.';
    renderScanBooks();
  }

  $('show-fallback-covers').addEventListener('change', () => {
    showFallbackCovers = $('show-fallback-covers').checked;
    try { localStorage.setItem(fallbackCoverStorageKey, String(showFallbackCovers)); } catch {}
    if ($('editor').open) updateBookCover();
    render();
  });
  $('update-app').addEventListener('click', async () => {
    const button = $('update-app'), feedback = $('update-app-status');
    button.disabled = true;
    feedback.hidden = false;
    feedback.textContent = 'Checking for updates…';
    try {
      const registration = await window.navigator?.serviceWorker?.getRegistration();
      if (registration) await registration.update();
      const url = new URL(window.location.href);
      url.searchParams.set('_update', String(Date.now()));
      feedback.textContent = 'Reloading app…';
      window.location.replace(url.href);
    } catch {
      feedback.textContent = 'Could not check for updates. Check your connection and try again.';
      button.disabled = false;
    }
  });
  function updateEditingToolVisibility() {
    $('import-open').hidden = libraryConnected && !showEditingTools;
    $('upgrade-library').hidden = libraryConnected && (!showEditingTools || !needsUpdate());
  }
  async function checkPermission() {
    const currentSheet = sheetId, currentToken = token;
    let cachedAccess;
    try {
      const saved = JSON.parse(sessionStorage.getItem(editAccessKey) || 'null');
      if (saved?.sheetId === currentSheet && typeof saved.canEdit === 'boolean') cachedAccess = saved.canEdit;
    } catch {}
    // Keep the saved layout while Drive verifies editing access for this session.
    canEdit = false;
    for (const add of addBookButtons) {
      add.disabled = true;
      add.hidden = cachedAccess === false;
      add.classList.toggle('awaiting-edit-access', cachedAccess === undefined);
    }
    updateCheckActions();
    $('import-open').disabled = true;
    $('upgrade-library').disabled = true;
    showEditingTools = cachedAccess !== false;
    updateEditingToolVisibility();
    try {
      const response = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(currentSheet) + '?fields=capabilities(canEdit)', { headers: { Authorization: 'Bearer ' + currentToken } });
      if (response.status === 401) expireSession(currentToken);
      const data = await response.json();
      if (sheetId !== currentSheet || token !== currentToken) return;
      const access = data.capabilities?.canEdit;
      canEdit = response.ok && access === true;
      if (response.ok && typeof access === 'boolean') {
        showEditingTools = access;
        try { sessionStorage.setItem(editAccessKey, JSON.stringify({ sheetId: currentSheet, canEdit })); } catch {}
      }
      updateCheckActions();
      updateEditingToolVisibility();
      render();
    } catch {
      if (sheetId === currentSheet && token === currentToken) status('Could not check editing access. You can still browse and scan.');
    } finally {
      if (sheetId === currentSheet && token === currentToken) {
        $('import-open').disabled = !canEdit;
        $('upgrade-library').disabled = !canEdit;
        for (const add of addBookButtons) {
          add.classList.remove('awaiting-edit-access');
          add.hidden = !canEdit;
          add.disabled = !canEdit;
        }
      }
    }
  }
  function setMainView(view) {
    const previousView = mainView;
    mainView = view;
    try { localStorage.setItem('annas-annals-main-view', view); } catch {}
    $('scan-view').hidden = view !== 'scan';
    $('library').hidden = view !== 'library';
    $('settings-dialog').hidden = view !== 'settings';
    for (const name of ['scan', 'library', 'settings']) $(name === 'settings' ? 'settings-open' : 'mode-' + name).setAttribute('aria-pressed', String(name === view));
    if (view !== 'scan') {
      resetOwnershipCheck();
      checkScanner.stop?.().catch(() => {});
    }
    if (libraryConnected && view === 'library' && lastLibrarySearch !== $('search').value) render();
    if (view !== previousView) window.scrollTo?.(0, 0);
  }
  $('mode-scan').addEventListener('click', () => setMainView('scan'));
  $('mode-library').addEventListener('click', () => setMainView('library'));
  function renderScanBooks() {
    const container = $('scan-books'); container.replaceChildren();
    const query = $('scan-search').value.trim().toLocaleLowerCase();
    container.hidden = !query;
    $('scan-count').hidden = !query;
    if (!query) {
      $('scan-count').textContent = '';
      return;
    }
    const filtered = books.filter(catalogSearch(query));
    $('scan-count').textContent = filtered.length
      ? filtered.length + (filtered.length === 1 ? ' book found' : ' books found')
      : 'No books match your search. Try a different title or author.';
    for (const book of filtered) {
      const button = cloneTemplate('scan-book').firstElementChild;
      button.querySelector('.book-cover').hidden = !showFallbackCovers;
      button.querySelector('strong').textContent = book.title;
      button.querySelector('[data-book="author"]').textContent = book.author || 'Unknown author';
      button.addEventListener('click', () => showDetails(book));
      container.append(button);
    }
  }
  let scanSearchTimer, cameraOpen = false, resultActions;
  function showCheckResult(show) {
    $('check-home').hidden = show;
    $('check-back').hidden = !show;
    $('scan-controls').hidden = show;
    $('check-result').hidden = !show;
    if (show) $('scan-count').hidden = true;
  }
  function showIsbnForm(show) {
    $('check-isbn-form').hidden = !show;
    $('check-isbn-open').setAttribute('aria-expanded', String(show));
    $('check-isbn-error').textContent = '';
    if (show) $('check-isbn').focus();
  }
  function resetOwnershipCheck() {
    checkSequence++;
    clearTimeout(scanSearchTimer);
    setCameraOpen(false);
    showCheckResult(false);
    showIsbnForm(false);
    $('check-result').replaceChildren();
    resultActions = undefined;
    $('check-announcement').textContent = '';
    $('check-photo-status').textContent = '';
    renderScanBooks();
  }
  function returnToCheck() {
    setSearchText('');
    $('check-isbn').value = '';
    resetOwnershipCheck();
    window.scrollTo?.(0, 0);
  }
  $('check-back').addEventListener('click', () => {
    returnToCheck();
    checkScanner.stop().catch(() => {});
    $('scan-start').focus();
  });
  $('check-isbn-open').addEventListener('click', async () => {
    clearTimeout(scanSearchTimer);
    const sequence = await closeCheckScanner();
    if (sequence === checkSequence && mainView === 'scan') showIsbnForm(true);
  });
  $('check-isbn-cancel').addEventListener('click', () => {
    showIsbnForm(false);
    $('check-isbn-open').focus();
  });
  $('check-isbn-form').addEventListener('submit', async event => {
    event.preventDefault();
    const isbn = normalizeIsbn($('check-isbn').value);
    if (!isbn) {
      $('check-isbn-error').textContent = 'Enter a valid ISBN-10 or ISBN-13.';
      $('check-isbn').focus();
      return;
    }
    clearTimeout(scanSearchTimer);
    const sequence = await closeCheckScanner();
    if (sequence === checkSequence && mainView === 'scan') checkIsbn(isbn);
  });
  function updateSearch(inputId, value) {
    setSearchText(value);
    if (inputId === 'search') { render(); return; }
    const sequence = ++checkSequence;
    clearTimeout(scanSearchTimer);
    if (cameraOpen) {
      setCameraOpen(false);
      checkScanner.stop().catch(() => {});
    }
    showCheckResult(false);
    renderScanBooks();
    const query = value.trim();
    if (normalizeIsbn(query)) scanSearchTimer = setTimeout(async () => {
      await checkScanner.stop();
      if (sequence !== checkSequence || mainView !== 'scan') return;
      setCameraOpen(false);
      checkIsbn(query);
    }, 400);
  }
  for (const [, inputId, , clearId] of searchBars) {
    const input = $(inputId);
    input.addEventListener('input', () => updateSearch(inputId, input.value));
    $(clearId).addEventListener('click', () => {
      updateSearch(inputId, '');
      input.focus?.();
    });
  }
  let editorGeneration = 0;
  function fillEmptyBookFields(values, generation, isbn) {
    const form = $('book-form');
    if (generation !== editorGeneration || !$('editor').open || normalizeIsbn(form.elements.isbn.value) !== isbn) return;
    for (const [key, value] of Object.entries(values)) if (value && form.elements[key] && !form.elements[key].value.trim()) form.elements[key].value = value;
    updateBookSaveButton();
  }
  function showOwnedEditions(result, matchingBooks) {
    if (!matchingBooks.length) return;
    const editions = cloneTemplate('owned-editions').firstElementChild;
    editions.querySelector('h3').textContent = matchingBooks.length === 1 ? 'Edition you own' : 'Editions you own';
    for (const book of matchingBooks) {
      const edition = cloneTemplate('owned-edition').firstElementChild;
      const link = edition.querySelector('.owned-book');
      link.addEventListener('click', () => showDetails(book));
      link.querySelector('.book-cover').hidden = !showFallbackCovers;
      link.querySelector('strong').textContent = book.title;
      const author = link.querySelector('[data-book="author"]');
      author.textContent = book.author;
      author.hidden = !book.author;
      const metadata = link.querySelector('[data-book="edition"]');
      metadata.textContent = [book.publisher, book.publication_year, book.isbn && 'ISBN ' + book.isbn].filter(Boolean).join(' · ');
      metadata.hidden = !metadata.textContent;
      edition.querySelector('.owned-shelf').textContent = book.shelf_location.trim() || 'Shelf location not recorded';
      editions.append(edition);
    }
    result.append(editions);
  }

  async function checkIsbn(value) {
    if (!libraryConnected) return;
    const sequence = ++checkSequence;
    const isbn = normalizeIsbn(value);
    const result = $('check-result');
    const [heading, detail, scanned] = cloneTemplate('check-result').children;
    result.setAttribute('aria-labelledby', heading.id);
    resultActions = undefined;
    result.replaceChildren(heading, detail, scanned);
    showIsbnForm(false);
    showCheckResult(true);
    window.scrollTo?.(0, 0);
    if (!isbn) {
      heading.textContent = 'Invalid ISBN';
      detail.textContent = 'Enter a valid ISBN-10 or ISBN-13.';
      heading.focus?.();
      return;
    }

    let match = matchBook(isbn, null, books), metadata = null, bookData = null;
    if (match.kind !== 'exact') {
      heading.textContent = 'Checking your library…';
      detail.textContent = 'Looking up the title and author.';
      heading.focus?.();
      try {
        ({metadata, bookData} = await bookLookup.lookupBookMetadata(isbn));
        match = matchBook(isbn, metadata, books);
      } catch { match = { kind: 'unknown', books: [] }; }
    }
    if (sequence !== checkSequence || mainView !== 'scan') return;
    heading.textContent = { exact: 'In your library', possible: 'Possible match', none: 'No match in your library', unknown: 'Couldn’t verify' }[match.kind];
    detail.textContent = {
      exact: 'The ISBN matches an edition you own.',
      possible: 'The title and author match a book in your library.',
      none: [metadata?.title, metadata?.author].filter(Boolean).join(' · '),
      unknown: 'Try searching by title or author to check your library.'
    }[match.kind];
    scanned.textContent = 'Scanned ISBN ' + isbn;
    scanned.hidden = false;
    showOwnedEditions(result, match.books);

    const actions = cloneTemplate('check-actions').firstElementChild;
    const add = match.kind === 'exact' ? undefined : actions.querySelector('[data-add-edition]');
    if (add) {
      add.textContent = match.kind === 'possible' ? 'Add this edition anyway' : 'Add book';
      add.addEventListener('click', () => {
        if (!canEdit) return;
        openEditor();
        const form = $('book-form');
        form.elements.isbn.value = isbn;
        if (metadata) for (const [key, value] of Object.entries(metadata)) if (value) form.elements[key].value = value;
        updateBookSaveButton();
        if (bookData) {
          const generation = editorGeneration;
          bookLookup.lookupOpenLibraryDetails(bookData, values => fillEmptyBookFields(values, generation, isbn));
        }
      });
    }
    const again = actions.querySelector('[data-scan-again]');
    again.addEventListener('click', () => {
      returnToCheck();
      startCheckScanner();
    });
    resultActions = { add, again };
    updateCheckActions();
    result.append(actions);
    // Announce the completed state without moving focus away from a control
    // the user reached during a slow lookup.
    if (match.kind === 'exact') heading.focus?.();
    $('check-announcement').textContent = heading.textContent;
  }
  function updateCheckActions() {
    if (!resultActions) return;
    const { add, again } = resultActions;
    if (add) add.hidden = !canEdit;
    again.className = add && canEdit ? 'quiet-button' : 'check-primary';
  }
  function updateScanButton() {
    const button = $('scan-start');
    button.classList.toggle('connect-button', !libraryConnected);
    button.textContent = !libraryConnected ? 'Connect to a Library to Scan a Book' : cameraOpen ? 'Close scanner' : 'Scan Book';
    button.setAttribute('aria-expanded', String(cameraOpen));
  }
  function setCameraOpen(open, standby = false) {
    cameraOpen = open;
    $('check-camera').hidden = !open && !standby;
    $('check-camera').classList.toggle('camera-standby', standby);
    $('check-camera').inert = standby;
    $('check-status').textContent = '';
    updateScanButton();
  }
  async function closeCheckScanner() {
    const sequence = ++checkSequence;
    setCameraOpen(false);
    $('check-photo-status').textContent = '';
    await checkScanner.stop();
    return sequence;
  }
  async function startCheckScanner() {
    if (!libraryConnected) return;
    const scanId = ++checkSequence;
    clearTimeout(scanSearchTimer);
    showIsbnForm(false);
    showCheckResult(false);
    $('check-photo-status').textContent = '';
    setCameraOpen(true); $('check-preview').classList.remove('recognized'); $('check-preview').classList.add('loading');
    $('scan-start').focus?.();
    try {
      await checkScanner.start(async value => {
        if (scanId !== checkSequence || $('check-camera').hidden) return;
        $('check-preview').classList.add('recognized');
        await new Promise(resolve => setTimeout(resolve, 500));
        if (scanId !== checkSequence || $('check-camera').hidden) return;
        checkScanner.hold(30000);
        setCameraOpen(false, true); checkIsbn(value);
      }, value => {
        if (scanId === checkSequence && cameraOpen && value !== 'Starting camera…' && value !== scanGuidance) {
          $('check-status').textContent = value;
        }
      });
      if (scanId === checkSequence) $('check-preview').classList.remove('loading');
    } catch (error) {
      if (scanId === checkSequence && !$('check-camera').hidden) { $('check-preview').classList.remove('loading'); $('check-status').textContent = message(error); }
    }
  }
  $('scan-start').addEventListener('click', () => {
    if (!libraryConnected) return connect();
    return cameraOpen ? closeCheckScanner() : startCheckScanner();
  });
  document.addEventListener?.('visibilitychange', () => {
    if (!document.hidden) { checkSessionExpiry(); return; }
    if ($('check-camera').hidden) return;
    if (cameraOpen) checkSequence++;
    setCameraOpen(false);
    checkScanner.stop().catch(() => {});
  });
  $('check-photo-open').addEventListener('click', () => $('check-photo').click());
  $('check-photo').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    clearTimeout(scanSearchTimer);
    const sequence = await closeCheckScanner();
    if (sequence !== checkSequence || mainView !== 'scan') return;
    const photoStatus = $('check-photo-status');
    photoStatus.textContent = 'Reading barcode…';
    try {
      const value = await checkScanner.scanFile(file);
      if (sequence !== checkSequence || mainView !== 'scan') return;
      photoStatus.textContent = '';
      if (value) checkIsbn(value);
    } catch {
      if (sequence === checkSequence) photoStatus.textContent = 'No barcode found. Try another photo or enter the ISBN manually.';
    }
  });

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
  function useGoogleSession(session) {
    activateSession(session);
    try { sessionStorage.removeItem(cacheKey); sessionStorage.removeItem(editAccessKey); } catch {}
    try { localStorage.setItem(sessionKey, JSON.stringify(session)); } catch {}
  }
  function openPicker(session, attempt) {
    if (attempt !== connectionAttempt) return;
    const mine = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS);
    const shared = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setOwnedByMe(false);
    new google.picker.PickerBuilder().addView(mine).addView(shared).setOAuthToken(session.token).setDeveloperKey(config.apiKey).setAppId(config.appId)
      .setCallback(async result => {
        if (attempt !== connectionAttempt || result.action !== google.picker.Action.PICKED) return;
        if (busy) { connectionStatus('Finish the current library action before switching libraries.'); return; }
        const id = result.docs?.[0]?.id;
        if (!id) return;
        busy = true;
        try {
          const catalog = await loadCatalog({ id, accessToken: session.token });
          if (attempt !== connectionAttempt) return;
          if (libraryConnected && id !== sheetId) {
            duplicatesMode = false;
            sortField = '';
            sortDirection = 1;
            $('library-sort').value = '';
            setSearchText('');
            $('check-isbn').value = '';
            resetOwnershipCheck();
            checkScanner.stop?.().catch(() => {});
          }
          canEdit = false;
          useGoogleSession(session);
          sheetId = id;
          rememberSheet(id);
          const updatedAt = Date.now();
          applyCatalog(catalog, updatedAt);
          showLibrary();
          showCatalogUpdated(updatedAt);
        } catch (error) {
          if (attempt === connectionAttempt) connectionStatus('Could not open the selected Sheet: ' + message(error));
        } finally {
          busy = false;
        }
      }).build().setVisible(true);
  }
  async function createLibrary(name) {
    if (creatingLibrary) return;
    creatingLibrary = true;
    try {
    const accessToken = token;
    checkSessionExpiry();
    if (token !== accessToken) return;
    connectionStatus('Creating your library…');
    let response;
    try { response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { title: name },
        sheets: [{ properties: { title: 'Books', gridProperties: { frozenRowCount: 1 } },
          data: [{ startRow: 0, startColumn: 0, rowData: [{ values: preferredHeaders.map(header => ({ userEnteredValue: { stringValue: header } })) }] }] }]
      })
    });
    } catch { throw new Error('Could not confirm creation. Check Google Drive before trying again.'); }
    if (response.status === 401) expireSession(accessToken);
    const data = await response.json().catch(() => ({}));
    if (token !== accessToken) return;
    if (!response.ok || !data.spreadsheetId) throw new Error(data.error?.message || 'The creation result could not be confirmed. Check Google Drive before trying again.');
    const previousSheet = sheetId;
    sheetId = data.spreadsheetId;
    rememberSheet(sheetId);
    try {
      await refresh({ minimumIndicatorTime: 0 });
      if (token === accessToken) { showLibrary(); status('New library created.'); }
    }
    catch (error) {
      if (token !== accessToken) return;
      sheetId = previousSheet;
      if (previousSheet) rememberSheet(previousSheet);
      throw new Error('The new spreadsheet was created, but could not be opened. Find it in Google Drive and reconnect. ' + message(error));
    }
    } finally { creatingLibrary = false; }
  }
  function connect(mode = 'connect', libraryName = '') {
    if (busy) return;
    const attempt = ++connectionAttempt;
    $('connect-status').hidden = true;
    $('settings-connect-status').hidden = true;
    if (!libraryConnected) $('check-status').textContent = '';
    if (!config.clientId || !config.apiKey || !config.appId) { connectionStatus('Setup needed: add the Google Cloud identifiers to assets/js/config.js. See the setup guide.'); return; }
    if (!window.google?.accounts?.oauth2 || !window.gapi) { connectionStatus('Google sign-in is still loading. Please try again.'); return; }
    const client = google.accounts.oauth2.initTokenClient({ client_id: config.clientId, scope, callback: async response => {
      if (attempt !== connectionAttempt) return;
      if (response.error) { connectionStatus('Google authorization was not completed: ' + response.error); return; }
      const session = { token: response.access_token, expiresAt: Date.now() + Number(response.expires_in) * 1000 };
      if (mode === 'create') {
        useGoogleSession(session);
        try { await createLibrary(libraryName); } catch (error) { connectionStatus(message(error)); }
        return;
      }
      if (rememberedSheet && mode === 'connect') {
        useGoogleSession(session);
        sheetId = rememberedSheet;
        try { await refresh({ minimumIndicatorTime: 0 }); if (attempt === connectionAttempt) showLibrary(); }
        catch (error) {
          if (attempt !== connectionAttempt) return;
          sheetId = '';
          connectionStatus('Could not open the remembered Sheet: ' + message(error) + ' You can choose a different Sheet.');
        }
        return;
      }
      if (pickerReady) openPicker(session, attempt); else gapi.load('picker', { callback: () => { pickerReady = true; openPicker(session, attempt); }, onerror: () => connectionStatus('Google Picker could not load. Please try again.'), timeout: 10000, ontimeout: () => connectionStatus('Google Picker took too long to load. Please try again.') });
    }});
    client.requestAccessToken();
  }
  async function restoreSession() {
    if (!rememberedSheet) { showDisconnectedLibrary(); return; }
    const session = readSavedSession();
    if (session?.token && session.expiresAt <= Date.now()) {
      clearSession();
      connectionStatus(expiredSessionMessage);
      return;
    }
    if (!session?.token || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now() + 30000) {
      try { localStorage.removeItem(sessionKey); } catch {}
      showDisconnectedLibrary();
      return;
    }
    activateSession(session); sheetId = rememberedSheet;
    let cached = false;
    try {
      const snapshot = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (snapshot?.sheetId === sheetId && Array.isArray(snapshot.books) && snapshot.books.every(book => headers.every(key => typeof book[key] === 'string')) && Number.isFinite(snapshot.updatedAt) && Array.isArray(snapshot.sheetHeaders)) {
        sheetHeaders = readHeaders(snapshot.sheetHeaders); headerFrozen = snapshot.headerFrozen === true; libraryWidth = sheetHeaders.length;
        books = snapshot.books;
        updateLibraryCount();
        setLibraryLinkLabel(snapshot.title);
        render(); showLibrary(); cached = true;
      }
    } catch {}
    try {
      if (cached) {
        await refresh();
      } else {
        await refresh({ minimumIndicatorTime: 0 });
        if (token === session.token && sheetId) showLibrary();
      }
    } catch (error) {
      if (token !== session.token) return;
      if (cached && error.status !== 401 && error.status !== 403) {
        status('Showing saved catalog; refresh failed: ' + message(error));
      } else {
        clearSession();
        connectionStatus('Could not restore your session: ' + message(error) + ' Reconnect to try again.');
      }
    }
  }
  $('library-link').addEventListener('click', event => {
    if (libraryConnected) return;
    event.preventDefault();
    setMainView('library');
    connect();
  });
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
    if (token) createLibrary(name).catch(error => connectionStatus(message(error)));
    else connect('create', name);
  });
  $('new-library').addEventListener('click', requestNewLibrary);
  $('settings-open').addEventListener('click', () => setMainView('settings'));
  $('disconnect').addEventListener('click', () => { rememberSheet(''); clearSession(); });
  window.addEventListener('storage', event => {
    if (event.key !== sessionKey || event.newValue || !token) return;
    try {
      const savedSheet = localStorage.getItem(storageKey) || '';
      if (savedSheet && JSON.parse(event.oldValue || 'null')?.token !== token) return;
      rememberedSheet = savedSheet;
    } catch {}
    clearSession(false);
    if (rememberedSheet) connectionStatus(expiredSessionMessage);
  });
  $('upgrade-library').addEventListener('click', () => {
    if (!libraryConnected || busy || !libraryWidth || !needsUpdate()) return;
    const labels = { publisher: 'Publisher', publication_year: 'Publication year', shelf_location: 'Shelf location', category: 'Category', description: 'Description', series_name: 'Series name', volume_number: 'Volume number', pages: 'Pages', updated_at: 'Updated at' };
    const changes = missingHeaders().map(key => 'Add ' + (labels[key] || key));
    if (!headerFrozen) changes.push('Freeze the header row.');
    if (JSON.stringify(sheetHeaders) !== JSON.stringify(desiredOrder(sheetHeaders)) || missingHeaders().length) changes.push('Reorder library columns into the standard layout; custom columns follow.');
    const list = $('upgrade-columns');
    list.replaceChildren();
    for (const change of changes) {
      const item = cloneTemplate('upgrade-item').firstElementChild;
      item.textContent = change;
      list.append(item);
    }
    $('upgrade-dialog').showModal();
  });
  $('cancel-upgrade').addEventListener('click', () => $('upgrade-dialog').close());
  $('confirm-upgrade').addEventListener('click', async () => {
    if (!libraryConnected || busy || !libraryWidth || !needsUpdate()) return;
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
    finally { busy = false; $('upgrade-library').disabled = !canEdit; }
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
    if (!libraryConnected || busy || !importRows.length) return;
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
      refresh().then(() => status(result)).catch(error => status(result + ' Catalog refresh failed: ' + message(error)));
    } catch (error) { $('import-status').textContent = 'Import failed or could not be confirmed: ' + message(error) + ' Refresh and check the Sheet before retrying.'; }
    finally { busy = false; $('import-confirm').disabled = !importRows.length; $('import-cancel').disabled = false; $('import-file').disabled = false; }
  });
  $('export-csv').addEventListener('click', () => {
    const csv = formatCsv([headers, ...books.map(book => headers.map(key => book[key] || ''))]);
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'library-export.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  for (const mode of ['card', 'list']) $('view-' + mode).addEventListener('click', () => {
    viewMode = mode; try { localStorage.setItem('annas-annals-view', mode); } catch {} render();
  });
  $('library-sort').addEventListener('change', render);
  compactLayout?.addEventListener?.('change', render);
  let editMode = false, detailsScrollTop = 0, deleteArmed = false, deleteTimer;
  function resetDelete() {
    deleteArmed = false; clearTimeout(deleteTimer);
    $('delete').textContent = 'Delete book'; $('delete').classList.remove('upgrade-button'); $('delete').classList.add('secondary');
  }
  const editableFields = ['isbn', 'title', 'author', 'publisher', 'publication_year', 'language', 'shelf_location', 'category', 'description', 'series_name', 'volume_number', 'pages', 'notes'];
  function hasBookEdits() {
    const { elements } = $('book-form');
    return editableFields.some(key => elements[key].value !== (editingBook?.[key] || ''));
  }
  function updateBookSaveButton() {
    const canSave = editingBook ? hasBookEdits() : Boolean($('book-form').elements.title.value.trim());
    $('save').disabled = busy || (editMode && !canSave);
  }
  $('book-form').addEventListener('input', updateBookSaveButton);

  function renderBookDetails(book) {
    const value = key => String(book[key] ?? '').trim();
    $('book-details-title').textContent = value('title');
    const author = $('book-details-author');
    author.textContent = value('author');
    author.hidden = !author.textContent;
    const summary = $('book-details-summary');
    const pages = value('pages');
    summary.textContent = [value('category'), value('publication_year'), pages && pages + (pages === '1' ? ' page' : ' pages')].filter(Boolean).join(' · ');
    summary.hidden = !summary.textContent;
    const description = value('description');
    $('book-details-description').textContent = description;
    $('book-description-section').hidden = !description;
    const sections = [
      ['copy', [['Shelf location', 'shelf_location'], ['Notes', 'notes']]],
      ['edition', [['Publisher', 'publisher'], ['Language', 'language'], ['Series', 'series_name'], ['Volume', 'volume_number'], ['ISBN', 'isbn']]]
    ];
    for (const [section, fields] of sections) {
      const list = $('book-details-' + section);
      list.replaceChildren();
      let hasValues = false;
      for (const [label, key] of fields) {
        let text = value(key);
        if (!text) continue;
        if (key === 'language' && /^[a-z]{2,3}$/i.test(text) && Intl.DisplayNames) {
          text = new Intl.DisplayNames('en', { type: 'language', fallback: 'none' }).of(text) || text;
        }
        const row = cloneTemplate('book-detail-row').firstElementChild;
        row.querySelector('dt').textContent = label;
        row.querySelector('dd').textContent = text;
        list.append(row);
        hasValues = true;
      }
      $('book-' + section + '-section').hidden = !hasValues;
    }
  }
  function setEditorMode(editable) {
    editorGeneration++;
    resetBookDetailsMotion();
    resetDelete();
    editMode = editable;
    const editor = $('editor');
    const title = $('editor-title');
    editor.classList.toggle('view-mode', !editable);
    title.classList.toggle('visually-hidden', !editable);
    title.textContent = editingBook ? (editable ? 'Edit book' : 'Book details') : 'Add a book';
    title.autofocus = editable;
    $('book-details-heading').hidden = editable;
    $('book-details-content').hidden = editable;
    $('book-primary-fields').hidden = !editable;
    $('book-editor-fields').hidden = !editable;
    $('book-edition-fields').open = !editingBook;
    $('book-notes-fields').open = false;
    $('lookup-results').hidden = true;
    $('lookup-suggestions').replaceChildren();
    $('book-options').open = false;
    $('book-options').hidden = !editable || !canEdit || !editingBook?.id;
    $('close-editor').hidden = editable;
    $('close-editor').textContent = mainView === 'library' ? '‹ Library' : '‹ Check';
    $('save').hidden = !editable;
    $('cancel-edit').hidden = !editable;
    $('edit-from-details').hidden = !canEdit || editable || !editingBook?.id;
    if (!editable) renderBookDetails(editingBook);
    updateBookCover();
    updateBookSaveButton();
    $('editor-body').scrollTop = editable ? 0 : detailsScrollTop;
    if (editable && editor.open) title.focus?.({ preventScroll: true });
  }
  function showDetails(book) { openEditor(book, false); }
  $('edit-from-details').addEventListener('click', () => {
    if (busy || !canEdit || !editingBook?.id) return;
    detailsScrollTop = $('editor-body').scrollTop;
    formStatus('');
    setEditorMode(true);
  });
  function cancelBookDraft() {
    if (busy || !editMode) return;
    if (hasBookEdits() && !window.confirm('Discard unsaved changes?')) return;
    if (!editingBook) {
      closeEditor();
      return;
    }
    stopScanner().catch(() => {});
    const { elements } = $('book-form');
    for (const key of editableFields) elements[key].value = editingBook[key] || '';
    formStatus(''); setEditorMode(false);
    $('edit-from-details').focus?.({ preventScroll: true });
  }
  $('cancel-edit').addEventListener('click', cancelBookDraft);
  function updateBookCover() {
    $('book-cover-panel').hidden = !showFallbackCovers || (editMode && Boolean(editingBook));
  }
  function openEditor(book = null, editable = true) {
    if (busy) return;
    detailsScrollTop = 0;
    editingBook = book ? { ...book } : null;
    const form = $('book-form'); form.reset();
    for (const key of editableFields) form.elements[key].value = book?.[key] || '';
    formStatus('');
    setEditorMode(editable);
    if (!editorDialog.open) {
      editorDialog.showModal();
      if (!editable) slideBookDetails('translateX(100%)', 'translateX(0)');
    }
    if (!editable) $('book-details-title').focus?.({ preventScroll: true });
  }
  async function addBook() {
    if (!canEdit || busy) return;
    if (mainView === 'scan') {
      clearTimeout(scanSearchTimer);
      const sequence = await closeCheckScanner();
      if (sequence !== checkSequence || mainView !== 'scan' || !canEdit) return;
    }
    openEditor();
  }
  for (const add of addBookButtons) add.addEventListener('click', addBook);
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
    $('editor').close();
    try { await refresh(); } catch (error) { status(label + ' Refresh failed: ' + message(error)); }
  }
  function setBookSavePending(pending) {
    busy = pending;
    updateBookSaveButton();
    $('save-label').textContent = pending ? 'Saving…' : 'Save';
    $('cancel-edit').disabled = pending;
    $('close-editor').disabled = pending;
    $('edit-from-details').disabled = pending;
    $('editor-body').inert = pending;
  }
  $('delete').addEventListener('click', async () => {
    if (busy || !canEdit || !editingBook?.id) return;
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
  async function stopScanner() { editorScanSequence++; $('scan-area').hidden = true; await scanner.stop(); }
  const editorDialog = $('editor');
  function closeEditor() {
    if (!busy) editorDialog.close();
  }
  $('close-editor').addEventListener('click', () => {
    if (busy) return;
    const from = bookDetailsAnimation
      ? getComputedStyle(editorDialog).transform
      : editorDialog.style.transform || 'translateX(0)';
    slideBookDetails(from, 'translateX(100%)', closeEditor);
  });

  let backSwipe, bookDetailsAnimation;
  function resetBookDetailsMotion() {
    const animation = bookDetailsAnimation;
    backSwipe = undefined;
    bookDetailsAnimation = undefined;
    animation?.cancel();
    editorDialog.style.transform = '';
    editorDialog.classList.remove('is-sliding');
  }

  function slideBookDetails(from, to, onFinish) {
    resetBookDetailsMotion();
    if (!compactLayout?.matches || !editorDialog.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      onFinish?.();
      return;
    }
    editorDialog.classList.add('is-sliding');
    const animation = editorDialog.animate([{ transform: from }, { transform: to }],
      { duration: 360, easing: 'cubic-bezier(0.32, 0.08, 0.24, 1)', fill: 'both' });
    bookDetailsAnimation = animation;
    animation.finished.then(() => {
      if (bookDetailsAnimation !== animation) return;
      if (editorDialog.open) onFinish?.();
      resetBookDetailsMotion();
    }, () => {
      if (bookDetailsAnimation === animation) resetBookDetailsMotion();
    });
  }

  function settleBackSwipe(dismiss) {
    if (!backSwipe?.distance) {
      resetBookDetailsMotion();
      return;
    }
    if (dismiss) slideBookDetails(editorDialog.style.transform, 'translateX(100%)', closeEditor);
    else slideBookDetails(editorDialog.style.transform, 'translateX(0)');
  }

  editorDialog.addEventListener('pointerdown', event => {
    if (bookDetailsAnimation) return;
    if (backSwipe) {
      settleBackSwipe(false);
      return;
    }
    if (!compactLayout?.matches || !editorDialog.open || editMode || busy ||
        event.pointerType !== 'touch' || !event.isPrimary || event.clientX > 36 ||
        event.target.closest?.('button, a')) return;
    backSwipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  function moveBackSwipe(event) {
    if (event.pointerId !== backSwipe?.id) return;
    const across = event.clientX - backSwipe.x;
    const vertical = Math.abs(event.clientY - backSwipe.y);
    if (backSwipe.distance === undefined) {
      if (Math.max(Math.abs(across), vertical) < 8) return;
      if (across <= vertical) {
        backSwipe = undefined;
        return;
      }
      editorDialog.classList.add('is-sliding');
    }
    backSwipe.distance = Math.max(0, across);
    editorDialog.style.transform = 'translateX(' + backSwipe.distance + 'px)';
  }
  editorDialog.addEventListener('pointermove', moveBackSwipe);
  editorDialog.addEventListener('pointerup', event => {
    if (event.pointerId !== backSwipe?.id) return;
    moveBackSwipe(event);
    if (!backSwipe) return;
    const vertical = Math.abs(event.clientY - backSwipe.y);
    settleBackSwipe(backSwipe.distance >= 72 && backSwipe.distance > vertical * 1.5);
  });
  editorDialog.addEventListener('pointercancel', event => {
    if (event.pointerId === backSwipe?.id) settleBackSwipe(false);
  });
  editorDialog.addEventListener('cancel', event => {
    if (busy || editMode) event.preventDefault();
    if (editMode) cancelBookDraft();
  });
  editorDialog.addEventListener('close', () => {
    resetBookDetailsMotion();
    editorGeneration++;
    resetDelete();
    stopScanner().catch(() => {});
  });
  $('book-edition-fields').addEventListener('toggle', () => {
    if (!$('book-edition-fields').open && !$('scan-area').hidden) stopScanner().catch(() => {});
  });
  $('scan').addEventListener('click', async () => {
    const scanId = ++editorScanSequence;
    const generation = editorGeneration;
    $('scan-area').hidden = false; $('scan-status').textContent = scanGuidance; $('editor-preview').classList.remove('recognized'); $('editor-preview').classList.add('loading');
    try {
      await scanner.start(async text => {
        if (scanId !== editorScanSequence || $('scan-area').hidden) return;
        $('editor-preview').classList.add('recognized');
        await new Promise(resolve => setTimeout(resolve, 500));
        if (scanId !== editorScanSequence || $('scan-area').hidden) return;
        $('book-form').elements.isbn.value = text;
        updateBookSaveButton();
        await stopScanner();
        if (!busy && generation === editorGeneration) formStatus('Barcode captured. Look up the ISBN or enter the details.');
      }, text => { if (text !== 'Starting camera…') $('scan-status').textContent = text; });
      if (scanId === editorScanSequence) $('editor-preview').classList.remove('loading');
    } catch (error) { if (scanId === editorScanSequence && !$('scan-area').hidden) { $('editor-preview').classList.remove('loading'); $('scan-status').textContent = message(error); } }
  });
  $('stop-scan').addEventListener('click', () => stopScanner().catch(error => formStatus(message(error))));
  $('photo').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    const generation = editorGeneration;
    try {
      const result = await scanner.scanFile(file);
      if (generation !== editorGeneration || busy || !result) return;
      $('book-form').elements.isbn.value = result;
      updateBookSaveButton();
      await stopScanner();
      if (!busy && generation === editorGeneration) formStatus('Barcode captured. Look up the ISBN or enter the details.');
    } catch {
      if (generation === editorGeneration) $('scan-status').textContent = 'No barcode found. Try a clearer photo or enter the ISBN manually.';
    }
  });
  $('lookup').addEventListener('click', async () => {
    const form = $('book-form');
    const isbn = normalizeIsbn(form.elements.isbn.value);
    const results = $('lookup-results'), resultStatus = $('lookup-status'), suggestions = $('lookup-suggestions');
    results.hidden = false; suggestions.replaceChildren();
    if (!isbn) { resultStatus.textContent = 'Enter a valid ISBN-10 or ISBN-13.'; return; }
    form.elements.isbn.value = isbn;
    updateBookSaveButton();
    resultStatus.textContent = 'Looking up book details…'; $('lookup').disabled = true;
    const currentBook = editingBook, generation = editorGeneration, autoFilled = {}, userChanged = new Set();
    const isCurrent = () => !busy && editingBook === currentBook && editorGeneration === generation && normalizeIsbn(form.elements.isbn.value) === isbn && $('editor').open;
    function showLookupResult({metadata, fieldSources}, pending) {
      if (!isCurrent() || !metadata) return;
      suggestions.replaceChildren();
      const values = [
        ['title', 'Title', metadata.title], ['author', 'Author', metadata.author],
        ['publisher', 'Publisher', metadata.publisher], ['publication_year', 'Publication year', metadata.publication_year],
        ['language', 'Language', metadata.language], ['pages', 'Pages', metadata.pages], ['category', 'Category', metadata.category]
      ];
      let filled = 0, alternatives = 0;
      for (const [key, label, value] of values) {
        if (!value) continue;
        const current = form.elements[key].value.trim();
        if (autoFilled[key] !== undefined && current !== autoFilled[key]) { delete autoFilled[key]; userChanged.add(key); }
        if (!userChanged.has(key) && (!current || current === autoFilled[key])) { form.elements[key].value = value; autoFilled[key] = value; filled++; continue; }
        if (!current) continue;
        if (form.elements[key].value.trim() === value) continue;
        alternatives++;
        const item = cloneTemplate('lookup-suggestion').firstElementChild;
        item.querySelector('p').textContent = label + ': ' + value;
        item.querySelector('.lookup-source').textContent = 'Source: ' + fieldSources[key];
        const button = item.querySelector('button');
        button.textContent = 'Use this ' + label.toLowerCase();
        button.addEventListener('click', () => { form.elements[key].value = value; updateBookSaveButton(); item.remove(); });
        suggestions.append(item);
      }
      updateBookSaveButton();
      resultStatus.textContent = filled ? 'Filled ' + filled + (filled === 1 ? ' empty field.' : ' empty fields.') + ' Review the details and save.' : 'No empty fields were filled. Review the details and save.';
      if (alternatives) resultStatus.textContent += ' The lookup also suggested alternatives below.';
      const usedSources = ['Google Books', 'Open Library'].filter(source => Object.values(fieldSources).includes(source));
      if (usedSources.length) resultStatus.textContent += ' Sources: ' + usedSources.join(' and ') + '.';
      if (pending) resultStatus.textContent += ' Checking Open Library for missing details…';
    }
    try {
      const result = await bookLookup.lookupBookMetadata(isbn, partial => showLookupResult(partial, true));
      if (!isCurrent()) return;
      if (!result.metadata) { resultStatus.textContent = 'No match found. You can enter the details manually.'; return; }
      showLookupResult(result, false);
    } catch (error) { if (isCurrent()) resultStatus.textContent = message(error); } finally { $('lookup').disabled = false; }
  });
  $('book-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !editMode || (editingBook && !hasBookEdits())) return;
    if (missingHeaders().length) { formStatus('Update the library before saving book details. Close this window and choose Update library.'); return; }
    const form = event.currentTarget, enteredIsbn = form.elements.isbn.value.trim();
    const isbn = normalizeIsbn(enteredIsbn);
    if (enteredIsbn && !isbn) {
      $('book-edition-fields').open = true;
      form.elements.isbn.focus?.();
      formStatus('Enter a valid ISBN-10 or ISBN-13, or leave it blank.'); return;
    }
    if (isbn) form.elements.isbn.value = isbn;
    if (isbn && books.some(book => book.id !== editingBook?.id && normalizeIsbn(book.isbn) === isbn)) { formStatus('This ISBN is already in the catalog.'); return; }
    setBookSavePending(true); formStatus('Saving…');
    stopScanner().catch(() => {});
    try {
      const row = [editingBook?.id || crypto.randomUUID(), isbn, form.elements.title.value.trim(), form.elements.author.value.trim(), form.elements.language.value.trim(), form.elements.notes.value.trim(), editingBook?.created_at || new Date().toISOString(), form.elements.publisher.value.trim(), form.elements.publication_year.value.trim(), form.elements.shelf_location.value.trim(), form.elements.category.value.trim(), form.elements.description.value.trim(), form.elements.series_name.value.trim(), form.elements.volume_number.value.trim(), form.elements.pages.value.trim(), new Date().toISOString()];
      if (!row[2]) throw new Error('Enter a title.');
      const valuesByHeader = Object.fromEntries(headers.map((key, index) => [key, row[index]]));
      if (editingBook) {
        const rowNumber = await findUnchangedBook(editingBook);
        await api('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: headers.map(key => ({ range: "'Books'!" + column(sheetHeaders.indexOf(key)) + rowNumber, values: [[valuesByHeader[key]]] })) }) });
        editingBook = valuesByHeader;
        for (const key of editableFields) form.elements[key].value = editingBook[key];
        setEditorMode(false);
        formStatus('Changes saved.');
        $('editor-body').inert = false;
        $('book-details-title').focus?.({ preventScroll: true });
        books = books.map(book => book.id === editingBook.id ? editingBook : book);
        render();
        try { await refresh({ minimumIndicatorTime: 0 }); }
        catch (error) { status('Book saved. Catalog refresh failed: ' + message(error)); }
      } else {
        await api('/values/' + encodeURIComponent("'Books'!A:ZZ") + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { method: 'POST', body: JSON.stringify({ values: [sheetHeaders.map(key => valuesByHeader[key] || '')] }) });
        returnToCheck();
        $('library-sort').value = ''; sortField = ''; duplicatesMode = false;
        books.unshift(valuesByHeader); updateLibraryCount(); render();
        await finishChange('Book saved.');
      }
    } catch (error) { formStatus('Save failed or could not be confirmed. Refresh the catalog before retrying: ' + message(error)); }
    finally { setBookSavePending(false); }
  });
  restoreSession();
})();
