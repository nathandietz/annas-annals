# Anna’s Annals
Anna’s Annals is a free, minimal, opinionated progressive web app for cataloging and managing your personal library in a Google Sheet.
- Your [**GitHub Account**](https://docs.github.com/en/pages) hosts the web app via Github Pages
- Your [**Google Drive**](https://drive.google.com) stores the catalog in a private Google Sheet.
- Your [**Google Cloud project**](https://console.cloud.google.com/) provides Google sign-in and API access.

## Why Google Cloud instead of Google Apps Script?
Other catalog tools I tried, used a [Google Apps Script](https://developers.google.com/apps-script) to quickly setup a catalog in Google Sheets. However because of how they were built and their functionality, they requested read/write access to the entire Google Drive. **I found this unacceptable.**

With a Google Cloud project you create and manage, Anna’s Annals asks for access to only the spreadsheets you choose or create in the app. Plus, you get to use familiar Google tools to sign in and decide who can view or edit your catalog.

<details>
<summary>Compare Anna’s Annals with the Apps Script setup I tried</summary>
  
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

It does require a little more initial setup, but the end result is a catalog that lives in your own Google Sheet, with you in charge of who can see or edit it.



# Setup Anna’s Annals
## What you will need to get started
1. A **free GitHub account** to fork this repository and publish the app on [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#who-can-use-this-feature).
2. A **Free Google account** to create Google Sheets and to create [Google Cloud Project](https://console.cloud.google.com/projectcreate).

## 1. Create Google Cloud Project & Enable APIs
1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project called `Anna’s Annals`. We will use this project for the enabled APIs, OAuth client, and browser API key.
2. Visit each link and `Enable` APIs for the newly created project:
   - [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
   - [Google Picker API](https://console.cloud.google.com/apis/library/picker.googleapis.com)
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
   - [Google Books API](https://console.cloud.google.com/apis/library/books.googleapis.com)
 
> [!Important]
> **As of 2026.11.23, no credit card or cloud billing account is needed for standard use!** You can enable Sheets, Picker, Drive, and Books API with billing turned off.
> 
> Google may reject requests that exceed usage limits, and higher Workspace API quotas may require billing. [Google Cloud billing requirements](https://docs.cloud.google.com/docs/starter-tier#what_happens_if_your_account_isnt_eligible) · [Workspace API quota policy](https://developers.google.com/workspace/tools-safety)

## 2. Setup Google Auth Platform
### Set up the Consent Screen
1. Open [Google Auth Platform → Overview](https://console.cloud.google.com/auth/overview) and confirm the project you just created is selected.
2. You will likely see **Google Auth Platform not configured yet**. If you do click the `Get Started` button.
3. Under **App Information** enter a **App Name**  and **User Support Email**  click `Next`.
4. Under **Audience**, choose `External` and click `Next`
5. Under **Contact information**, enter your email address.
6. Under **Finish** review the **Google API Services User Data Policy**, accept it if you agree, then click `Continue` and `Create`.

### Add test users
1. Open [Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience) and keep the **publishing status** set to `Testing`.
2. Under **Test users**, click `Add users`. Enter the Google account you’ll use to connect and the accounts of anyone else who will use the app, then click `Save`.

While the OAuth app is in **Testing**, the test-user list controls who can connect through Anna’s Annals. To give someone access to your catalog, also share the Google Sheet with that account as a `Viewer` or `Editor`.

### Create the OAuth 2.0 Web Client
> The web client identifies Anna’s Annals to Google. **Authorized JavaScript origins** tell Google which websites can start Google sign-in.
1. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients) and click `Create Client`.
2. Set **Application type** to `Web application`. For **Name**, enter `Anna’s Annals OAuth Client`.
3. Under **Authorized JavaScript origins**, click `Add URI` and enter your GitHub Pages origin. Replace `YOUR-GITHUB-USERNAME` with your GitHub username and leave off the repository path (such as `/annas-annals`).
    ```text
    https://YOUR-GITHUB-USERNAME.github.io
    ```
4. Leave **Authorized redirect URIs** empty
5. Leave **Use this client for an AI-powered agent** unchecked.
6. Click `Create`.

## 3. Setup Google Cloud Credentials
> [!IMPORTANT]
> The browser API key is public and identifies your Google Cloud project to Google Picker and Google Books. Access to your private Sheet requires Google sign-in and permission on the Sheet.
1. Open [Google Cloud credentials](https://console.cloud.google.com/apis/credentials), select the same project, and choose
     - `Create credentials` → `API key`
     - Name it `Anna’s Annals API Key`
2. Under **Select API restrictions**, choose
    - `Google Picker API`
    - `Books API`
3. Under **Application restrictions**, choose `Websites` and add the following entries for your GitHub Pages site and Google Picker, replacing `YOUR-GITHUB-USERNAME` with your GitHub username:
   ```text
   https://docs.google.com/*
   https://YOUR-GITHUB-USERNAME.github.io/*
   ```
4. Click `Create` or `Save`.

## 4. Setup Anna’s Annals and publish
> [!Note]
> Publishing the web app on GitHub does leaves your Google Sheet’s sharing settings in place.

1. Grab the `clientId`, `apiKey`, and `appId` values from the Google Links below
    | Field | Where to get the value |
    | --- | --- |
    | `clientId` | [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients). Open `Anna’s Annals OAuth Client` and copy the **Client ID** ending in `.apps.googleusercontent.com`. |
    | `apiKey` | [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). Under **API Keys**, find `Anna’s Annals API Key` and click `Show key` to copy it. |
    | `appId` | [Google Cloud → Project dashboard](https://console.cloud.google.com/home/dashboard). Under **Project info**, copy the numeric **Project number**. | 
2. Open Anna’s Annals [`config.js`](./config.js), paste in your values, and save. 
   ```js
   window.LIBRARY_CONFIG = {
     clientId: 'YOUR_WEB_CLIENT_ID',
     apiKey: 'YOUR_BROWSER_API_KEY',
     appId: 'YOUR_NUMERIC_PROJECT_NUMBER'
   };
   ``` 
3. Commit and push the files to the `main` branch of your GitHub fork.
4. Make sure your fork of Anna’s Annals is public, not private. This is required to use [GitHub Pages on GitHub Free](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).
5. In your fork, open `Settings → Pages`. Under **Build and deployment**, choose `Deploy from a branch`, select `main` and `/ (root)`, then click `Save`.
6. Check the `Actions` tab for the **pages build and deployment** run. Once it succeeds, open the site URL shown in **Settings → Pages**.
7. On the published site, choose `Create new library` to start a new Sheet or `Connect Google Sheet` to open an existing Anna’s Annals library. An existing library must have a `Books` tab with `id` and `title` as column headers in the first row. If other library columns are missing, editors can use `Settings → Update library` before saving books.

# Local Development
> [!Warning]
> Local and deployed instances can connect to the same Google Sheet, so local saves change real data. Create and select a separate test Sheet to avoid that.

1. Add `http://localhost:8000` to [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients) → **Authorized JavaScript origins**
2. Add `http://localhost:8000/*` to [Google Cloud credentials](https://console.cloud.google.com/apis/credentials) → `Websites`.
3. In a terminal, start the server from the repository folder:
   ```bash
   cd /path/to/annas-annals
   python3 -m http.server 8000
   ```
4. Open [http://localhost:8000](http://localhost:8000), connect with Google, and select a Sheet. Stop the server with `Ctrl+C`.

Save code changes and reload locally; changes reach GitHub Pages only after committing and pushing. Run scanner checks with `node --test tests/*.test.cjs`. 

Make sure to use the exact hostname and port above. `127.0.0.1` is a different OAuth origin.