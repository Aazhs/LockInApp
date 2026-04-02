const API_PATH = "/v1/dashboard";
const HISTORY_API_PATH = "/v1/dashboard/history";
const MANUAL_DOMAIN_API_PATH = "/v1/classification/manual-domains";
const REFRESH_MS = 10000;
const HISTORY_DAYS = 10;
const THEME_STORAGE_KEY = "lockin-dashboard-theme";
const RECENT_LIMIT_STORAGE_KEY = "lockin-dashboard-recent-limit";

let lastHistoryEndDate = "";
let lastHistoryRefreshedMs = 0;
let recentExpanded = false;

const BROWSER_COLORS = {
  zen: "#0e8b76",
  safari: "#c7922d",
  unknown: "#647789"
};

const elements = {
  statusText: document.getElementById("status-text"),
  dayWindowText: document.getElementById("day-window-text"),
  themeToggleBtn: document.getElementById("theme-toggle-btn"),
  dateInput: document.getElementById("date-input"),
  refreshBtn: document.getElementById("refresh-btn"),
  prevDayBtn: document.getElementById("prev-day-btn"),
  todayBtn: document.getElementById("today-btn"),
  nextDayBtn: document.getElementById("next-day-btn"),
  statActive: document.getElementById("stat-active"),
  statSessions: document.getElementById("stat-sessions"),
  statDomains: document.getElementById("stat-domains"),
  statUrls: document.getElementById("stat-urls"),
  timelineSvg: document.getElementById("timeline-svg"),
  timelineX: document.getElementById("timeline-x"),
  timelineTotal: document.getElementById("timeline-total"),
  donut: document.getElementById("donut"),
  browserList: document.getElementById("browser-list"),
  browserTotal: document.getElementById("browser-total"),
  domainBars: document.getElementById("domain-bars"),
  domainsTotal: document.getElementById("domains-total"),
  qualityModel: document.getElementById("quality-model"),
  qualityScoreRing: document.getElementById("quality-score-ring"),
  qualityScore: document.getElementById("quality-score"),
  qualityVerdict: document.getElementById("quality-verdict"),
  qualityGoodValue: document.getElementById("quality-good-value"),
  qualityNeutralValue: document.getElementById("quality-neutral-value"),
  qualityWasteValue: document.getElementById("quality-waste-value"),
  qualityGoodBar: document.getElementById("quality-good-bar"),
  qualityNeutralBar: document.getElementById("quality-neutral-bar"),
  qualityWasteBar: document.getElementById("quality-waste-bar"),
  qualityGoodDomains: document.getElementById("quality-good-domains"),
  qualityWasteDomains: document.getElementById("quality-waste-domains"),
  manualDomainInput: document.getElementById("manual-domain-input"),
  manualLabelSelect: document.getElementById("manual-label-select"),
  manualSaveBtn: document.getElementById("manual-save-btn"),
  manualDeleteBtn: document.getElementById("manual-delete-btn"),
  manualStatus: document.getElementById("manual-status"),
  manualPendingList: document.getElementById("manual-pending-list"),
  manualActiveList: document.getElementById("manual-active-list"),
  historyDays: document.getElementById("history-days"),
  recentLimitSelect: document.getElementById("recent-limit-select"),
  recentExpandBtn: document.getElementById("recent-expand-btn"),
  eventsBody: document.getElementById("events-body"),
  updatedAt: document.getElementById("updated-at"),
  tableWrap: document.querySelector(".table-wrap")
};

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalized;
  elements.themeToggleBtn.textContent = normalized === "dark" ? "Light Mode" : "Dark Mode";
  localStorage.setItem(THEME_STORAGE_KEY, normalized);
}

function getRecentLimit() {
  const raw = Number(elements.recentLimitSelect.value || 120);
  if (!Number.isFinite(raw)) {
    return 120;
  }
  return Math.max(10, Math.min(5000, Math.trunc(raw)));
}

function setRecentExpanded(isExpanded) {
  recentExpanded = Boolean(isExpanded);
  elements.tableWrap.classList.toggle("expanded", recentExpanded);
  elements.recentExpandBtn.textContent = recentExpanded ? "Collapse" : "Expand";
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addLocalDays(dateString, deltaDays) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return localDateString(date);
}

function currentUsageDateString() {
  const now = new Date();
  const today = localDateString(now);
  if (now.getHours() < 6) {
    return addLocalDays(today, -1);
  }
  return today;
}

function parseLocalDate(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

function formatDateHeading(dateString) {
  const parsed = parseLocalDate(dateString);
  return parsed.toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function formatDayWindowText(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startLabel = start.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  const endLabel = end.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  return `Usage day window: ${startLabel} to ${endLabel}`;
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    if (remainingSeconds > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${minutes}m`;
  }

  return `${remainingSeconds}s`;
}

function formatTime(iso) {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setManualStatus(message, isError = false) {
  elements.manualStatus.textContent = message;
  elements.manualStatus.classList.toggle("error", isError);
}

function normalizeDomainInput(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) {
    return "";
  }

  try {
    if (value.includes("://")) {
      return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    }

    if (value.includes("/") || value.includes("?") || value.includes("#")) {
      return new URL(`https://${value}`).hostname.replace(/^www\./, "").toLowerCase();
    }
  } catch {
    return "";
  }

  return value.replace(/^www\./, "");
}

function pickManualDomain(domain, label) {
  elements.manualDomainInput.value = domain;
  if (label && ["good", "neutral", "waste"].includes(label)) {
    elements.manualLabelSelect.value = label;
  }
}

function renderStats(data) {
  elements.statActive.textContent = formatDuration(data.totalActiveSeconds);
  elements.statSessions.textContent = String(data.sessionsCount);
  elements.statDomains.textContent = String(data.uniqueDomains);
  elements.statUrls.textContent = String(data.uniqueUrls);
  elements.timelineTotal.textContent = `${formatDuration(data.totalActiveSeconds)} tracked`;
  elements.browserTotal.textContent = formatDuration(data.totalActiveSeconds);
  elements.domainsTotal.textContent = `${data.topDomains.length} tracked`;
}

function renderTimeline(timeline) {
  const width = 960;
  const paddingX = 18;
  const baseline = 188;
  const chartHeight = 145;
  const points = timeline.length > 0 ? timeline : [{ label: "00:00", activeSeconds: 0 }];
  const maxValue = Math.max(1, ...points.map((point) => point.activeSeconds));
  const stepX = points.length > 1 ? (width - paddingX * 2) / (points.length - 1) : 0;

  const pathPoints = points.map((point, index) => {
    const x = paddingX + index * stepX;
    const y = baseline - (point.activeSeconds / maxValue) * chartHeight;
    return { x, y, value: point.activeSeconds };
  });

  const polyline = pathPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const fillPath =
    pathPoints.length > 1
      ? `M ${pathPoints[0].x} ${baseline} L ${polyline.replace(/ /g, " L ")} L ${pathPoints[pathPoints.length - 1].x} ${baseline} Z`
      : "";

  const circles = pathPoints
    .filter((point) => point.value > 0)
    .map(
      (point) =>
        `<circle cx="${point.x}" cy="${point.y}" r="2.5" fill="#0f7d72" opacity="0.9"></circle>`
    )
    .join("");

  elements.timelineSvg.innerHTML = `
    <defs>
      <linearGradient id="timelineGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2cb59a" stop-opacity="0.4"></stop>
        <stop offset="100%" stop-color="#2cb59a" stop-opacity="0.04"></stop>
      </linearGradient>
    </defs>
    <line x1="${paddingX}" y1="${baseline}" x2="${width - paddingX}" y2="${baseline}" stroke="#b9cdc8" stroke-width="1"></line>
    ${fillPath ? `<path d="${fillPath}" fill="url(#timelineGradient)"></path>` : ""}
    <polyline points="${polyline}" fill="none" stroke="#0f7d72" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></polyline>
    ${circles}
  `;

  const labels = [
    points[0]?.label,
    points[Math.floor(points.length / 3)]?.label,
    points[Math.floor((points.length * 2) / 3)]?.label,
    points[points.length - 1]?.label
  ];
  elements.timelineX.innerHTML = labels.map((label) => `<span>${label ?? ""}</span>`).join("");
}

function renderBrowserUsage(byBrowser, totalSeconds) {
  if (!byBrowser.length || totalSeconds <= 0) {
    elements.donut.style.background = "#ebf1ef";
    elements.browserList.innerHTML = '<p class="empty">No browser usage yet.</p>';
    return;
  }

  let currentPercent = 0;
  const segments = byBrowser.map((item) => {
    const percent = (item.activeSeconds / totalSeconds) * 100;
    const color = BROWSER_COLORS[item.browser] ?? BROWSER_COLORS.unknown;
    const segment = `${color} ${currentPercent.toFixed(2)}% ${(currentPercent + percent).toFixed(2)}%`;
    currentPercent += percent;
    return segment;
  });

  elements.donut.style.background = `conic-gradient(${segments.join(", ")})`;

  elements.browserList.innerHTML = byBrowser
    .map((item) => {
      const color = BROWSER_COLORS[item.browser] ?? BROWSER_COLORS.unknown;
      const share = totalSeconds > 0 ? Math.round((item.activeSeconds / totalSeconds) * 100) : 0;
      return `
        <div class="browser-item">
          <span class="left"><span class="dot" style="background:${color}"></span>${escapeHtml(item.browser)}</span>
          <span>${formatDuration(item.activeSeconds)} · ${share}%</span>
        </div>
      `;
    })
    .join("");
}

function renderDomainBars(topDomains) {
  if (!topDomains.length) {
    elements.domainBars.innerHTML = '<p class="empty">No domain activity yet.</p>';
    return;
  }

  const maxSeconds = Math.max(...topDomains.map((entry) => entry.activeSeconds), 1);
  elements.domainBars.innerHTML = topDomains
    .map((entry) => {
      const width = Math.max(6, Math.round((entry.activeSeconds / maxSeconds) * 100));
      return `
        <div class="domain-row">
          <div class="domain-meta">
            <strong>${escapeHtml(entry.domain)}</strong>
            <span>${formatDuration(entry.activeSeconds)} · ${entry.sessions} sessions</span>
          </div>
          <div class="domain-track">
            <div class="domain-fill" style="width:${width}%"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderQualityDomains(target, domains) {
  if (!domains?.length) {
    target.innerHTML = '<p class="empty">No domains yet.</p>';
    return;
  }

  target.innerHTML = domains
    .map(
      (entry) => `
      <div class="quality-domain-item">
        <span class="name">${escapeHtml(entry.domain)}</span>
        <span class="value">${formatDuration(entry.activeSeconds)}</span>
      </div>
    `
    )
    .join("");
}

function renderProductivity(productivity) {
  if (!productivity) {
    return;
  }

  const score = Math.max(0, Math.min(100, Number(productivity.score) || 0));
  const provider = productivity.provider ?? "gemini";
  const modelName = productivity.model ?? (provider === "gemini" ? "gemini-1.5-flash" : "gpt-4o-mini");
  const aiStatus = productivity.aiEnabled
    ? `YT AI: ${productivity.youtubeClassifiedVideos} classified, ${productivity.youtubePendingVideos} pending`
    : `YT AI disabled (missing ${provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"})`;
  elements.qualityModel.textContent = `${provider} · ${modelName} · ${aiStatus}`;
  elements.qualityScore.textContent = String(score);
  elements.qualityVerdict.textContent = productivity.verdict ?? "Mixed usage";
  elements.qualityGoodValue.textContent = `${productivity.goodPercent ?? 0}% · ${formatDuration(
    productivity.goodSeconds ?? 0
  )}`;
  elements.qualityNeutralValue.textContent = `${productivity.neutralPercent ?? 0}% · ${formatDuration(
    productivity.neutralSeconds ?? 0
  )}`;
  elements.qualityWasteValue.textContent = `${productivity.wastePercent ?? 0}% · ${formatDuration(
    productivity.wasteSeconds ?? 0
  )}`;
  elements.qualityGoodBar.style.width = `${Math.max(0, productivity.goodPercent ?? 0)}%`;
  elements.qualityNeutralBar.style.width = `${Math.max(0, productivity.neutralPercent ?? 0)}%`;
  elements.qualityWasteBar.style.width = `${Math.max(0, productivity.wastePercent ?? 0)}%`;

  const scoreState = score >= 70 ? "good" : score >= 45 ? "neutral" : "waste";
  elements.qualityScoreRing.style.setProperty("--score", String(score));
  elements.qualityScoreRing.classList.remove("good", "neutral", "waste");
  elements.qualityScoreRing.classList.add(scoreState);
  elements.qualityScoreRing.setAttribute("aria-label", `Focus score ${score} out of 100`);
  elements.qualityVerdict.classList.remove("good", "neutral", "waste");
  elements.qualityVerdict.classList.add(scoreState);

  renderQualityDomains(elements.qualityGoodDomains, productivity.topGoodDomains);
  renderQualityDomains(elements.qualityWasteDomains, productivity.topWasteDomains);
  renderManualLists(productivity);
}

function renderManualListItems(target, items, renderItem) {
  if (!items?.length) {
    target.innerHTML = '<p class="empty">No items.</p>';
    return;
  }

  target.innerHTML = items.map(renderItem).join("");
}

function renderManualLists(productivity) {
  renderManualListItems(
    elements.manualPendingList,
    productivity.pendingManualDomains,
    (entry) => `
      <div class="manual-item">
        <span><strong>${escapeHtml(entry.domain)}</strong> · ${formatDuration(entry.activeSeconds)}</span>
        <button type="button" data-manual-pick-domain="${escapeHtml(entry.domain)}">Classify</button>
      </div>
    `
  );

  renderManualListItems(
    elements.manualActiveList,
    productivity.manualDomainLabels,
    (entry) => `
      <div class="manual-item">
        <span><strong>${escapeHtml(entry.domain)}</strong> · ${escapeHtml(entry.label)}</span>
        <button type="button" data-manual-edit-domain="${escapeHtml(entry.domain)}" data-manual-edit-label="${escapeHtml(entry.label)}">Edit</button>
      </div>
    `
  );
}

async function saveManualDomainLabel() {
  const domain = normalizeDomainInput(elements.manualDomainInput.value);
  const label = elements.manualLabelSelect.value;
  if (!domain) {
    setManualStatus("Enter a valid domain to label.", true);
    return;
  }

  const response = await fetch(MANUAL_DOMAIN_API_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain, label })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Save failed (${response.status})`);
  }

  setManualStatus(`Saved: ${domain} → ${label}`);
}

async function deleteManualDomainLabel() {
  const domain = normalizeDomainInput(elements.manualDomainInput.value);
  if (!domain) {
    setManualStatus("Enter a valid domain to delete.", true);
    return;
  }

  const response = await fetch(`${MANUAL_DOMAIN_API_PATH}/${encodeURIComponent(domain)}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Delete failed (${response.status})`);
  }

  setManualStatus(`Removed manual label for ${domain}`);
}

function renderRecentEvents(events) {
  if (!events.length) {
    elements.eventsBody.innerHTML =
      '<tr><td colspan="7" class="empty">No events recorded for this date.</td></tr>';
    return;
  }

  elements.eventsBody.innerHTML = events
    .map((event) => {
      const title = event.title ? escapeHtml(event.title) : "-";
      const browserClass = event.browser === "zen" || event.browser === "safari" ? event.browser : "unknown";
      const label = escapeHtml(event.classificationLabel ?? "neutral");
      const reason = escapeHtml(event.classificationReason ?? "No reason");
      const source = escapeHtml(event.classificationSource ?? "fallback");
      return `
        <tr>
          <td>${formatTime(event.endedAt)}</td>
          <td>${escapeHtml(event.domain)}</td>
          <td title="${escapeHtml(event.url)}">${title}</td>
          <td><span class="browser-pill ${browserClass}">${escapeHtml(event.browser)}</span></td>
          <td title="${source}: ${reason}"><span class="class-pill ${label}">${label}</span></td>
          <td>${event.sessions}</td>
          <td>${formatDuration(event.activeSeconds)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderHistory(items, selectedDate) {
  if (!items?.length) {
    elements.historyDays.innerHTML = '<p class="empty">No daily history yet.</p>';
    return;
  }

  const maxSeconds = Math.max(1, ...items.map((item) => item.totalActiveSeconds ?? 0));
  elements.historyDays.innerHTML = items
    .map((item) => {
      const usageSeconds = Number(item.totalActiveSeconds) || 0;
      const sessions = Number(item.sessionsCount) || 0;
      const uniqueDomains = Number(item.uniqueDomains) || 0;
      const width = Math.max(6, Math.round((usageSeconds / maxSeconds) * 100));
      const selectedClass = item.date === selectedDate ? "selected" : "";
      return `
        <button
          type="button"
          class="history-day ${selectedClass}"
          data-history-date="${escapeHtml(item.date)}"
          title="${escapeHtml(item.date)}"
        >
          <span class="history-date">${escapeHtml(formatDateHeading(item.date))}</span>
          <strong>${escapeHtml(formatDuration(usageSeconds))}</strong>
          <span class="history-meta">${sessions} sessions · ${uniqueDomains} domains</span>
          <span class="history-bar"><span style="width:${width}%"></span></span>
        </button>
      `;
    })
    .join("");
}

async function refreshHistory(endDate) {
  const params = new URLSearchParams({
    endDate,
    days: String(HISTORY_DAYS)
  });
  const response = await fetch(`${HISTORY_API_PATH}?${params.toString()}`, {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`History request failed (${response.status})`);
  }

  const payload = await response.json();
  if (!payload?.ok || !payload.data) {
    throw new Error("Unexpected history payload");
  }

  renderHistory(payload.data.items, elements.dateInput.value);
  lastHistoryEndDate = endDate;
  lastHistoryRefreshedMs = Date.now();
}

function updateDateButtons() {
  const selectedDate = elements.dateInput.value;
  const currentUsageDate = currentUsageDateString();
  elements.nextDayBtn.disabled = selectedDate >= currentUsageDate;
}

function shiftSelectedDate(deltaDays) {
  elements.dateInput.value = addLocalDays(elements.dateInput.value, deltaDays);
  updateDateButtons();
  void refreshDashboard();
}

async function refreshDashboard() {
  const selectedDate = elements.dateInput.value;
  const limit = getRecentLimit();
  const url = `${API_PATH}?date=${encodeURIComponent(selectedDate)}&limit=${encodeURIComponent(limit)}`;

  try {
    const [dashboardResponse] = await Promise.all([fetch(url, { cache: "no-store" })]);
    if (!dashboardResponse.ok) {
      throw new Error(`Request failed (${dashboardResponse.status})`);
    }

    const payload = await dashboardResponse.json();
    if (!payload?.ok || !payload.data) {
      throw new Error("Unexpected payload from collector");
    }

    const data = payload.data;
    renderStats(data);
    renderTimeline(data.timeline);
    renderBrowserUsage(data.byBrowser, data.totalActiveSeconds);
    renderDomainBars(data.topDomains);
    renderProductivity(data.productivity);
    renderRecentEvents(data.recentEvents);
    elements.dayWindowText.textContent = formatDayWindowText(data.usageDayStartIso, data.usageDayEndIso);

    const generatedAt = new Date(data.generatedAt);
    elements.updatedAt.textContent = `Updated ${generatedAt.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })}`;

    const dateLabel = data.date === currentUsageDateString() ? "today" : data.date;
    const provider = data.productivity?.provider ?? "gemini";
    const ytStatus = data.productivity?.aiEnabled
      ? `YT AI ${data.productivity.youtubeClassifiedVideos} done / ${data.productivity.youtubePendingVideos} pending`
      : `YT AI disabled (missing ${provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"})`;
    elements.statusText.textContent = `Live every ${REFRESH_MS / 1000}s · showing ${dateLabel} · rows ${limit} · ${ytStatus}`;
    elements.statusText.classList.remove("error");

    const shouldRefreshHistory =
      lastHistoryEndDate !== selectedDate || Date.now() - lastHistoryRefreshedMs > 60000;
    if (shouldRefreshHistory) {
      void refreshHistory(selectedDate).catch(() => {
        elements.historyDays.innerHTML =
          '<p class="empty">Unable to load daily history right now.</p>';
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    elements.statusText.textContent = `Collector offline: ${message}`;
    elements.statusText.classList.add("error");
  }
}

function setup() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) ?? "light";
  applyTheme(savedTheme);

  const savedLimit = localStorage.getItem(RECENT_LIMIT_STORAGE_KEY);
  if (
    savedLimit &&
    [...elements.recentLimitSelect.options].some((option) => option.value === savedLimit)
  ) {
    elements.recentLimitSelect.value = savedLimit;
  }

  elements.dateInput.value = currentUsageDateString();
  updateDateButtons();
  setManualStatus("");
  setRecentExpanded(false);

  elements.refreshBtn.addEventListener("click", () => {
    void refreshDashboard();
  });

  elements.themeToggleBtn.addEventListener("click", () => {
    applyTheme(currentTheme() === "dark" ? "light" : "dark");
  });

  elements.recentLimitSelect.addEventListener("change", () => {
    localStorage.setItem(RECENT_LIMIT_STORAGE_KEY, elements.recentLimitSelect.value);
    void refreshDashboard();
  });

  elements.recentExpandBtn.addEventListener("click", () => {
    setRecentExpanded(!recentExpanded);
  });

  elements.dateInput.addEventListener("change", () => {
    updateDateButtons();
    void refreshDashboard();
  });

  elements.prevDayBtn.addEventListener("click", () => {
    shiftSelectedDate(-1);
  });

  elements.todayBtn.addEventListener("click", () => {
    elements.dateInput.value = currentUsageDateString();
    updateDateButtons();
    void refreshDashboard();
  });

  elements.nextDayBtn.addEventListener("click", () => {
    if (elements.nextDayBtn.disabled) {
      return;
    }
    shiftSelectedDate(1);
  });

  elements.manualSaveBtn.addEventListener("click", () => {
    void (async () => {
      try {
        await saveManualDomainLabel();
        await refreshDashboard();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save label";
        setManualStatus(message, true);
      }
    })();
  });

  elements.manualDeleteBtn.addEventListener("click", () => {
    void (async () => {
      try {
        await deleteManualDomainLabel();
        await refreshDashboard();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete label";
        setManualStatus(message, true);
      }
    })();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const pickDomain = target.getAttribute("data-manual-pick-domain");
    if (pickDomain) {
      pickManualDomain(pickDomain);
      setManualStatus(`Selected ${pickDomain} for manual labeling.`);
      return;
    }

    const editDomain = target.getAttribute("data-manual-edit-domain");
    const editLabel = target.getAttribute("data-manual-edit-label");
    if (editDomain) {
      pickManualDomain(editDomain, editLabel);
      setManualStatus(`Loaded existing label for ${editDomain}.`);
      return;
    }

    const historyButton = target.closest("[data-history-date]");
    const historyDate = historyButton?.getAttribute("data-history-date");
    if (historyDate) {
      elements.dateInput.value = historyDate;
      updateDateButtons();
      void refreshDashboard();
    }
  });

  void refreshDashboard();
  window.setInterval(() => {
    if (document.hidden) {
      return;
    }
    void refreshDashboard();
  }, REFRESH_MS);
}

setup();
