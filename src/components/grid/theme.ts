"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

/** AG Grid theme matching the app (slate neutrals, PayPal blue accent, Geist via inherit). */
export const gridTheme = themeQuartz.withParams({
  accentColor: "#0070ba",
  foregroundColor: "#0f172a",
  backgroundColor: "#ffffff",
  borderColor: "#e2e8f0",
  headerBackgroundColor: "#f8fafc",
  headerTextColor: "#64748b",
  headerFontWeight: 600,
  headerFontSize: 12,
  fontFamily: "inherit",
  fontSize: 13,
  rowHoverColor: "#f1f5f9",
  wrapperBorderRadius: 12,
  wrapperBorder: { color: "#e2e8f0" },
  spacing: 7,
});
