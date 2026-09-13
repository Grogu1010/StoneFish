// Parallel browser test runner.
// Independent games do not share state, so distribute them across a small
// worker pool. This changes test throughput only; model search is untouched.
//
// The dev lab also records engine-only performance for every model:
// - average think time per move,
// - average moves made per game,
// - average engine time per game = avg think time/move * avg moves/game.
// Opponent think time is excluded from each model's engine-time figure.

const stonefishBaseCreateStats = createStats;
const stonefishBaseApplyResult = applyResult;

function stonefishTimedCreateStats(selectedKeys) {
  const stats = stonefishBaseCreateStats(selectedKeys);
  for (const key of selectedKeys) {
    stats.overall[key].moves = 0;
    stats.overall[key].thinkMs = 0;
  }
  for (const matchup of Object.values(stats.matchups)) {
    matchup.performance = {
      [matchup.a]: { moves: 0, thinkMs: 0 },
      [matchup.b]: { moves: 0, thinkMs: 0 }
    };
  }
  return stats;
}

function stonefishTimedApplyResult(stats, job, result) {
  const outcome = typeof result === 'string' ? result : result.outcome;
  stonefishBaseApplyResult(stats, job, outcome);
  if (!result || typeof result === 'string' || !result.metrics) return;

  const matchup = stats.matchups[pairKey(job.a, job.b)];
  for (const key of [job.a, job.b]) {
    const metric = result.metrics[key];
    if (!metric) continue;
    const moves = Number(metric.moves) || 0;
    const thinkMs = Number(metric.thinkMs) || 0;
    stats.overall[key].moves += moves;
    stats.overall[key].thinkMs += thinkMs;
    if (matchup.performance && matchup.performance[key]) {
      matchup.performance[key].moves += moves;
      matchup.performance[key].thinkMs += thinkMs;
    }
  }
}

function stonefishFormatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0.00 ms';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(2)} ms`;
}

function stonefishPerformanceSummary(perf, games) {
  const moves = perf && Number.isFinite(perf.moves) ? perf.moves : 0;
  const thinkMs = perf && Number.isFinite(perf.thinkMs) ? perf.thinkMs : 0;
  const avgTimePerMove = moves ? thinkMs / moves : 0;
  const avgMovesPerGame = games ? moves / games : 0;
  const avgEngineTimePerGame = avgTimePerMove * avgMovesPerGame;
  return {
    avgTimePerMove,
    avgMovesPerGame,
    avgEngineTimePerGame,
    text: `${stonefishFormatDuration(avgTimePerMove)}/move · ${avgMovesPerGame.toFixed(1)} moves/game · ${stonefishFormatDuration(avgEngineTimePerGame)} engine time/game`
  };
}

function stonefishTimedRenderRoundRobin(stats, selectedKeys, completed, total, done = false) {
  const overallRows = selectedKeys.map(key => {
    const s = stats.overall[key];
    const performance = stonefishPerformanceSummary(s, s.games);
    return `<div class="result-row"><strong>${models[key].name}</strong><span>${s.wins}W · ${s.losses}L · ${s.draws}D · ${s.games} played</span><span>W ${percent(s.wins, s.games)} · L ${percent(s.losses, s.games)} · D ${percent(s.draws, s.games)}</span><span>${performance.text}</span></div>`;
  }).join('');

  const matchupRows = Object.values(stats.matchups).map(m => {
    const aLosses = m.games - m.aWins - m.draws;
    const bLosses = m.games - m.bWins - m.draws;
    const aPerformance = stonefishPerformanceSummary(m.performance ? m.performance[m.a] : null, m.games);
    const bPerformance = stonefishPerformanceSummary(m.performance ? m.performance[m.b] : null, m.games);
    return `<div class="matchup-row"><strong>${models[m.a].name} vs ${models[m.b].name}</strong><span>${m.games}/${m.targetGames} games</span><span>${models[m.a].name}: ${m.aWins}W · ${aLosses}L · ${m.draws}D — W ${percent(m.aWins, m.games)} · D ${percent(m.draws, m.games)}</span><span>${aPerformance.text}</span><span>${models[m.b].name}: ${m.bWins}W · ${bLosses}L · ${m.draws}D — W ${percent(m.bWins, m.games)} · D ${percent(m.draws, m.games)}</span><span>${bPerformance.text}</span></div>`;
  }).join('');

  testResults.innerHTML = `<div class="test-progress-heading">${done ? 'Final' : 'Running'} — ${completed} / ${total} total games</div><div class="developer-note">Timing is engine-only: opponent think time is excluded. Engine time/game = average time/move × average moves/game.</div><div class="results-section-title">Overall</div>${overallRows}<div class="results-section-title">Matchups</div>${matchupRows}`;
}

createStats = stonefishTimedCreateStats;
applyResult = stonefishTimedApplyResult;
renderRoundRobin = stonefishTimedRenderRoundRobin;

const stonefishSequentialRoundRobinTest = runRoundRobinTest;
let stonefishParallelWorkerPool = [];

function stonefishParallelWorkerCount(totalJobs) {
  const hardware = Number(navigator.hardwareConcurrency) || 4;
  const usable = hardware > 2 ? hardware - 1 : 1;
  return Math.max(1, Math.min(totalJobs, Math.min(8, usable)));
}

function stonefishCloseParallelWorkers() {
  for (const worker of stonefishParallelWorkerPool) worker.terminate();
  stonefishParallelWorkerPool = [];
}

async function stonefishParallelRoundRobinTest() {
  if (testing) return;
  const selectedKeys = getSelectedTestModels();
  if (selectedKeys.length < 2) {
    testResults.textContent = 'Select at least two models.';
    return;
  }

  stopWatching();
  const requested = Number.parseInt(testCountInput.value, 10);
  const totalGames = Number.isFinite(requested) ? Math.max(1, Math.min(10000, requested)) : 100;
  testCountInput.value = totalGames;

  const stats = createStats(selectedKeys);
  const schedule = buildSchedule(selectedKeys, totalGames, stats);
  const workerCount = stonefishParallelWorkerCount(schedule.length);
  let nextJobIndex = 0;
  let completed = 0;

  testing = true;
  setTestControlsDisabled(true);
  renderRoundRobin(stats, selectedKeys, 0, schedule.length);
  stonefishCloseParallelWorkers();
  stonefishParallelWorkerPool = Array.from({ length: workerCount }, () => new Worker('test-worker.js'));

  try {
    async function runQueue(worker) {
      while (true) {
        const scheduleIndex = nextJobIndex;
        nextJobIndex += 1;
        if (scheduleIndex >= schedule.length) return;

        const job = schedule[scheduleIndex];
        const result = await runWorkerGame(worker, {
          jobId: scheduleIndex + 1,
          whiteModelKey: job.whiteModelKey,
          blackModelKey: job.blackModelKey,
          maxPlies: 1000
        });

        applyResult(stats, job, result);
        completed += 1;
        renderRoundRobin(stats, selectedKeys, completed, schedule.length);
      }
    }

    await Promise.all(stonefishParallelWorkerPool.map(worker => runQueue(worker)));
    renderRoundRobin(stats, selectedKeys, schedule.length, schedule.length, true);
  } catch (error) {
    testResults.textContent = `Test stopped: ${error.message}`;
  } finally {
    stonefishCloseParallelWorkers();
    if (testWorker) testWorker.terminate();
    testWorker = null;
    testing = false;
    setTestControlsDisabled(false);
  }
}

runTestButton.removeEventListener('click', stonefishSequentialRoundRobinTest);
runRoundRobinTest = stonefishParallelRoundRobinTest;
runTestButton.addEventListener('click', runRoundRobinTest);
