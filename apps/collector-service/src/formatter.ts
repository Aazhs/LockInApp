import { DailySummary } from "@lockin/shared";
import { DashboardSnapshot } from "./dashboard";

function toMinutes(seconds: number): number {
  const rounded = Math.round(seconds / 60);
  if (seconds > 0 && rounded <= 0) {
    return 1;
  }
  return rounded;
}

function formatMinutesAsDuration(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  if (minutes <= 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

export function formatSummaryMessage(summary: DailySummary): string {
  const lines: string[] = [];
  lines.push(`Daily web usage summary (${summary.date})`);
  lines.push(`Total active time: ${toMinutes(summary.totalActiveSeconds)} min`);
  lines.push(`Tracked sessions: ${summary.sessionsCount}`);

  if (summary.byBrowser.length > 0) {
    const browserLine = summary.byBrowser
      .map((item) => `${item.browser}: ${toMinutes(item.activeSeconds)}m`)
      .join(" | ");
    lines.push(`By browser: ${browserLine}`);
  }

  if (summary.topDomains.length > 0) {
    lines.push("Top domains:");
    for (const domain of summary.topDomains) {
      lines.push(
        `- ${domain.domain}: ${toMinutes(domain.activeSeconds)}m (${domain.visitCount} sessions)`
      );
    }
  }

  for (const highlight of summary.highlights) {
    lines.push(highlight);
  }

  return lines.join("\n");
}

export interface FormatAccountabilityMessageInput {
  date: string;
  snapshot: DashboardSnapshot;
  aiSummary: string | null;
  severeWasteDay: boolean;
}

export function formatAccountabilityMessage(
  input: FormatAccountabilityMessageInput
): string {
  const { date, snapshot, aiSummary, severeWasteDay } = input;
  const productivity = snapshot.productivity;
  const totalMinutes = toMinutes(snapshot.totalActiveSeconds);
  const goodMinutes = toMinutes(productivity.goodSeconds);
  const neutralMinutes = toMinutes(productivity.neutralSeconds);
  const wasteMinutes = toMinutes(productivity.wasteSeconds);
  const startLabel = new Date(snapshot.usageDayStartIso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  const endLabel = new Date(snapshot.usageDayEndIso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  const lines: string[] = [];
  lines.push(`LockIn Daily Accountability Report (${date})`);
  lines.push(`Window: ${startLabel} -> ${endLabel}`);
  lines.push(
    `Total: ${formatMinutesAsDuration(totalMinutes)} across ${snapshot.sessionsCount} sessions`
  );
  lines.push(
    `Good: ${formatMinutesAsDuration(goodMinutes)} (${productivity.goodPercent}%) | Neutral: ${formatMinutesAsDuration(neutralMinutes)} (${productivity.neutralPercent}%) | Waste: ${formatMinutesAsDuration(wasteMinutes)} (${productivity.wastePercent}%)`
  );

  const topGood = productivity.topGoodDomains
    .slice(0, 3)
    .map((item) => `${item.domain} ${toMinutes(item.activeSeconds)}m`)
    .join(", ");
  const topWaste = productivity.topWasteDomains
    .slice(0, 3)
    .map((item) => `${item.domain} ${toMinutes(item.activeSeconds)}m`)
    .join(", ");

  if (topGood.length > 0) {
    lines.push(`Top good: ${topGood}`);
  }
  if (topWaste.length > 0) {
    lines.push(`Top waste: ${topWaste}`);
  }

  if (snapshot.recentEvents.length > 0) {
    lines.push("What you did most:");
    for (const item of snapshot.recentEvents.slice(0, 4)) {
      const title = item.title?.trim() ? item.title : item.domain;
      lines.push(`- ${title} (${item.domain}) ${toMinutes(item.activeSeconds)}m`);
    }
  }

  if (severeWasteDay) {
    lines.push(
      "Reality check: your screen time is high and too much of it is waste. This is harming your progress. Change your habits now."
    );
  }

  if (aiSummary && aiSummary.trim().length > 0) {
    lines.push("AI Coach:");
    lines.push(aiSummary.trim());
  }

  return lines.join("\n");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreTone(score: number): {
  strong: string;
  soft: string;
  verdict: string;
} {
  if (score >= 70) {
    return {
      strong: "#0f8a74",
      soft: "#d9f6ed",
      verdict: "#0c6a58"
    };
  }
  if (score >= 45) {
    return {
      strong: "#ca8430",
      soft: "#fdeac9",
      verdict: "#8a5f20"
    };
  }
  return {
    strong: "#d1622e",
    soft: "#ffe2d4",
    verdict: "#ad4e26"
  };
}

function renderMetricCard(label: string, value: string): string {
  return `
    <td style="padding:8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe7e4;border-radius:12px;background:#f9fcfb;">
        <tr>
          <td style="padding:12px 14px;">
            <p style="margin:0;color:#466560;font-size:12px;font-weight:600;">${escapeHtml(label)}</p>
            <p style="margin:4px 0 0;color:#112a26;font-size:20px;font-weight:700;">${escapeHtml(value)}</p>
          </td>
        </tr>
      </table>
    </td>
  `;
}

function renderLabeledBar(input: {
  label: string;
  detail: string;
  percent: number;
  color: string;
}): string {
  const width = clampPercent(input.percent);
  return `
    <tr>
      <td style="padding:6px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-bottom:4px;color:#26433f;font-size:13px;font-weight:700;">${escapeHtml(input.label)}</td>
            <td align="right" style="padding-bottom:4px;color:#456661;font-size:12px;">${escapeHtml(input.detail)}</td>
          </tr>
          <tr>
            <td colspan="2">
              <div style="height:10px;border-radius:999px;background:#e8f1ef;overflow:hidden;">
                <div style="height:10px;width:${width}%;border-radius:999px;background:${input.color};"></div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function compressTimeline(
  timeline: DashboardSnapshot["timeline"],
  maxBars: number
): DashboardSnapshot["timeline"] {
  if (timeline.length <= maxBars) {
    return timeline;
  }

  const chunkSize = Math.ceil(timeline.length / maxBars);
  const items: DashboardSnapshot["timeline"] = [];
  for (let index = 0; index < timeline.length; index += chunkSize) {
    const chunk = timeline.slice(index, index + chunkSize);
    const seconds = chunk.reduce((total, point) => total + point.activeSeconds, 0);
    items.push({
      label: chunk[0]?.label ?? "",
      activeSeconds: seconds
    });
  }

  return items;
}

function renderTimelineBars(snapshot: DashboardSnapshot): string {
  const points = compressTimeline(snapshot.timeline, 24);
  const maxSeconds = Math.max(1, ...points.map((point) => point.activeSeconds));
  const totalSeconds = points.reduce((total, point) => total + point.activeSeconds, 0);
  if (totalSeconds <= 0) {
    return `<p style="margin:0;color:#57736f;font-size:13px;">No timeline activity yet.</p>`;
  }

  const bars = points
    .map((point) => {
      const height = Math.max(6, Math.round((point.activeSeconds / maxSeconds) * 90));
      return `<td style="padding:0 2px;vertical-align:bottom;"><div title="${escapeHtml(point.label)} ${toMinutes(point.activeSeconds)}m" style="width:10px;height:${height}px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,#2cb59a 0%,#0f7d72 100%);"></div></td>`;
    })
    .join("");

  const first = points[0]?.label ?? "";
  const middle = points[Math.floor(points.length / 2)]?.label ?? "";
  const last = points[points.length - 1]?.label ?? "";

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;">
      <tr>${bars}</tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
      <tr>
        <td style="color:#55726e;font-size:11px;">${escapeHtml(first)}</td>
        <td align="center" style="color:#55726e;font-size:11px;">${escapeHtml(middle)}</td>
        <td align="right" style="color:#55726e;font-size:11px;">${escapeHtml(last)}</td>
      </tr>
    </table>
  `;
}

function renderRecentEventsTable(snapshot: DashboardSnapshot): string {
  const rows = snapshot.recentEvents.slice(0, 8);
  if (rows.length === 0) {
    return `<p style="margin:0;color:#57736f;font-size:13px;">No events recorded for this usage day.</p>`;
  }

  const items = rows
    .map((item) => {
      const duration = formatMinutesAsDuration(toMinutes(item.activeSeconds));
      const endedLabel = new Date(item.endedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
      const label = item.classificationLabel;
      const labelBg =
        label === "good" ? "#d9f6ed" : label === "waste" ? "#ffe2d4" : "#e7eef2";
      const labelColor =
        label === "good" ? "#0b6558" : label === "waste" ? "#9e4020" : "#3d5c66";
      return `
        <tr>
          <td style="padding:8px;border-top:1px solid #e8f1ef;color:#2c4a45;font-size:12px;">${escapeHtml(
            endedLabel
          )}</td>
          <td style="padding:8px;border-top:1px solid #e8f1ef;color:#2c4a45;font-size:12px;">${escapeHtml(
            item.domain
          )}</td>
          <td style="padding:8px;border-top:1px solid #e8f1ef;color:#2c4a45;font-size:12px;">${escapeHtml(
            item.title?.trim() ? item.title : "-"
          )}</td>
          <td style="padding:8px;border-top:1px solid #e8f1ef;color:#2c4a45;font-size:12px;">${escapeHtml(
            duration
          )}</td>
          <td style="padding:8px;border-top:1px solid #e8f1ef;">
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${labelBg};color:${labelColor};font-size:11px;font-weight:700;text-transform:uppercase;">${escapeHtml(
              label
            )}</span>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #dbe7e4;border-radius:12px;overflow:hidden;background:#fff;">
      <tr>
        <th align="left" style="padding:8px;background:#f2f8f6;color:#40615d;font-size:11px;text-transform:uppercase;">Last Seen</th>
        <th align="left" style="padding:8px;background:#f2f8f6;color:#40615d;font-size:11px;text-transform:uppercase;">Domain</th>
        <th align="left" style="padding:8px;background:#f2f8f6;color:#40615d;font-size:11px;text-transform:uppercase;">Title</th>
        <th align="left" style="padding:8px;background:#f2f8f6;color:#40615d;font-size:11px;text-transform:uppercase;">Duration</th>
        <th align="left" style="padding:8px;background:#f2f8f6;color:#40615d;font-size:11px;text-transform:uppercase;">Class</th>
      </tr>
      ${items}
    </table>
  `;
}

function renderDomainRows(input: {
  items: Array<{ domain: string; activeSeconds: number }>;
  emptyText: string;
  barColor: string;
}): string {
  if (input.items.length === 0) {
    return `<p style="margin:0;color:#57736f;font-size:13px;">${escapeHtml(input.emptyText)}</p>`;
  }

  const maxSeconds = Math.max(1, ...input.items.map((item) => item.activeSeconds));
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${input.items
        .map((item) => {
          const width = Math.max(8, Math.round((item.activeSeconds / maxSeconds) * 100));
          return `
            <tr>
              <td style="padding:6px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-bottom:4px;color:#26433f;font-size:13px;font-weight:700;">${escapeHtml(
                      item.domain
                    )}</td>
                    <td align="right" style="padding-bottom:4px;color:#456661;font-size:12px;">${toMinutes(
                      item.activeSeconds
                    )}m</td>
                  </tr>
                  <tr>
                    <td colspan="2">
                      <div style="height:10px;border-radius:999px;background:#e8f1ef;overflow:hidden;">
                        <div style="height:10px;width:${width}%;border-radius:999px;background:${input.barColor};"></div>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          `;
        })
        .join("")}
    </table>
  `;
}

export function formatAccountabilityEmailHtml(
  input: FormatAccountabilityMessageInput
): string {
  const textSummary = formatAccountabilityMessage(input);
  const score = clampPercent(input.snapshot.productivity.score);
  const tone = scoreTone(score);
  const productivity = input.snapshot.productivity;
  const totalMinutes = toMinutes(input.snapshot.totalActiveSeconds);
  const windowStart = new Date(input.snapshot.usageDayStartIso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  const windowEnd = new Date(input.snapshot.usageDayEndIso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  const browserColors: Record<string, string> = {
    zen: "#0e8b76",
    safari: "#c7922d",
    unknown: "#647789"
  };
  const topDomainsForEmail = input.snapshot.topDomains.map((item) => ({
    domain: item.domain,
    activeSeconds: item.activeSeconds
  }));
  const browserRows = input.snapshot.byBrowser.map((item) => ({
    domain: item.browser,
    activeSeconds: item.activeSeconds,
    color: browserColors[item.browser] ?? browserColors.unknown
  }));
  const maxBrowserSeconds = Math.max(1, ...browserRows.map((item) => item.activeSeconds));

  return `
<!doctype html>
<html>
  <body style="margin:0;padding:20px;background:#f6f9f7;font-family:Arial,'Helvetica Neue',sans-serif;color:#10211f;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:900px;margin:0 auto;background:#ffffff;border:1px solid #dbe7e4;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:20px 22px;background:linear-gradient(135deg,#eaf8f1 0%,#f6fbf9 100%);border-bottom:1px solid #dbe7e4;">
          <p style="margin:0 0 6px;color:#3b5a56;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">LockIn Analytics</p>
          <h1 style="margin:0;color:#112a26;font-size:26px;line-height:1.2;">Daily Accountability Report (${escapeHtml(
            input.date
          )})</h1>
          <p style="margin:10px 0 0;color:#456661;font-size:13px;">Usage window: ${escapeHtml(
            windowStart
          )} -> ${escapeHtml(windowEnd)}</p>
        </td>
      </tr>

      <tr>
        <td style="padding:16px 14px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${renderMetricCard("Active Time", formatMinutesAsDuration(totalMinutes))}
              ${renderMetricCard("Sessions", String(input.snapshot.sessionsCount))}
            </tr>
            <tr>
              ${renderMetricCard("Unique Domains", String(input.snapshot.uniqueDomains))}
              ${renderMetricCard("Unique URLs", String(input.snapshot.uniqueUrls))}
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:8px 22px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="top" width="220" style="padding:8px 0 8px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid #dbe7e4;border-radius:12px;background:${tone.soft};">
                  <tr>
                    <td style="padding:14px 18px;text-align:center;">
                      <div style="margin:0 auto;width:120px;height:120px;border-radius:999px;border:12px solid ${tone.strong};display:flex;align-items:center;justify-content:center;background:#ffffff;">
                        <div>
                          <p style="margin:0;color:#103f39;font-size:34px;font-weight:800;line-height:1;">${score}</p>
                          <p style="margin:0;color:#456560;font-size:12px;font-weight:700;">/100</p>
                        </div>
                      </div>
                      <p style="margin:10px 0 0;color:${tone.verdict};font-size:14px;font-weight:700;">${escapeHtml(
                        productivity.verdict
                      )}</p>
                    </td>
                  </tr>
                </table>
              </td>
              <td style="padding:8px 0 8px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe7e4;border-radius:12px;background:#fbfdfc;">
                  <tr><td style="padding:12px 14px 4px;color:#294641;font-size:14px;font-weight:700;">Focus Quality Split</td></tr>
                  <tr><td style="padding:0 14px 12px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      ${renderLabeledBar({
                        label: "Good",
                        detail: `${productivity.goodPercent}% · ${toMinutes(productivity.goodSeconds)}m`,
                        percent: productivity.goodPercent,
                        color: "linear-gradient(90deg,#1aa87f 0%,#0f8a74 100%)"
                      })}
                      ${renderLabeledBar({
                        label: "Neutral",
                        detail: `${productivity.neutralPercent}% · ${toMinutes(productivity.neutralSeconds)}m`,
                        percent: productivity.neutralPercent,
                        color: "linear-gradient(90deg,#7e9da4 0%,#678994 100%)"
                      })}
                      ${renderLabeledBar({
                        label: "Waste",
                        detail: `${productivity.wastePercent}% · ${toMinutes(productivity.wasteSeconds)}m`,
                        percent: productivity.wastePercent,
                        color: "linear-gradient(90deg,#f08f59 0%,#d1622e 100%)"
                      })}
                    </table>
                  </td></tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:8px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="top" width="50%" style="padding-right:8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe7e4;border-radius:12px;background:#fbfdfc;">
                  <tr><td style="padding:12px 14px 4px;color:#294641;font-size:14px;font-weight:700;">Browser Share</td></tr>
                  <tr><td style="padding:0 14px 12px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      ${browserRows
                        .map((item) =>
                          renderLabeledBar({
                            label: item.domain,
                            detail: `${toMinutes(item.activeSeconds)}m`,
                            percent: Math.round((item.activeSeconds / maxBrowserSeconds) * 100),
                            color: item.color
                          })
                        )
                        .join("")}
                    </table>
                  </td></tr>
                </table>
              </td>
              <td valign="top" width="50%" style="padding-left:8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe7e4;border-radius:12px;background:#fbfdfc;">
                  <tr><td style="padding:12px 14px 4px;color:#294641;font-size:14px;font-weight:700;">Top Domains</td></tr>
                  <tr><td style="padding:0 14px 12px;">
                    ${renderDomainRows({
                      items: topDomainsForEmail,
                      emptyText: "No domain activity yet.",
                      barColor: "linear-gradient(90deg,#17a17e 0%,#0e7e71 100%)"
                    })}
                  </td></tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:8px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe7e4;border-radius:12px;background:#fbfdfc;">
            <tr><td style="padding:12px 14px 8px;color:#294641;font-size:14px;font-weight:700;">Focus Timeline</td></tr>
            <tr><td style="padding:0 14px 12px;">${renderTimelineBars(input.snapshot)}</td></tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:8px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="top" width="50%" style="padding-right:8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe7e4;border-radius:12px;background:#fbfdfc;">
                  <tr><td style="padding:12px 14px 4px;color:#294641;font-size:14px;font-weight:700;">Top Good Domains</td></tr>
                  <tr><td style="padding:0 14px 12px;">
                    ${renderDomainRows({
                      items: productivity.topGoodDomains,
                      emptyText: "No good domains recorded.",
                      barColor: "linear-gradient(90deg,#31c59a 0%,#0f8a74 100%)"
                    })}
                  </td></tr>
                </table>
              </td>
              <td valign="top" width="50%" style="padding-left:8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe7e4;border-radius:12px;background:#fbfdfc;">
                  <tr><td style="padding:12px 14px 4px;color:#294641;font-size:14px;font-weight:700;">Top Waste Domains</td></tr>
                  <tr><td style="padding:0 14px 12px;">
                    ${renderDomainRows({
                      items: productivity.topWasteDomains,
                      emptyText: "No waste domains recorded.",
                      barColor: "linear-gradient(90deg,#f08f59 0%,#d1622e 100%)"
                    })}
                  </td></tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:8px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe7e4;border-radius:12px;background:#fbfdfc;">
            <tr><td style="padding:12px 14px 8px;color:#294641;font-size:14px;font-weight:700;">Recent Events</td></tr>
            <tr><td style="padding:0 14px 12px;">${renderRecentEventsTable(input.snapshot)}</td></tr>
          </table>
        </td>
      </tr>

      ${
        input.severeWasteDay
          ? `
      <tr>
        <td style="padding:8px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0b89d;border-radius:12px;background:#fff1e8;">
            <tr>
              <td style="padding:12px 14px;color:#a24620;font-size:13px;line-height:1.45;">
                <strong>Reality check:</strong> your screen time is high and too much of it is waste. This is harming your progress. Change your habits now.
              </td>
            </tr>
          </table>
        </td>
      </tr>
      `
          : ""
      }

      ${
        input.aiSummary && input.aiSummary.trim().length > 0
          ? `
      <tr>
        <td style="padding:8px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe7e4;border-radius:12px;background:#f7fbfa;">
            <tr>
              <td style="padding:12px 14px;">
                <p style="margin:0 0 8px;color:#294641;font-size:14px;font-weight:700;">AI Coach</p>
                <p style="margin:0;color:#314f4b;font-size:13px;line-height:1.5;">${escapeHtml(
                  input.aiSummary.trim()
                )}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      `
          : ""
      }

      <tr>
        <td style="padding:8px 22px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe7e4;border-radius:12px;background:#fdfefe;">
            <tr>
              <td style="padding:12px 14px;">
                <p style="margin:0 0 8px;color:#294641;font-size:14px;font-weight:700;">Current Text Summary</p>
                <pre style="margin:0;white-space:pre-wrap;color:#365450;font-size:12px;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${escapeHtml(
                  textSummary
                )}</pre>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
