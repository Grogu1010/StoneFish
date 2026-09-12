// StoneFish UI latency patch.
// Normal play used to wait 450 ms before starting the selected engine. Keep the
// existing event/render flow, but remove only that artificial delay. Spectator
// pacing and engine search logic are untouched.
const stonefishUiBaseSetTimeout = window.setTimeout.bind(window);
window.setTimeout = function(callback, delay, ...args) {
  if (callback === makeSelectedBotMove && delay === 450) {
    return stonefishUiBaseSetTimeout(callback, 0, ...args);
  }
  return stonefishUiBaseSetTimeout(callback, delay, ...args);
};
