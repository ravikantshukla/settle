/** Client-safe types for the receivables dashboard. */

export type AgingBucket = "Current" | "1–30" | "31–60" | "60+" | "Paid" | "Draft" | "Closed";
export const AGING_ORDER: AgingBucket[] = ["Current", "1–30", "31–60", "60+", "Paid", "Draft", "Closed"];

export interface DashboardRow {
  id: string;
  client: string;
  project: string;
  number: string;
  status: string;
  currency: string;
  amount: number;
  paid: number;
  outstanding: number;
  dueDate: string | null;
  daysOverdue: number | null;
  bucket: AgingBucket;
  /** Score from the rules; reason written by the AI when available, else built from the rule drivers. */
  risk: { score: number; reason: string; aiReason: boolean } | null;
  nextAction: { id: string; type: string; summary: string } | null;
  payerViewUrl: string | null;
  isDemo: boolean;
}

export interface Kpis {
  currency: string;
  totalOutstanding: number;
  overdueAmount: number;
  overdueCount: number;
  collectedThisMonth: number;
  averageDaysToPay: number | null;
  pendingActions: number;
}
