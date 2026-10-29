/** Freelancer settings, stored as one JSON row in AppSetting (single-user app). */
import { prisma } from "@/lib/db";
import { DEFAULT_SETTINGS, FreelancerSettingsSchema, type FreelancerSettings } from "./schema";

export { DEFAULT_SETTINGS, FreelancerSettingsSchema, type FreelancerSettings } from "./schema";

const KEY = "freelancer.settings";

export async function getSettings(): Promise<FreelancerSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_SETTINGS;
  try {
    // Fill in fields added after the row was saved; fall back to defaults if it's unreadable.
    return FreelancerSettingsSchema.parse({ ...DEFAULT_SETTINGS, ...JSON.parse(row.value) });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(input: unknown): Promise<FreelancerSettings> {
  const settings = FreelancerSettingsSchema.parse(input);
  const value = JSON.stringify(settings);
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return settings;
}
