/**
 * LanguageControl — ES/EN segmented toggle for public surfaces.
 *
 * - Real buttons with aria-pressed
 * - Clear active state
 * - Minimum 44px touch target
 * - Persists preference in a cookie and localStorage through LocaleProvider
 */

"use client";

import { useRouter } from "next/navigation";

import { useLocale } from "@/context/LocaleContext";

interface LanguageControlProps {
  className?: string;
}

export default function LanguageControl({ className = "" }: LanguageControlProps) {
  const router = useRouter();
  const { locale, copy, setLocale } = useLocale();

  function handleChange(next: "es" | "en") {
    if (next === locale) return;
    setLocale(next);
    // Refresh server components so cookie-backed copy changes in the same turn.
    router.refresh();
  }

  return (
    <div className={`lang-control ${className}`} role="group" aria-label={copy.language.label}>
      <button
        type="button"
        className="lang-control__button"
        aria-pressed={locale === "es"}
        onClick={() => handleChange("es")}
        title={copy.language.spanish}
      >
        ES
      </button>
      <button
        type="button"
        className="lang-control__button"
        aria-pressed={locale === "en"}
        onClick={() => handleChange("en")}
        title={copy.language.english}
      >
        EN
      </button>
    </div>
  );
}
