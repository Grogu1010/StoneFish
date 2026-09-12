// Stonefish v5 / v5 Pro inherited opening capability.
//
// v5 testunit1 preserved the strong pre-balance v4.5 opening profile (profile 0)
// and treated opening knowledge as an actual move choice after safety filtering.
// v5 and v5 Pro now preserve that capability at their own strength level:
// each engine evaluates the position normally first, then the profile-0 book may
// choose between that engine's top two candidates. Immediate mates always win.
// This keeps opening continuity without letting older three-ply-era safety rules
// override newer v5 / five-ply Pro search knowledge.

const STONEFISH_V5_INHERITED_OPENING_PROFILE = 0;
const STONEFISH_V5_INHERITED_OPENING_CANDIDATES = 2;

// Current v5/v5 Pro internals historically request profile 1 for their opening
// score signal. Preserve the old testunit1/base repertoire weights everywhere in
// the newer engines by mapping that request back to profile 0. v4.5 already uses
// profile 0, so its behavior is unchanged.
const stonefishV5InheritedBookBase = stonefishV45BookMove;
stonefishV45BookMove = function(game, profileIndex, allowedCandidates) {
  const inheritedProfile = profileIndex === 1
    ? STONEFISH_V5_INHERITED_OPENING_PROFILE
    : profileIndex;
  return stonefishV5InheritedBookBase(game, inheritedProfile, allowedCandidates);
};

function stonefishV5InheritedOpeningCandidates(scored) {
  const out = [];
  for (let i = 0; i < scored.length && out.length < STONEFISH_V5_INHERITED_OPENING_CANDIDATES; i += 1) {
    if (!scored[i] || !scored[i].raw || !Number.isFinite(scored[i].score)) continue;
    out.push(scored[i].raw);
  }
  return out;
}

function stonefishV5InheritedOpeningChoice(game, scored) {
  const allowed = stonefishV5InheritedOpeningCandidates(scored);
  if (!allowed.length) return null;
  return stonefishV45BookMove(game, STONEFISH_V5_INHERITED_OPENING_PROFILE, allowed);
}

const stonefishV5MoveAfterBook = getStonefishV5Move;
getStonefishV5Move = function(game) {
  const scored = stonefishV5ScoreAllMoves(game);
  if (!scored.length) return null;

  // Never let repertoire preference override a forced mate found by v5.
  if (scored[0].tactical >= STONEFISH_V5_MATE) {
    return stonefishV3PublicMove(game, scored[0].raw);
  }

  const book = stonefishV5InheritedOpeningChoice(game, scored);
  if (book) return stonefishV3PublicMove(game, book);
  return stonefishV3PublicMove(game, scored[0].raw);
};

if (typeof getStonefishV5ProMove === 'function') {
  const stonefishV5ProMoveAfterBook = getStonefishV5ProMove;
  getStonefishV5ProMove = function(game) {
    const scored = stonefishV5ProScoreAllMoves(game);
    if (!scored.length) return null;

    // Pro mate knowledge remains absolute; book only arbitrates ordinary top
    // candidates after the full selective five-ply evaluation has run.
    if (scored[0].score >= STONEFISH_V5_PRO_MATE * 0.9) {
      return stonefishV3PublicMove(game, scored[0].raw);
    }

    const book = stonefishV5InheritedOpeningChoice(game, scored);
    if (book) return stonefishV3PublicMove(game, book);
    return stonefishV3PublicMove(game, scored[0].raw);
  };
}
