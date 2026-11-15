# Anna’s Annals

A simple book catalog with a GitHub Pages interface and a private, shareable Google Sheet as its database. You can browse and search, scan an ISBN with a camera or photo, look up book details, and add books.

**This version does not use Google Apps Script.** The website asks each person to authorize access with their own Google account and calls the Google Sheets API directly. The site itself is public; the Sheet stays private and controls who can read or edit it.

This is an early prototype. Google sign-in, Picker, scanning and sharing still need to be tested on a live deployment. Editing and deleting books are not implemented yet.

## What you will need

- A GitHub repository where you can configure GitHub Pages.
- A Google account to own the Sheet and a [Google Cloud project](https://console.cloud.google.com/projectcreate) for the app's OAuth configuration.
- About three configuration values from Google Cloud: a **web client ID**, a **browser API key**, and the **numeric project number**. These identify the app; they are not your Google password.

The steps below are a one-time setup for the app and its Sheet. Each additional user will then authorize the app and select the shared Sheet once they connect.

## 1. Prepare a private spreadsheet

1. Create a **new** spreadsheet at [Google Sheets](https://sheets.google.com/create).
2. Rename the first tab at the bottom to **Books**, exactly as written.
3. In the first row, put the following headers in seven separate cells, in this order:

   | A1 | B1 | C1 | D1 | E1 | F1 | G1 |
   | --- | --- | --- | --- | --- | --- | --- |
   | id | isbn | title | author | language | notes | created_at |

4. Keep this tab for the app's table. Do not select the old seven-tab library database: it has a different format and no migration has been built.
5. To share the catalog, click **Share**, add the other people's Google accounts, and assign **Viewer** or **Editor** access. Under **General access**, leave the Sheet **Restricted**. [Google's sharing instructions](https://support.google.com/drive/answer/7166529)

Viewers can browse. Editors can add books through the app and can also edit the spreadsheet directly. You can change or remove access in the Sheet's Share settings.

## 2. Enable Google APIs

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project. Use the same project for the following steps.
2. Enable each of these APIs in the project:
   - [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
   - [Google Picker API](https://console.cloud.google.com/apis/library/picker.googleapis.com)
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
3. Find the **project number** in the [project dashboard](https://console.cloud.google.com/home/dashboard). Save the numeric value for `appId` below. It is different from the project ID and the OAuth client ID.

## 3. Configure Google authorization

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview). Configure the branding and audience as prompted. Choose an audience that permits the Google accounts you intend to use; for personal accounts this is generally **External**.
2. If the app is in **Testing**, add your Google account and every intended user's Google account under **Audience → Test users**. Google may show an unverified-app warning during testing; publishing and verification requirements depend on your configuration. See [Google's OAuth setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
3. Open [Clients](https://console.cloud.google.com/auth/clients), create a client, and choose **Web application**.
4. Under **Authorized JavaScript origins**, add the site's origin. For a typical Pages address `https://yourname.github.io/annas-annals/`, the origin is `https://yourname.github.io`—without the repository path or trailing slash. If testing locally, also add the exact origin and port, such as `http://localhost:8000`.
5. Create the client and copy its **client ID** for `clientId` below. Do **not** put the client secret in this repository.

The app requests the [`drive.file` scope](https://developers.google.com/workspace/sheets/api/scopes), which applies to files the user chooses to use with the app, rather than all of their Drive or Sheets files. Each user must have access to the Sheet **and** authorize the app to use it.

## 4. Create a browser API key

1. Open [Google Cloud credentials](https://console.cloud.google.com/apis/credentials), choose **Create credentials → API key**, and copy the key for `apiKey` below.
2. Edit the key and set **Application restrictions** to **Websites**. Add your site's website pattern, for example `https://yourname.github.io/*`, and `https://docs.google.com/*`, which Google Picker requires. Add a localhost pattern if you will test locally.
3. Under **API restrictions**, restrict the key to the **Google Picker API** and, if needed by Picker, the **Google Drive API**. Follow [Google's Picker setup and key restriction guide](https://developers.google.com/workspace/drive/picker/guides/web-picker) if the Cloud Console labels change.

A browser API key is visible to site visitors; website and API restrictions limit where it can be used. It is not a substitute for the user's Google authorization.

## 5. Add the configuration and publish

1. Edit [`config.js`](./config.js) and insert the three values between the quotes:

   ```js
   window.LIBRARY_CONFIG = {
     clientId: 'YOUR_WEB_CLIENT_ID',
     apiKey: 'YOUR_BROWSER_API_KEY',
     appId: 'YOUR_NUMERIC_PROJECT_NUMBER'
   };
   ```

2. Commit and push the files to the branch you intend to publish. Never add a Google client secret, password, or access token to the repository.
3. On GitHub, open the repository's **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select the branch you pushed and **/ (root)**, and save. Open the displayed site URL when it is published. [GitHub Pages instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 6. Connect and use the library

1. Open the Pages site and click **Connect Google Sheet**.
2. Choose the Google account that owns the Sheet or that the Sheet was shared with. Approve the requested access.
3. In Google Picker, select the new spreadsheet. Each person connecting must choose the shared file for their own account. The app remembers the chosen Sheet in this browser and restores the catalog after a reload while the Google session is valid. After it expires, reconnect without selecting the Sheet again. Choose **Choose a different Sheet** if needed. If it isn't visible, look in the shared-files view and check that the correct Google account has access.
4. Search the catalog or choose **Add book**. Scan or type an ISBN, optionally look it up, review the details, and save. A viewer can browse but cannot save.

Google access tokens expire, so you may need to reconnect. The Sheet ID is stored in browser local storage, and the short-lived access token is stored in session storage to survive reloads in the same tab. Scripts running on this site can access that token. Catalog data is not deliberately stored in browser storage. Disconnect clears the session and forgets the Sheet but does not revoke the Google grant. To revoke it, use your [Google Account connections](https://myaccount.google.com/connections).

## Troubleshooting and current limitations

- **“Setup needed”:** add all three values to `config.js` and republish.
- **Origin mismatch:** ensure the exact site origin, without its path, is listed in the OAuth client's JavaScript origins. Check that you are using the intended Google Cloud project.
- **Access blocked during testing:** add the person's Google account as a test user and verify that the Sheet is shared with that account.
- **Sheet or header error:** select the new spreadsheet and confirm the `Books` tab and all seven headers match exactly.
- **Can't save:** confirm the account has Editor access. If a save fails or its response is lost, refresh before retrying to avoid a duplicate.
- **Camera doesn't start:** open the site over HTTPS and allow camera access; you can also scan a photo or enter the ISBN manually. ISBN lookup sends the ISBN to [Open Library](https://openlibrary.org/); a missing match does not prevent manual entry.
- **Shared edits:** simultaneous additions can create duplicate ISBNs. Editing, deletion, conflict handling, persistent caching and migration are not implemented.

For local development, serve the repository root with `python3 -m http.server 8000`, open `http://localhost:8000/`, and add the matching origin to your Google Cloud configuration. Run existing scanner checks with `node --test tests/*.test.cjs`.
