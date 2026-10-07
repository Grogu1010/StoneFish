# Learned quiet-reply forecast: not promoted

This experiment retains Preview's exact host policy, weights, search budget and depth. It predicts a quiet reply distribution using frozen per-game Preview weights, then measures its quiescence-evaluated expectation relative to uniform replies. This is a conditional model: positions offering captures, promotions, forced moves or fewer than two replies cannot receive a forecast. Both provisional and challenger forecasts must complete before their differential can vote. Probes share at most 512 additional nodes. Forecast trust requires eight voluntary observations and positive pre-update prediction gain above 0.05; the bounded vote cannot bypass the existing host safety window.

The earlier reserved-budget research reduced host search even when the forecast could not contribute. This experiment avoids that tax. It also stops challenger probes when the provisional cannot be modelled and skips captured/promoting provisional moves. A separate 120-position check against the original review found identical final and shadow votes after this idle-work optimization.

| Opening indices | Games | Candidate | Control | Difference |
|---|---:|---:|---:|---:|
| 0–99 | 100 | 53.5% | 53.5% | 0.0 pp |
| 100–199 | 100 | 52.5% | 51.5% | +1.0 pp |
| 200–299 | 100 | 47.5% | 48.0% | −0.5 pp |
| Combined | 300 | 51.17% | 51.00% | +0.17 pp |

The net gain is only half a game point across 300 games. Eight outcomes improved and seven regressed. The forecast changed 209 moves, but did not demonstrate a reliable strength improvement. Local runtime screens also contained ratios above 2×. This branch is a research checkpoint; it does not update the default test units and does not qualify the >85% strength or personality gates. The fixture preserves hashes, all outcomes, per-batch activity and timing, plus an opening-pair score sign-flip diagnostic.

Reproduction, from the repository root:

```sh
node tests/armx_reply_forecast.js
node tests/armx_timing_contract.js
GAMES=100 MATCHUP=artemisVsCurrent START_INDEX=0 RESULT_JSON=forecast.json node tests/v5_5_range.js
ARMX_REPLY_FORECAST_OFF=1 GAMES=100 MATCHUP=artemisVsCurrent START_INDEX=0 RESULT_JSON=control.json node tests/v5_5_range.js
```

Repeat at start indices 100 and 200. The first two recorded controls are saved decision-equivalent foundation outcomes. The third was rerun using the explicit forecast-off flag. Both source fingerprints are recorded. Compare outcomes on the same opening and color, including draw half-points; do not promote from the positive second batch alone.
