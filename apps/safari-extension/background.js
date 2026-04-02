const COLLECTOR_ENDPOINT = "http://127.0.0.1:4317/v1/events";
const BROWSER_NAME = "safari";
const HEARTBEAT_ALARM = "lockin-heartbeat";
const HEARTBEAT_SECONDS = 60;
const IDLE_THRESHOLD_SECONDS = 60;
const MIN_REALTIME_EMIT_MS = 3000;
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

let lastTickMs = Date.now();
let lastRealtimeEmitMs = 0;

function hasBrowserNamespace() {
  return typeof browser !== "undefined";
}

function getRuntimeApi() {
  return hasBrowserNamespace() ? browser : chrome;
}

function isBlockedHost(hostname) {
  const normalized = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(normalized)) {
    return true;
  }

  if (normalized.startsWith("127.")) {
    return true;
  }

  if (normalized.endsWith(".localhost")) {
    return true;
  }

  return false;
}

function isTrackableUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    return !isBlockedHost(parsed.hostname);
  } catch {
    return false;
  }
}

function tabsQuery(queryInfo) {
  const runtime = getRuntimeApi();
  if (!runtime.tabs?.query) {
    return Promise.resolve([]);
  }

  if (hasBrowserNamespace()) {
    return runtime.tabs.query(queryInfo).catch(() => []);
  }
  return new Promise((resolve) => runtime.tabs.query(queryInfo, resolve));
}

function windowsGetLastFocused() {
  const runtime = getRuntimeApi();
  if (!runtime.windows?.getLastFocused) {
    return Promise.resolve(null);
  }

  if (hasBrowserNamespace()) {
    return runtime.windows.getLastFocused().catch(() => null);
  }
  return new Promise((resolve) => runtime.windows.getLastFocused(resolve));
}

function idleQueryState(detectionIntervalInSeconds) {
  const runtime = getRuntimeApi();
  if (!runtime.idle?.queryState) {
    return Promise.resolve("active");
  }

  if (hasBrowserNamespace()) {
    return runtime.idle.queryState(detectionIntervalInSeconds).catch(() => "active");
  }
  return new Promise((resolve) => runtime.idle.queryState(detectionIntervalInSeconds, resolve));
}

async function sendUsageEvent(payload) {
  try {
    await fetch(COLLECTOR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch {
    // Ignore collector connection errors. Next heartbeat will retry.
  }
}

async function emitHeartbeat() {
  const [windowInfo, tabs, idleState] = await Promise.all([
    windowsGetLastFocused(),
    tabsQuery({ active: true, lastFocusedWindow: true }),
    idleQueryState(IDLE_THRESHOLD_SECONDS)
  ]);

  const tab = tabs[0];
  if (idleState !== "active" || !tab?.url) {
    return;
  }

  if (windowInfo && !windowInfo.focused) {
    return;
  }

  if (!isTrackableUrl(tab.url)) {
    return;
  }

  const nowMs = Date.now();
  const elapsedSeconds = Math.max(1, Math.round((nowMs - lastTickMs) / 1000));
  const startedAt = new Date(nowMs - elapsedSeconds * 1000).toISOString();
  const endedAt = new Date(nowMs).toISOString();
  lastTickMs = nowMs;

  await sendUsageEvent({
    browser: BROWSER_NAME,
    url: tab.url,
    title: tab.title,
    startedAt,
    endedAt,
    activeSeconds: elapsedSeconds,
    isFocused: true,
    sourceTabId: typeof tab.id === "number" ? tab.id : undefined
  });
}

function setupAlarms() {
  const runtime = getRuntimeApi();
  if (!runtime.alarms?.create) {
    return;
  }

  runtime.alarms.create(HEARTBEAT_ALARM, {
    periodInMinutes: Math.max(1, HEARTBEAT_SECONDS / 60)
  });
}

const runtime = getRuntimeApi();

function emitRealtimePulse() {
  const nowMs = Date.now();
  if (nowMs - lastRealtimeEmitMs < MIN_REALTIME_EMIT_MS) {
    return;
  }

  lastRealtimeEmitMs = nowMs;
  void emitHeartbeat();
}

function attachRealtimeListeners() {
  if (runtime.tabs?.onActivated) {
    runtime.tabs.onActivated.addListener(() => {
      emitRealtimePulse();
    });
  }

  if (runtime.tabs?.onUpdated) {
    runtime.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
      if (changeInfo.status === "complete" && tab?.active) {
        emitRealtimePulse();
      }
    });
  }

  if (runtime.windows?.onFocusChanged) {
    runtime.windows.onFocusChanged.addListener((windowId) => {
      if (
        typeof runtime.windows.WINDOW_ID_NONE === "number" &&
        windowId === runtime.windows.WINDOW_ID_NONE
      ) {
        return;
      }
      emitRealtimePulse();
    });
  }
}

attachRealtimeListeners();
setupAlarms();
void emitHeartbeat();

runtime.runtime.onInstalled.addListener(() => {
  setupAlarms();
  void emitHeartbeat();
});

runtime.runtime.onStartup.addListener(() => {
  setupAlarms();
  void emitHeartbeat();
});

if (runtime.alarms?.onAlarm) {
  runtime.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== HEARTBEAT_ALARM) {
      return;
    }
    void emitHeartbeat();
  });
}
