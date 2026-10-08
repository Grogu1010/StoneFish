// Experimental Full ARMX causal-horizon alignment.
//
// armxCausalSync resolves pending trajectories before applying the move at
// currentPly. Therefore an event created after move index N has only seen one
// completed future ply when currentPly === N + 2. The production queue currently
// labels that point as the 2-ply horizon (and N + 4 as the 4-ply horizon), which
// makes the delayed treatment/control evidence one ply too early.
//
// This override keeps every other ARMX rule unchanged and shifts both causal
// horizons by one index so "2 plies" and "4 plies" mean two and four completed
// moves after the observed candidate.
function armxCausalQueueTrajectory(book,map,available,chosen,afterScore,index){
  book.pendingTrajectories.push({
    map,available:[...available],chosen:new Set(chosen),
    afterScore,lastScore:afterScore,maxStep:0,
    observationId:index,
    shortAt:index+ARMX_CAUSAL_SHORT_PLIES+1,
    longAt:index+ARMX_CAUSAL_LONG_PLIES+1,
    shortDone:false,
  });
}
