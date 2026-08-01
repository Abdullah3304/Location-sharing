# Connect PinTrail to Google Sheets

Each time someone allows location access, rows are added with location + phone details:

| … | Type | Session ID | Device ID | Device Name | Model | OS | Browser | Screen | Language | Timezone | User Agent |
|---|---|---|---|---|---|---|---|---|---|---|---|

- **Device ID / Device Name** — stable per phone (saved in browser). Filter by these to group one device.
- **Session ID** — one browser visit (current + live rows share it).
- **Type** `current` / `live`. Exact Location is reverse-geocoded for `current` only.

---

## Create the sheet (about 3 minutes)

### 1. Create the spreadsheet

1. Open [https://sheets.new](https://sheets.new)
2. Rename it to **Location Sharing**
3. Keep the default first tab (the script will create a **Locations** tab)

### 2. Install / upgrade the Apps Script

1. In the spreadsheet menu: **Extensions → Apps Script**
2. Delete any code in `Code.gs`
3. Copy everything from this repo file: `google-apps-script/Code.gs`
4. Paste it into the Apps Script editor
5. Click **Save** (disk icon)
6. Select function **UPGRADE_HEADERS_NOW** → **Run** → Allow permissions  
   (this expands the header row to Type / Session / Device columns)

### 3. Deploy the webhook (or New version if upgrading)

1. Click **Deploy → New deployment** (first time) or **Manage deployments → Edit → New version**
2. Type: **Web app**
3. Settings:
   - **Description:** PinTrail locations
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**
5. Authorize with your Google account (Advanced → Go to… → Allow)
6. **Copy the Web app URL** (ends with `/exec`)

### Admin live map

After the server has `ADMIN_MAP_KEY` in `.env`, open:

`http://localhost:3000/admin/map.html?key=YOUR_ADMIN_MAP_KEY`

It shows the latest pin per device and refreshes automatically.

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
