(function (global) {
    const PIECE_VALUES = {
        p: 1,
        n: 3,
        b: 3,
        r: 5,
        q: 9,
        k: 100,
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
            const square = mv.to;
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

    class StonefishV25 {
        constructor() {
            this.id = 'v2_5';
            this.name = 'StoneFish V2.5';
            this.description = 'Material-aware reactive engine (defend≈capture)';
        }

        chooseMove(game) {
            if (!game || typeof game.moves !== 'function') {
                console.warn('StoneFish V2.5 received an invalid game instance.');
                return null;
            }

            const legalMoves = game.moves({ verbose: true });
            if (!legalMoves.length) {
                return null;
            }

            const color = game.turn();
            const threatenedBefore = getThreatenedPiecesMap(game, color);
            const inCheck = typeof game.in_check === 'function' ? game.in_check() : false;

            let bestCandidate = null;
            let fallbackCandidate = null;

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

                const opponentMoves = simulation.moves({ verbose: true });
                let opponentMaxCapture = 0;
                let destinationAttackers = 0;
                for (const oppMove of opponentMoves) {
                    if (!oppMove.captured) {
                        continue;
                    }
                    opponentMaxCapture = Math.max(opponentMaxCapture, getPieceValue(oppMove.captured));
                    if (oppMove.to === move.to) {
                        destinationAttackers += 1;
                    }
                }

                const movingPiece = game.get(move.from);
                const movingValue = movingPiece ? getPieceValue(movingPiece.type) : 0;
                const capturedValue = move.captured ? getPieceValue(move.captured) : 0;
                const captureScore = move.captured ? capturedValue - movingValue : 0;

                let valueSaved = 0;
                if (threatenedBefore.size) {
                    const threatenedAfter = getThreatenedPiecesMap(simulation, color);
                    valueSaved = computeValueSaved(move, simulation, color, threatenedBefore, threatenedAfter);
                }

                if (inCheck && !simulation.in_check()) {
                    valueSaved += 100;
                }

                const createdThreat = ourMaxThreatValueAfter(simulation, color);
                const localPenalty = destinationAttackers > 0 ? 0.5 : 0;

                const score =
                    captureScore +
                    valueSaved -
                    0.9 * opponentMaxCapture +
                    0.25 * createdThreat -
                    localPenalty;

                const candidate = {
                    mv: move,
                    score,
                    givesCheck: isCheckMove(move),
                    develops: isDevelopingMove(move, movingPiece, color),
                    lexical: lexicalKey(move),
                };

                if (!fallbackCandidate || betterThan(candidate, fallbackCandidate)) {
                    fallbackCandidate = candidate;
                }

                const dominated =
                    !inCheck && opponentMaxCapture >= 9 && capturedValue < 9 && valueSaved < 9;
                if (dominated) {
                    continue;
                }

                if (betterThan(candidate, bestCandidate)) {
                    bestCandidate = candidate;
                }
            }

            const winner = bestCandidate || fallbackCandidate;
            return winner ? winner.mv : legalMoves[0];
        }
    }

    global.StonefishModels = Object.assign({}, global.StonefishModels, {
        v2_5: new StonefishV25(),
    });
})(typeof window !== 'undefined' ? window : globalThis);
