import { getSettings } from "@/lib/settings";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const settings = await getSettings();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">
          Who you are, and the limits for negotiating payment plans. When a client asks for more time, Claude only reads
          their reply; <b>code</b> holds every plan to these limits before it reaches your inbox.
        </p>
      </div>
      <SettingsForm initial={settings} />
    </div>
  );
}
