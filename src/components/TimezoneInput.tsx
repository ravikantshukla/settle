"use client";

import { useEffect, useId, useState } from "react";

const COMMON = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Asia/Kolkata"];

/** Text input that suggests IANA timezone names (e.g. "Europe/London"). */
export function TimezoneInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "list">) {
  const id = useId();
  // The full list comes from the browser after mount: Node's and the browser's zone lists differ,
  // so rendering it on the server would cause a hydration mismatch.
  const [zones, setZones] = useState<string[]>(COMMON);
  useEffect(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    setZones([...new Set([...COMMON, ...all])]);
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
