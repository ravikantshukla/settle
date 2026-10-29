/** Freelancer settings (client + server safe; no server-only imports). */
import { z } from "zod";
import { isValidTimeZone } from "@/lib/timezone";

export const FreelancerSettingsSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(80),
  city: z.string().trim().max(80),
  timezone: z.string().refine((tz) => isValidTimeZone(tz), "Pick a valid timezone, e.g. Asia/Kolkata"),
  /** Negotiation limits: code enforces these on every payment plan, whatever the client asks. */
  minUpfrontPercent: z.number().min(0, "0–100").max(100, "0–100"),
  maxInstallments: z.number().int("Whole number").min(2, "At least 2").max(12, "At most 12"),
  maxDaysAfterDue: z.number().int("Whole number").min(7, "At least 7 days").max(365, "At most 365 days"),
});
export type FreelancerSettings = z.infer<typeof FreelancerSettingsSchema>;

export const DEFAULT_SETTINGS: FreelancerSettings = {
  name: "Aarav Mishra",
  city: "Lucknow, India",
  timezone: "Asia/Kolkata",
  minUpfrontPercent: 25,
  maxInstallments: 4,
  maxDaysAfterDue: 60,
};
