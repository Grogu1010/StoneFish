# PLEASE LOOK AT THIS BRANCH

This branch is a handoff/checkpoint for the StoneFish v5.5 + ARMX runtime optimization work.

## Goal

Keep the strength and behavior of the current full ARMX implementation, while reducing runtime so:

- v5.5 + ARMX <= 1.40x v5.5 No-ARMX
- Prefer lossless/performance-only changes that preserve search decisions and conclusions.
- If behavior/search effort is changed, use the direct 100-game acceptance test against current ARMX:
  - wins >= 40
  - losses <= 40
  - draws unrestricted (roughly 20 was the intended shape)

The important lesson so far is that simply reducing ARMX search effort can hit the speed target, but loses far too much strength.

## Baseline / reference behavior

Current ARMX uses the existing evidence/surprise driven extra-search policy:

- base v5.5 search: 1200 nodes, maxDepth 4
- ARMX can request substantially more search effort and up to +2 depth
- this extra search effort is a major part of ARMX's strength

Historical strength checkpoints already in the repo/work:

- current ARMX vs No-ARMX: about 72-74 wins per 100 in earlier runs
- current/integrated ARMX also strongly beat v5 Pro

The direct full-strength runtime problem is large. The latest full-strength measurement on this branch was:

- ARMX: 12.0137 ms/move
- No-ARMX: 2.4140 ms/move
- ratio: 4.9767x

That is still far above the 1.40x target.

## What worked safely

These changes are intended to be lossless and have passed the native/ARMX/parity contracts.

### 1. Incremental search-path / TT identity bookkeeping

The old search repeatedly built path identity strings using pathIds.join(',').

This was replaced with incremental numeric path signatures and nested TT buckets while preserving the same relevant history identity semantics.

Result:

- contract behavior preserved
- removes repeated string construction from the search hot path
- useful micro-optimization, but nowhere near enough by itself to solve the total ARMX overhead

### 2. Reuse move-order scratch arrays

Move ordering previously allocated a new Int32Array for priorities repeatedly.

The search now reuses per-ply priority buffers.

Result:

- parity/contracts passed
- lossless
- small allocation reduction

### 3. Remove temporary ARMX quiet-feature arrays

ARMX quiet-move scoring previously built a Float64Array of 13 features and then scored it.

The current branch has armxPreviewQuietMoveLogit(), which evaluates the exact same 13 feature values in the same accumulation order without the temporary feature-array allocation.

Result:

- ARMX contracts/parity passed
- behavior intended to be identical
- useful micro-optimization, but extra ARMX search still dominates runtime

### 4. Search-local make/undo experiment

The v5.5 search now has a preallocated search-local undo stack instead of using generic Chess.fastApply()/fastUndo() for every speculative search node.

The intent is to preserve the exact board/castling/en-passant/halfmove/fullmove/king-square state transition while avoiding generic history-state and runtime-cache-frame allocations at every node.

Important history:

- the first commit had a simple variable-reference typo (m was referenced from a root loop where e.raw was required)
- after that typo was fixed, the native search contract, ARMX memory contract, compiled-helper parity, learned reply/native-control parity, diagnostics, and benchmark all passed

This is a promising lossless implementation direction, but it did not by itself change the fundamental ARMX/No-ARMX ratio enough.

### 5. Reuse compiled-kernel board state within the same node

The WASM helper wrappers used to copy the same 64-square board into WASM separately for calls such as:

- in_check
- move generation
- evaluation

The current branch marks the compiled board dirty only after make/undo and reuses it for multiple same-position helper calls.

Result:

- native/ARMX/kernel/reply-policy parity checks passed
- latest full-strength ARMX-vs-No-ARMX timing remained about 4.98x
- therefore repeated board copying was not the dominant bottleneck

## What did NOT work

These experiments are intentionally documented so they are not repeated blindly.

### A. Hard-cap ARMX to base search (1200 nodes / depth 4)

This was very fast but changed behavior immediately and broke the golden/native expectations.

Rejected as a production/default change.

The experiment was moved behind ARMX_FAST_SCREEN so normal/default ARMX behavior stayed unchanged.

### B. 1200-node selective fallback candidate

A cheap ARMX search was used first, with selective full verification when certain host-gap or adaptation-rejection conditions fired.

100-game result vs current ARMX:

- 22 wins
- 65 losses
- 13 draws
- score 0.285

Timing:

- fast candidate about 3.47 ms/move
- current ARMX about 9.13 ms/move
- fast/current ratio about 0.38

The candidate was much too weak.

### C. Plain 1680-node / depth-4 candidate

This hit the speed target in the ARMX-vs-No-ARMX benchmark.

One run:

- ARMX vs No-ARMX timing ratio about 1.246x

But 100-game strength vs current ARMX was:

- 25 wins
- 67 losses
- 8 draws

Rejected.

### D. 1680-node + learned-reply LMR

This added an experimental reduction only for learned low-priority quiet opponent replies, with full-depth verification when the reduced probe raised alpha.

Short speed tests looked excellent. One early run measured roughly:

- ARMX 2.258 ms/move
- No-ARMX 2.229 ms/move
- ratio about 1.013x

A later direct 100-game test after the surrounding optimizations measured:

- 26 wins
- 66 losses
- 8 draws
- score 0.30

So this also fails the strength requirement badly.

The fast candidate was around 2.68-3.34 ms/move in different runs versus roughly 9.8-12.1 ms/move for current full ARMX, showing clearly that the strength loss tracks the removed search work.

Do not mistake the fast-mode timing for a successful solution.

## Important interpretation

The experiments strongly suggest:

1. ARMX's extra search is not incidental overhead; it contributes materially to its strength.
2. Cutting nodes/depth is the easy way to hit <=1.40x, but the tested cuts destroy too much playing strength.
3. The viable route is to make the same full ARMX search substantially cheaper per node, or eliminate repeated work across those nodes without changing conclusions.

## Most useful next optimization targets

The next person should focus on lossless hot-path work, especially:

### 1. Move-object and move-list allocation

The compiled move generator returns packed moves, but sf55cKernelMoves() currently creates:

- a new JS Array for every generated move list
- a new JS object for every move

This scales directly with node count and is likely a much larger ARMX tax than the already-tested 64-byte board copies.

Promising directions:

- per-ply reusable move buffers
- struct-of-arrays / packed integer move representation inside search
- decode fields only when needed
- preserve exact stable move order

This needs contract/parity validation because move order is search behavior.

### 2. TT allocation / nested Map overhead

Current TT handling still allocates/stores JS objects and nested Maps for many nodes.

Potential lossless directions:

- packed TT entries
- reusable entry storage
- integer keys where exact history identity can still be represented safely
- avoid per-entry object allocation

Must preserve:
- halfmove identity
- ply/mate-distance identity
- speculative repetition-path identity
- exact bound/depth semantics

### 3. Path/repetition bookkeeping

The string-join issue was removed, but Map operations remain on every searched position.

Potential direction:
- search-local integer IDs / arrays for exact path counts once a position has an ID
- preserve threefold-repetition semantics exactly

### 4. Compiled search core

The biggest remaining opportunity may be moving more of the recursive PVS/Q-search loop into the compiled kernel rather than crossing JS/WASM boundaries for helpers only.

That is more work, but unlike reducing nodes it can theoretically preserve the exact search while attacking the true per-node cost.

## Test gates to keep

Before treating any optimization as safe, keep running:

- node --check ARMX-preview.js
- node --check Stonefish_v5_5_native.js
- benchmark_v5_5_native_contract.js
- benchmark_armx_contract.js
- benchmark_v5_5_kernel_contract.js
- benchmark_armx_reply_policy.js
- benchmark_armx_preview.js

The learned-reply/native-control parity test covers a large fixed position set and has been useful for catching behavior changes.

For final performance validation, measure FULL ARMX against No-ARMX with ARMX_FAST_SCREEN disabled.

The target remains:

- full ARMX / No-ARMX <= 1.40x

If an optimization changes behavior/search effort, also require the 100-game candidate-vs-current-ARMX acceptance:

- wins >= 40
- losses <= 40

## Branch state warning

This branch intentionally contains BOTH:

- useful lossless optimization work
- experimental fast-screen / benchmark machinery used to prove that search-effort cuts are too weak

Do not merge the whole branch blindly.

In particular, ARMX_FAST_SCREEN / ARMX_FAST_NODES / ARMX_FAST_DEPTH / ARMX_FAST_POLICY_LMR are experiment controls, not a validated production solution.

The safest useful work here is the performance-only code that continues to pass the default contracts with fast mode disabled.

## Latest conclusion

The project is not finished.

What has been established with good confidence:

- micro/allocation optimizations can preserve ARMX behavior
- reducing ARMX search effort can reach the runtime target
- those tested reduced-effort candidates are far too weak
- full ARMX remains about 5x No-ARMX in the latest direct full-strength timing
- future work should optimize per-node representation, allocation, TT/path bookkeeping, or move more of the search core into compiled code

That is the current handoff point.
