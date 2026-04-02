const TRACKABLE_PROTOCOLS = new Set(["http:", "https:"]);
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(lower)) {
    return true;
  }

  if (lower.endsWith(".localhost")) {
    return true;
  }

  if (lower.startsWith("127.")) {
    return true;
  }

  return false;
}

export function normalizeDomain(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (!TRACKABLE_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }

    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (isBlockedHost(hostname)) {
      return null;
    }

    return hostname;
  } catch {
    return null;
  }
}

export function isTrackableUrl(rawUrl: string): boolean {
  return normalizeDomain(rawUrl) !== null;
}
