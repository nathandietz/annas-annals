# Anna’s Annals
Anna’s Annals is a free, minimal, opinionated progressive web app for cataloging and managing a personal library via a Google Sheet. The website UI is statically hosted on Github Pages while your catalog always lives in a your personal Google Drive. A Google Cloud project provides the API credentials and OAuth configuration for securely accessing, editing, and sharing.

## Why Google Cloud instead of an Apps Script?
Other tools that I discovered, used Apps Scripts to setup a catalog but would request read/write access to the entire Google Drive...which I found unacceptable! Why would I give some random person and their script access to everything?

By using a Google Cloud project, I can restrict the Anna’s Annals to requesting access to a single file—**the spreadsheets you choose**—nothing else! Plus it lets you use familiar Google tools for sign-in and controlling who can view or edit.

> [!NOTE] Requiring the full Google Drive access seems to be a limitation by AppsScript, but I’m not sure!

<details>
<summary>Compare Google Cloud and Apps Script</summary>

| | Google Cloud Project | Google Apps Script |
| --- | --- | --- |
| **What can the website access in Google Drive?** | 🟢 Only the spreadsheet(s) you select or create. | 🔴 Drive-wide read and write access. |
| **Who Can View Spreadsheet Data in the website?** | 🟢 Visitors must connect with a Google account that has access to the spreadsheet. | 🟡 In the public deployment, visitors can browse the catalog without having access to the spreadsheet itself. |
| **Who Can Edit?** | 🟢 The owner and anyone granted Editor access in Google Sheets. | 🔴 Anyone with the shared admin PIN, when one is configured. |
| **How Do You Share It?** | 🟢 Invite people through Google Sheets and assign them Viewer or Editor access. | 🔴 Share the website link for public browsing and the shared PIN for admin edits. |
| **How Do Users Connect?** | 🟢 Each user connects with their own Google account. | 🔴 The owner authorizes the script with their Google account. Visitors can browse without signing in. |
| **How Do You Choose a Spreadsheet?** | 🟢 Choose a spreadsheet with Google’s file picker. | 🟡 Paste the website URL (`/exec`) to connect to its configured spreadsheet. |
| **How Do You Create a Spreadsheet?** | 🟢 Create a spreadsheet directly in the website. | 🟡 Create a spreadsheet in Google Sheets, then run the script to set up the library tabs and Drive folders. |
| **How Do You Publish Updates?** | 🟢 Publish the updated website on GitHub Pages. | 🟡 For backend changes, create a new script version and update the existing deployment in the Apps Script editor. |
</details>

## What you will need to get started

1. **A Free Google account** to create Google Sheets and to create [Google Cloud Project](https://console.cloud.google.com/projectcreate).

2. **A Free GitHub account** to fork this repo and publish your own website using [GitHub Pages](https://docs.github.com/en/pages).

> [!TIP] No credit card or billing account is needed! Everything can be run for free on Google and Github.

## 1. Create Google Cloud Project & Enable APIs
1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project called `Anna’s Annals`. We will use this project for the enabled APIs, OAuth client, and browser API key.
2. Visit each link and Enable APIs for the newly created project:
   - [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
   - [Google Picker API](https://console.cloud.google.com/apis/library/picker.googleapis.com)
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
   - [Google Books API](https://console.cloud.google.com/apis/library/books.googleapis.com) (optional, but recommended)


> **As of 2026.11.23, no credit card or cloud billing account is needed for standard use.** You can enable Sheets, Picker, Drive, and Books API with billing turned off. Google may reject requests that exceed usage limits, and higher Workspace API quotas may require billing. [Google Cloud billing requirements](https://docs.cloud.google.com/docs/starter-tier#what_happens_if_your_account_isnt_eligible) · [Workspace API quota policy](https://developers.google.com/workspace/tools-safety)



## 2. Configure Google authorization

### Set up the Consent Screen
1. Open [Google Auth Platform → Overview](https://console.cloud.google.com/auth/overview). Make sure your **Home Library Catalog** project is selected.
2. If you see **Google Auth Platform not configured yet**, click **Get started**.
3. Under **App Information**, enter **Home Library Catalog** as the **App name**. Select your email for **User support email**, then click **Next**.
4. Under **Audience**, choose **External** if you’ll sign in with a personal Google account. Your spreadsheet’s sharing settings still control who can open it. Click **Next**.
5. Under **Contact information**, enter your email address. Review the Google API Services User Data Policy under **Finish**, accept it if you agree, then click **Continue** and **Create**.

### Add Test Users
1. Open [Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience) and check the Publishing status.
2. Keep the status set to `Testing`, then scroll down to "Test Users" and click `Add users`
3. Enter the email address of the Google account you’ll use to connect to the website.
4. Add anyone else who will use the website, then click `Save`
> [!WARNING] While the project is in Testing, each user must be on the "Test User" list to have access to the spreadsheet.

### Create the web client

> The web client identifies Anna’s Annals to Google. Its **Authorized JavaScript origins** tell Google where the app can start the consent flow, such as your GitHub Pages site or `http://localhost:8000` for local testing.

1. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients) and click **Create client**.
2. Set **Application type** to **Web application**. For **Name**, enter **Home Library Catalog Website**.
3. Under **Authorized JavaScript origins**, click **Add URI**. If your GitHub Pages website is at `https://YOUR-GITHUB-USERNAME.github.io/annas-annals/`, enter `https://YOUR-GITHUB-USERNAME.github.io`. Replace `YOUR-GITHUB-USERNAME` with your GitHub username. If you use a custom domain, enter that domain with `https://`. Leave out the path and trailing slash.
4. If you’ll test the website locally, click **Add URI** again and enter `http://localhost:8000`. Use that exact address when testing.
5. Leave **Authorized redirect URIs** empty and **Use this client for an AI-powered agent** unchecked. Click **Create**.

## 3. Create a browser API key

> The browser API key identifies your Google Cloud project when Anna’s Annals opens Google Picker so users can choose a spreadsheet, or looks up an ISBN through Google Books if enabled. The key is public, so restrict it to the websites and APIs the app uses.

1. Open [Google Cloud credentials](https://console.cloud.google.com/apis/credentials), select the same project, and choose **Create credentials → API key**.
2. Name the key, for example `Anna’s Annals Picker`. Under **Select API restrictions**, choose **Google Picker API** and **Google Drive API**. Add **Books API** if you enabled it. ISBN lookup uses Open Library when Google Books is unavailable.
3. Under **Application restrictions**, choose **Websites** and add the following entries for your GitHub Pages site and Google Picker, replacing `YOUR-GITHUB-USERNAME` with your GitHub username:

   ```text
   https://YOUR-GITHUB-USERNAME.github.io/*
   https://docs.google.com/*
   ```

   For local testing, add `http://localhost:8000/*` as a separate entry. Use your actual site hostname if it differs.
4. Click **Create** or **Save**. Follow [Google's Picker setup guide](https://developers.google.com/workspace/drive/picker/guides/web-picker) if the Cloud Console labels change.

>**The browser API key is public.** Anyone can inspect it in the published website or repository. Apply both website and API restrictions before publishing, and periodically review usage in Google Cloud. Restrictions reduce the risk of misuse but do not eliminate it; website referrers can be spoofed outside a browser. The key is not a substitute for a user's Google authorization or the Sheet's sharing permissions.

>GitHub secret scanning may flag the key because it is published. If the restrictions were in place before publication and usage is expected, decide whether to resolve the alert as an intentionally exposed restricted browser key. If the key was unrestricted or usage is suspicious, create and restrict a replacement, update and test the app, then delete the old key. The replacement will also be public and may trigger another alert. See [Google's API key security guidance](https://docs.cloud.google.com/docs/authentication/api-keys-best-practices).

## 4. Add the configuration and publish

1. Open [`config.js`](./config.js) for editing. Select the same Google Cloud project on each page below and paste each value into its matching field.

   | Field | Where to get the value |
   | --- | --- |
   | `clientId` | [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients). Open **Home Library Catalog Website** and copy the **Client ID** ending in `.apps.googleusercontent.com`. |
   | `apiKey` | [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). Under **API Keys**, find **Anna’s Annals Picker** and click **Show key** to copy it. |
   | `appId` | [Google Cloud → Project dashboard](https://console.cloud.google.com/home/dashboard). Under **Project info**, copy the numeric **Project number**. |

   ```js
   window.LIBRARY_CONFIG = {
     clientId: 'YOUR_WEB_CLIENT_ID',
     apiKey: 'YOUR_BROWSER_API_KEY',
     appId: 'YOUR_NUMERIC_PROJECT_NUMBER'
   };
   ```

2. Commit and push the files to the branch you intend to publish. Never add a Google client secret, password, or access token to the repository.
3. On GitHub, open the repository's **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select the branch you pushed and **/ (root)**, and save. Open the repository’s **Actions** tab and check that the latest **pages build and deployment** run succeeds for that branch and commit. Open the displayed site URL when it is published. If an older version appears, check the deployed commit and try a private window or hard refresh. [GitHub Pages instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

4. On the published site, choose **Create new library** to start a new Sheet or **Connect Google Sheet** to select an existing one.

## Local development

1. Add `http://localhost:8000` to the OAuth client's JavaScript origins and `http://localhost:8000/*` to the API key's website restrictions, as described above. Save both changes; Google configuration changes may take time to propagate.
2. In a terminal, start the server from the repository folder:

   ```bash
   cd /path/to/annas-annals
   python3 -m http.server 8000
   ```

3. Open [http://localhost:8000](http://localhost:8000), connect with Google, and select a Sheet. Stop the server with **Ctrl+C**. Use the exact hostname and port above: `127.0.0.1` is a different OAuth origin.

Local and deployed apps can connect to the same Sheet, so local saves change real data. Create and select a separate test Sheet to avoid that. Save code changes and reload locally; changes reach GitHub Pages only after committing and pushing. Run scanner checks with `node --test tests/*.test.cjs`.


