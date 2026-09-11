(function () {
  'use strict';
  window.KaltsitLoading = {
    create: function (config) {
      const starts = new Map([['page_total', 0]]);
      const completed = new Set();
      const resources = new Map();
      const resourceStages = new Map([
        [config.frameworkUrl, 'framework_fetch'], [config.dataUrl, 'data_fetch'], [config.codeUrl, 'wasm_fetch']
      ].map(([url, stage]) => [new URL(url, document.baseURI).href, stage]));
      let observer;
      let finished = false;

      function emit(stage, result, start, end) {
        if (completed.has(stage) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
        completed.add(stage);
        window.KaltsitDebugConsole?.log(result === 'failed' ? 'error' : 'info',
          '[加载]', stage, result, Math.round(end - start) + 'ms');
        if (window.KaltsitAnalyticsDispatch) window.KaltsitAnalyticsDispatch('track', ['game_load_step', {
          stage: stage, result: result, duration_ms: Math.round(end - start), since_start_ms: Math.round(start)
        }]);
      }

      function begin(stage) {
        if (!finished && !starts.has(stage) && !completed.has(stage)) {
          starts.set(stage, performance.now());
          window.KaltsitDebugConsole?.log('info', '[加载]', stage, '开始');
        }
      }

      function end(stage, result = 'success', at = performance.now()) {
        if (!starts.has(stage)) return;
        emit(stage, result, starts.get(stage), at);
        starts.delete(stage);
      }

      function collect(entries) {
        for (const entry of entries) {
          const stage = resourceStages.get(entry.name);
          if (stage && entry.responseEnd > 0) resources.set(stage, entry);
        }
      }

      function reportResources(result) {
        // 浏览器不一定暴露缓存读取或跨域明细；缺失测量不填成零，也不据此推断失败。
        for (const [stage, entry] of resources) {
          const status = entry.responseStatus || 0;
          if (status >= 400 || (status >= 200 && status < 400) || result === 'success')
            emit(stage, status >= 400 ? 'failed' : 'success', entry.startTime, entry.responseEnd);
        }
      }

      function finish(result) {
        if (finished) return;
        finished = true;
        const at = performance.now();
        for (const stage of starts.keys()) end(stage, result, at);
        try {
          if (observer) collect(observer.takeRecords());
          if (performance.getEntriesByType) collect(performance.getEntriesByType('resource'));
          reportResources(result);
        } catch (_) {}
        if (observer) observer.disconnect();
        window.removeEventListener('pagehide', onPageHide);
      }

      function onPageHide(event) {
        if (event.persisted) return;
        finish('cancelled');
        if (window.KaltsitAnalyticsDispatch) window.KaltsitAnalyticsDispatch('flushOnHide', []);
      }

      // 只使用 Unity 模板公开的生命周期回调，不改写生成的 loader 或全局 fetch。
      config.preRun = [...(config.preRun || []), function () {
        if (finished) return;
        end('unity_prepare');
        begin('scene_start');
      }];
      try {
        if (window.PerformanceObserver) {
          observer = new window.PerformanceObserver(function (list) {
            collect(list.getEntries());
            reportResources();
          });
          observer.observe({ type: 'resource', buffered: true });
        }
      } catch (_) { observer = null; }
      window.addEventListener('pagehide', onPageHide);
      return { begin: begin, end: end, finish: finish };
    }
  };
})();
