(function (global) {
    const PIECE_VALUES = { p:1, n:3, b:3, r:5, q:9, k:100 };

    const POS = {
        PAWN_CENTER: 0.3, KNIGHT_CENTER: 0.4, BISHOP_DEVELOPED: 0.25,
        ROOK_OPEN_FILE: 0.5, KING_CASTLED: 0.6,
        PASSED_PAWN: 0.5, PASSED_SUPPORTED_BONUS: 0.2,
        ISOLATED_PAWN: -0.25, DOUBLED_PAWN: -0.3, RIM_KNIGHT: -0.3, EXPOSED_KING: -0.6,
    };

    // ---------- Basics ----------
    const getPieceValue = t => PIECE_VALUES[t] || 0;

    function cloneGameWithTurn(game, turn) {
        const parts = game.fen().split(' ');
        parts[1] = turn;
        return new Chess(parts.join(' '));
    }
    const ensureTurn = (g,t)=> g.turn()===t? g : cloneGameWithTurn(g,t);

    function simulateMove(game, move) {
        const sim = new Chess(game.fen());
        const ok = sim.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
        return ok ? sim : null;
    }

    // ---------- Squares / board ----------
    const fileIndex = sq => sq.charCodeAt(0)-97;
    const rankIndex = sq => parseInt(sq[1],10)-1;
    const squareFromBoardIndices = (f,row) => String.fromCharCode(97+f)+(8-row);
    const boardArray = g => g.board();
    const pieceAt = (g,sq) => g.get(sq);

    // ---------- Positional helpers ----------
    function isCenterPawnSquare(sq){ const f=sq[0], r=rankIndex(sq)+1; return (f==='d'||f==='e') && (r===4||r===5); }
    function isKnightCenterSquare(sq){ const f=fileIndex(sq), r=rankIndex(sq); return f>=2&&f<=5&&r>=2&&r<=5; }
    function isRimSquareForKnight(sq){ const f=fileIndex(sq), r=rankIndex(sq); return f===0||f===7||r===0||r===7; }
    function countPawnsOnFile(g,file,color=null){
        let c=0; for(let r=1;r<=8;r++){ const sq=String.fromCharCode(97+file)+r; const p=pieceAt(g,sq);
            if(p&&p.type==='p'&&(!color||p.color===color)) c++; } return c; }
    const isOpenFileFor = (g,file)=> countPawnsOnFile(g,file,null)===0;
    function isIsolatedPawn(g,sq,color){ const f=fileIndex(sq);
        const left = f>0? countPawnsOnFile(g,f-1,color):0;
        const right= f<7? countPawnsOnFile(g,f+1,color):0;
        return (left+right)===0; }
    const isDoubledPawn=(g,file,color)=> countPawnsOnFile(g,file,color)>=2;
    function isPassedPawn(g,sq,color){
        const f=fileIndex(sq), r=rankIndex(sq), dir = color==='w'?1:-1;
        for(let df=-1; df<=1; df++){ const ff=f+df; if(ff<0||ff>7) continue;
            for(let rr=r+dir; rr>=0 && rr<8; rr+=dir){
                const p=pieceAt(g, String.fromCharCode(97+ff)+(rr+1));
                if(p && p.type==='p' && p.color!==color) return false;
            }
        } return true;
    }
    function isSupportedPassed(g,sq,color){
        const f=fileIndex(sq), r=rankIndex(sq), dr=color==='w'?-1:1, rr=r+dr;
        if(rr<0||rr>7) return false;
        for(const df of [-1,1]){ const ff=f+df; if(ff<0||ff>7) continue;
            const p=pieceAt(g, String.fromCharCode(97+ff)+(rr+1));
            if(p && p.type==='p' && p.color===color) return true;
        } return false;
    }
    function kingSquare(g,color){
        const b=boardArray(g);
        for(let row=0;row<8;row++) for(let f=0;f<8;f++){
            const p=b[row][f]; if(p&&p.type==='k'&&p.color===color) return squareFromBoardIndices(f,row);
        } return null;
    }
    const isCastled = (g,color)=>{ const ks=kingSquare(g,color); return ks==='g1'||ks==='c1'||ks==='g8'||ks==='c8'; };
    function kingExposed(g,color){
        const ks=kingSquare(g,color); if(!ks) return false;
        const f=fileIndex(ks), shieldRank=color==='w'?2:7;
        let miss=0; for(const df of [-1,0,1]){ const ff=f+df; if(ff<0||ff>7) continue;
            const p=pieceAt(g, String.fromCharCode(97+ff)+shieldRank);
            if(!(p && p.type==='p' && p.color===color)) miss++;
        } return miss>=2;
    }

    // ---------- Threats / captures ----------
    function getCaptureMovesForColor(game,color){
        const view=ensureTurn(game,color);
        return view.moves({verbose:true}).filter(m=>m.captured);
    }
    function getThreatenedPiecesMap(game,color){
        const opp=color==='w'?'b':'w';
        const view=ensureTurn(game,opp);
        const caps=view.moves({verbose:true}).filter(m=>m.captured);
        const map=new Map();
        for(const mv of caps){
            let square = mv.to;
            if(mv.flags && mv.flags.includes('e')){ // en passant target square adjust
                const dir = opp==='w' ? -1 : 1;
                const f=fileIndex(mv.to), r=rankIndex(mv.to)+dir;
                square = String.fromCharCode(97+f)+(r+1);
            }
            const piece=view.get(square);
            if(!piece || piece.color!==color) continue;
            const ex=map.get(square);
            const atk={from:mv.from,piece:mv.piece,value:getPieceValue(mv.piece)};
            if(ex){ ex.attackers.push(atk); }
            else map.set(square,{square,piece,value:getPieceValue(piece.type),attackers:[atk]});
        }
        return map;
    }
    function ourMaxThreatValueAfter(sim,ourColor){
        let mx=0; for(const m of getCaptureMovesForColor(sim,ourColor)) mx=Math.max(mx,getPieceValue(m.captured));
        return mx;
    }
    const isPromotionDescendant=(orig,res)=> !!(orig&&res&&orig.type==='p'&&res.color===orig.color&&res.type!=='p');

    function computeValueSaved(move, sim, color, thBefore, thAfter){
        if(!thBefore.size) return 0;
        let saved=0; const MAX=30;
        const dest=move.to, destPiece=sim.get(dest);
        thBefore.forEach((entry, sq)=>{
            const pieceBefore=entry.piece, movedThis = move.from===sq;
            if(movedThis){
                if(!destPiece || destPiece.color!==color) return;
                const sameType = destPiece.type===pieceBefore.type;
                const promoted = isPromotionDescendant(pieceBefore,destPiece);
                if(!sameType && !promoted) return;
                if(thAfter.has(dest)) return;
                saved += entry.value; return;
            }
            const still=sim.get(sq);
            if(!still || still.color!==color) return;
            if(thAfter.has(sq)) return;
            saved += entry.value;
        });
        return Math.min(saved, MAX);
    }

    // ---------- Meta / scoring helpers ----------
    const isCheckMove = mv => !!(mv && typeof mv.san==='string' && (mv.san.includes('+')||mv.san.includes('#')));
    function isDevelopingMove(mv, piece, color){
        if(!piece || piece.type==='p') return false;
        const home = color==='w'?'1':'8'; return mv.from.endsWith(home);
    }
    const lexicalKey = mv => `${mv.from}-${mv.to}-${mv.promotion||''}`;

    function positionalPoints(g,color){
        let pts=0; const b=boardArray(g);
        for(let row=0;row<8;row++) for(let f=0;f<8;f++){
            const p=b[row][f]; if(!p||p.color!==color) continue;
            const sq=squareFromBoardIndices(f,row);
            switch(p.type){
                case 'p':
                    if(isCenterPawnSquare(sq)) pts+=POS.PAWN_CENTER;
                    if(isIsolatedPawn(g,sq,color)) pts+=POS.ISOLATED_PAWN;
                    if(isDoubledPawn(g,f,color)) pts+=POS.DOUBLED_PAWN;
                    if(isPassedPawn(g,sq,color)){ pts+=POS.PASSED_PAWN; if(isSupportedPassed(g,sq,color)) pts+=POS.PASSED_SUPPORTED_BONUS; }
                    break;
                case 'n':
                    if(isKnightCenterSquare(sq)) pts+=POS.KNIGHT_CENTER;
                    if(isRimSquareForKnight(sq)) pts+=POS.RIM_KNIGHT;
                    break;
                case 'b': {
                    const back=color==='w'?1:8; if((rankIndex(sq)+1)!==back) pts+=POS.BISHOP_DEVELOPED;
                    break;
                }
                case 'r': if(isOpenFileFor(g,f)) pts+=POS.ROOK_OPEN_FILE; break;
                case 'k':
                    if(isCastled(g,color)) pts+=POS.KING_CASTLED;
                    if(kingExposed(g,color)) pts+=POS.EXPOSED_KING;
                    break;
            }
        }
        return pts;
    }

    // ---------- NEW: mate & draw policy + repetition control ----------
    function isMateInOneMove(game, move){
        const sim=simulateMove(game,move);
        return !!(sim && sim.in_checkmate && sim.in_checkmate());
    }
    function opponentHasMateInOneAfter(sim){
        const oppMoves=sim.moves({verbose:true});
        for(const mv of oppMoves){
            const sim2=simulateMove(sim,mv);
            if(sim2 && sim2.in_checkmate && sim2.in_checkmate()) return true;
        }
        return false;
    }
    function materialBalanceFor(game, color){
        const b=game.board(); let ours=0,theirs=0;
        for(const row of b) for(const p of row){ if(!p) continue;
            const v=getPieceValue(p.type); if(p.color===color) ours+=v; else theirs+=v; }
        return ours-theirs;
    }
    const isImmediateDraw = sim =>
        (sim.in_stalemate && sim.in_stalemate()) || (sim.insufficient_material && sim.insufficient_material()) || false;

    // Build a small window of recent FEN counts (with full history) to detect repetition risks.
    function recentFenCounts(game, windowPlies = 12){
        const h = game.history({ verbose: true }) || [];
        const base = new Chess(); // startpos
        const fens = [base.fen()];
        for(const mv of h){ base.move({from:mv.from,to:mv.to,promotion:mv.promotion||'q'}); fens.push(base.fen()); }
        const counts = new Map();
        const start = Math.max(0, fens.length - windowPlies);
        for(let i=start;i<fens.length;i++){
            const fen=fens[i]; counts.set(fen, (counts.get(fen)||0)+1);
        }
        return counts;
    }
    function causesImmediateThreefold(sim, fenCounts){
        const fen = sim.fen();
        const seen = fenCounts.get(fen) || 0;
        // if this exact position (incl. side-to-move) has already occurred twice in the recent window,
        // playing into it now is very likely to complete threefold.
        return seen >= 2;
    }
    // also block moves that let the opponent force a draw in one (stalemate/insufficient)
    function opponentHasImmediateDrawAfter(sim){
        const opp=sim.moves({verbose:true});
        for(const mv of opp){
            const s2=simulateMove(sim,mv);
            if(!s2) continue;
            if(isImmediateDraw(s2)) return true;
        }
        return false;
    }

    // ---------- Engine ----------
    class StonefishV3 {
        constructor(){
            this.id='v3';
            this.name='StoneFish V3';
            this.description='V2.5 tactics + positional scoring + mate/draw policy + anti-repetition';
        }

        chooseMove(game){
            if(!game || typeof game.moves!=='function'){ console.warn('StoneFish V3 invalid game'); return null; }
            const legal = game.moves({ verbose: true });
            if(!legal.length) return null;

            const color = game.turn();
            const threatenedBefore = getThreatenedPiecesMap(game, color);
            const inCheck = game.in_check ? game.in_check() : false;

            // 0) Take mate-in-1 immediately
            for(const mv of legal){ if(isMateInOneMove(game,mv)) return mv; }

            // Draw policy context & repetition window
            const mat = materialBalanceFor(game, color);
            const allowDraws = mat <= -4;                 // only accept draw moves when losing badly
            const fenCounts = recentFenCounts(game, 12);  // short rolling window

            // Buckets
            let bestSafeNonDraw = null, bestSafeOrDraw = null, bestAny = null;

            const betterThan = (a,b)=>{
                if(!b) return true;
                if(a.score!==b.score) return a.score>b.score;
                if(a.givesCheck!==b.givesCheck) return a.givesCheck;
                if(a.develops!==b.develops) return a.develops;
                return a.lexical < b.lexical;
            };

            // Precompute current positional for progress bias
            const currentPosPts = positionalPoints(game, color);

            for(const move of legal){
                const sim = simulateMove(game, move);
                if(!sim) continue;

                // Safety / draw / repetition gates
                const unsafe = opponentHasMateInOneAfter(sim);
                const drawNow = isImmediateDraw(sim);
                const oppDrawNext = opponentHasImmediateDrawAfter(sim);
                const repRisk = causesImmediateThreefold(sim, fenCounts); // repeating a prior FEN in window
                const avoidDrawish = !allowDraws; // avoid draws when not losing badly

                // Opponent reply power & local attackers (as before)
                const opponentMoves = sim.moves({ verbose: true });
                let opponentMaxCapture = 0, destinationAttackers = 0;
                for(const om of opponentMoves){
                    if(!om.captured) continue;
                    opponentMaxCapture = Math.max(opponentMaxCapture, getPieceValue(om.captured));
                    if(om.to === move.to) destinationAttackers++;
                }

                // Material/net gain & saved value
                const movingPiece = game.get(move.from);
                const movingValue = movingPiece ? getPieceValue(movingPiece.type) : 0;
                const capturedValue = move.captured ? getPieceValue(move.captured) : 0;
                const captureScore = move.captured ? (capturedValue - movingValue) : 0;

                let valueSaved = 0;
                if(threatenedBefore.size){
                    const threatenedAfter = getThreatenedPiecesMap(sim, color);
                    valueSaved = computeValueSaved(move, sim, color, threatenedBefore, threatenedAfter);
                }
                if(inCheck) valueSaved += 100; // escape bonus

                // Pressure & positional
                const createdThreat = ourMaxThreatValueAfter(sim, color);
                const localPenalty = destinationAttackers > 0 ? 0.5 : 0;
                const posPts = positionalPoints(sim, color);

                // Tiny progress bias & contempt to avoid shuffles when winning
                const progress = Math.max(0, posPts - currentPosPts); // reward improving positions
                const contempt = mat > 0 ? 0.1 : 0;                   // nudge against neutral results when ahead

                const score =
                    captureScore +
                    valueSaved -
                    0.9 * opponentMaxCapture +
                    0.25 * createdThreat -
                    localPenalty +
                    posPts +
                    0.05 * progress +
                    contempt;

                const cand = {
                    mv: move,
                    score,
                    givesCheck: isCheckMove(move),
                    develops: isDevelopingMove(move, movingPiece, color),
                    lexical: lexicalKey(move),
                };

                // Absolute fallback
                if(!bestAny || betterThan(cand, bestAny)) bestAny = cand;

                if(!unsafe){
                    // Consider a move "drawish" if:
                    // - it is an immediate draw now, OR
                    // - we are avoiding draws and opponent can force an immediate draw next, OR
                    // - we are avoiding draws and it repeats a recent FEN (repetition risk)
                    const drawish = drawNow || (avoidDrawish && (oppDrawNext || repRisk));

                    if(!drawish){
                        if(!bestSafeNonDraw || betterThan(cand, bestSafeNonDraw)) bestSafeNonDraw = cand;
                    } else {
                        if(!bestSafeOrDraw || betterThan(cand, bestSafeOrDraw)) bestSafeOrDraw = cand;
                    }
                }
            }

            const winner = bestSafeNonDraw || bestSafeOrDraw || bestAny || legal[0];
            return winner.mv;
        }
    }

    global.StonefishModels = Object.assign({}, global.StonefishModels, { v3: new StonefishV3() });
})(typeof window!=='undefined'?window:globalThis);
