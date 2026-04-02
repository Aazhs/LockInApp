import { ClassifierProvider } from "./classification";

export interface AiSummaryTopItem {
  name: string;
  minutes: number;
}

export interface AiDailySummaryInput {
  date: string;
  totalMinutes: number;
  goodMinutes: number;
  neutralMinutes: number;
  wasteMinutes: number;
  goodPercent: number;
  neutralPercent: number;
  wastePercent: number;
  topGood: AiSummaryTopItem[];
  topWaste: AiSummaryTopItem[];
  recentActivities: string[];
  severeWasteDay: boolean;
}

export interface GenerateAiDailySummaryInput {
  provider: ClassifierProvider;
  openaiApiKey?: string;
  openaiModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  summary: AiDailySummaryInput;
}

function safeModelName(provider: ClassifierProvider, model?: string): string {
  if (provider === "gemini") {
    return model?.trim() || "gemini-2.5-flash";
  }
  return model?.trim() || "gpt-4o-mini";
}

function buildPrompt(summary: AiDailySummaryInput): string {
  return [
    `Date: ${summary.date}`,
    `Total minutes: ${summary.totalMinutes}`,
    `Good minutes: ${summary.goodMinutes} (${summary.goodPercent}%)`,
    `Neutral minutes: ${summary.neutralMinutes} (${summary.neutralPercent}%)`,
    `Waste minutes: ${summary.wasteMinutes} (${summary.wastePercent}%)`,
    `Top good: ${summary.topGood.map((item) => `${item.name} ${item.minutes}m`).join(", ") || "none"}`,
    `Top waste: ${summary.topWaste.map((item) => `${item.name} ${item.minutes}m`).join(", ") || "none"}`,
    `Recent activity samples: ${summary.recentActivities.join(" | ") || "none"}`
  ].join("\n");
}

async function generateWithOpenAI(
  apiKey: string,
  model: string,
  summary: AiDailySummaryInput
): Promise<string | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: summary.severeWasteDay
              ? "You are a strict accountability coach. Write a concise daily review with strong wording. Clearly call out harmful behavior and demand immediate change. Keep it under 120 words."
              : "You are a practical accountability coach. Write a concise daily review: what was good, what was wasteful, and exactly what to improve tomorrow. Keep it under 120 words."
          },
          {
            role: "user",
            content: buildPrompt(summary)
          }
        ]
      })
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const text = payload.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

async function generateWithGemini(
  apiKey: string,
  model: string,
  summary: AiDailySummaryInput
): Promise<string | null> {
  try {
    const prompt = [
      summary.severeWasteDay
        ? "You are a strict accountability coach. Write a concise daily review with strong wording. Clearly call out harmful behavior and demand immediate change. Keep it under 120 words."
        : "You are a practical accountability coach. Write a concise daily review: what was good, what was wasteful, and exactly what to improve tomorrow. Keep it under 120 words.",
      "",
      buildPrompt(summary)
    ].join("\n");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
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
            temperature: 0.3
          }
        })
      }
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export async function generateAiDailySummary(
  input: GenerateAiDailySummaryInput
): Promise<string | null> {
  const preferredProvider = input.provider;
  const openaiModel = safeModelName("openai", input.openaiModel);
  const geminiModel = safeModelName("gemini", input.geminiModel);

  if (preferredProvider === "gemini") {
    if (input.geminiApiKey) {
      const response = await generateWithGemini(input.geminiApiKey, geminiModel, input.summary);
      if (response) {
        return response;
      }
    }
    if (input.openaiApiKey) {
      return generateWithOpenAI(input.openaiApiKey, openaiModel, input.summary);
    }
    return null;
  }

  if (input.openaiApiKey) {
    const response = await generateWithOpenAI(input.openaiApiKey, openaiModel, input.summary);
    if (response) {
      return response;
    }
  }
  if (input.geminiApiKey) {
    return generateWithGemini(input.geminiApiKey, geminiModel, input.summary);
  }

  return null;
}
