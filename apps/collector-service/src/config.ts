import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), override: false });

export interface AppConfig {
  port: number;
  dbPath: string;
  smtpHost?: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  emailTo?: string;
  classifierProvider: "openai" | "gemini";
  openaiApiKey?: string;
  openaiModel: string;
  geminiApiKey?: string;
  geminiModel: string;
}

function parseBoolean(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false;
  }
  const normalized = rawValue.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parsePort(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

export function loadConfig(): AppConfig {
  const provider =
    process.env.CLASSIFIER_PROVIDER === "openai" || process.env.CLASSIFIER_PROVIDER === "gemini"
      ? process.env.CLASSIFIER_PROVIDER
      : process.env.GEMINI_API_KEY
        ? "gemini"
        : "openai";

  return {
    port: parsePort(process.env.PORT, 4317),
    dbPath: process.env.DB_PATH ?? path.resolve(process.cwd(), "usage.sqlite"),
    smtpHost: process.env.SMTP_HOST,
    smtpPort: parsePort(process.env.SMTP_PORT, 587),
    smtpSecure: parseBoolean(process.env.SMTP_SECURE),
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    smtpFrom: process.env.SMTP_FROM,
    emailTo: process.env.EMAIL_TO,
    classifierProvider: provider,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash"
  };
}
