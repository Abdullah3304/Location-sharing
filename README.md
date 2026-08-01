# PinTrail — Location Sharing

A full-stack web app. When the user clicks **Press me to continue**, the browser Geolocation permission prompt appears. If granted, coordinates are saved silently to the **Node.js + Express** backend (JSON file). The page never displays location details or a “location shared” message.

## Features

- Separate frontend files: HTML, CSS, and JavaScript
- Location is requested only after the user clicks **Press me to continue**
- Coordinates are sent with `fetch()` only when permission is granted
- No location data or sharing confirmation shown in the UI
- Saved fields: `latitude`, `longitude`, `accuracy`, `timestamp`
- Ready for local development, **Render**, and **Vercel**

## Project structure

```
.
├── api/index.js          # Vercel serverless entry
├── lib/storage.js        # JSON file read/write helpers
├── public/
│   ├── index.html        # Continue page
│   ├── css/styles.css
│   └── js/app.js
├── server.js             # Express app + API
├── package.json
├── vercel.json
├── render.yaml
└── README.md
```

## Prerequisites

- Node.js 18 or newer
- npm

## Local setup

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Open [http://localhost:3000](http://localhost:3000).

Optional auto-restart during development:

```bash
npm run dev
```

### Try the flow

1. On the home page, click **Press me to continue**.
2. Approve the browser permission prompt.
3. The page shows a generic “You’re all set” message (no coordinates).
4. Confirm data was stored via `GET /api/locations` or in `data/locations.json`.

## API

### `POST /api/locations`

Body (JSON):

```json
{
  "latitude": 37.7749,
  "longitude": -122.4194,
  "accuracy": 12.5,
  "timestamp": 1712345678901
}
```

### `GET /api/locations`

Returns all stored locations (newest first). Useful for checking saved data; there is no public view page.

Data is written to `data/locations.json` locally (created automatically).

## Deploy to Render

1. Push this repo to GitHub.
2. In [Render](https://render.com), create a **Web Service** from the repo.
3. Use:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
4. Or connect the included `render.yaml` blueprint.

Render sets `PORT` automatically. Persistent disk is recommended if you need locations to survive redeploys; on the free plan the filesystem may reset when the service redeploys.

## Deploy to Vercel

1. Install the Vercel CLI or import the repo in the Vercel dashboard.
2. Deploy:

```bash
npx vercel
```

`vercel.json` routes all traffic through the Express app in `api/index.js`.

**Important:** Vercel’s filesystem is ephemeral. Saved locations may not persist across cold starts or instances. For durable production storage on Vercel, swap the JSON file for a hosted database (for example Neon Postgres or Vercel Blob). Local and Render deployments keep the simple JSON file approach.

## Notes on permissions

- The browser still shows its native location permission prompt (required by the Geolocation API).
- Coordinates are never shown on the website after save.
- Use HTTPS in production; most browsers require a secure context for geolocation (localhost is allowed for development).

## License

MIT
