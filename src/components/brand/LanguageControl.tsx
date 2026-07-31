/**
 * LanguageControl — ES/EN segmented toggle for public surfaces.
 *
 * - Real buttons with aria-pressed
 * - Clear active state
 * - Minimum 44px touch target
 * - Persists preference in localStorage
 * - No new i18n dependency
 *
 * This component manages the `data-lang` attribute on the document root
 * which controls CSS visibility of bilingual content.
 */

"use client";

import { useCallback, useSyncExternalStore, useState } from "react";

type Lang = "es" | "en";

interface LanguageControlProps {
  className?: string;
}

function getSavedLang(): Lang {
  try {
    const saved = localStorage.getItem("hb-lang") as Lang | null;
    if (saved === "es" || saved === "en") return saved;
  } catch {
    // localStorage unavailable
  }
  return "es";
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): Lang {
  return getSavedLang();
}

function getServerSnapshot(): Lang {
  return "es";
}

export default function LanguageControl({ className = "" }: LanguageControlProps) {
  const savedLang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [lang, setLang] = useState<Lang>(savedLang);

  // Apply initial lang on mount (client-only)
  const [mounted, setMounted] = useState(false);
  if (!mounted && typeof document !== "undefined") {
    setMounted(true);
    document.documentElement.setAttribute("data-lang", savedLang);
  }

  const handleChange = useCallback(
    (next: Lang) => {
      setLang(next);
      document.documentElement.setAttribute("data-lang", next);
      try {
        localStorage.setItem("hb-lang", next);
      } catch {
        // localStorage unavailable
      }
    },
    []
  );

  if (!mounted) {
    // Prevent hydration mismatch — render static version
    return (
      <div className={`lang-control ${className}`} role="group" aria-label="Language">
        <span className="lang-control__button" aria-pressed="true">ES</span>
        <span className="lang-control__button" aria-pressed="false">EN</span>
      </div>
    );
  }

  return (
    <div className={`lang-control ${className}`} role="group" aria-label="Language">
      <button
        type="button"
        className="lang-control__button"
        aria-pressed={lang === "es"}
        onClick={() => handleChange("es")}
      >
        ES
      </button>
      <button
        type="button"
        className="lang-control__button"
        aria-pressed={lang === "en"}
        onClick={() => handleChange("en")}
      >
        EN
      </button>
    </div>
  );
}
