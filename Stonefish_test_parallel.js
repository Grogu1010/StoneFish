// Parallel browser test harness.
// Independent games are distributed over a small worker pool so developer
// round-robin tests finish much sooner on multi-core machines. Model logic is
// unchanged; this only changes how separate test games are scheduled.

(function installParallelStonefishTests() {
  if (typeof Worker === 'undefined' || typeof runTestButton === 'undefined') return;

  async function runParallelRoundRobinTest() {
    if (testing) return;
    const selectedKeys = getSelectedTestModels();
    if (selectedKeys.length < 2) {
      testResults.textContent = 'Select at least two models.';
      return;
    }

    stopWatching();
    const requested = Number.parseInt(testCountInput.value, 10);
    const totalGames = Number.isFinite(requested)
      ? Math.max(1, Math.min(10000, requested))
      : 100;
    testCountInput.value = totalGames;

    const stats = createStats(selectedKeys);
    const schedule = buildSchedule(selectedKeys, totalGames, stats);
    const availableCores = Math.max(1, navigator.hardwareConcurrency || 4);
    const workerCount = Math.max(1, Math.min(8, availableCores, schedule.length));
    const workers = Array.from({ length: workerCount }, () => new Worker('test-worker.js'));

    let nextIndex = 0;
    let completed = 0;
    testing = true;
    setTestControlsDisabled(true);
    renderRoundRobin(stats, selectedKeys, 0, schedule.length);

    const runWorkerLoop = async worker => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= schedule.length) return;

        const job = schedule[index];
        const result = await runWorkerGame(worker, {
          jobId: index + 1,
          whiteModelKey: job.whiteModelKey,
          blackModelKey: job.blackModelKey,
          maxPlies: 1000
        });

        applyResult(stats, job, result);
        completed += 1;
        renderRoundRobin(stats, selectedKeys, completed, schedule.length);
      }
    };

    try {
      await Promise.all(workers.map(runWorkerLoop));
      renderRoundRobin(stats, selectedKeys, schedule.length, schedule.length, true);
    } catch (error) {
      testResults.textContent = `Test stopped: ${error.message}`;
    } finally {
      workers.forEach(worker => worker.terminate());
      testing = false;
      setTestControlsDisabled(false);
    }
  }

  runTestButton.removeEventListener('click', runRoundRobinTest);
  runTestButton.addEventListener('click', runParallelRoundRobinTest);
})();
