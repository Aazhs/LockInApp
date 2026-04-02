export type BrowserName = "zen" | "safari" | "unknown";

export interface UsageEvent {
  browser: BrowserName;
  url: string;
  domain: string;
  title?: string;
  startedAt: string;
  endedAt: string;
  activeSeconds: number;
  isFocused: boolean;
  sourceTabId?: number;
}

export interface UsageEventInput {
  browser: BrowserName;
  url: string;
  title?: string;
  startedAt: string;
  endedAt: string;
  activeSeconds: number;
  isFocused: boolean;
  sourceTabId?: number;
}

export interface DomainAggregate {
  domain: string;
  activeSeconds: number;
  visitCount: number;
}

export interface BrowserAggregate {
  browser: BrowserName;
  activeSeconds: number;
}

export interface DailySummary {
  date: string;
  totalActiveSeconds: number;
  sessionsCount: number;
  byBrowser: BrowserAggregate[];
  topDomains: DomainAggregate[];
  highlights: string[];
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

