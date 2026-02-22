# StoneFish

StoneFish is a tiny browser chess game where you play White against **StoneFish v1**, a deliberately weak engine that simply chooses a random legal move.

## Model structure

The engine now lives in its own folder:

- `models/StoneFish/model.js`

The web app loads that model and asks it for each Black move. This makes it easy to add future engines side-by-side (for example, `models/StoneFishV2/model.js`) without removing old ones.

## Run locally

Because it is a static site, you can open `index.html` directly in your browser, or run a simple local server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Features

- Play legal chess moves using `chess.js` rules.
- StoneFish v1 loaded from a dedicated model folder.
- Move history and game status panel.
- One-click new game.
