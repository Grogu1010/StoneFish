(function (global) {
    const PIECE_VALUES = {
        p: 1, n: 3, b: 3, r: 5, q: 9, k: 100,
    };

    function getPieceValue(type) {
        return PIECE_VALUES[type] || 0;
    }

    // Clone game but set whose turn it is (used to ask "what can the opponent take now?")
    function cloneGameWithTurn(game, turn) {
        const parts = game.fen().split(' ');
        parts[1] = turn;
        return new Chess(parts.join(' '));
    }

    // Simulate a move and return the resulting Chess instance (or null if illegal)
    function simulateMove(game, move) {
        const sim = new Chess(game.fen());
        const ok = sim.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
        return ok ? sim : null;
    }

    // All *captures* available to side `color` in current position
    function getCaptureOptionsForColor(game, color) {
        const view = cloneGameWithTurn(game, color);
        return view.moves({ verbose: true }).filter(m => Boolean(m.captured));
    }

    // After a simulation, measure “how bad can it be next turn?”
    // i.e., the *highest value* of any piece the opponent could capture immediately.
    function opponentMaxCaptureValueAfter(simulation, ourColor) {
        const opp = ourColor === 'w' ? 'b' : 'w';
        const oppCaps = getCaptureOptionsForColor(simulation, opp);
        let maxVal = 0;
        for (const m of oppCaps) {
            maxVal = Math.max(maxVal, getPieceValue(m.captured));
        }
        return maxVal; // 0 means the opponent cannot immediately capture anything
    }

    // Which of our pieces are currently threatened (opponent has a capture to that square)?
    function getThreatsAgainstColor(game, color) {
        const opp = color === 'w' ? 'b' : 'w';
        const oppView = cloneGameWithTurn(game, opp);
        return oppView.moves({ verbose: true }).filter(m => Boolean(m.captured));
    }

    function getThreatenedPieces(game, color) {
        const threats = getThreatsAgainstColor(game, color);
        const map = new Map();
        for (const t of threats) {
            const sq = t.to;
            const piece = game.get(sq);
            if (!piece || piece.color !== color) continue;
            const key = sq;
            const entry = map.get(key) || {
                square: sq, piece, value: getPieceValue(piece.type), attackers: []
            };
            entry.attackers.push({
                from: t.from, attacker: t.piece, value: getPieceValue(t.piece),
            });
            map.set(key, entry);
        }
        // Highest value threatened first (save queen before pawn, etc.)
        return Array.from(map.values()).sort((a, b) => b.value - a.value);
    }

    // For tie-breakers: how much do we newly threaten after the move?
    function ourMaxThreatValueAfter(simulation, ourColor) {
        const caps = getCaptureOptionsForColor(simulation, ourColor);
        let maxVal = 0;
        for (const m of caps) maxVal = Math.max(maxVal, getPieceValue(m.captured));
        return maxVal;
    }

    class StonefishV2 {
        constructor() {
            this.id = 'v2';
            this.name = 'StoneFish V2';
            this.description = 'Structured Instinct decision engine (future-safety aware)';
        }

        chooseMove(game) {
            if (!game || typeof game.moves !== 'function') {
                console.warn('StoneFish V2 received an invalid game instance.');
                return null;
            }
            const legal = game.moves({ verbose: true });
            if (!legal.length) return null;

            const color = game.turn();

            return (
                this.chooseDefenseMove(game, legal, color) ||
                this.chooseCaptureMove(game, legal, color) ||
                this.chooseAttackMove(game, legal, color) ||
                this.chooseFallbackMove(game, legal, color)
            );
        }

        // 1) DEFEND: for each threatened piece (highest value first), find moves that leave it *not capturable*;
        // among those, prefer smallest opponentMaxCapture, then free capture value, then new threats.
        chooseDefenseMove(game, legal, color) {
            const threatened = getThreatenedPieces(game, color);
            if (!threatened.length) return null;

            for (const th of threatened) {
                const candidates = [];
                for (const mv of legal) {
                    const sim = simulateMove(game, mv);
                    if (!sim) continue;

                    // Track where that particular piece ends up (could move away or be shielded)
                    let protectedSq = th.square;
                    if (mv.from === th.square) protectedSq = mv.to;

                    const afterPiece = sim.get(protectedSq);
                    if (!afterPiece || afterPiece.color !== color || afterPiece.type !== th.piece.type) {
                        // that threatened piece is gone or not ours anymore → not a valid defense of THIS piece
                        continue;
                    }

                    // Is that piece still capturable after we move?
                    const stillThreatened = getThreatsAgainstColor(sim, color).some(t => t.to === protectedSq);
                    if (stillThreatened) continue;

                    const oppMax = opponentMaxCaptureValueAfter(sim, color);
                    const createdThreat = ourMaxThreatValueAfter(sim, color);
                    const captureValue = mv.captured ? getPieceValue(mv.captured) : 0;

                    candidates.push({ mv, oppMax, captureValue, createdThreat });
                }

                if (candidates.length) {
                    candidates.sort((a, b) => {
                        if (a.oppMax !== b.oppMax) return a.oppMax - b.oppMax; // SAFEST future first
                        if (b.captureValue !== a.captureValue) return b.captureValue - a.captureValue; // grab something if tied
                        if (b.createdThreat !== a.createdThreat) return b.createdThreat - a.createdThreat; // create threats
                        return 0;
                    });
                    return candidates[0].mv;
                }
            }
            return null;
        }

        // 2) CAPTURE: consider all captures; simulate; prefer ones that minimize opponentMaxCapture,
        // then prefer bigger capture, then better net gain, then new threats.
        chooseCaptureMove(game, legal, color) {
            const caps = [];
            for (const mv of legal) {
                if (!mv.captured) continue;

                const sim = simulateMove(game, mv);
                if (!sim) continue;

                const capturingPiece = game.get(mv.from);
                if (!capturingPiece) continue;

                const capturedValue = getPieceValue(mv.captured);
                const ourValue = getPieceValue(capturingPiece.type);
                const netGain = capturedValue - ourValue;

                const oppMax = opponentMaxCaptureValueAfter(sim, color);
                const createdThreat = ourMaxThreatValueAfter(sim, color);

                caps.push({ mv, oppMax, capturedValue, netGain, createdThreat });
            }

            if (!caps.length) return null;

            caps.sort((a, b) => {
                if (a.oppMax !== b.oppMax) return a.oppMax - b.oppMax;            // safest future first
                if (b.capturedValue !== a.capturedValue) return b.capturedValue - a.capturedValue; // bigger prize
                if (b.netGain !== a.netGain) return b.netGain - a.netGain;        // better trade
                if (b.createdThreat !== a.createdThreat) return b.createdThreat - a.createdThreat; // threaten more
                return 0;
            });

            return caps[0].mv;
        }

        // 3) ATTACK: non-captures that *create* the ability to take something next turn;
        // prefer minimal opponentMaxCapture, then the biggest new threatened value.
        chooseAttackMove(game, legal, color) {
            const atks = [];
            for (const mv of legal) {
                if (mv.captured) continue; // handled in capture phase
                const sim = simulateMove(game, mv);
                if (!sim) continue;

                const createdThreat = ourMaxThreatValueAfter(sim, color);
                if (createdThreat <= 0) continue; // no new threats → not an "attack" move

                const oppMax = opponentMaxCaptureValueAfter(sim, color);
                atks.push({ mv, oppMax, createdThreat });
            }

            if (!atks.length) return null;

            atks.sort((a, b) => {
                if (a.oppMax !== b.oppMax) return a.oppMax - b.oppMax; // safest future
                if (b.createdThreat !== a.createdThreat) return b.createdThreat - a.createdThreat; // strongest threat
                return 0;
            });

            return atks[0].mv;
        }

        // 4) FALLBACK: nothing to defend/capture/attack — pick the globally *safest* future.
        // Prefer minimal opponentMaxCapture; if tied, prefer moves that *increase* our max threat a bit.
        chooseFallbackMove(game, legal, color) {
            const scored = [];
            for (const mv of legal) {
                const sim = simulateMove(game, mv);
                if (!sim) continue;

                const oppMax = opponentMaxCaptureValueAfter(sim, color);
                const createdThreat = ourMaxThreatValueAfter(sim, color);

                scored.push({ mv, oppMax, createdThreat });
            }

            if (!scored.length) {
                // completely degenerate, pick random
                return legal[Math.floor(Math.random() * legal.length)];
            }

            scored.sort((a, b) => {
                if (a.oppMax !== b.oppMax) return a.oppMax - b.oppMax;  // safest future first
                if (b.createdThreat !== a.createdThreat) return b.createdThreat - a.createdThreat;
                return 0;
            });

            return scored[0].mv;
        }
    }

    global.StonefishModels = Object.assign({}, global.StonefishModels, {
        v2: new StonefishV2(),
    });
})(typeof window !== 'undefined' ? window : globalThis);
