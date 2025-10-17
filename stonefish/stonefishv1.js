(function (global) {
    class StonefishV1 {
        constructor() {
            this.id = 'v1';
            this.name = 'StoneFish V1';
            this.description = 'Early proof of concept for intelligent play';
        }

        chooseMove(gameInstance) {
            if (!gameInstance || typeof gameInstance.moves !== 'function') {
                console.warn('StoneFish V1 received an invalid game instance.');
                return null;
            }
            const legalMoves = gameInstance.moves({ verbose: true });
            if (!legalMoves.length) {
                return null;
            }
            const index = Math.floor(Math.random() * legalMoves.length);
            return legalMoves[index];
        }
    }

    global.StonefishModels = Object.assign({}, global.StonefishModels, {
        v1: new StonefishV1(),
    });
})(typeof window !== 'undefined' ? window : globalThis);
