# Connect PinTrail to Google Sheets

Each time someone presses **Press me to continue** and allows location access, a new row is added with:

| Received At | Latitude | Longitude | Accuracy (m) | Exact Location | Device Timestamp | Google Maps |
|---|---|---|---|---|---|---|

**Exact Location** is a reverse-geocoded street address from the coordinates.

---

## Create the sheet (about 3 minutes)

### 1. Create the spreadsheet

1. Open [https://sheets.new](https://sheets.new)
2. Rename it to **Location Sharing**
3. Keep the default first tab (the script will create a **Locations** tab)

### 2. Install the Apps Script

1. In the spreadsheet menu: **Extensions → Apps Script**
2. Delete any code in `Code.gs`
3. Copy everything from this repo file: `google-apps-script/Code.gs`
4. Paste it into the Apps Script editor
5. Click **Save** (disk icon)

### 3. Deploy the webhook

1. Click **Deploy → New deployment**
2. Click the gear icon → choose **Web app**
3. Settings:
   - **Description:** PinTrail locations
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**
5. Authorize with your Google account (Advanced → Go to… → Allow)
6. **Copy the Web app URL** (ends with `/exec`)

### 4. Connect the Node server

In the project root, create a `.env` file:

```bash
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_ID/exec
```

Install the env loader (already used by the server) and start:

```bash
npm install
npm start
```

### 5. Test

1. Open http://localhost:3000
2. Click **Press me to continue** and allow location
3. Open your Google Sheet → **Locations** tab
4. You should see a new row with lat, lng, and the exact address

---

## Deployed apps (Render / Vercel)

Add the same env var in the host dashboard:

- `GOOGLE_SHEETS_WEBHOOK_URL` = your Apps Script `/exec` URL

---

## Optional: Sheets API instead of Apps Script

If you prefer a service account, set these instead of the webhook:

```bash
GOOGLE_SHEET_ID=your_spreadsheet_id_from_the_url
GOOGLE_SHEET_TAB=Locations
GOOGLE_SERVICE_ACCOUNT_EMAIL=...@....iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Share the spreadsheet with the service account email as **Editor**, then run `npm install` (includes `googleapis`).
