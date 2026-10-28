/**
 * Prompt-injection handling for pasted (untrusted) text. Deterministic, no AI.
 *
 * Defence in depth:
 *  1. wrapUntrusted() fences the text in delimiters it can't close.
 *  2. Prompts tell the model the fenced text is data only.
 *  3. checkExtraction() flags injection-like phrasing and any email or payee the model returned
 *     that doesn't literally appear in the text, so a human sees it before approving anything.
 *  4. Nothing is ever executed from an extraction: sending and payouts need explicit approval.
 */
import type { Extraction } from "@/lib/invoices/schema";

const PATTERNS: Array<[RegExp, string]> = [
  [/\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|system)\b[^.\n]{0,20}\b(instructions?|prompts?|rules?)\b/i, "asks the AI to ignore its instructions"],
  [/\b(you are now|act as|new instructions|system prompt|developer mode)\b/i, "tries to re-program the AI"],
  [/\b(pay|send|transfer|wire|payout)\b[^.\n]{0,40}\$?\s?\d[\d,]*(\.\d+)?[^.\n]{0,40}\bto\b[^.\n]{0,40}[\w.+-]+@[\w-]+\.[\w.]+/i, "asks for a payment to an email address"],
  [/<\/?(system|assistant|agreement|instructions?)>/i, "contains prompt-like tags"],
];

export function injectionSignals(text: string): string[] {
  return PATTERNS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

/** Fence untrusted text so it can't close the delimiter and "escape" into the prompt. */
export function wrapUntrusted(tag: string, text: string): string {
  const safe = text.replace(new RegExp(`</?${tag}\\s*>`, "gi"), (m) => m.replace("<", "&lt;"));
  return `<${tag}>\n${safe}\n</${tag}>`;
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

export interface InjectionReport {
  /** Human-readable warnings to show above the review form. */
  warnings: string[];
  /** Extraction field paths to highlight as needing a check. */
  flaggedFields: string[];
}

/** Compare an extraction to its source text; flag anything a human must double-check. */
export function checkExtraction(sourceText: string, x: Extraction): InjectionReport {
  const lower = sourceText.toLowerCase();
  const signals = injectionSignals(sourceText);
  const warnings: string[] = [];
  const flagged = new Set<string>();

  if (signals.length) {
    warnings.push(
      `The pasted text contains instructions aimed at the AI (${signals.join("; ")}). They were treated as plain text and ignored. Check every field, especially subcontractor splits, before approving.`,
    );
    x.subcontractorSplits.forEach((_, i) => flagged.add(`subcontractorSplits.${i}`));
  }

  const inText = (email: string | null) => !email || lower.includes(email.toLowerCase());
  if (!inText(x.client.email)) {
    flagged.add("client.email");
    warnings.push(`The client email "${x.client.email}" doesn't appear in the pasted text.`);
  }
  x.subcontractorSplits.forEach((s, i) => {
    if (!inText(s.email)) {
      flagged.add(`subcontractorSplits.${i}.email`);
      warnings.push(`Subcontractor email "${s.email}" doesn't appear in the pasted text.`);
    }
  });

  // An email that appears only inside an injection-like sentence is suspicious even if present.
  if (signals.length) {
    // Split on sentence ends followed by whitespace, so the dots inside emails don't split.
    for (const sentence of sourceText.split(/(?<=[.!?])\s+|\n+/)) {
      if (!injectionSignals(sentence).length) continue;
      for (const email of sentence.match(EMAIL) ?? []) {
        x.subcontractorSplits.forEach((s, i) => {
          if (s.email?.toLowerCase() === email.toLowerCase()) {
            flagged.add(`subcontractorSplits.${i}`);
            warnings.push(`Subcontractor "${s.name}" (${email}) comes from a suspicious instruction in the text. Remove it unless you're sure it's legitimate.`);
          }
        });
      }
    }
  }

  return { warnings: [...new Set(warnings)], flaggedFields: [...flagged] };
}
