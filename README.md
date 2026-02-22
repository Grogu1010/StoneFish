# StoneFish

StoneFish is a lightweight browser chess website where you play as White against **StoneFish v1**.

## Model architecture

The engine models live in the `StoneFish/` folder so older versions can stay in place as new models are added.

- `StoneFish/models/stonefish-v1.js` defines the random-move engine.
- `StoneFish/index.js` exposes a model registry and default model.
- `app.js` runs the game against whatever model is selected from the registry.

## Run locally

Any static server works. Example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
