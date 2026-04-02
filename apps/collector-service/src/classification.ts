import Database from "better-sqlite3";
import {
  getYoutubeVideoAiAttemptedIds,
  getManualDomainLabels,
  getYoutubeVideoLabels,
  markYoutubeVideoAiAttempted,
  ProductivityLabel,
  upsertYoutubeVideoLabel,
  UsageEventRow
} from "./db";

const FORCED_BAD_ROOT_DOMAINS = new Set(["x.com", "twitter.com", "reddit.com"]);
const inFlightYoutubeClassifications = new Set<string>();
const MAX_YOUTUBE_CLASSIFICATIONS_PER_PASS = 3;
const YOUTUBE_RETRY_COOLDOWN_MINUTES = 15;

export type ClassifierProvider = "openai" | "gemini";
export type ClassificationSource = "forced" | "manual" | "openai" | "gemini" | "fallback";

export interface RowClassification {
  label: ProductivityLabel;
  reason: string;
  source: ClassificationSource;
}

export interface DomainSeconds {
  domain: string;
  activeSeconds: number;
}

export interface ManualDomainLabel {
  domain: string;
  label: ProductivityLabel;
}

export interface ResolvedClassifications {
  rowMap: Map<number, RowClassification>;
  pendingManualDomains: DomainSeconds[];
  manualDomainLabels: ManualDomainLabel[];
  model: string;
  provider: ClassifierProvider;
  aiEnabled: boolean;
  youtubeClassifiedVideos: number;
  youtubePendingVideos: number;
}

export interface ResolveClassificationsInput {
  db: Database.Database;
  rows: UsageEventRow[];
  provider?: ClassifierProvider;
  openaiApiKey?: string;
  openaiModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
}

interface YoutubeClassificationResult {
  label: ProductivityLabel;
  reason: string;
  confidence: number;
}

interface YoutubeCandidate {
  videoId: string;
  title: string | null;
  url: string;
}

interface GeminiModelEntry {
  name?: string;
  supportedGenerationMethods?: string[];
}

const GEMINI_FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash"
];

const resolvedGeminiModelByApiKey = new Map<string, string>();

const TECH_GOOD_KEYWORDS = [
  "coding",
  "programming",
  "developer",
  "software",
  "api",
  "backend",
  "frontend",
  "full stack",
  "fullstack",
  "database",
  "sql",
  "system design",
  "dsa",
  "data structure",
  "algorithm",
  "leetcode",
  "fastapi",
  "node",
  "react",
  "next.js",
  "typescript",
  "javascript",
  "python",
  "java",
  "go",
  "rust",
  "docker",
  "kubernetes",
  "devops",
  "debug",
  "tutorial",
  "crash course",
  "cs",
  "computer science"
];

const DISTRACTION_KEYWORDS = [
  "podcast",
  "wedding",
  "rumour",
  "rumor",
  "gossip",
  "celebrity",
  "comedy",
  "prank",
  "song",
  "music",
  "nursery",
  "birthday",
  "live mission",
  "reaction",
  "vlog",
  "dating",
  "interview"
];

function matchesRootDomain(domain: string, root: string): boolean {
  return domain === root || domain.endsWith(`.${root}`);
}

export function isForcedBadDomain(domain: string): boolean {
  for (const root of FORCED_BAD_ROOT_DOMAINS) {
    if (matchesRootDomain(domain, root)) {
      return true;
    }
  }
  return false;
}

export function isYouTubeDomain(domain: string): boolean {
  return matchesRootDomain(domain, "youtube.com") || matchesRootDomain(domain, "youtu.be");
}

export function extractYoutubeVideoId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    if (host === "youtu.be" || host.endsWith(".youtu.be")) {
      const candidate = path.split("/").filter(Boolean)[0] ?? "";
      return /^[A-Za-z0-9_-]{6,32}$/.test(candidate) ? candidate : null;
    }

    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{6,32}$/.test(v)) {
        return v;
      }

      const segments = path.split("/").filter(Boolean);
      if (segments.length >= 2 && ["shorts", "embed", "live"].includes(segments[0])) {
        const candidate = segments[1];
        return /^[A-Za-z0-9_-]{6,32}$/.test(candidate) ? candidate : null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function parseModelResponse(raw: string): YoutubeClassificationResult | null {
  try {
    const parsed = JSON.parse(raw) as {
      label?: string;
      reason?: string;
      confidence?: number;
    };

    if (
      parsed.label !== "good" &&
      parsed.label !== "neutral" &&
      parsed.label !== "waste"
    ) {
      return null;
    }

    if (typeof parsed.reason !== "string" || parsed.reason.trim().length === 0) {
      return null;
    }

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.6;

    return {
      label: parsed.label,
      reason: parsed.reason.trim(),
      confidence
    };
  } catch {
    return null;
  }
}

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    const corePattern = normalized
      .split(/\s+/)
      .map((part) => escapeRegex(part))
      .join("\\s+");
    const pattern = new RegExp(`(^|[^a-z0-9])${corePattern}([^a-z0-9]|$)`, "i");
    return pattern.test(text);
  });
}

export function isLikelyCsEducational(candidate: {
  title: string | null;
  url: string;
}): boolean {
  const text = `${candidate.title ?? ""} ${candidate.url}`.toLowerCase();
  return containsKeyword(text, TECH_GOOD_KEYWORDS);
}

export function isLikelyDistraction(candidate: {
  title: string | null;
  url: string;
}): boolean {
  const text = `${candidate.title ?? ""} ${candidate.url}`.toLowerCase();
  if (containsKeyword(text, DISTRACTION_KEYWORDS)) {
    return true;
  }

  if (text.includes("/shorts/") && !isLikelyCsEducational(candidate)) {
    return true;
  }

  return false;
}

export function enforceYoutubePolicy(
  candidate: {
    title: string | null;
    url: string;
  },
  input: YoutubeClassificationResult
): YoutubeClassificationResult {
  if (input.label !== "good") {
    return input;
  }

  if (isLikelyCsEducational(candidate)) {
    return input;
  }

  if (isLikelyDistraction(candidate)) {
    return {
      label: "waste",
      reason: "Policy override: non-CS/distraction video cannot be GOOD",
      confidence: input.confidence
    };
  }

  return {
    label: "neutral",
    reason: "Policy override: GOOD requires clear CS/coding educational signal",
    confidence: input.confidence
  };
}

function normalizeGeminiModelName(model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith("models/") ? trimmed.slice("models/".length) : trimmed;
}

function canGenerateContent(model: GeminiModelEntry): boolean {
  return (model.supportedGenerationMethods ?? []).includes("generateContent");
}

function scoreGeminiModel(name: string): number {
  let score = 0;
  if (name.includes("flash")) {
    score += 30;
  }
  if (name.includes("2.5")) {
    score += 20;
  } else if (name.includes("2.0")) {
    score += 15;
  } else if (name.includes("1.5")) {
    score += 10;
  }
  if (name.includes("lite")) {
    score += 5;
  }
  return score;
}

async function listGeminiGenerateModels(apiKey: string): Promise<string[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { models?: GeminiModelEntry[] };
  const models = payload.models ?? [];
  return models
    .filter(canGenerateContent)
    .map((model) => model.name ?? "")
    .filter((name) => name.length > 0)
    .map((name) => normalizeGeminiModelName(name))
    .sort((a, b) => scoreGeminiModel(b) - scoreGeminiModel(a));
}

async function resolveGeminiModel(
  apiKey: string,
  preferredModel: string,
  forceRefresh = false
): Promise<string> {
  if (!forceRefresh) {
    const cached = resolvedGeminiModelByApiKey.get(apiKey);
    if (cached) {
      return cached;
    }
  }

  const preferred = normalizeGeminiModelName(preferredModel);
  const available = await listGeminiGenerateModels(apiKey);
  if (available.length === 0) {
    resolvedGeminiModelByApiKey.set(apiKey, preferred);
    return preferred;
  }

  const preferenceOrder = [preferred, ...GEMINI_FALLBACK_MODELS].map(normalizeGeminiModelName);
  for (const candidate of preferenceOrder) {
    if (available.includes(candidate)) {
      resolvedGeminiModelByApiKey.set(apiKey, candidate);
      return candidate;
    }
  }

  const selected = available[0];
  resolvedGeminiModelByApiKey.set(apiKey, selected);
  return selected;
}

async function classifyYoutubeWithOpenAI(
  candidate: YoutubeCandidate,
  apiKey: string,
  model: string
): Promise<YoutubeClassificationResult | null> {
  try {
    const payload = {
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You classify YouTube videos for CS student productivity. Output strict JSON with keys: label, reason, confidence. label must be one of good, neutral, waste. confidence is 0..1."
        },
        {
          role: "user",
          content: [
            `URL: ${candidate.url}`,
            `Title: ${candidate.title ?? "(missing)"}`,
            "Classification policy:",
            "- good: coding tutorials, CS lectures, project build walkthroughs, debugging/system design/DSA educational content.",
            "- waste: shorts entertainment, gossip, celebrity, comedy clips, unrelated distraction.",
            "- neutral: mixed or unclear value."
          ].join("\n")
        }
      ]
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.error(
        `YouTube classification failed for video ${candidate.videoId}: status=${response.status} body=${body.slice(0, 500)}`
      );
      return null;
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const content = json.choices?.[0]?.message?.content ?? "";
    if (typeof content !== "string" || content.trim().length === 0) {
      return null;
    }

    return parseModelResponse(content);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `YouTube classification failed for video ${candidate.videoId}: network/runtime error`,
      error
    );
    return null;
  }
}

async function classifyYoutubeWithGemini(
  candidate: YoutubeCandidate,
  apiKey: string,
  model: string
): Promise<YoutubeClassificationResult | null> {
  try {
    const preferredModel = normalizeGeminiModelName(model);
    let selectedModel = await resolveGeminiModel(apiKey, preferredModel);
    const prompt = [
      "Classify this YouTube video for CS student productivity.",
      `URL: ${candidate.url}`,
      `Title: ${candidate.title ?? "(missing)"}`,
      "Policy:",
      "- good: coding tutorials, CS lectures, project build walkthroughs, debugging/system design/DSA educational content.",
      "- waste: shorts entertainment, gossip, celebrity, comedy clips, unrelated distraction.",
      "- neutral: mixed or unclear value.",
      'Return strict JSON object: {"label":"good|neutral|waste","reason":"...","confidence":0.0-1.0}'
    ].join("\n");

    const runRequest = async (targetModel: string) =>
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: "application/json"
            }
          })
        }
      );

    let response = await runRequest(selectedModel);
    if (response.status === 404) {
      // Model name may have been removed/renamed. Refresh model selection once.
      resolvedGeminiModelByApiKey.delete(apiKey);
      selectedModel = await resolveGeminiModel(apiKey, preferredModel, true);
      if (selectedModel !== normalizeGeminiModelName(model)) {
        response = await runRequest(selectedModel);
      }
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.error(
        `YouTube classification failed for video ${candidate.videoId}: provider=gemini model=${selectedModel} status=${response.status} body=${body.slice(0, 500)}`
      );
      return null;
    }

    const json = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const content = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (typeof content !== "string" || content.trim().length === 0) {
      return null;
    }

    return parseModelResponse(content);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `YouTube classification failed for video ${candidate.videoId}: provider=gemini network/runtime error`,
      error
    );
    return null;
  }
}

async function classifyYoutubeWithProvider(
  candidate: YoutubeCandidate,
  provider: ClassifierProvider,
  apiKey: string,
  model: string
): Promise<YoutubeClassificationResult | null> {
  if (provider === "gemini") {
    return classifyYoutubeWithGemini(candidate, apiKey, model);
  }
  return classifyYoutubeWithOpenAI(candidate, apiKey, model);
}

function toSortedDomainSeconds(domainMap: Map<string, number>, limit: number): DomainSeconds[] {
  return [...domainMap.entries()]
    .map(([domain, activeSeconds]) => ({ domain, activeSeconds }))
    .sort((a, b) => b.activeSeconds - a.activeSeconds)
    .slice(0, limit);
}

export async function resolveClassifications(
  input: ResolveClassificationsInput
): Promise<ResolvedClassifications> {
  const { db, rows, openaiApiKey, openaiModel, geminiApiKey, geminiModel } = input;
  const provider: ClassifierProvider =
    input.provider ??
    (geminiApiKey ? "gemini" : "openai");
  const model = provider === "gemini" ? geminiModel ?? "gemini-1.5-flash" : openaiModel ?? "gpt-4o-mini";
  const providerApiKey = provider === "gemini" ? geminiApiKey : openaiApiKey;
  const rowMap = new Map<number, RowClassification>();
  const manualDomainLabelsMap = getManualDomainLabels(db);
  const pendingManualDomainMap = new Map<string, number>();
  const youtubeRowsByVideoId = new Map<string, UsageEventRow[]>();
  const youtubeCandidates = new Map<string, YoutubeCandidate>();

  for (const row of rows) {
    if (isForcedBadDomain(row.domain)) {
      rowMap.set(row.id, {
        label: "waste",
        reason: "Forced bad domain rule",
        source: "forced"
      });
      continue;
    }

    if (isYouTubeDomain(row.domain)) {
      const videoId = extractYoutubeVideoId(row.url);
      if (!videoId) {
        rowMap.set(row.id, {
          label: "neutral",
          reason: "YouTube URL missing video id",
          source: "fallback"
        });
        continue;
      }

      const existing = youtubeRowsByVideoId.get(videoId);
      if (existing) {
        existing.push(row);
      } else {
        youtubeRowsByVideoId.set(videoId, [row]);
      }

      if (!youtubeCandidates.has(videoId)) {
        youtubeCandidates.set(videoId, {
          videoId,
          title: row.title,
          url: row.url
        });
      }

      continue;
    }

    const manualLabel = manualDomainLabelsMap.get(row.domain);
    if (manualLabel) {
      rowMap.set(row.id, {
        label: manualLabel,
        reason: "Manual domain label",
        source: "manual"
      });
      continue;
    }

    rowMap.set(row.id, {
      label: "neutral",
      reason: "Manual label required",
      source: "fallback"
    });
    const current = pendingManualDomainMap.get(row.domain) ?? 0;
    pendingManualDomainMap.set(row.domain, current + row.active_seconds);
  }

  const youtubeVideoIds = [...youtubeRowsByVideoId.keys()];
  const youtubeLabelMap = getYoutubeVideoLabels(db, youtubeVideoIds);
  const missingVideoIds = youtubeVideoIds.filter((videoId) => !youtubeLabelMap.has(videoId));
  const retryAfterDate = new Date(Date.now() - YOUTUBE_RETRY_COOLDOWN_MINUTES * 60 * 1000);
  const attemptedVideoIds = getYoutubeVideoAiAttemptedIds(
    db,
    missingVideoIds,
    retryAfterDate.toISOString()
  );
  const failedVideoIds = new Set<string>();
  const classifyQueue = missingVideoIds
    .filter(
      (videoId) => !inFlightYoutubeClassifications.has(videoId) && !attemptedVideoIds.has(videoId)
    )
    .slice(0, MAX_YOUTUBE_CLASSIFICATIONS_PER_PASS);

  if (providerApiKey && classifyQueue.length > 0) {
    for (const videoId of classifyQueue) {
      const candidate = youtubeCandidates.get(videoId);
      if (!candidate) {
        continue;
      }

      // Call AI at most once per unique YouTube video ID.
      markYoutubeVideoAiAttempted(db, videoId);
      attemptedVideoIds.add(videoId);
      inFlightYoutubeClassifications.add(videoId);
      try {
        const modelResult = await classifyYoutubeWithProvider(
          candidate,
          provider,
          providerApiKey,
          model
        );
        if (modelResult) {
          const adjustedResult = enforceYoutubePolicy(candidate, modelResult);
          upsertYoutubeVideoLabel(db, {
            videoId,
            label: adjustedResult.label,
            reason: adjustedResult.reason,
            confidence: adjustedResult.confidence,
            source: provider,
            model,
            title: candidate.title ?? undefined,
            url: candidate.url
          });
        } else {
          failedVideoIds.add(videoId);
        }
      } finally {
        inFlightYoutubeClassifications.delete(videoId);
      }
    }
  }

  const mergedYoutubeLabelMap = getYoutubeVideoLabels(db, youtubeVideoIds);
  const youtubeClassifiedVideos = youtubeVideoIds.filter((videoId) =>
    mergedYoutubeLabelMap.has(videoId)
  ).length;
  const youtubePendingVideos = youtubeVideoIds.length - youtubeClassifiedVideos;

  for (const [videoId, groupedRows] of youtubeRowsByVideoId.entries()) {
    const labelRow = mergedYoutubeLabelMap.get(videoId);
    for (const row of groupedRows) {
      if (labelRow) {
        const storedSource = labelRow.source === "gemini" ? "gemini" : "openai";
        rowMap.set(row.id, {
          label: labelRow.label,
          reason: labelRow.reason ?? "YouTube classification",
          source: storedSource
        });
      } else {
        const providerName = provider === "gemini" ? "Gemini" : "OpenAI";
        const missingKeyName = provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
        const attempted = attemptedVideoIds.has(videoId);
        rowMap.set(row.id, {
          label: "neutral",
          reason: providerApiKey
            ? failedVideoIds.has(videoId)
              ? `${providerName} YouTube classification failed`
              : attempted
                ? `YouTube classification cooldown (${YOUTUBE_RETRY_COOLDOWN_MINUTES}m)`
                : "YouTube classification pending"
            : `${missingKeyName} missing for YouTube classification`,
          source: "fallback"
        });
      }
    }
  }

  const manualDomainLabels: ManualDomainLabel[] = [...manualDomainLabelsMap.entries()]
    .map(([domain, label]) => ({ domain, label }))
    .sort((a, b) => a.domain.localeCompare(b.domain));

  return {
    rowMap,
    pendingManualDomains: toSortedDomainSeconds(pendingManualDomainMap, 8),
    manualDomainLabels,
    model,
    provider,
    aiEnabled: Boolean(providerApiKey),
    youtubeClassifiedVideos,
    youtubePendingVideos
  };
}
