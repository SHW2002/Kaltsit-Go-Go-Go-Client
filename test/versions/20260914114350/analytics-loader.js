(function () {
  'use strict';
  window.kaltsitAnalyticsStartedAt = performance.now();
  const version = new URLSearchParams(window.location.search).get('v');
  const root = version ? 'versions/' + encodeURIComponent(version) + '/' : './';
  const cacheKey = version || new URL(document.currentScript.src).searchParams.get('v') || '';
  function load(file) {
    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = root + file + '?v=' + encodeURIComponent(cacheKey);
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  const pending = [];
  const placeholder = {};
  let expired = false;
  // 加载埋点资源不阻塞 Unity；先发生的游戏事件最多保留八秒、128 条。
  function dispatch(method, args) {
    const client = window.KaltsitAnalytics;
    if (client && client !== placeholder) {
      try { client[method].apply(null, args); } catch (_) {}
    } else if (!expired && pending.length < 128) pending.push([method, args]);
  }
  for (const method of ['setEnabled', 'beginRun', 'track', 'loadResult', 'orientationGate', 'orientationReady', 'flushOnHide'])
    placeholder[method] = function () { dispatch(method, Array.from(arguments)); };
  window.KaltsitAnalytics = placeholder;
  window.KaltsitAnalyticsDispatch = dispatch;
  window.setTimeout(function () { expired = true; pending.length = 0; }, 8000);
  load('analytics-config.js').then(function () {
    // 调试开关只看环境，独立于埋点是否开启。
    window.KaltsitDebugConsole?.configure(window.kaltsitAnalyticsConfig?.environment);
    return load('analytics.js');
  }).then(function () {
    for (const call of pending.splice(0)) dispatch(call[0], call[1]);
  }).catch(function () {
    expired = true; pending.length = 0;
    window.KaltsitDebugConsole?.configure(null);
  });
})();
