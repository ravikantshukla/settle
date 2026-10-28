"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  detail?: string;
}

const ToastContext = createContext<(tone: Tone, title: string, detail?: string) => void>(() => {});

export function useToast() {
  const push = useContext(ToastContext);
  return useMemo(
    () => ({
      success: (title: string, detail?: string) => push("success", title, detail),
      error: (title: string, detail?: string) => push("error", title, detail),
      info: (title: string, detail?: string) => push("info", title, detail),
    }),
    [push],
  );
}

const TONE: Record<Tone, string> = {
  success: "border-emerald-200 bg-white [&_.dot]:bg-emerald-500",
  error: "border-red-200 bg-white [&_.dot]:bg-red-500",
  info: "border-slate-200 bg-white [&_.dot]:bg-sky-500",
};

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (tone: Tone, title: string, detail?: string) => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-3), { id, tone, title, detail }]);
      setTimeout(() => dismiss(id), tone === "error" ? 9000 : 5000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto w-full rounded-lg border px-4 py-3 shadow-lg ${TONE[t.tone]}`}
          >
            <div className="flex items-start gap-3">
              <span className="dot mt-1.5 h-2 w-2 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{t.title}</p>
                {t.detail && <p className="mt-0.5 break-words text-xs text-slate-600">{t.detail}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-slate-400 hover:text-slate-700">
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
