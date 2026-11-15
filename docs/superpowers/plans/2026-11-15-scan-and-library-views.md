# Scan and Library Views Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Make checking a book fast on mobile while retaining the existing catalog experience.

**Architecture:** Add Scan and Library views over the existing Google Sheet catalog. Normalize ISBNs for exact matches, then use looked-up title and author for possible edition matches. Reuse the existing scanner and editor.

**Tech Stack:** Vanilla HTML, CSS and JavaScript; Google Sheets API; Open Library; node:test.

**Spec:** The approved design in the conversation and the two supplied reference images.

## Global Constraints

- Mobile defaults to Scan; desktop defaults to Library. Both views have a visible toggle.
- Camera starts only after the user selects Scan Book.
- Scan view follows the first reference: search, prominent scan action and compact title/author rows. Library view retains the existing catalog appearance shown in the second reference.
- Library view provides separate Scan Book and Add Book actions; add/edit actions require editor access.
- Exact ISBN matches are definite; title and author matches are possible matches, not proof.
- A user may explicitly add another edition. No match does not automatically open the editor.

## Review Focus

- ISBN-10 and ISBN-13 equivalents must match after normalization.
- Missing metadata or lookup failure must not be reported as a confirmed absence.
- Camera denial must leave manual search and ISBN entry available.
- Viewer permissions must prevent write actions without preventing scanning.
- Repeated scans and switching views must stop the camera and avoid stale results.

### Task 1: Matching and lookup results

**Files:** Create `book-match.js`, `tests/book-match.test.cjs`; modify `index.html`, `app.js`.

- [ ] Test exact ISBN matches across ISBN-10 and ISBN-13, distinct ISBNs with matching title and author, missing author, and missing metadata.
- [ ] Implement a pure `matchBook(isbn, metadata, books)` function returning exact matches first, otherwise possible title-and-author matches. Normalize text for case and whitespace; do not claim certainty for a metadata match.
- [ ] Test lookup failure separately from a successful lookup with no catalog match.
- [ ] Run `node --test tests/book-match.test.cjs` and confirm it passes.

### Task 2: Views and permissions

**Files:** Modify `index.html`, `style.css`, `app.js`; add focused tests under `tests/`.

- [ ] Add accessible Scan/Library controls and select the initial view using a mobile viewport breakpoint; retain the user's explicit selection during the session.
- [ ] Implement the first reference's scan landing layout with search and compact tappable book rows; retain the existing catalog layout, card/list options, search and settings in Library view.
- [ ] Provide separate Scan Book and Add Book actions in Library view. Determine edit capability from the connected Sheet's actual permissions; hide write actions for viewers and preserve server-side error handling.
- [ ] Verify mobile and desktop defaults, view switching, viewer controls and keyboard access.

### Task 3: Scanning, outcomes and adding

**Files:** Modify `app.js`, `scanner.js`, `index.html`, `style.css`; extend relevant tests.

- [ ] Start camera only on Scan Book; offer manual ISBN entry and retain existing camera/photo fallbacks. Stop it on cancellation or view change.
- [ ] Compare scanned ISBN against normalized Sheet values first. If no exact match, fetch metadata and compare title and author. Show exact, possible, no-match and unable-to-identify states distinctly.
- [ ] Show matching existing records, Scan another book, and editor-only Add book or Add this edition anyway actions as appropriate. Populate known metadata without saving automatically.
- [ ] Test camera failure, a second scan replacing the first result, lookup failures, and intentional addition of a distinct edition.
- [ ] Run `node --test tests/*.test.cjs` and verify the mobile and desktop flows in a browser, including a real viewer account when available. Document any unverified live Google or camera behavior.
