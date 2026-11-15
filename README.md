# Anna’s Annals

A simple book catalog with a GitHub Pages interface and a private, shareable Google Sheet as its database. You can browse and search, scan an ISBN with a camera or photo, look up book details, and add books.

**This version does not use Google Apps Script.** The website asks each person to authorize access with their own Google account and calls the Google Sheets API directly. The site itself is public; the Sheet stays private and controls who can read or edit it.

This is an early prototype. Google sign-in and opening a Sheet have been tried in a live deployment; scanner and shared-user flows still need broader testing. Editing and deleting books are not implemented yet.

## What you will need

- A GitHub repository where you can configure GitHub Pages.
- A Google account to own the Sheet and a [Google Cloud project](https://console.cloud.google.com/projectcreate) for the app's OAuth configuration.
- About three configuration values from Google Cloud: a **web client ID**, a **browser API key**, and the **numeric project number**. The client ID and project number identify the app. The browser API key is a publicly exposed credential and must be restricted as described below.

The steps below are a one-time setup for the app and its Sheet. Each additional user will then authorize the app and select the shared Sheet once they connect.

## 1. Prepare a private spreadsheet (optional)

You can skip this step and use **Create new library** in the app after setup. The app creates a new spreadsheet with a `Books` tab and the required headers. To use an existing Sheet or prepare one manually, follow these steps:

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

### Set up the consent screen

1. Open [Google Auth Platform → Overview](https://console.cloud.google.com/auth/overview). Confirm your project is selected at the top of the page.
2. If you see **Google Auth Platform not configured yet**, click **Get started**.
3. On **Project configuration → App Information**, enter an app name such as `Anna’s Annals` and select your email for **User support email**. Click **Next**.
4. Under **Audience**, select **External** if you want to use personal Google accounts. This does not make the Sheet public. Complete **Contact information** with your email, review the last screen, and click **Create**.
5. Open [Audience](https://console.cloud.google.com/auth/audience). If the publishing status is **Testing**, scroll to **Test users**, click **Add users**, and add the exact Google account you will use to sign in. Add each additional person's account as well. Save.

A Google account needs to be both a test user and a Sheet collaborator while the app is in Testing. A test user may still see an unverified-app warning. See [Google's OAuth setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

### Create the web client

1. On the OAuth Overview page, click **Create OAuth client**, or open [Clients](https://console.cloud.google.com/auth/clients) and click **Create client**.
2. Set **Application type** to **Web application**. Name it, for example, `Anna’s Annals Website`.
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
2. Name the key, for example `Anna’s Annals Picker`. Under **Select API restrictions**, choose **Google Picker API**. If it is missing, first enable it in the [API Library](https://console.cloud.google.com/apis/library/picker.googleapis.com). Include **Google Drive API** if needed by Picker.
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

## 6. Connect and use the library

1. Open the Pages site. Click **Create new library** to create and initialize a new Sheet, or **Connect Google Sheet** to select an existing one. A connected user can also select **New library** to create another Sheet.
2. Choose the Google account that owns the Sheet or that the Sheet was shared with. Approve the requested access.
3. If connecting an existing library, select it in Google Picker. If creating a library, enter a name and the app creates and opens it in your Google Drive. Each person connecting must choose the shared file for their own account. The app remembers the chosen Sheet in this browser and restores the catalog after a reload while the Google session is valid. After it expires, reconnect without selecting the Sheet again. Choose **Choose a different Sheet** if needed. If it isn't visible, look in the shared-files view and check that the correct Google account has access.
4. Search the catalog or choose **Add book**. Scan or type an ISBN, optionally look it up, review the details, and save. A viewer can browse but cannot save.

Google access tokens expire, so you may need to reconnect. The Sheet ID is stored in browser local storage, and the short-lived access token is stored in session storage to survive reloads in the same tab. Scripts running on this site can access that token. Catalog data is not deliberately stored in browser storage. Disconnect clears the session and forgets the Sheet but does not revoke the Google grant. To revoke it, use your [Google Account connections](https://myaccount.google.com/connections).

## Troubleshooting and current limitations

- **“Setup needed”:** add all three values to `config.js` and republish.
- **Origin mismatch:** click **error details** in the Google sign-in popup and compare its `origin` with the exact origin in the OAuth client. Confirm the local browser URL, port, saved settings and client ID in `config.js`. Google changes may take time to propagate.
- **Access blocked during testing:** add the person's Google account as a test user and verify that the Sheet is shared with that account.
- **Sheet or header error:** select the new spreadsheet and confirm the `Books` tab and all seven headers match exactly.
- **Can't save:** confirm the account has Editor access. If a save fails or its response is lost, refresh before retrying to avoid a duplicate.
- **Camera doesn't start:** open the site over HTTPS and allow camera access; you can also scan a photo or enter the ISBN manually. ISBN lookup sends the ISBN to [Open Library](https://openlibrary.org/); a missing match does not prevent manual entry.
- **Creating a library:** if a creation request fails or times out, check Google Drive before retrying; the Sheet might have been created even if the response was lost.
- **Shared edits:** simultaneous additions can create duplicate ISBNs. Editing, deletion, conflict handling, persistent caching and migration are not implemented.

## Local development

1. Add `http://localhost:8000` to the OAuth client's JavaScript origins and `http://localhost:8000/*` to the API key's website restrictions, as described above. Save both changes; Google configuration changes may take time to propagate.
2. In a terminal, start the server from the repository folder:

   ```bash
   cd /path/to/annas-annals
   python3 -m http.server 8000
   ```

3. Open [http://localhost:8000](http://localhost:8000), connect with Google, and select a Sheet. Stop the server with **Ctrl+C**. Use the exact hostname and port above: `127.0.0.1` is a different OAuth origin.

Local and deployed apps can connect to the same Sheet, so local saves change real data. Create and select a separate test Sheet to avoid that. Save code changes and reload locally; changes reach GitHub Pages only after committing and pushing. Run scanner checks with `node --test tests/*.test.cjs`.
