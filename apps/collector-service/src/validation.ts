import { z } from "zod";

export const usageEventInputSchema = z.object({
  browser: z.enum(["zen", "safari", "unknown"]),
  url: z.string().url(),
  title: z.string().optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  activeSeconds: z.number().int().nonnegative(),
  isFocused: z.boolean(),
  sourceTabId: z.number().int().optional()
});

export type UsageEventInputPayload = z.infer<typeof usageEventInputSchema>;

export const manualDomainLabelInputSchema = z.object({
  domain: z.string().min(1),
  label: z.enum(["good", "neutral", "waste"])
});

export type ManualDomainLabelInputPayload = z.infer<typeof manualDomainLabelInputSchema>;
