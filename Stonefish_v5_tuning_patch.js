// Stonefish_v5 tuning pass 1.
// Keep the proven v5(testunit1) choice as a strong prior while the new all-move
// scorecard is tuned, and refuse casual repetition much more aggressively.
STONEFISH_V5_WEIGHTS.heritage = 1200;
STONEFISH_V5_WEIGHTS.repetition = 2500;
STONEFISH_V5_WEIGHTS.repetitionAhead = 6000;
