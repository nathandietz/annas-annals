# Simple, fast library: exploration plan

## Goal

A dependable personal book catalog backed by one Google Sheet, with barcode scanning and metadata lookup. Keep the interface small and easy to restyle. Add other capabilities only after the basic flow works reliably.

## Current build: feature map

These are features present in the code, not a guarantee that every flow has been verified live.

- **Catalog:** searchable and filterable card/list views, book details, multilingual titles, series and volumes, categories, reading status, ratings, notes and covers.
- **Capture and metadata:** camera and photo barcode/QR scanning, manual ISBN entry, Google Books and Open Library lookup, optional Gemini photo recognition, and cover cropping/perspective correction.
- **Physical library:** multiple copies, accession IDs, shelf locations, condition, pricing, call numbers, Dewey guide, and printable QR/spine labels.
- **Lending:** members, checkout, return, renewal, due dates, loan history and WhatsApp reminder links/templates.
- **Digital archive:** PDF upload, Drive folder sync, preview and download.
- **Administration:** librarian PIN, public guest view, branding, configurable lists, audit log, CSV and JSON exports.
- **Delivery:** GitHub Pages frontend, Apps Script backend, installable web app manifest and network-only service worker.

The backend currently creates seven database tabs and Drive storage folders. The initial snapshot reads four tabs for guests and six for the requested admin role; each table read makes a Sheets API request. The browser waits for the snapshot and the service worker does not cache it.

## Recommended first release

1. **Browse and search:** show a compact catalog with title, author, ISBN and cover when available. Search locally after the catalog loads.
2. **Scan and add:** camera ISBN scan, photo/manual fallback, fetch metadata, review and edit it, then save. Handle unavailable metadata and duplicate ISBNs without blocking manual entry.
3. **Edit and remove:** correct a record and confirm deletion. Use stable IDs rather than row numbers.
4. **One Sheet:** one Books tab with a small, documented set of columns, preserving the original title and language where needed. Google Sheets remains editable directly; document how app refresh detects those edits.
5. **Reliability:** visible loading, refresh, save and error states; no false success on failed writes; backup through the Sheet itself. Test on an actual phone and deployed Google account.

Defer copies and lending, PDF uploads, AI/image processing, labels, advanced filters, branding, PWA installation and elaborate administration. Existing data and features remain on the original branch; design a migration before using a new schema on real data.

## Architecture and hosting: selected direction

- **Frontend:** static HTML, CSS and JavaScript on GitHub Pages. The interface is public; catalog data stays private until a user authorizes access.
- **Shared database:** one private Google Sheet shared with named Google accounts. Google Sheet viewer/editor permissions govern what each user can do. Each user signs in, grants the app `drive.file`, and selects the shared spreadsheet in Google Picker. No access to the rest of Drive is requested.
- **API:** call the Sheets API directly using each user's short-lived Google authorization token; no Apps Script backend is required for the basic catalog. Look up ISBN metadata through a public API, without sending credentials.
- **Access and privacy:** the current Apps Script endpoint trusts a caller-provided `role=Admin`, so it must not be used for private data. The new prototype does not call it. Public website code must not contain secrets. Verify consent, selection, sharing, revocation and viewer/editor behavior with real accounts.
- **Shared edits:** Google file permissions do not by themselves prevent conflicting updates. Design and test conflict detection before enabling edits or deletion; the initial prototype only appends. Concurrent duplicate additions remain possible.

The initial implementation is at the repository root and uses a new database. See `README.md` for Google Cloud and new Sheet setup. Camera scanning, Google authorization and multi-user use still require live verification.

## Speed strategy

“Instant” should mean the interface appears immediately and a previously loaded catalog appears promptly; a first-ever load still needs a network round trip and cannot be guaranteed instantaneous. Measure both cold and repeat loads on a real phone and connection before setting a firm target.

- Load only the Books fields needed for the first screen; avoid unrelated tables and external metadata requests during startup.
- Consider a versioned local snapshot only after sign-in, scoped to the account and Sheet, labeled with its last refresh time and cleared on disconnect. A local cache can outlive access revocation; decide whether that tradeoff is acceptable before implementing it. The prototype does not persist catalog data.
- Refresh after app writes; detect direct Sheet edits on the next refresh. Show stale or offline status and avoid claiming cached data is current. Start with online-only writes to avoid conflict and duplicate handling complexity.
- Measure frontend paint, time to cached catalog, time to fresh catalog, payload size and save latency, including Apps Script cold starts. Add server caching or batching only if measurements justify it, with an explicit freshness/invalidation policy.

## Progressive milestones

1. **Baseline and access:** measure startup and save times; verify limited consent, private sharing, and deployment with two Google accounts. Define a representative catalog size and acceptance targets.
2. **Minimal vertical slice:** new isolated Sheet and small frontend; read, display, search, manually add/edit/delete one book; demonstrate persistent writes and error handling. Do not modify the existing database.
3. **Scanner and lookup:** add ISBN camera scan, manual/photo fallback, metadata lookup with editable results and duplicate handling. Test on phone and in poor network conditions.
4. **Performance and hardening:** add scoped local snapshot, background refresh and explicit freshness states; verify direct Sheet edits, failures, permissions and actual cold/repeat performance. Resolve access control before exposing the deployment.
5. **Restore features by need:** consider physical copies and locations first, then lending, then labels and exports; defer digital archive and AI until their storage, privacy and reliability tradeoffs are justified. Revisit ordering based on actual use.

## Acceptance checks

- A fresh installation connects to only its intended Sheet and its consent screen requests no whole-Drive or all-spreadsheets access.
- A book can be scanned, reviewed, saved, found, edited and deleted; a manual entry works when scanning or metadata lookup fails.
- A reload shows a clearly dated local snapshot and eventually reflects direct Sheet changes; a failed refresh or save is clearly reported.
- Private data and writes are protected by the chosen access model; calling an endpoint with a different role parameter cannot reveal privileged data.
- Record measured cold-load, repeat-load, refresh and save times alongside device, network and catalog size.
