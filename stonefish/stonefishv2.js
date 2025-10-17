(function (global) {
    const PIECE_VALUES = {
        p: 1,
        n: 3,
        b: 3,
        r: 5,
        q: 9,
        k: 100,
    };

    function cloneGameWithTurn(game, turn) {
        const fenParts = game.fen().split(' ');
        fenParts[1] = turn;
        return new Chess(fenParts.join(' '));
    }

    function simulateMove(game, move) {
        const simulation = new Chess(game.fen());
        const result = simulation.move({
            from: move.from,
            to: move.to,
            promotion: move.promotion || 'q',
        });
        return result ? simulation : null;
    }

    function getPieceValue(type) {
        return PIECE_VALUES[type] || 0;
    }

    function getThreatsAgainstColor(game, color) {
        const opponentTurn = color === 'w' ? 'b' : 'w';
        const opponentView = cloneGameWithTurn(game, opponentTurn);
        return opponentView
            .moves({ verbose: true })
            .filter((move) => Boolean(move.captured));
    }

    function getCaptureOptionsForColor(game, color) {
        const perspective = cloneGameWithTurn(game, color);
        return perspective
            .moves({ verbose: true })
            .filter((move) => Boolean(move.captured));
    }

    function getMaxThreatValue(game, color) {
        const threats = getCaptureOptionsForColor(game, color);
        let maxValue = 0;
        for (const threat of threats) {
            maxValue = Math.max(maxValue, getPieceValue(threat.captured));
        }
        return maxValue;
    }

    function getThreatenedPieces(game, color) {
        const threats = getThreatsAgainstColor(game, color);
        const threatenedMap = new Map();

        for (const threat of threats) {
            const square = threat.to;
            const piece = game.get(square);
            if (!piece || piece.color !== color) {
                continue;
            }

            const key = square;
            const entry = threatenedMap.get(key) || {
                square,
                piece,
                value: getPieceValue(piece.type),
                attackers: [],
            };

            entry.attackers.push({
                from: threat.from,
                attacker: threat.piece,
                value: getPieceValue(threat.piece),
            });

            threatenedMap.set(key, entry);
        }

        return Array.from(threatenedMap.values()).sort((a, b) => b.value - a.value);
    }

    class StonefishV2 {
        constructor() {
            this.id = 'v2';
            this.name = 'StoneFish V2';
            this.description = 'Structured Instinct decision engine';
        }

        chooseMove(gameInstance) {
            if (!gameInstance || typeof gameInstance.moves !== 'function') {
                console.warn('StoneFish V2 received an invalid game instance.');
                return null;
            }

            const legalMoves = gameInstance.moves({ verbose: true });
            if (!legalMoves.length) {
                return null;
            }

            const color = gameInstance.turn();

            return (
                this.chooseDefenseMove(gameInstance, legalMoves, color) ||
                this.chooseCaptureMove(gameInstance, legalMoves, color) ||
                this.chooseAttackMove(gameInstance, legalMoves, color) ||
                this.chooseFallbackMove(gameInstance, legalMoves, color)
            );
        }

        chooseDefenseMove(game, legalMoves, color) {
            const threatenedPieces = getThreatenedPieces(game, color);
            if (!threatenedPieces.length) {
                return null;
            }

            for (const threatened of threatenedPieces) {
                const defensiveMoves = [];

                for (const move of legalMoves) {
                    const simulation = simulateMove(game, move);
                    if (!simulation) {
                        continue;
                    }

                    let protectedSquare = threatened.square;
                    if (move.from === threatened.square) {
                        protectedSquare = move.to;
                    }

                    const pieceAfter = simulation.get(protectedSquare);
                    if (!pieceAfter || pieceAfter.color !== color || pieceAfter.type !== threatened.piece.type) {
                        continue;
                    }

                    const remainingThreats = getThreatsAgainstColor(simulation, color);
                    const stillUnderAttack = remainingThreats.some((threat) => threat.to === protectedSquare);
                    if (stillUnderAttack) {
                        continue;
                    }

                    const captureValue = move.captured ? getPieceValue(move.captured) : 0;
                    const createdThreat = getMaxThreatValue(simulation, color);

                    defensiveMoves.push({
                        move,
                        captureValue,
                        createdThreat,
                    });
                }

                if (defensiveMoves.length) {
                    defensiveMoves.sort((a, b) => {
                        if (b.captureValue !== a.captureValue) {
                            return b.captureValue - a.captureValue;
                        }
                        if (b.createdThreat !== a.createdThreat) {
                            return b.createdThreat - a.createdThreat;
                        }
                        return 0;
                    });
                    return defensiveMoves[0].move;
                }
            }

            return null;
        }

        chooseCaptureMove(game, legalMoves, color) {
            const captureMoves = [];
            for (const move of legalMoves) {
                if (!move.captured) {
                    continue;
                }

                const capturingPiece = game.get(move.from);
                if (!capturingPiece) {
                    continue;
                }

                const capturedValue = getPieceValue(move.captured);
                const ourValue = getPieceValue(capturingPiece.type);
                const simulation = simulateMove(game, move);
                if (!simulation) {
                    continue;
                }

                const retaliation = getThreatsAgainstColor(simulation, color).filter((threat) => threat.to === move.to);
                const isSafe = retaliation.length === 0;
                const worthwhile = capturedValue >= ourValue;
                if (!isSafe && !worthwhile) {
                    continue;
                }

                const netGain = capturedValue - ourValue;
                const createdThreat = getMaxThreatValue(simulation, color);

                captureMoves.push({
                    move,
                    capturedValue,
                    netGain,
                    createdThreat,
                    isSafe,
                });
            }

            if (!captureMoves.length) {
                return null;
            }

            captureMoves.sort((a, b) => {
                if (b.capturedValue !== a.capturedValue) {
                    return b.capturedValue - a.capturedValue;
                }
                if (b.netGain !== a.netGain) {
                    return b.netGain - a.netGain;
                }
                if (a.isSafe !== b.isSafe) {
                    return a.isSafe ? -1 : 1;
                }
                if (b.createdThreat !== a.createdThreat) {
                    return b.createdThreat - a.createdThreat;
                }
                return 0;
            });

            return captureMoves[0].move;
        }

        chooseAttackMove(game, legalMoves, color) {
            const attackMoves = [];
            for (const move of legalMoves) {
                if (move.captured) {
                    continue;
                }

                const simulation = simulateMove(game, move);
                if (!simulation) {
                    continue;
                }

                const maxThreat = getMaxThreatValue(simulation, color);
                if (maxThreat <= 0) {
                    continue;
                }

                attackMoves.push({ move, maxThreat });
            }

            if (!attackMoves.length) {
                return null;
            }

            attackMoves.sort((a, b) => b.maxThreat - a.maxThreat);
            return attackMoves[0].move;
        }

        chooseFallbackMove(game, legalMoves, color) {
            const evaluatedMoves = [];
            for (const move of legalMoves) {
                const simulation = simulateMove(game, move);
                if (!simulation) {
                    continue;
                }

                const threats = getThreatsAgainstColor(simulation, color);
                const highestThreat = threats.reduce((max, threat) => {
                    const value = getPieceValue(threat.captured);
                    return Math.max(max, value);
                }, 0);

                evaluatedMoves.push({ move, highestThreat });
            }

            if (!evaluatedMoves.length) {
                return legalMoves[Math.floor(Math.random() * legalMoves.length)];
            }

            evaluatedMoves.sort((a, b) => a.highestThreat - b.highestThreat);
            const safest = evaluatedMoves.filter((entry) => entry.highestThreat <= 3);
            if (safest.length) {
                return safest[0].move;
            }

            return evaluatedMoves[0].move;
        }
    }

    global.StonefishModels = Object.assign({}, global.StonefishModels, {
        v2: new StonefishV2(),
    });
})(typeof window !== 'undefined' ? window : globalThis);
