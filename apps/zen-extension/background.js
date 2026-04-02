const COLLECTOR_ENDPOINT = "http://127.0.0.1:4317/v1/events";
const BROWSER_NAME = "zen";
const HEARTBEAT_MS = 5000;
const IDLE_THRESHOLD_SECONDS = 60;
const HISTORY_BACKFILL_MARKER_KEY = "lockin-history-backfill-day";
const HISTORY_SEARCH_LIMIT = 10000;
const HISTORY_EVENT_MAX_SECONDS = 300;
const MIN_REALTIME_EMIT_MS = 2000;
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

let lastTickMs = Date.now();
let lastRealtimeEmitMs = 0;

function hasBrowserNamespace() {
  return typeof browser !== "undefined";
}

function getExtensionApi() {
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
  if (hasBrowserNamespace()) {
    return browser.tabs.query(queryInfo);
  }
  return new Promise((resolve) => chrome.tabs.query(queryInfo, resolve));
}

function windowsGetLastFocused() {
  if (hasBrowserNamespace()) {
    return browser.windows.getLastFocused();
  }
  return new Promise((resolve) => chrome.windows.getLastFocused(resolve));
}

function idleQueryState(detectionIntervalInSeconds) {
  if (hasBrowserNamespace()) {
    return browser.idle.queryState(detectionIntervalInSeconds);
  }
  return new Promise((resolve) => chrome.idle.queryState(detectionIntervalInSeconds, resolve));
}

function historySearch(query) {
  const extensionApi = getExtensionApi();
  if (hasBrowserNamespace()) {
    return extensionApi.history.search(query);
  }
  return new Promise((resolve) => extensionApi.history.search(query, resolve));
}

function historyGetVisits(details) {
  const extensionApi = getExtensionApi();
  if (hasBrowserNamespace()) {
    return extensionApi.history.getVisits(details);
  }
  return new Promise((resolve) => extensionApi.history.getVisits(details, resolve));
}

function storageGet(key) {
  const extensionApi = getExtensionApi();
  if (hasBrowserNamespace()) {
    return extensionApi.storage.local.get(key).then((result) => result[key]);
  }
  return new Promise((resolve) =>
    extensionApi.storage.local.get([key], (result) => resolve(result?.[key]))
  );
}

function storageSet(value) {
  const extensionApi = getExtensionApi();
  if (hasBrowserNamespace()) {
    return extensionApi.storage.local.set(value);
  }
  return new Promise((resolve) => extensionApi.storage.local.set(value, resolve));
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDayMs(nowMs) {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function toHistoricalUsageEvents(visits, nowMs) {
  const events = [];

  for (let index = 0; index < visits.length; index += 1) {
    const currentVisit = visits[index];
    const nextVisit = visits[index + 1];
    const nextVisitMs = nextVisit ? nextVisit.visitTime : nowMs;
    const rawSeconds = Math.max(1, Math.round((nextVisitMs - currentVisit.visitTime) / 1000));
    const activeSeconds = Math.min(rawSeconds, HISTORY_EVENT_MAX_SECONDS);
    const endMs = currentVisit.visitTime + activeSeconds * 1000;

    if (endMs <= currentVisit.visitTime) {
      continue;
    }

    events.push({
      browser: BROWSER_NAME,
      url: currentVisit.url,
      title: currentVisit.title,
      startedAt: new Date(currentVisit.visitTime).toISOString(),
      endedAt: new Date(endMs).toISOString(),
      activeSeconds,
      isFocused: true
    });
  }

  return events;
}

async function collectTodayHistoryVisits(nowMs) {
  const startMs = startOfLocalDayMs(nowMs);
  const items = await historySearch({
    text: "",
    startTime: startMs,
    endTime: nowMs,
    maxResults: HISTORY_SEARCH_LIMIT
  });

  const visits = [];
  for (const item of items) {
    if (!item.url || !isTrackableUrl(item.url)) {
      continue;
    }

    try {
      const itemVisits = await historyGetVisits({ url: item.url });
      for (const visit of itemVisits) {
        if (typeof visit.visitTime !== "number") {
          continue;
        }
        if (visit.visitTime < startMs || visit.visitTime > nowMs) {
          continue;
        }
        visits.push({
          url: item.url,
          title: item.title,
          visitTime: visit.visitTime
        });
      }
    } catch {
      // Skip URLs that fail history read.
    }
  }

  visits.sort((a, b) => a.visitTime - b.visitTime);
  return visits;
}

async function getSampleContext() {
  const windowInfoPromise = windowsGetLastFocused().catch(() => null);
  const [windowInfo, tabs, idleState] = await Promise.all([
    windowInfoPromise,
    tabsQuery({ active: true, lastFocusedWindow: true }),
    idleQueryState(IDLE_THRESHOLD_SECONDS)
  ]);
  const tab = tabs[0];
  return { windowInfo, tab, idleState };
}

async function sendUsageEvent(payload) {
  try {
    const response = await fetch(COLLECTOR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      return false;
    }
    return true;
  } catch {
    // Ignore collector connection errors. Extension should keep sampling.
    return false;
  }
}

async function runDailyHistoryBackfill() {
  try {
    const nowMs = Date.now();
    const today = localDateKey(new Date(nowMs));
    const processedDay = await storageGet(HISTORY_BACKFILL_MARKER_KEY);

    if (processedDay === today) {
      return;
    }

    const historyVisits = await collectTodayHistoryVisits(nowMs);
    const historicalEvents = toHistoricalUsageEvents(historyVisits, nowMs);

    if (historicalEvents.length === 0) {
      await storageSet({ [HISTORY_BACKFILL_MARKER_KEY]: today });
      return;
    }

    for (const event of historicalEvents) {
      const sent = await sendUsageEvent(event);
      if (!sent) {
        return;
      }
    }

    await storageSet({ [HISTORY_BACKFILL_MARKER_KEY]: today });
  } catch {
    // Keep live heartbeat running even if backfill fails.
  }
}

async function emitHeartbeat() {
  const nowMs = Date.now();
  const elapsedSeconds = Math.max(1, Math.round((nowMs - lastTickMs) / 1000));
  const startedAt = new Date(nowMs - elapsedSeconds * 1000).toISOString();
  const endedAt = new Date(nowMs).toISOString();
  lastTickMs = nowMs;

  const { windowInfo, tab, idleState } = await getSampleContext();
  if (idleState !== "active" || !tab?.url) {
    return;
  }

  if (windowInfo && !windowInfo.focused) {
    return;
  }

  if (!isTrackableUrl(tab.url)) {
    return;
  }

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

function emitRealtimePulse() {
  const nowMs = Date.now();
  if (nowMs - lastRealtimeEmitMs < MIN_REALTIME_EMIT_MS) {
    return;
  }

  lastRealtimeEmitMs = nowMs;
  void emitHeartbeat();
}

function attachRealtimeListeners() {
  const extensionApi = getExtensionApi();

  extensionApi.tabs.onActivated.addListener(() => {
    emitRealtimePulse();
  });

  extensionApi.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab?.active) {
      emitRealtimePulse();
    }
  });

  if (extensionApi.windows?.onFocusChanged) {
    try {
      extensionApi.windows.onFocusChanged.addListener((windowId) => {
        if (
          typeof extensionApi.windows.WINDOW_ID_NONE === "number" &&
          windowId === extensionApi.windows.WINDOW_ID_NONE
        ) {
          return;
        }
        emitRealtimePulse();
      });
    } catch {
      // Continue running heartbeat tracking even if windows events are unavailable.
    }
  }
}

function start() {
  attachRealtimeListeners();
  setInterval(() => {
    void emitHeartbeat();
  }, HEARTBEAT_MS);
  void emitHeartbeat();
  void runDailyHistoryBackfill();
}

start();
