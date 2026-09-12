// Parallel browser test runner.
// Independent games do not share state, so distribute them across a small
// worker pool. This changes test throughput only; model search is untouched.

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
