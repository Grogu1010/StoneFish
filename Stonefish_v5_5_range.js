// Stonefish v5.5 range — Athena, Ares and Artemis.
//
// All three models use the exact same native v5.5 chess engine and Full ARMX.
// Artemis adds no playstyle preference. Athena and Ares add bounded finalist
// style priors only after native search; mate-scale truth and large native score
// gaps remain protected.

const STONEFISH_V5_5_RANGE = Object.freeze({
  technology: 'Full ARMX',
  base: 'Stonefish v5.5 native PVS',
  models: Object.freeze({
    athena: Object.freeze({
      name: 'Stonefish_v5.5 Athena',
      style: 'athena',
      identity: 'extreme-defense',
    }),
    ares: Object.freeze({
      name: 'Stonefish_v5.5 Ares',
      style: 'ares',
      identity: 'extreme-aggression',
    }),
    artemis: Object.freeze({
      name: 'Stonefish_v5.5 Artemis',
      style: 'artemis',
      identity: 'balanced',
    }),
  }),
});

function stonefishV55RangeScoreAllMoves(game, style = 'artemis') {
  const perspective = game.side;
  const policy = armxFullOpponentPolicy(game, perspective, style);
  const host = stonefishV55HostSearch(game, policy);
  return armxFullRankHost(game, host, style);
}

function getStonefishV55AthenaMove(game) {
  const scored = stonefishV55RangeScoreAllMoves(game, 'athena');
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

function getStonefishV55AresMove(game) {
  const scored = stonefishV55RangeScoreAllMoves(game, 'ares');
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

function getStonefishV55ArtemisMove(game) {
  const scored = stonefishV55RangeScoreAllMoves(game, 'artemis');
  return scored.length ? stonefishV3PublicMove(game, scored[0].raw) : null;
}

function stonefishV55PreviewRankHost(game, host) {
  const finished=host&&Array.isArray(host.finished)?host.finished:[];
  if(!finished.length)return finished;
  const perspective=game.side;
  const provisional=finished[0];
  const provisionalRaw=provisional.raw;
  const profile=armxPreviewSyncProfile(game,perspective);
  const review=armxPreviewReview(
    game,finished.slice(0,Math.max(1,ARMX_PREVIEW.candidateLimit)),perspective
  );
  const reports=review&&Array.isArray(review.reports)?review.reports:[];
  const provisionalReport=stonefishV55FindARMXReport(reports,provisionalRaw);
  const proposedReport=stonefishV55BestARMXReport(reports,provisionalReport);
  const proposed=proposedReport?stonefishV55FindEntry(finished,proposedReport.raw):null;
  if(proposed&&provisionalReport&&!stonefishV5SameMove(proposed.raw,provisionalRaw)){
    provisional.armxOriginalScore=provisional.score;
    proposed.armxOriginalScore=proposed.score;
    const gate=stonefishV55ARMXChangeDecision(
      provisional,proposed,provisionalReport,proposedReport,
      review&&Number(review.observedPlies)||0
    );
    if(gate.allowed)stonefishV55ARMXPromoteReviewedCandidate(finished,proposed);
  }
  return finished;
}

// Developer-only decomposition controls. Neither is a release model.
// A: Full opponent-policy/search effort + frozen Preview finalist voting.
// B: Frozen Preview opponent-policy/search effort + Full-ARMX finalist voting.
function getStonefishV55DiagFullPolicyPreviewReviewMove(game){
  const perspective=game.side;
  const policy=armxFullOpponentPolicy(game,perspective,'artemis');
  const host=stonefishV55HostSearch(game,policy);
  const scored=stonefishV55PreviewRankHost(game,host);
  return scored.length?stonefishV3PublicMove(game,scored[0].raw):null;
}
function getStonefishV55DiagPreviewPolicyFullReviewMove(game){
  const perspective=game.side;
  const policy=armxPreviewOpponentPolicy(game,perspective);
  const host=stonefishV55HostSearch(game,policy);
  const scored=armxFullRankHost(game,host,'artemis');
  return scored.length?stonefishV3PublicMove(game,scored[0].raw):null;
}

function stonefishV55DiagSplitPolicies(game,perspective){
  const full=armxFullOpponentPolicy(game,perspective,'artemis');
  const preview=armxPreviewOpponentPolicy(game,perspective);
  const previewOrNeutral=preview||{
    observations:0,
    searchBudget:SF55C.nodes,
    maxDepth:SF55C.maxDepth,
    weights:new Float64Array(13),
    priority:()=>0,
    isLowPriority:()=>false,
  };
  return {
    fullBudgetPreviewOrdering:{
      ...full,
      weights:previewOrNeutral.weights,
      priority:previewOrNeutral.priority,
      isLowPriority:previewOrNeutral.isLowPriority,
    },
    previewBudgetFullOrdering:{
      ...previewOrNeutral,
      weights:full.weights,
      priority:full.priority,
      isLowPriority:full.isLowPriority,
    },
  };
}
function getStonefishV55DiagFullBudgetPreviewOrderingMove(game){
  const perspective=game.side;
  const policy=stonefishV55DiagSplitPolicies(game,perspective).fullBudgetPreviewOrdering;
  const host=stonefishV55HostSearch(game,policy);
  const scored=stonefishV55PreviewRankHost(game,host);
  return scored.length?stonefishV3PublicMove(game,scored[0].raw):null;
}
function getStonefishV55DiagPreviewBudgetFullOrderingMove(game){
  const perspective=game.side;
  const policy=stonefishV55DiagSplitPolicies(game,perspective).previewBudgetFullOrdering;
  const host=stonefishV55HostSearch(game,policy);
  const scored=stonefishV55PreviewRankHost(game,host);
  return scored.length?stonefishV3PublicMove(game,scored[0].raw):null;
}

if (typeof globalThis !== 'undefined') {
  globalThis.STONEFISH_V5_5_RANGE = STONEFISH_V5_5_RANGE;
  globalThis.stonefishV55RangeScoreAllMoves = stonefishV55RangeScoreAllMoves;
  globalThis.getStonefishV55AthenaMove = getStonefishV55AthenaMove;
  globalThis.getStonefishV55AresMove = getStonefishV55AresMove;
  globalThis.getStonefishV55ArtemisMove = getStonefishV55ArtemisMove;
  globalThis.getStonefishV55DiagFullPolicyPreviewReviewMove = getStonefishV55DiagFullPolicyPreviewReviewMove;
  globalThis.getStonefishV55DiagPreviewPolicyFullReviewMove = getStonefishV55DiagPreviewPolicyFullReviewMove;
  globalThis.getStonefishV55DiagFullBudgetPreviewOrderingMove = getStonefishV55DiagFullBudgetPreviewOrderingMove;
  globalThis.getStonefishV55DiagPreviewBudgetFullOrderingMove = getStonefishV55DiagPreviewBudgetFullOrderingMove;
}
