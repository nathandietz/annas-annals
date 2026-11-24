# Anna’s Annals
Anna’s Annals is a free, minimal, opinionated progressive web app for cataloging and managing your personal library in a Google Sheet.

- Your [**GitHub Account**](https://docs.github.com/en/pages) hosts the web app via Github Pages
- Your [**Google Drive**](https://drive.google.com) stores the catalog in a private Google Sheet.
- Your [**Google Cloud project**](https://console.cloud.google.com/) provides Google sign-in and API access.
  
## Why Google Cloud instead of Google Apps Script?
Other catalog tools I tried used a [Google Apps Scripts](https://developers.google.com/apps-script) to quickly setup a catalog in Google Sheets. However because of how they were built and their functionality, they requested read/write access to the entire Google Drive. **I found this unacceptable.**

Anna’s Annals uses a Google Cloud project you create and manage. It requests Google’s drive.file permission, which limits the app’s access to spreadsheets you select or create through the app. You sign in with Google, and your Sheet’s sharing settings still control who can view or edit your catalog.

By using a Google Cloud project, I can restrict the Anna’s Annals to requesting access to a single file—**the spreadsheets you choose**—nothing else! Plus it lets you use familiar Google tools for sign-in and controlling who can view or edit. 


## What you will need to get started

1. **A Free Google account** to create Google Sheets and to create [Google Cloud Project](https://console.cloud.google.com/projectcreate).

2. **A Free GitHub account** to fork this repo and publish your own website using [GitHub Pages](https://docs.github.com/en/pages).

> [!TIP]
> No credit card or billing account is needed! Everything can be run for free on Google and Github.

## 1. Create Google Cloud Project & Enable APIs
1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project called `Anna’s Annals`. We will use this project for the enabled APIs, OAuth client, and browser API key.
3. Visit each link and Enable APIs for the newly created project:
   - [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
   - [Google Picker API](https://console.cloud.google.com/apis/library/picker.googleapis.com)
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
   - [Google Books API](https://console.cloud.google.com/apis/library/books.googleapis.com) (optional, but recommended)


> **As of 2026.11.23, no credit card or cloud billing account is needed for standard use.** You can enable Sheets, Picker, Drive, and Books API with billing turned off. Google may reject requests that exceed usage limits, and higher Workspace API quotas may require billing. [Google Cloud billing requirements](https://docs.cloud.google.com/docs/starter-tier#what_happens_if_your_account_isnt_eligible) · [Workspace API quota policy](https://developers.google.com/workspace/tools-safety)



## 2. Setup Google Auth Platform

### Set up the Consent Screen
1. Open [Google Auth Platform → Overview](https://console.cloud.google.com/auth/overview) and confirm the project you just created is selected.
2. You will likely see `Google Auth Platform not configured yet`. If you do click the `Get Started` button.
3. Under **App Information** enter a `App Name`  and `User Support Email`  click `Next`.
5. Under **Audience**, choose `External` and click `Next`
6. Under **Contact information**, enter your email address.
7. Under **Finish** review the Google API Services User Data Policy, accept it if you agree, then click `Continue` and `Create`.

### Add Users to can Access
1. Open [Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience) and check the Publishing status.
2. Keep the status set to `Testing`, then scroll down to "Test Users" and click `Add users`
3. Enter the email address of the Google account you’ll use to connect to the website.
4. Add the email of else who will use the website, then click `Save`
> [!Important]
> While the project is in Testing, each user must be on the "Test User" list to have access to the spreadsheet. Otherwise, they will not be able to access.

### Create the OAuth 2.0 Web Client
> The web client identifies Anna’s Annals to Google. Its **Authorized JavaScript origins** tell Google what domains have access

1. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients) and click `Create Client`.
2. Set **Application type** to `Web application`. For **Name**, enter `Anna’s Annals Website`.
3. Under **Authorized JavaScript origins**, click `Add URI` and add the following web address:
   
    ```text
    https://YOUR-GITHUB-USERNAME.github.io
    ```
   
4. Leave **Authorized redirect URIs** empty
5. Leave **Use this client for an AI-powered agent** unchecked.
6. Click `Create`.



## 3. Setup Google Cloud Credentials 
> [!IMPORTANT] 
> Because Anna’s Annals web app runs in the browser, it uses a publicly visible API key to identify your Google Cloud project when you choose a spreadsheet with Google Picker or look up an ISBN with Google Books.
> 
> However, this API key **DOES NOT GRANT ACCESS** to any Google Sheet data.
>
> To view or edit your Google Sheet, a user must first:
> 1. Sign in with a Google account that has permission to view or edit the Google Sheet.
> 2. Be added in **Test users** on [Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience)

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
5. Click `Create` or `Save`.


## 4. Setup Anna’s Annals and publish

1. Grab the `clientId`, `apiKey`, and `appId` values from the Google Links below
   | Field | Where to get the value |
   | --- | --- |
   | `clientId` | [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients). Open **Home Library Catalog Website** and copy the **Client ID** ending in `.apps.googleusercontent.com`. |
   | `apiKey` | [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). Under **API Keys**, find **Anna’s Annals Picker** and click **Show key** to copy it. |
   | `appId` | [Google Cloud → Project dashboard](https://console.cloud.google.com/home/dashboard). Under **Project info**, copy the numeric **Project number**. |
2. Open Anna’s Annals [`config.js`](./config.js), paste in your values, and save. 

   ```js
   window.LIBRARY_CONFIG = {
     clientId: 'YOUR_WEB_CLIENT_ID',
     apiKey: 'YOUR_BROWSER_API_KEY',
     appId: 'YOUR_NUMERIC_PROJECT_NUMBER'
   };
   ``` 
3. Commit and push the files to main on Github
4. Publish the Branch and visit the url!
    1. Open the repository's **Settings → Pages**.
    2. Under **Build and deployment**, choose **Deploy from a branch**, select the branch you pushed and **/ (root)**, and save.
    3. Open the repository’s **Actions** tab and check that the latest **pages build and deployment** run succeeds for that branch and commit.
    4. Open the displayed site URL when it is published.

7. On the published site, choose **Create new library** to start a new Sheet or **Connect Google Sheet** to select an existing one.

## Setup Local Development
> [!Warning]
> Local and deployed instances can connect to the same Google Sheet, so local saves change real data. Create and select a separate test Sheet to avoid that.

1. Add `http://localhost:8000` to [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients) → Authorized JavaScript origins 
   
2. Add `http://localhost:8000/*` to [Google Cloud credentials](https://console.cloud.google.com/apis/credentials) → Websites.

3. In a terminal, start the server from the repository folder:
   ```bash
   cd /path/to/annas-annals
   python3 -m http.server 8000
   ```
4. Open [http://localhost:8000](http://localhost:8000), connect with Google, and select a Sheet. Stop the server with **Ctrl+C**.

Save code changes and reload locally; changes reach GitHub Pages only after committing and pushing. Run scanner checks with `node --test tests/*.test.cjs`. 

Make sure to use the exact hostname and port above. `127.0.0.1` is a different OAuth origin.

## Compare Google Cloud and Apps Script
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