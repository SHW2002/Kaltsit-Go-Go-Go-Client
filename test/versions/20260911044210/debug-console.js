(function () {
  'use strict';
  const version = new URLSearchParams(window.location.search).get('v');
  const root = version ? 'versions/' + encodeURIComponent(version) + '/' : './';
  const cacheKey = version || new URL(document.currentScript.src).searchParams.get('v') || '';
  const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const methods = ['log', 'info', 'warn', 'error', 'debug'];
  const originals = {};
  const wrappers = {};
  const pending = [];
  let state = 'pending';
  let timeout;

  // Unity 捕获 keypress 并阻止文本输入；先隔离面板按键，让筛选和命令框正常工作。
  function isolateKeyboard(event) {
    if (state === 'active' && event.target?.closest?.('#__vconsole.vc-toggle')) event.stopImmediatePropagation();
  }
  window.addEventListener('keypress', isolateKeyboard, true);
  document.addEventListener('keydown', isolateKeyboard);
  document.addEventListener('keyup', isolateKeyboard);

  function remember(type, args) {
    const text = args.slice(0, 10).map(value => {
      try { return String(value?.stack || value).slice(0, 8000); }
      catch (_) { return '[无法格式化日志]'; }
    });
    pending.push({ type: type, args: text, at: Math.round(performance.now()) });
    if (pending.length > 200) pending.shift();
  }

  // 仅在环境与面板就绪前暂存日志；保留浏览器原始输出，不持有大型运行时对象。
  for (const method of methods) {
    originals[method] = console[method];
    wrappers[method] = function (...args) {
      remember(method, args);
      originals[method].apply(console, args);
    };
    console[method] = wrappers[method];
  }
  function onError(event) {
    remember('error', [event.error || event.message || ('资源加载失败：' + (event.target?.src || event.target?.href || 'unknown'))]);
  }
  function onRejection(event) { remember('error', ['未处理的 Promise 异常', event.reason]); }
  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onRejection);

  function releaseCapture() {
    for (const method of methods) if (console[method] === wrappers[method]) console[method] = originals[method];
    window.removeEventListener('error', onError, true);
    window.removeEventListener('unhandledrejection', onRejection);
  }

  function disable() {
    state = 'off';
    releaseCapture();
    window.removeEventListener('keypress', isolateKeyboard, true);
    document.removeEventListener('keydown', isolateKeyboard);
    document.removeEventListener('keyup', isolateKeyboard);
    pending.length = 0;
    window.clearTimeout(timeout);
  }

  function initialize() {
    if (state !== 'loading') return;
    releaseCapture();
    try {
      window.kaltsitVConsole = new window.VConsole({
        // 放在游戏全屏容器内，进入全屏后仍能打开调试面板。
        target: document.querySelector('#unity-container') || document.body,
        // Network 插件会包装流式响应，影响 Unity 下载；这里只启用日志和系统信息。
        defaultPlugins: ['system'],
        log: { maxLogNumber: 200, showTimestamps: true }
      });
      window.kaltsitVConsole.setSwitchPosition(12, 76);
      state = 'active';
      document.body.classList.add('has-debug-console');
      window.clearTimeout(timeout);
      for (const entry of pending.splice(0))
        window.kaltsitVConsole.log[entry.type](`[早期 +${entry.at}ms]`, ...entry.args);
      console.info('[调试] vConsole 已启用', localPreview ? '本地 WebGL 预览' : '测试服');
    } catch (error) {
      disable();
      originals.warn.call(console, '[调试] vConsole 初始化失败，可使用浏览器开发者工具', error);
    }
  }

  function configure(environment) {
    if (state !== 'pending') return;
    if (!localPreview && environment !== 'test') { disable(); return; }
    state = 'loading';
    const script = document.createElement('script');
    script.async = true;
    script.src = root + 'vendor/vconsole.min.js?v=' + encodeURIComponent(cacheKey);
    script.onload = function () {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
      else initialize();
    };
    script.onerror = function () {
      disable();
      originals.warn.call(console, '[调试] vConsole 下载失败，可使用浏览器开发者工具');
    };
    document.head.appendChild(script);
  }

  window.KaltsitDebugConsole = {
    configure: configure,
    log: function (type, ...args) {
      if (!methods.includes(type) || state === 'off') return;
      if (state === 'active') console[type](...args);
      else remember(type, args);
    }
  };
  timeout = window.setTimeout(disable, 15000);
  if (localPreview) configure('test');
})();
