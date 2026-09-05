/**
 * Theme choice without client script: the footer form posts to `/theme`, the
 * choice is stored in a cookie the root layout reads, and the reader is
 * redirected back to the page it came from.
 */

export const THEME_COOKIE = "specra-mode";
export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_LABELS: Readonly<Record<ThemeMode, string>> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

export function readThemeMode(value: string | undefined): ThemeMode {
  return value === "light" || value === "dark" ? value : "system";
}

/** Accepts only an absolute path on this origin; anything else returns home. */
export function safeReturnPath(
  value: FormDataEntryValue | null | undefined,
): string {
  if (typeof value !== "string") return "/";
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/";
  }
  if (/[\u0000-\u001f\u007f]/.test(value) || value.length > 2_048) return "/";
  return value;
}
