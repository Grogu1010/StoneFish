# ARMX mature-history timing

The old timing screen used 12–19 ply openings. That cannot exercise the 20-observation confidence policy or its earned search budget. Do not use those measurements as evidence of mature policy latency.

Run from the repository root after building the compiled kernel:

```sh
node tests/armx_causal_key_union.js
node tests/armx_timing_contract.js
GAMES=0 ARMX_TIMING_SAMPLES=40 RESULT_JSON=armx-timing.json node tests/v5_5_range.js
```

The default history requests are 12, 20, 36, 52, 68, 84, 100 and 116 plies. After a seeded opening, the frozen current v5.5 plays both sides to supply realistic histories. Games can end before the requested length; actual lengths are reported. History generation, cloning, cache preparation and warm-up are outside the clock.

Each position measures policy, native host search and review separately. Attributed overhead is policy plus review plus host time minus a neutral search through the same compiled kernel. Signed host differences are retained rather than clipped. Both cold complete-history replay and persistent same-perspective replay after two new plies are reported. Incremental preparation runs policy, host and review at the previous own turn, then replays the actual two moves outside timing. A deferred notebook may still need to catch up further during the measured turn.

`RELEASE_GATE=1` requires all six matchups with at least 100 balanced games each. Its existing 2× Full/Preview overhead limit now applies to both replay modes; the strength and personality requirements remain unchanged.

Rows expose actual history length, all timing components, policy availability, confidence activation, predictions and earned extra nodes. `REQUIRE_ACTIVE_POLICY_TIMING=1` additionally rejects a screen that never activates the experimental confidence policy in any style. This option is for confidence-policy branches; the deferred baseline has no such policy. Availability and confidence activation are separate fields. Mature history alone does not guarantee earned confidence.

For historical reproduction only:

```sh
ARMX_TIMING_HISTORY_PLIES=12,13,14,15,16,17,18,19 GAMES=0 node tests/v5_5_range.js
```

The fixture records serial local observations, source hashes and per-position timing components. These timings depend on the machine and are screens, not a release proof. Delayed short/long horizon updates use fixed row fields and compute weighted impacts once per trajectory; the contract compares every row against the original dynamic-field implementation. The causal union optimization preserves move-local interactions: expanding an aggregate feature union into interactions would invent alternatives the player never had. Contracts compare every available key, both perspectives' treatment/control rows and delayed trajectories, cold versus incremental decisions, repetition state and reset behavior.
