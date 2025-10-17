(function (global) {
    const PIECE_VALUES = {
        p: 1,
        n: 3,
        b: 3,
        r: 5,
        q: 9,
        k: 100,
    };

    const POS = {
        PAWN_CENTER: 0.3,
        KNIGHT_CENTER: 0.4,
        BISHOP_DEVELOPED: 0.25,
        ROOK_OPEN_FILE: 0.5,
        KING_CASTLED: 0.6,
        PASSED_PAWN: 0.5,
        PASSED_SUPPORTED_BONUS: 0.2,

        ISOLATED_PAWN: -0.25,
        DOUBLED_PAWN: -0.3,
        RIM_KNIGHT: -0.3,
        EXPOSED_KING: -0.6,
    };

    function getPieceValue(type) {
        return PIECE_VALUES[type] || 0;
    }

    function cloneGameWithTurn(game, turn) {
        const parts = game.fen().split(' ');
        parts[1] = turn;
        return new Chess(parts.join(' '));
    }

    function ensureTurn(game, turn) {
        return game.turn() === turn ? game : cloneGameWithTurn(game, turn);
    }

    function simulateMove(game, move) {
        const sim = new Chess(game.fen());
        const ok = sim.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
        return ok ? sim : null;
    }

    function fileIndex(square) {
        return square.charCodeAt(0) - 97;
    }

    function rankIndex(square) {
        return parseInt(square[1], 10) - 1;
    }

    function isCenterPawnSquare(sq) {
        const f = sq[0];
        const r = rankIndex(sq) + 1;
        return (f === 'd' || f === 'e') && (r === 4 || r === 5);
    }

    function isKnightCenterSquare(sq) {
        const f = fileIndex(sq);
        const r = rankIndex(sq);
        return f >= 2 && f <= 5 && r >= 2 && r <= 5;
    }

    function isRimSquareForKnight(sq) {
        const f = fileIndex(sq);
        const r = rankIndex(sq);
        return f === 0 || f === 7 || r === 0 || r === 7;
    }

    function boardArray(game) {
        return game.board();
    }

    function pieceAt(game, sq) {
        return game.get(sq);
    }

    function squareFromBoardIndices(file, row) {
        return String.fromCharCode(97 + file) + (8 - row);
    }

    function countPawnsOnFile(game, file, color = null) {
        let c = 0;
        for (let rank = 1; rank <= 8; rank++) {
            const sq = String.fromCharCode(97 + file) + rank;
            const p = pieceAt(game, sq);
            if (p && p.type === 'p' && (!color || p.color === color)) {
                c++;
            }
        }
        return c;
    }

    function isOpenFileFor(game, file) {
        return countPawnsOnFile(game, file, null) === 0;
    }

    function isIsolatedPawn(game, sq, color) {
        const f = fileIndex(sq);
        const left = f > 0 ? countPawnsOnFile(game, f - 1, color) : 0;
        const right = f < 7 ? countPawnsOnFile(game, f + 1, color) : 0;
        return left + right === 0;
    }

    function isDoubledPawn(game, file, color) {
        return countPawnsOnFile(game, file, color) >= 2;
    }

    function isPassedPawn(game, sq, color) {
        const f = fileIndex(sq);
        const r = rankIndex(sq);
        const dir = color === 'w' ? 1 : -1;
        for (let df = -1; df <= 1; df++) {
            const ff = f + df;
            if (ff < 0 || ff > 7) {
                continue;
            }
            for (let rr = r + dir; rr >= 0 && rr < 8; rr += dir) {
                const targetSquare = String.fromCharCode(97 + ff) + (rr + 1);
                const p = pieceAt(game, targetSquare);
                if (p && p.type === 'p' && p.color !== color) {
                    return false;
                }
            }
        }
        return true;
    }

    function isSupportedPassed(game, sq, color) {
        const f = fileIndex(sq);
        const r = rankIndex(sq);
        const dr = color === 'w' ? -1 : 1;
        const supportRank = r + dr;
        if (supportRank < 0 || supportRank > 7) {
            return false;
        }
        for (const df of [-1, 1]) {
            const ff = f + df;
            if (ff < 0 || ff > 7) {
                continue;
            }
            const supportSquare = String.fromCharCode(97 + ff) + (supportRank + 1);
            const p = pieceAt(game, supportSquare);
            if (p && p.type === 'p' && p.color === color) {
                return true;
            }
        }
        return false;
    }

    function kingSquare(game, color) {
        const b = boardArray(game);
        for (let row = 0; row < 8; row++) {
            for (let f = 0; f < 8; f++) {
                const p = b[row][f];
                if (p && p.type === 'k' && p.color === color) {
                    return squareFromBoardIndices(f, row);
                }
            }
        }
        return null;
    }

    function isCastled(game, color) {
        const ks = kingSquare(game, color);
        return ks === 'g1' || ks === 'c1' || ks === 'g8' || ks === 'c8';
    }

    function kingExposed(game, color) {
        const ks = kingSquare(game, color);
        if (!ks) {
            return false;
        }
        const f = fileIndex(ks);
        const shieldRank = color === 'w' ? 2 : 7;
        let missing = 0;
        for (const df of [-1, 0, 1]) {
            const ff = f + df;
            if (ff < 0 || ff > 7) {
                continue;
            }
            const shieldSquare = String.fromCharCode(97 + ff) + shieldRank;
            const p = pieceAt(game, shieldSquare);
            if (!(p && p.type === 'p' && p.color === color)) {
                missing++;
            }
        }
        return missing >= 2;
    }

    function getCaptureMovesForColor(game, color) {
        const view = ensureTurn(game, color);
        return view.moves({ verbose: true }).filter((m) => Boolean(m.captured));
    }

    function getThreatenedPiecesMap(game, color) {
        const opponent = color === 'w' ? 'b' : 'w';
        const view = ensureTurn(game, opponent);
        const captures = view.moves({ verbose: true }).filter((m) => Boolean(m.captured));
        const map = new Map();

        for (const mv of captures) {
            let square = mv.to;
            // en passant: captured pawn is behind mv.to by one rank
            if (mv.flags && mv.flags.includes('e')) {
                const dir = opponent === 'w' ? -1 : 1;
                const f = fileIndex(mv.to);
                const r = rankIndex(mv.to) + dir;
                square = String.fromCharCode(97 + f) + (r + 1);
            }
            const piece = view.get(square);
            if (!piece || piece.color !== color) {
                continue;
            }

            const existing = map.get(square);
            if (existing) {
                existing.attackers.push({ from: mv.from, piece: mv.piece, value: getPieceValue(mv.piece) });
            } else {
                map.set(square, {
                    square,
                    piece,
                    value: getPieceValue(piece.type),
                    attackers: [{ from: mv.from, piece: mv.piece, value: getPieceValue(mv.piece) }],
                });
            }
        }

        return map;
    }

    function ourMaxThreatValueAfter(simulation, ourColor) {
        const captures = getCaptureMovesForColor(simulation, ourColor);
        let maxVal = 0;
        for (const mv of captures) {
            maxVal = Math.max(maxVal, getPieceValue(mv.captured));
        }
        return maxVal;
    }

    function isPromotionDescendant(originalPiece, resultingPiece) {
        if (!originalPiece || !resultingPiece) {
            return false;
        }
        if (originalPiece.type !== 'p') {
            return false;
        }
        return resultingPiece.color === originalPiece.color && resultingPiece.type !== 'p';
    }

    function computeValueSaved(move, simulation, color, threatenedBefore, threatenedAfter) {
        if (!threatenedBefore.size) {
            return 0;
        }

        let saved = 0;
        const MAX_VALUE_SAVED = 30;
        const destSquare = move.to;
        const destPiece = simulation.get(destSquare);

        threatenedBefore.forEach((entry, square) => {
            const pieceBefore = entry.piece;
            const movedThisPiece = move.from === square;

            if (movedThisPiece) {
                if (!destPiece || destPiece.color !== color) {
                    return;
                }

                const sameType = destPiece.type === pieceBefore.type;
                const promoted = isPromotionDescendant(pieceBefore, destPiece);

                if (!sameType && !promoted) {
                    return;
                }

                if (threatenedAfter.has(destSquare)) {
                    return;
                }

                saved += entry.value;
                return;
            }

            const pieceStillThere = simulation.get(square);
            if (!pieceStillThere || pieceStillThere.color !== color) {
                return;
            }

            if (threatenedAfter.has(square)) {
                return;
            }

            saved += entry.value;
        });

        return Math.min(saved, MAX_VALUE_SAVED);
    }

    function isCheckMove(move) {
        if (!move || typeof move.san !== 'string') {
            return false;
        }
        return move.san.includes('+') || move.san.includes('#');
    }

    function isDevelopingMove(move, piece, color) {
        if (!piece || piece.type === 'p') {
            return false;
        }
        const homeRank = color === 'w' ? '1' : '8';
        return move.from.endsWith(homeRank);
    }

    function lexicalKey(move) {
        return `${move.from}-${move.to}-${move.promotion || ''}`;
    }

    function positionalPoints(game, color) {
        let pts = 0;
        const b = boardArray(game);

        for (let row = 0; row < 8; row++) {
            for (let f = 0; f < 8; f++) {
                const p = b[row][f];
                if (!p || p.color !== color) {
                    continue;
                }
                const sq = squareFromBoardIndices(f, row);

                switch (p.type) {
                    case 'p':
                        if (isCenterPawnSquare(sq)) {
                            pts += POS.PAWN_CENTER;
                        }
                        if (isIsolatedPawn(game, sq, color)) {
                            pts += POS.ISOLATED_PAWN;
                        }
                        if (isDoubledPawn(game, f, color)) {
                            pts += POS.DOUBLED_PAWN;
                        }
                        if (isPassedPawn(game, sq, color)) {
                            pts += POS.PASSED_PAWN;
                            if (isSupportedPassed(game, sq, color)) {
                                pts += POS.PASSED_SUPPORTED_BONUS;
                            }
                        }
                        break;
                    case 'n':
                        if (isKnightCenterSquare(sq)) {
                            pts += POS.KNIGHT_CENTER;
                        }
                        if (isRimSquareForKnight(sq)) {
                            pts += POS.RIM_KNIGHT;
                        }
                        break;
                    case 'b': {
                        const back = color === 'w' ? 1 : 8;
                        if (rankIndex(sq) + 1 !== back) {
                            pts += POS.BISHOP_DEVELOPED;
                        }
                        break;
                    }
                    case 'r':
                        if (isOpenFileFor(game, f)) {
                            pts += POS.ROOK_OPEN_FILE;
                        }
                        break;
                    case 'k':
                        if (isCastled(game, color)) {
                            pts += POS.KING_CASTLED;
                        }
                        if (kingExposed(game, color)) {
                            pts += POS.EXPOSED_KING;
                        }
                        break;
                    default:
                        break;
                }
            }
        }

        return pts;
    }

    // === New: Mate & draw policy helpers ===

    // If we play `move`, is the opponent already checkmated?
    function isMateInOneMove(game, move) {
        const sim = simulateMove(game, move);
        return !!(sim && typeof sim.in_checkmate === 'function' && sim.in_checkmate());
    }

    // After our move (simulation), can the opponent mate us in one?
    function opponentHasMateInOneAfter(simulation) {
        const oppMoves = simulation.moves({ verbose: true });
        for (const oppMove of oppMoves) {
            const sim2 = simulateMove(simulation, oppMove);
            if (sim2 && typeof sim2.in_checkmate === 'function' && sim2.in_checkmate()) {
                return true;
            }
        }
        return false;
    }

    // Material balance from our perspective (positive = ahead)
    function materialBalanceFor(game, ourColor) {
        const b = game.board();
        let ours = 0, theirs = 0;
        for (let r = 0; r < 8; r++) {
            for (let f = 0; f < 8; f++) {
                const p = b[r][f];
                if (!p) continue;
                const v = getPieceValue(p.type);
                if (p.color === ourColor) ours += v; else theirs += v;
            }
        }
        return ours - theirs;
    }

    // Immediate draw detection that doesn't need history
    function isImmediateDraw(sim) {
        if (typeof sim.in_stalemate === 'function' && sim.in_stalemate()) return true;
        if (typeof sim.insufficient_material === 'function' && sim.insufficient_material()) return true;
        // threefold/50-move need history; we can't reliably detect here
        return false;
    }

    class StonefishV3 {
        constructor() {
            this.id = 'v3';
            this.name = 'StoneFish V3';
            this.description = 'V2.5 tactical core + positional scoring + mate/draw policy';
        }

        chooseMove(game) {
            if (!game || typeof game.moves !== 'function') {
                console.warn('StoneFish V3 received an invalid game instance.');
                return null;
            }

            const legalMoves = game.moves({ verbose: true });
            if (!legalMoves.length) {
                return null;
            }

            const color = game.turn();
            const threatenedBefore = getThreatenedPiecesMap(game, color);
            const inCheck = typeof game.in_check === 'function' ? game.in_check() : false;

            // 0) Instant win: take mate-in-1 if available
            const mates = [];
            for (const mv of legalMoves) {
                if (isMateInOneMove(game, mv)) mates.push(mv);
            }
            if (mates.length) {
                // Can keep your "betterThan" tie-break if you want; first is fine
                return mates[0];
            }

            // Draw policy context
            const materialBalance = materialBalanceFor(game, color);
            const allowDraws = materialBalance <= -4; // only accept immediate draws if we're down by 4+

            let bestSafeNonDraw = null;  // preferred bucket
            let bestSafeOrDraw   = null; // safe, even if immediate draw
            let bestAny          = null; // absolute fallback

            const betterThan = (next, current) => {
                if (!current) {
                    return true;
                }
                if (next.score !== current.score) {
                    return next.score > current.score;
                }
                if (next.givesCheck !== current.givesCheck) {
                    return next.givesCheck;
                }
                if (next.develops !== current.develops) {
                    return next.develops;
                }
                return next.lexical < current.lexical;
            };

            for (const move of legalMoves) {
                const simulation = simulateMove(game, move);
                if (!simulation) {
                    continue;
                }

                // 1) Safety & draw gates
                const unsafe = opponentHasMateInOneAfter(simulation);
                const drawNow = isImmediateDraw(simulation);
                const avoidDraw = !allowDraws; // avoid draws unless we're losing badly

                // 2) Opponent reply power & local attackers (existing V3)
                const opponentMoves = simulation.moves({ verbose: true });
                let opponentMaxCapture = 0;
                let destinationAttackers = 0;
                for (const oppMove of opponentMoves) {
                    if (!oppMove.captured) continue;
                    opponentMaxCapture = Math.max(opponentMaxCapture, getPieceValue(oppMove.captured));
                    if (oppMove.to === move.to) destinationAttackers += 1;
                }

                // 3) Material/net gain & value saved (existing V3)
                const movingPiece = game.get(move.from);
                const movingValue = movingPiece ? getPieceValue(movingPiece.type) : 0;
                const capturedValue = move.captured ? getPieceValue(move.captured) : 0;
                const captureScore = move.captured ? capturedValue - movingValue : 0;

                let valueSaved = 0;
                if (threatenedBefore.size) {
                    const threatenedAfter = getThreatenedPiecesMap(simulation, color);
                    valueSaved = computeValueSaved(move, simulation, color, threatenedBefore, threatenedAfter);
                }
                if (inCheck) {
                    // All legal moves here escape; award the escape bonus unconditionally
                    valueSaved += 100;
                }

                // 4) Pressure & positional (existing V3)
                const createdThreat = ourMaxThreatValueAfter(simulation, color);
                const localPenalty = destinationAttackers > 0 ? 0.5 : 0;
                const posPts = positionalPoints(simulation, color);

                const score =
                    captureScore +
                    valueSaved -
                    0.9 * opponentMaxCapture +
                    0.25 * createdThreat -
                    localPenalty +
                    posPts;

                const candidate = {
                    mv: move,
                    score,
                    givesCheck: isCheckMove(move),
                    develops: isDevelopingMove(move, movingPiece, color),
                    lexical: lexicalKey(move),
                };

                // Track absolute fallback
                if (!bestAny || betterThan(candidate, bestAny)) bestAny = candidate;

                // Skip unsafe moves if any safe move exists
                if (!unsafe) {
                    // If we're avoiding draws, prefer non-draw moves when possible
                    if (!(avoidDraw && drawNow)) {
                        if (!bestSafeNonDraw || betterThan(candidate, bestSafeNonDraw)) {
                            bestSafeNonDraw = candidate;
                        }
                    } else {
                        if (!bestSafeOrDraw || betterThan(candidate, bestSafeOrDraw)) {
                            bestSafeOrDraw = candidate;
                        }
                    }
                }
            }

            const winner =
                bestSafeNonDraw ||    // safest and tries to win
                bestSafeOrDraw   ||    // safe but drawish (used when avoiding draws isn't possible)
                bestAny;               // forced bad/draw/unsafe
            return winner ? winner.mv : legalMoves[0];
        }
    }

    global.StonefishModels = Object.assign({}, global.StonefishModels, {
        v3: new StonefishV3(),
    });
})(typeof window !== 'undefined' ? window : globalThis);
