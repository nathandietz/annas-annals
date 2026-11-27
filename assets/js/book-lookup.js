'use strict';
const bookLookup = (() => {
  const config = window.LIBRARY_CONFIG;
  const googleBookRequests = new Map();

  function openLibraryMetadata(data) {
    return {
      title: data.title || '',
      author: (data.authors || []).map(a => a.name).filter(Boolean).join(', '),
      publisher: (data.publishers || []).map(p => p.name).filter(Boolean).join(', '),
      publication_year: (data.publish_date || '').match(/\b(?:1[0-9]{3}|20[0-9]{2})\b/)?.[0] || '',
      language: (data.languages || []).map(language => language.name || language.key?.split('/').pop() || '').filter(Boolean).join(', '),
      pages: data.number_of_pages ? String(data.number_of_pages) : '',
      category: (data.subjects || []).map(subject => subject.name).find(Boolean) || ''
    };
  }
  async function fetchLookup(url) {
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    let timer;
    try {
      const response = await Promise.race([
        fetch(url, controller ? {signal: controller.signal} : undefined),
        new Promise((_, reject) => { timer = setTimeout(() => { controller?.abort(); reject(new Error('Lookup timed out')); }, 5000); })
      ]);
      if (!response.ok) throw new Error('Lookup unavailable');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  function googleBookMetadata(google) {
    return {
      title: google.title || '', author: (google.authors || []).join(', '), publisher: google.publisher || '',
      publication_year: (google.publishedDate || '').match(/\b(?:1[0-9]{3}|20[0-9]{2})\b/)?.[0] || '',
      language: google.language || '', pages: google.pageCount ? String(google.pageCount) : '',
      category: google.mainCategory || google.categories?.[0] || ''
    };
  }
  function requestGoogleBook(isbn) {
    if (!config.apiKey) return Promise.resolve(null);
    if (googleBookRequests.has(isbn)) return googleBookRequests.get(isbn);
    const request = fetchLookup('https://www.googleapis.com/books/v1/volumes?q=' + encodeURIComponent('isbn:' + isbn) + '&key=' + encodeURIComponent(config.apiKey))
      .then(data => (data.items || []).find(item => (item.volumeInfo?.industryIdentifiers || []).some(id => normalizeIsbn(id.identifier) === isbn))?.volumeInfo || null)
      .finally(() => googleBookRequests.delete(isbn));
    googleBookRequests.set(isbn, request);
    return request;
  }
  async function lookupBookMetadata(isbn, onGoogle) {
    const openLibrary = fetchLookup('https://openlibrary.org/api/books?bibkeys=' + encodeURIComponent('ISBN:' + isbn) + '&format=json&jscmd=data')
      .then(data => data['ISBN:' + isbn] || null);
    const googleBooks = requestGoogleBook(isbn).then(google => {
      if (google && onGoogle) {
        const metadata = googleBookMetadata(google);
        const fieldSources = {};
        for (const [key, value] of Object.entries(metadata)) {
          if (value) fieldSources[key] = 'Google Books';
        }
        onGoogle({ metadata, fieldSources });
      }
      return google;
    });
    const [openResult, googleResult] = await Promise.allSettled([openLibrary, googleBooks]);
    if (openResult.status === 'rejected' && (googleResult.status === 'rejected' || !googleResult.value)) throw new Error('Book lookup unavailable. You can enter the details manually.');
    const openData = openResult.status === 'fulfilled' ? openResult.value : null;
    const google = googleResult.status === 'fulfilled' ? googleResult.value : null;
    const fallback = openData ? openLibraryMetadata(openData) : {};
    const preferred = google ? googleBookMetadata(google) : {};
    const metadata = {...fallback}, fieldSources = {};
    for (const [key, value] of Object.entries(fallback)) if (value) fieldSources[key] = 'Open Library';
    for (const [key, value] of Object.entries(preferred)) {
      if (!value) continue;
      metadata[key] = value;
      fieldSources[key] = 'Google Books';
    }
    return { metadata: openData || google ? metadata : null, bookData: openData, fieldSources };
  }

  async function lookupOpenLibraryDetails(data, onDetails) {
    const editionId = String(data?.url || '').match(/^https?:\/\/openlibrary\.org\/books\/(OL\d+M)(?:\/|$)/)?.[1];
    if (!editionId) return;
    try {
      const response = await fetch('https://openlibrary.org/books/' + editionId + '.json');
      if (!response.ok) return;
      const edition = await response.json();
      const text = value => typeof value === 'string' ? value : value?.value || '';
      onDetails({ description: text(edition.description), series_name: (edition.series || []).filter(value => typeof value === 'string').join(', ') });
      const workKey = edition.works?.[0]?.key;
      if (!/^\/works\/OL\d+W$/.test(workKey || '')) return;
      const workResponse = await fetch('https://openlibrary.org' + workKey + '.json');
      if (!workResponse.ok) return;
      const work = await workResponse.json();
      onDetails({ description: text(work.description) });
    } catch { /* Details are optional; the existing lookup remains usable. */ }
  }

  return { lookupBookMetadata, lookupOpenLibraryDetails };
})();
