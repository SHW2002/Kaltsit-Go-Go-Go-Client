(function () {
  'use strict';
  const config = window.kaltsitAnalyticsConfig || {};
  const maxQueue = 128;
  const batchSize = 32;
  const sessionId = uuid();
  const identity = loadIdentity();
  const agent = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod/i.test(agent)
    || (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);
  const browser = /MicroMessenger/i.test(agent) ? 'wechat' : /MQQBrowser|\bQQ\//i.test(agent) ? 'qq'
    : /Edg\//i.test(agent) ? 'edge' : /Firefox|FxiOS/i.test(agent) ? 'firefox'
    : /Chrome|CriOS/i.test(agent) ? 'chrome' : /Safari/i.test(agent) ? 'safari' : 'other';
  const endpoint = config.apiBaseUrl ? config.apiBaseUrl.replace(/\/+$/, '') + '/api/v1/gpr' : '';
  let enabled = config.enabled === true && Boolean(endpoint);
  let queue = [];
  let inFlight = [];
  let retryAt = 0;
  let failureCount = 0;
  let runId = null;
  let runIndex = 0;
  const runIndices = new Map();
  let debug = false;
  let input = mobile ? 'touch' : 'unknown';
  let backgroundMs = 0;
  let hiddenAt = document.hidden ? performance.now() : null;
  let runBackgroundStart = 0;
  const pageStartedAt = window.kaltsitAnalyticsStartedAt ?? performance.now();
  let loadFinished = false;
  let gateShown = false;
  let orientationFinished = false;

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (letter) {
      const value = Math.floor(Math.random() * 16);
      return (letter === 'x' ? value : (value & 3) | 8).toString(16);
    });
  }

  function loadIdentity() {
    try {
      const existing = localStorage.getItem('kaltsit.analytics.visitor.v1');
      if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(existing || ''))
        return { id: existing, isNew: false };
      const id = uuid();
      localStorage.setItem('kaltsit.analytics.visitor.v1', id);
      return { id: id, isNew: true };
    } catch (_) { return { id: uuid(), isNew: true }; }
  }

  function totalBackgroundMs() {
    return backgroundMs + (hiddenAt === null ? 0 : performance.now() - hiddenAt);
  }

  function track(name, properties, eventRunId) {
    if (!enabled) return;
    const values = Object.assign({}, properties || {});
    for (const key of Object.keys(values)) {
      if (values[key] === null || values[key] === '') delete values[key];
    }
    const currentRun = eventRunId || runId;
    values.input = input;
    values.orientation = window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
    if (currentRun) values.run_index = runIndices.get(currentRun)?.index || runIndex;
    if (name === 'run_end' || name === 'performance_summary') {
      values.background_ms = Math.round(totalBackgroundMs() - runBackgroundStart);
      if (name === 'run_end') values.duration_ms = Math.max(0, values.duration_ms - values.background_ms);
    }
    queue.push({
      id: uuid(), name: name, anonymousId: identity.id, sessionId: sessionId, runId: currentRun || null,
      occurredAt: new Date().toISOString(), appVersion: config.appVersion || 'unknown',
      environment: config.environment || 'test', device: mobile ? 'mobile' : 'desktop', browser: browser,
      isNewVisitor: identity.isNew, isDebug: currentRun && runIndices.has(currentRun) ? runIndices.get(currentRun).debug : debug, properties: values
    });
    if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
    if (queue.length >= batchSize || name === 'run_end' || name === 'game_load_result') flush();
  }

  async function flush() {
    if (!enabled || inFlight.length || !queue.length || Date.now() < retryAt) return;
    const batch = queue.splice(0, batchSize);
    inFlight = batch;
    const controller = new AbortController();
    const timeout = window.setTimeout(function () { controller.abort(); }, 8000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
        body: JSON.stringify({ events: batch }), signal: controller.signal
      });
      if (!response.ok && (response.status >= 500 || response.status === 429 || response.status === 408))
        throw new Error('retry');
      // 非重试类 4xx 丢弃当前批次，避免无效事件一直堵住队列。
      failureCount = 0;
      retryAt = 0;
    } catch (_) {
      if (enabled) queue = batch.concat(queue).slice(-maxQueue);
      failureCount++;
      retryAt = Date.now() + Math.min(60000, 5000 * Math.pow(2, Math.min(failureCount, 4)));
    } finally {
      window.clearTimeout(timeout);
      inFlight = [];
    }
  }

  function flushOnHide() {
    if (!enabled) return;
    // 离页发送没有服务端确认；保留队列以便恢复后重发，服务端按 ID 去重。
    const batch = inFlight.concat(queue).slice(0, batchSize);
    if (!batch.length) return;
    const body = JSON.stringify({ events: batch });
    try {
      // JSON Beacon 跨域时携带凭据，而 API 不开放凭据 CORS；跨域沿用匿名 fetch。
      const sameOrigin = new URL(endpoint, window.location.origin).origin === window.location.origin;
      if (sameOrigin && navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))) return;
      fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body,
        keepalive: true, credentials: 'omit'
      }).catch(function () {});
    } catch (_) {}
  }

  window.KaltsitAnalytics = {
    track: track,
    flush: flush,
    flushOnHide: flushOnHide,
    setEnabled: function (value) {
      enabled = config.enabled === true && value === true && Boolean(endpoint);
      if (!enabled) queue = [];
    },
    beginRun: function (id, isDebug) {
      runId = id;
      runIndex++;
      runIndices.set(id, { index: runIndex, debug: isDebug });
      if (runIndices.size > 16) runIndices.delete(runIndices.keys().next().value);
      debug = isDebug;
      runBackgroundStart = totalBackgroundMs();
    },
    loadResult: function (result, stage) {
      if (loadFinished) return;
      loadFinished = true;
      track('game_load_result', { result: result, stage: stage, duration_ms: performance.now() - pageStartedAt });
    },
    orientationGate: function (reason) {
      if (gateShown || orientationFinished) return;
      gateShown = true;
      track('orientation_gate_shown', { reason: reason });
    },
    orientationReady: function () {
      if (orientationFinished || !mobile) return;
      orientationFinished = true;
      track('orientation_ready', { duration_ms: performance.now() - pageStartedAt });
    }
  };

  document.addEventListener('pointerdown', function (event) { input = event.pointerType === 'touch' ? 'touch' : 'mouse'; }, { passive: true });
  document.addEventListener('keydown', function (event) { if (['Space', 'KeyA', 'KeyD'].includes(event.code)) input = 'keyboard'; });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (hiddenAt === null) hiddenAt = performance.now();
      track('page_hidden', { active_ms: performance.now() - pageStartedAt - totalBackgroundMs() });
      flushOnHide();
    } else {
      if (hiddenAt !== null) backgroundMs += performance.now() - hiddenAt;
      hiddenAt = null;
      flush();
    }
  });
  window.addEventListener('pagehide', flushOnHide);
  window.setInterval(function () { if (!document.hidden) flush(); }, 10000);
  window.setInterval(function () {
    if (!document.hidden) track('session_heartbeat', { active_ms: performance.now() - pageStartedAt - totalBackgroundMs() });
  }, 30000);
  track('page_enter');
  flush();
})();
