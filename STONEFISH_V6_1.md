# StoneFish v6.1 development notes

## Target
- Approximately v6 playing strength or better.
- Same completed search depth / ply as v6.
- Long-term speed target: approximately 7x faster at matched depth.
- v6 remains the frozen comparison engine; v6.1 is separately selectable.

## First optimization pass
The first v6.1 fork keeps the v6 evaluator, search algorithm, ARMX 1.1 planning, and bounded finalist verification. It adds two semantics-preserving hot-path optimizations:

1. **Exact static-evaluation cache.** Entries are indexed by the 64-bit Zobrist key and validate both 32-bit halves before reuse. A collision can only evict an entry; it cannot return a wrong score.
2. **Adaptive repetition-history lookup.** v6 scans the full root history at every search node. v6.1 keeps the original short linear scan for histories under eight entries, then switches to open-addressed lookup with exact key comparisons.
3. **Selective evaluation caching.** Positions with more than 30 pieces or fewer than 12 pieces bypass the cache. Benchmarks showed that very dense opening/tactical boards and sparse endgames can cost more to cache than to evaluate; the cache is reserved for the middlegame band where repeated full evaluations are more expensive.

Evaluation values and search pruning are unchanged. Cache hit/miss counts are recorded in `SF61_LAST_SEARCH`.

## Validation
Run:
- `npm run lint`
- `node --test tests/v6_engine.test.js tests/v6_1_engine.test.js`
- `node benchmarks/v6_1_benchmark.cjs`

The benchmark uses the same fixed depth and budgets for both engines and reports medians for opening, middlegame, tactical, and endgame positions. It fails only when completed depths differ; it does **not** pretend the 7x target has been reached.

## Next engineering milestone
This JS optimization pass is a safe first step, not the final 7x solution. The larger speed target requires a compiled, self-contained v6.1 search kernel with v6-equivalent evaluation terms, incremental state, and search parity. The v5.5 C/WebAssembly kernel is the architecture reference, but its simpler evaluator must not be substituted for v6's positional knowledge without parity and strength testing.
