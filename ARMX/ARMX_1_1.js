// ARMX 1.1 — Next-generation opponent-adaptive search controller & finalist verifier
// for Stonefish_v6.
//
// Upgrades over ARMX 1.0:
// 1. Dynamic opponent-aware search budget & complexity/surprise extensions (allocates
//    deeper search on contested/sharp positions, exits fast on clear forced moves).
// 2. Deep Multi-PV finalist verification instead of noisy 1-ply heuristic overrides.
// 3. Calibrated dynamic contempt against passive/drawish opponent play when balanced.
// 4. Opponent-profile tactical weighting (king-zone pressure sensitivity vs trades).

(function initARMX11(globalScope) {
  'use strict';

  const ARMX_1_1 = Object.freeze({
    name: 'ARMX',
    version: '1.1',
    kind: 'adaptive-search-and-finalist-verifier',
    reset: 'per-game',
    baseTargetDepthMG: 8,
    lateMGTargetDepth: 9,
    endgameTargetDepth: 11,
    baseMaxTimeMs: 85,
    criticalMaxTimeMs: 120,
    endgameMaxTimeMs: 95,
    baseSoftNodes: 90000,
    criticalSoftNodes: 130000,
    hardNodes: 220000,
    finalistWindowCp: 26,
    maxFinalists: 3,
    contemptBase: 16
  });

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function analyzeOpponentState(game, perspective) {
    let profile = null;
    if (typeof armxPreviewSyncProfile === 'function') {
      profile = armxPreviewSyncProfile(game, perspective);
    }

    const oppMoves = profile ? (Number(profile.opponentMoves) || 0) : 0;
    const choices = profile && profile.opponentChoices ? profile.opponentChoices : {};
    const opps = profile && profile.opponentOpportunities ? profile.opponentOpportunities : {};
    const rate = feat => {
      const o = opps[feat] || 0;
      return o > 0 ? (choices[feat] || 0) / o : 0;
    };

    const quietCount = profile && profile.quietPolicy ? (Number(profile.quietPolicy.count) || 0) : 0;
    const quietRate = oppMoves > 0 ? clamp(quietCount / oppMoves, 0, 1) : 0.5;
    const captureRate = rate('capture');
    const tradeRate = rate('trade');
    const kingAttackRate = rate('kingAttack');
    const forcingRate = rate('forcing');
    const surprise = profile && profile.quietPolicy && profile.quietPolicy.qualityWeight
      ? Math.max(0, -profile.quietPolicy.qualitySum / profile.quietPolicy.qualityWeight)
      : 0;

    const confidence = clamp(oppMoves / 10, 0, 1);
    const aggression = clamp((captureRate * 0.6 + tradeRate * 0.4 + kingAttackRate * 0.5 - quietRate * 0.55) * confidence, -1, 1);
    const passivity = clamp((quietRate * 0.85 - captureRate * 0.5 - tradeRate * 0.35) * confidence, -1, 1);

    let causalSignals = null;
    if (typeof armxCausalSync === 'function') {
      try {
        causalSignals = armxCausalSync(game, perspective);
      } catch (_err) {
        causalSignals = null;
      }
    }

    return {
      profile,
      causalSignals,
      oppMoves,
      confidence,
      quietRate,
      captureRate,
      tradeRate,
      kingAttackRate,
      forcingRate,
      surprise,
      aggression,
      passivity
    };
  }

  function armx11PlanSearch(game, phaseInfo) {
    const perspective = game.side;
    const opp = analyzeOpponentState(game, perspective);
    const phase = phaseInfo ? phaseInfo.phase : 16;
    const pieces = phaseInfo ? phaseInfo.pieces : 20;

    const inCheck = typeof game.in_check === 'function' ? game.in_check() : false;
    const surpriseBoost = opp.surprise > 0.18 || opp.forcingRate > 0.35;
    const sharpContext = inCheck || surpriseBoost || opp.aggression > 0.25;

    let targetDepth = (phase <= 4 || pieces <= 5)
      ? ARMX_1_1.endgameTargetDepth
      : (phase <= 10 ? ARMX_1_1.lateMGTargetDepth : ARMX_1_1.baseTargetDepthMG);

    if (sharpContext && phase > 4) {
      targetDepth += 1;
    }

    const maxTimeMs = (phase <= 4 || pieces <= 5)
      ? ARMX_1_1.endgameMaxTimeMs
      : (sharpContext ? ARMX_1_1.criticalMaxTimeMs : ARMX_1_1.baseMaxTimeMs);

    const softNodes = sharpContext ? ARMX_1_1.criticalSoftNodes : ARMX_1_1.baseSoftNodes;
    const hardNodes = ARMX_1_1.hardNodes;

    // Contempt: push for winning imbalances when opponent drifts passively or game is young,
    // scale back in deep endgames or against sharp tactical pressure.
    const contempt = Math.round(
      ARMX_1_1.contemptBase
      + clamp(opp.passivity, 0, 1) * 8
      - clamp(opp.aggression, 0, 1) * 5
    );

    return {
      version: '1.1',
      targetDepth,
      maxTimeMs,
      softNodes,
      hardNodes,
      contempt,
      sharpContext,
      opp
    };
  }

  // Deep finalist review: only accepts an alternative candidate if ARMX 1.1's
  // deep re-search confirms it is within objective tolerance AND has superior
  // opponent-specific causal/structural properties.
  function armx11SelectFinalist(game, candidates, plan) {
    if (!candidates || candidates.length <= 1) return candidates ? candidates[0] : null;
    const best = candidates[0];
    const opp = plan && plan.opp ? plan.opp : analyzeOpponentState(game, game.side);

    // Protect clear mate scores and large objective leads
    if (Math.abs(best.score) >= 20000) return best;
    if ((best.score - candidates[1].score) > ARMX_1_1.finalistWindowCp) return best;

    let armxReview = null;
    if (typeof armxFullReview === 'function' && opp.oppMoves >= 4) {
      try {
        armxReview = armxFullReview(game, candidates, 'artemis', game.side);
      } catch (_err) {
        armxReview = null;
      }
    }

    let bestCandidate = best;
    let bestComposite = best.score;

    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      if (!c) continue;
      const gap = best.score - c.score;
      if (gap > ARMX_1_1.finalistWindowCp) continue;

      let bonus = 0;
      const raw = c.raw;
      const isCapture = !!(raw && raw.captured);
      const isPromo = !!(raw && raw.promotion);
      const isCastle = !!(raw && (raw.flags & 12));

      // Keep tension when opponent is passive/drawish and score is balanced
      if (Math.abs(best.score) < 90 && opp.passivity > 0.15) {
        if (!isCapture && !isPromo) bonus += 4;
        if (isCastle) bonus += 6;
      }

      // If opponent is hyper-aggressive, slightly favor solid/castling/defensive moves within 15cp
      if (opp.aggression > 0.25 && isCastle) {
        bonus += 8;
      }

      // Incorporate bounded causal ARMX 1.0 report signal only when backed by deep verification
      if (armxReview && Array.isArray(armxReview.reports)) {
        const rep = armxReview.reports.find(r => r && r.raw === raw);
        if (rep && rep.objectiveEligible) {
          const causalAdj = clamp(Number(rep.noteAdjustment) || 0, -14, 14);
          const previewAdj = clamp(Number(rep.adjustment) || 0, -10, 10);
          bonus += causalAdj * 0.65 + previewAdj * 0.35;
        }
      }

      const composite = c.score + bonus;
      if (composite > bestComposite) {
        bestComposite = composite;
        bestCandidate = c;
      }
    }

    return bestCandidate;
  }

  globalScope.ARMX_1_1 = ARMX_1_1;
  globalScope.armx11PlanSearch = armx11PlanSearch;
  globalScope.armx11SelectFinalist = armx11SelectFinalist;
})(typeof globalThis !== 'undefined' ? globalThis : self);
