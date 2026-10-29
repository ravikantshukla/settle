"use client";

import { useId, useMemo } from "react";

const COMMON = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Asia/Kolkata"];

/** Text input that suggests IANA timezone names (e.g. "Europe/London"). */
export function TimezoneInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "list">) {
  const id = useId();
  const zones = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return [...new Set([...COMMON, ...all])];
  }, []);
  return (
    <>
      <input {...props} list={id} autoComplete="off" spellCheck={false} />
      <datalist id={id}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}
