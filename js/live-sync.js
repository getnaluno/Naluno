/* Keep an open screen current. Listeners already cover the feeds,
   Wireline, Band, calls, and the Broadcast room. This closes the
   gaps: leave a story and the watch stops; come back to the app and
   an open contribution or Broadcast repaints without a manual refresh. */
(function () {
  function active(id) {
    const el = document.getElementById(id);
    return !!(el && el.classList.contains('active'));
  }
  function tick() {
    if (!active('bviewer')) {
      try {
        if (window.NalunoSignalSocial && typeof NalunoSignalSocial.stopWatch === 'function') {
          NalunoSignalSocial.stopWatch();
        }
      } catch (_) {}
    }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    try {
      if (active('contributionPanel') && typeof renderContributionPanel === 'function') {
        renderContributionPanel(true);
      }
    } catch (_) {}
    try {
      if (active('bspace') && typeof scheduleBspaceLivePaint === 'function') scheduleBspaceLivePaint();
    } catch (_) {}
    try {
      if (typeof renderTogaBoard === 'function') {
        const board = document.getElementById('togaBoard');
        if (board && board.offsetParent !== null) renderTogaBoard();
      }
    } catch (_) {}
  });
  /* Only the story viewer matters here. Watching every class change on
     the whole page ran this on every animation frame of every screen. */
  function watchViewer() {
    const el = document.getElementById('bviewer');
    if (!el) { setTimeout(watchViewer, 1000); return; }
    try {
      const obs = new MutationObserver(tick);
      obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchViewer);
  else watchViewer();
})();
