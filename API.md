# StoneFish public browser API

StoneFish exposes its released chess models to other websites through `stonefish-api.js`.

## Public model policy

The API intentionally exposes released models only:

- `v1` — Stonefish_v1
- `v2` — Stonefish_v2
- `v3` — Stonefish_v3
- `v4` — Stonefish_v4
- `v45` — Stonefish_v4.5
- `v5` — Stonefish_v5
- `v5pro` — Stonefish_v5 Pro
- `v55` — Stonefish_v5.5

Developer controls, No-ARMX builds, Athena/Ares/Artemis testunits, and future unreleased test models are not part of the public registry and cannot be selected through the API.

## Quick start

For a site that wants the newest version on `main`:

```html
<script src="https://cdn.jsdelivr.net/gh/Grogu1010/StoneFish@main/stonefish-api.js"></script>
<script>
  async function demo() {
    await StonefishAPI.ready;

    const game = await StonefishAPI.createGame(['e2e4', 'e7e5', 'g1f3']);
    const answer = await StonefishAPI.getMove('v55', game);

    console.log(answer.move);
    // { from, to, promotion, captured, uci }
  }

  demo();
</script>
```

For production, pin the CDN URL to a release tag or commit instead of `@main` so your site does not change when StoneFish changes.

## API

### `StonefishAPI.ready`

A Promise that resolves once the rules engine, released models, and ARMX runtime have loaded.

### `StonefishAPI.listModels()`

Returns the public model list. This is the supported way to populate a model picker. Do not hard-code developer/test builds.

### `await StonefishAPI.createGame(moves?)`

Creates a StoneFish `Chess` game. `moves` is optional and is an array of UCI strings or move objects.

Examples: `e2e4`, `g1f3`, `e7e8q`.

### `await StonefishAPI.getMove(modelId, state?)`

Asks one released model for a move without applying that move.

`state` can be:
- a game returned by `createGame()`;
- an array of moves from the normal starting position;
- `{ moves: [...] }`;
- omitted for the initial position.

The return object contains the model id/name, the chosen move, current FEN, and side to move.

### `await StonefishAPI.playMove(game, move)`

Applies a legal move to a game. Accepts a UCI string or `{ from, to, promotion }`.

### `await StonefishAPI.playBestMove(modelId, game)`

Chooses a model move and applies it in one call.

## Full example

```html
<!doctype html>
<html>
<body>
  <select id="model"></select>
  <button id="move">Let StoneFish move</button>
  <pre id="output"></pre>

  <script src="https://cdn.jsdelivr.net/gh/Grogu1010/StoneFish@main/stonefish-api.js"></script>
  <script>
    (async () => {
      await StonefishAPI.ready;

      const picker = document.querySelector('#model');
      for (const model of StonefishAPI.listModels()) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        picker.appendChild(option);
      }

      const game = await StonefishAPI.createGame(['e2e4']);

      document.querySelector('#move').addEventListener('click', async () => {
        const result = await StonefishAPI.playBestMove(picker.value, game);
        document.querySelector('#output').textContent =
          JSON.stringify(result, null, 2);
      });
    })();
  </script>
</body>
</html>
```

## Notes for integrators

StoneFish runs in the visitor's browser. Your server does not need to send board positions to StoneFish and there is no API key.

The engine dependencies are loaded from the same base URL as `stonefish-api.js`. That means the one-file loader works when served from jsDelivr, GitHub Pages, or your own copy of the repository.

The API accepts move history from the standard starting position rather than arbitrary FEN import. Supplying the move history preserves castling rights, en-passant state, repetition history, and the per-game context used by higher models.

Model calculation can be CPU-intensive, especially the strongest models. For interactive sites, disable the move button while awaiting a result. If you need many simultaneous analyses, isolate calls in workers or rate-limit them in your own UI.

Stonefish_v1 includes randomness by design, so repeated calls from the same position can return different legal moves.

## Versioning

The public API has its own `StonefishAPI.version`. New released models may be added to `listModels()` in later versions, but unreleased developer/test models should remain excluded.

For a stable production integration, pin your script URL to a StoneFish release tag or commit SHA.
