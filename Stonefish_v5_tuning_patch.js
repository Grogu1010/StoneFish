// Stonefish_v5 tuning pass 2.
// Keep the proven v5(testunit1) choice as a strong prior while the new all-move
// scorecard is tuned. Repetition is now treated as a near-terminal conversion
// error so v5 actively searches for a different winning route.
STONEFISH_V5_WEIGHTS.heritage = 1500;
STONEFISH_V5_WEIGHTS.repetition = 200000;
STONEFISH_V5_WEIGHTS.repetitionAhead = 300000;
