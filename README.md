# Anna’s Annals

A minimal & opinionated book catalog / library management system (LMS) website that can be statically hosted and uses a private, shareable Google Sheet as its database. 

## What you will need

1. **A Google account** to create the Google Sheet and to create [Google Cloud Project](https://console.cloud.google.com/projectcreate)

2. **A GitHub Account** to clone this repo & publish front end using GitHub Pages

## Create Google Cloud Project & Enable APIs

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create new project called something like `Home Library Catalog` 
2. Visit each link and Enable APIs for the newly created project:
   - [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
     - <small>Create and modify spreadsheets data in Google Sheets.</small>
   - [Google Picker API](https://console.cloud.google.com/apis/library/picker.googleapis.com)
     - <small>Select a Google Spreadsheet stored in Google Drive.</small>
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
     - <small>Verifies user has access to edit selected spreadsheet.</small>
   - [Google Books API](https://console.cloud.google.com/apis/library/books.googleapis.com) (optional, but recommend)
     - <small>Access the Google Books repository when scanning ISBN.</small>
3. Open [Google Cloud Project Dashboard](https://console.cloud.google.com/home/dashboard) and copy the **Project number**.
    - Typically a 12 digit number
    - You’ll paste it into the website’s appId setting below so Google Picker can identify your project.

## Configure Google authorization

### Set up the Consent Screen
> The consent screen is where Google asks users to give the website permission to access the spreadsheet they select.

1. Open [Google Auth Platform → Overview](https://console.cloud.google.com/auth/overview). Make sure your **Home Library Catalog** project is selected.
2. If you see **Google Auth Platform not configured yet**, click **Get started**.
3. Under **App Information**, enter **Home Library Catalog** as the **App name**. This is the name users will see on the consent screen. Select your email for **User support email**, then click **Next**.
4. Under **Audience**, choose **External** if you’ll sign in with a personal Google account. Your spreadsheet’s sharing settings still control who can open it. Click **Next**.
5. Under **Contact information**, enter your email address. Continue to the final screen, review your settings, and click **Create**.

### Add test users

1. Open [Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience) and check the **Publishing status**.
2. If the status is **Testing**, scroll to **Test users** and click **Add users**.
3. Enter the email address of the Google account you’ll use to connect to the website. Add anyone else who will use the website, then click **Save**.

While the project is in **Testing**, each person needs to be on the test user list and have access to the spreadsheet. Share the spreadsheet with any test users who need access. Google will show an unverified-app warning during sign-in. [Google’s OAuth setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)

### Create the web client

The web client tells Google which website can ask users for permission to access their spreadsheet.

1. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients) and click **Create client**.
2. Set **Application type** to **Web application**. For **Name**, enter **Home Library Catalog Website**.
3. Under **Authorized JavaScript origins**, click **Add URI**. If your GitHub Pages website is at `https://YOUR-GITHUB-USERNAME.github.io/annas-annals/`, enter `https://YOUR-GITHUB-USERNAME.github.io`. Replace `YOUR-GITHUB-USERNAME` with your GitHub username. If you use a custom domain, enter that domain with `https://`. Leave out the path and trailing slash.
4. If you’ll test the website locally, click **Add URI** again and enter `http://localhost:8000`. Use that exact address when testing.
5. Leave **Authorized redirect URIs** empty and **Use this client for an AI-powered agent** unchecked. Click **Create**.
6. Copy the **Client ID** ending in `.apps.googleusercontent.com`. You’ll paste it into the website’s `clientId` setting later. You can find it again on the **Clients** page.

## Why Google Cloud instead of Apps Script?
Google Cloud gives the website access only to the spreadsheets you choose and lets you use familiar Google tools to sign in and control who can view or edit them.

| | Google Cloud Project | Google Apps Script |
| --- | --- | --- |
| **What can the website access in Google Drive?** | 🟢 Only the spreadsheet(s) you select or create. | 🔴 Drive-wide read and write access. |
| **Who Can View Spreadsheet Data in the website?** | 🟢 Visitors must connect with a Google account that has access to the spreadsheet. | 🟡 In the public deployment, visitors can browse the catalog without having access to the spreadsheet itself. || **Who Can Edit?** | 🟢 The owner and anyone granted Editor access in Google Sheets. | 🔴 Anyone with the shared admin PIN, when one is configured. |
| **How Do You Share It?** | 🟢 Invite people through Google Sheets and assign them Viewer or Editor access. | 🔴 Share the website link for public browsing and the shared PIN for admin edits. |
| **How Do Users Connect?** | 🟢 Each user connects with their own Google account. | 🔴 The owner authorizes the script with their Google account. Visitors can browse without signing in. |
| **How Do You Choose a Spreadsheet?** | 🟢 Choose a spreadsheet with Google’s file picker. | 🟡 Paste the website URL (`/exec`) to connect to its configured spreadsheet. |
| **How Do You Create a Spreadsheet?** | 🟢 Create a spreadsheet directly in the website. | 🟡 Create a spreadsheet in Google Sheets, then run the script to set up the library tabs and Drive folders. |
| **How Do You Publish Updates?** | 🟢 Publish the updated website on GitHub Pages. | 🟡 For backend changes, create a new script version and update the existing deployment in the Apps Script editor. |
 

## What you will need

- A GitHub repository where you can configure GitHub Pages.
- A Google account to own the Sheet and a [Google Cloud project](https://console.cloud.google.com/projectcreate) for the app's OAuth configuration.
- About three configuration values from Google Cloud: a **web client ID**, a **browser API key**, and the **numeric project number**. The client ID and project number identify the app. The browser API key is a publicly exposed credential and must be restricted as described below.

The steps below are a one-time setup for the app and its Sheet. Each additional user will then authorize the app and select the shared Sheet once they connect.

## 1. Prepare a private spreadsheet (optional)

You can skip this step and use **Create new library** in the app after setup. The app creates a new spreadsheet with a `Books` tab and the required headers. To use an existing Sheet or prepare one manually, follow these steps:

1. Create a **new** spreadsheet at [Google Sheets](https://sheets.google.com/create).
2. Rename the first tab at the bottom to **Books**, exactly as written.
3. In the first row, put the following headers in sixteen separate cells, in this order:

   | A1 | B1 | C1 | D1 | E1 | F1 | G1 | H1 | I1 | J1 | K1 | L1 | M1 | N1 | O1 | P1 |
   | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
   | id | isbn | title | author | language | notes | created_at | publisher | publication_year | shelf_location | category | description | series_name | volume_number | pages | updated_at |

4. Keep this tab for the app's table. Do not select the old seven-tab library database: it has a different format and no migration has been built.
5. To share the catalog, click **Share**, add the other people's Google accounts, and assign **Viewer** or **Editor** access. Under **General access**, leave the Sheet **Restricted**. [Google's sharing instructions](https://support.google.com/drive/answer/7166529)

Viewers can browse. Editors can add books through the app and can also edit the spreadsheet directly. You can change or remove access in the Sheet's Share settings.

## 2. Enable Google APIs

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project. Use the same project for the following steps.
2. Enable each of these APIs in the project:
   - [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
   - [Google Picker API](https://console.cloud.google.com/apis/library/picker.googleapis.com)
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
   - [Google Books API](https://console.cloud.google.com/apis/library/books.googleapis.com) for book metadata lookup
3. Find the **project number** in the [project dashboard](https://console.cloud.google.com/home/dashboard). Save the numeric value for `appId` below. It is different from the project ID and the OAuth client ID.


### Create the web client

1. On the OAuth Overview page, click **Create OAuth client**, or open [Clients](https://console.cloud.google.com/auth/clients) and click **Create client**.
2. Set **Application type** to **websitelication**. Name it, for example, `Anna’s Annals Website`.
3. Under **Authorized JavaScript origins**, click **Add URI** and enter the website origin. For a Pages address like `https://YOUR-GITHUB-USERNAME.github.io/annas-annals/`, enter:

   ```text
   https://YOUR-GITHUB-USERNAME.github.io
   ```

   The origin has no repository path or trailing slash. Replace `YOUR-GITHUB-USERNAME` with your GitHub username. If you use a custom domain, use that site's origin instead.
4. To test on your own computer, click **Add URI** again and enter `http://localhost:8000`. Use this exact address and port when opening the local app.
5. Leave **Authorized redirect URIs** empty and leave **Use this client for an AI-powered agent** unchecked. Click **Create**.
6. Copy the **client ID** for `clientId` below. You can find it again in [Credentials](https://console.cloud.google.com/apis/credentials), under **OAuth 2.0 Client IDs**, using the copy icon. It ends in `.apps.googleusercontent.com`. Do **not** put the client secret in the repository.

The app requests the [`drive.file` scope](https://developers.google.com/workspace/sheets/api/scopes), which applies to files the user chooses to use with the app, rather than all of their Drive or Sheets files. Each user must have access to the Sheet **and** authorize the app to use it.

## 4. Create a browser API key

1. Open [Google Cloud credentials](https://console.cloud.google.com/apis/credentials), select the same project, and choose **Create credentials → API key**.
2. Name the key, for example `Anna’s Annals Picker`. Under **Select API restrictions**, choose **Google Picker API** and **Books API**. If either is missing, first enable it in the API Library. Include **Google Drive API** if needed by Picker. For an existing restricted key, add Books API to its allowed APIs; until then, book lookups fall back to Open Library.
3. Under **Application restrictions**, choose **Websites** and add the following entries for your GitHub Pages site and Google Picker, replacing `YOUR-GITHUB-USERNAME` with your GitHub username:

   ```text
   https://YOUR-GITHUB-USERNAME.github.io/*
   https://docs.google.com/*
   ```

   For local testing, add `http://localhost:8000/*` as a separate entry. Use your actual site hostname if it differs.
4. Click **Create** or **Save**. Copy the API key for `apiKey` below. You can return to **Credentials → API Keys** to view or edit its restrictions. Follow [Google's Picker setup guide](https://developers.google.com/workspace/drive/picker/guides/web-picker) if the Cloud Console labels change.

**The browser API key is public.** Anyone can inspect it in the published website or repository. Apply both website and API restrictions before publishing, and periodically review usage in Google Cloud. Restrictions reduce the risk of misuse but do not eliminate it; website referrers can be spoofed outside a browser. The key is not a substitute for a user's Google authorization or the Sheet's sharing permissions.

GitHub secret scanning may flag the key because it is published. If the restrictions were in place before publication and usage is expected, decide whether to resolve the alert as an intentionally exposed restricted browser key. If the key was unrestricted or usage is suspicious, create and restrict a replacement, update and test the app, then delete the old key. The replacement will also be public and may trigger another alert. See [Google's API key security guidance](https://docs.cloud.google.com/docs/authentication/api-keys-best-practices).

## 5. Add the configuration and publish

1. Edit [`config.js`](./config.js) and insert the three values between the quotes:

   ```js
   window.LIBRARY_CONFIG = {
     clientId: 'YOUR_WEB_CLIENT_ID',
     apiKey: 'YOUR_BROWSER_API_KEY',
     appId: 'YOUR_NUMERIC_PROJECT_NUMBER'
   };
   ```

2. Find the three values again if needed: the **client ID** under OAuth 2.0 Client IDs and the **API key** under API Keys on the [Credentials page](https://console.cloud.google.com/apis/credentials); the numeric **project number** under Project info on the [project dashboard](https://console.cloud.google.com/home/dashboard).
3. Commit and push the files to the branch you intend to publish. Never add a Google client secret, password, or access token to the repository.
4. On GitHub, open the repository's **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select the branch you pushed and **/ (root)**, and save. Open the repository’s **Actions** tab and check that the latest **pages build and deployment** run succeeds for that branch and commit. Open the displayed site URL when it is published. If an older version appears, check the deployed commit and try a private window or hard refresh. [GitHub Pages instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

### Alternative: host the static site with Caddy

The app is static HTML, CSS, and JavaScript; it does not need an application server or Google Apps Script. You can serve the published files from your own site instead of GitHub Pages. Browsers connect directly to Google and Open Library, so the existing Sheet can remain in Google Drive.

For example, copy the app's public files to `/srv/annas-annals` and serve them on a dedicated HTTPS subdomain:

```caddyfile
books.example.com {
    root * /srv/annas-annals
    file_server
}
```

Include `index.html`, `style.css`, the JavaScript files (including `config.js` and `service-worker.js`), `manifest.webmanifest`, and the `icons/` directory. Use the actual directory and domain for your server. Caddy must be able to read the files, and the domain and server must be configured for HTTPS. If you already serve the files with another web server, Caddy can reverse-proxy to it instead; a reverse proxy is not required for Caddy's own static file server.

Before using the new address:

1. Add its **origin**, such as `https://books.example.com`, to the web OAuth client's **Authorized JavaScript origins** in Google Cloud. An origin has no path or trailing slash.
2. Add the corresponding website restriction, such as `https://books.example.com/*`, to the browser API key. Keep any existing allowed origins and restrictions that you still use.
3. Open the new HTTPS address, sign in, and select the existing Sheet. Each user must still authorize the app and have access to that Sheet.

The public `config.js` contains the browser client ID, project number, and restricted API key; do not put a client secret or access token in the served files. Camera access and the service worker require a secure context, normally HTTPS. A new origin has separate browser storage, so users will need to reconnect and choose their preferences again; saved sessions and cached covers do not automatically move from the old address. The PWA cover cache does not make the catalog fully offline. In the app, use **Settings → App → Update app** to check for a service-worker update and reload the current page with a fresh URL; cached covers and saved preferences are not cleared.

## 6. Connect and use the library

1. Open the Pages site. Click **Create new library** to create and initialize a new Sheet, or **Connect Google Sheet** to select an existing one. A connected user can also select **New library** to create another Sheet.
2. Choose the Google account that owns the Sheet or that the Sheet was shared with. Approve the requested access.
3. If connecting an existing library, select it in Google Picker. If creating a library, enter a name and the app creates and opens it in your Google Drive. Each person connecting must choose the shared file for their own account. The app remembers the chosen Sheet in this browser and restores the catalog after a reload while the Google session is valid. After it expires, reconnect without selecting the Sheet again. Choose **Choose a different Sheet** if needed. If it isn't visible, look in the shared-files view and check that the correct Google account has access.
4. Search the catalog or choose **Add book**. Scan or type an ISBN, optionally look it up, review the details, and save. Choose **Edit** on a book to change or delete it. A viewer can browse but cannot save changes.

ISBN lookups use Google Books first and fill missing details from Open Library. The app uses Google’s main category when available, otherwise one Open Library subject; it does not change existing category values. Both sources may have incomplete or inaccurate data, so review the results before saving.

Book covers are loaded from Open Library by ISBN in card view, list view, and book details when available. In **Settings**, turn off **Show book covers** to hide cover previews and stop requesting them; this preference is stored in your current browser on this device. Images are not saved in your Google Sheet or Drive. The app caches up to 300 cover image files on this device for later visits; different image sizes count separately. Settings shows the cached image count and, when available, the browser’s estimate of site or cache storage (not necessarily the exact size of covers). Use **Settings → Clear cached covers** to remove this app-managed cache; covers can be downloaded again when displayed. Browsers may also maintain their own HTTP cache.

On iPhone, open the HTTPS site in Safari, tap Share, and choose **Add to Home Screen** to install the website. Other supported browsers offer their own install option. The cover cache belongs to the current site and browser or web-app storage, and can be removed by the device or user. Opening the app, signing in, and reading or updating the Google Sheet still require a network connection; this is not a fully offline catalog.

Google access tokens expire, so you may need to reconnect. The Sheet ID is stored in browser local storage, and the short-lived access token is stored in browser local storage so other windows on the same site can reconnect until the token expires. The token can remain in browser storage after windows close until it is replaced, cleared, or checked after expiry. Scripts running on this site can access that token. A catalog snapshot is also stored in session storage for fast reloads in the same tab. It can briefly be shown before a fresh permission check and remains available in that tab during a network outage; avoid this on shared devices. Closing the tab normally ends the session. Disconnect clears the stored session and forgets the Sheet across windows but does not revoke the Google grant. To revoke it, use your [Google Account connections](https://myaccount.google.com/connections).

## Troubleshooting and current limitations

- **“Setup needed”:** add all three values to `config.js` and republish.
- **Origin mismatch:** click **error details** in the Google sign-in popup and compare its `origin` with the exact origin in the OAuth client. Confirm the local browser URL, port, saved settings and client ID in `config.js`. Google changes may take time to propagate.
- **Access blocked during testing:** add the person's Google account as a test user and verify that the Sheet is shared with that account.
- **Sheet or header error:** select the new spreadsheet and confirm the `Books` tab and all sixteen headers match exactly (or a supported seven-, nine-, or ten-column format).
- **Can't save:** confirm the account has Editor access. If a save fails or its response is lost, refresh before retrying to avoid a duplicate.
- **Camera doesn't start:** open the site over HTTPS and allow camera access; you can also scan a photo or enter the ISBN manually. ISBN lookup sends the ISBN to [Open Library](https://openlibrary.org/); a missing match does not prevent manual entry. Valid ISBN-10 values are converted to ISBN-13 and saved without hyphens; ISBN-13 check digits are validated. Existing Sheet rows are not automatically rewritten.
- **Creating a library:** if a creation request fails or times out, check Google Drive before retrying; the Sheet might have been created even if the response was lost.
- **Updating an older library:** open it and select **Update library**. The app checks for unnamed data and formulas before adding missing headers and moving columns. If any contain data, move it before updating. Viewers cannot upgrade. The app sets updated_at when it saves a book; direct Sheet edits do not update it. Back up important Sheets and avoid concurrent Sheet edits during the update; the check and write are separate requests.
- **Shared edits:** simultaneous additions can create duplicate ISBNs. Before editing or deleting, the app checks whether the record has changed and stops if it finds a conflict. This check and the write are separate requests, so simultaneous edits or row changes between them can still overwrite or affect the wrong row. Avoid concurrent edits and verify changes in the Sheet. Long-term caching and migration are not implemented.

## Local development

1. Add `http://localhost:8000` to the OAuth client's JavaScript origins and `http://localhost:8000/*` to the API key's website restrictions, as described above. Save both changes; Google configuration changes may take time to propagate.
2. In a terminal, start the server from the repository folder:

   ```bash
   cd /path/to/annas-annals
   python3 -m http.server 8000
   ```

3. Open [http://localhost:8000](http://localhost:8000), connect with Google, and select a Sheet. Stop the server with **Ctrl+C**. Use the exact hostname and port above: `127.0.0.1` is a different OAuth origin.

Local and deployed apps can connect to the same Sheet, so local saves change real data. Create and select a separate test Sheet to avoid that. Save code changes and reload locally; changes reach GitHub Pages only after committing and pushing. Run scanner checks with `node --test tests/*.test.cjs`.

## Column order

The app uses header names rather than column positions. New libraries use a readable order; use **Update library** in the header to move an existing library's known columns into that order, followed by custom columns. The operation moves whole Sheet columns. Back up the Sheet and pause other edits first. Missing or duplicate required headers and unnamed columns with data must be fixed before reordering. The app also stops if it finds formulas in the Books tab. Changing column positions can affect external integrations or formulas in ways the app cannot verify; review them after reordering.

Books added directly to the Sheet appear after refresh when they have a title. To edit or delete one through the app, choose **Assign ID** on its card; the app checks the row and adds a unique ID. App-created books receive an ID automatically. The check and write are separate requests, so avoid simultaneous Sheet edits. Duplicate IDs must be resolved before editing.

## Import and export CSV

Use **Import CSV** to select a UTF-8 CSV and review its row count before importing. CSV headers use the Sheet field names; `title` is required and other known fields are optional. The import appends new records, generates new IDs and timestamps, and skips matches by normalized ISBN or by title and author (case-insensitive). This matching may skip distinct editions with the same title and author. Imports are limited to 1,000 rows and 2 MB at a time. The check and append are separate requests, so avoid simultaneous imports or Sheet edits. If the response is lost, refresh and inspect the Sheet before retrying.

**Export CSV** downloads all books currently loaded in the catalog, regardless of filters. Refresh first to include recent Sheet edits. Exports include app fields but not custom Sheet columns, formatting, formulas, or other tabs; use Google Sheets' own copy/version history for a full backup. Imported IDs and timestamps are regenerated. Treat CSV files as untrusted: spreadsheet programs may interpret cells beginning with formula characters when opened.

For testing, create a separate library and import [`test-data/open-library-200.csv`](./test-data/open-library-200.csv). It contains 200 real works from the [Open Library Search API](https://openlibrary.org/dev/docs/api/search), with title, author, first publication year, an ISBN for an associated edition, and a work link. Search results combine work-level and edition-level data: the ISBN may refer to a translation or different edition, and the year is the work's first publication year rather than necessarily that edition's publication year. Do not import test books into a library you want to keep clean.
