# v5.5 compiled helpers

`v5_5_helpers.c` implements the existing evaluation, legal move generation and
check detection. It has no imports, search algorithm or opponent state. Its
27 KB WebAssembly module is embedded in `Stonefish_v5_5_native.js`, so existing
browser, worker and command-line loaders need no asynchronous resource fetch.
The original JavaScript routines remain the fallback. Both v5.5 variants use
the same helpers, evaluation tables and legal move ordering.

Rebuild with Zig 0.14.1: set `ZIG` to its executable, then run
`node build_v5_5_kernel.cjs`. The script compiles without libc, checks that the
module has no imports, and updates only the marked generated section. Runtime
tables come from the shared JavaScript configuration, refreshed at each search.

`node benchmark_v5_5_kernel_contract.js` checks 5,524 varied and special-rule
positions, exact evaluation and move ordering, all 2,080 metadata combinations,
material-counter restoration, and 128 complete search fixtures with both the
compiled module and JavaScript fallback. Search scores, nodes and decisions
must match the saved prototype and original No-ARMX control.

Per-game memory and note-dependent search effort remain in `ARMX-preview.js`.
The helper module cannot identify opponents or retain notes between games.
