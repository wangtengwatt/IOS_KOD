const LEGACY_GUIDE_BRAND_REPLACEMENTS: Array<[RegExp, string]> = [
  [/chatboxai\.app/gi, 'kod.kai.com'],
  [/hi@chatboxai\.com/gi, 'kod.kai.com'],
  [/Chatbox AI/gi, 'KOD AI'],
  [/Chatbox/gi, 'KOD'],
  [/Boxy/gi, 'KOD 新手助手'],
]

/**
 * Keeps legacy onboarding translations and server-streamed guide responses from
 * leaking the upstream Chatbox brand into the KOD user interface.
 */
export function brandGuideText(text: string): string {
  return LEGACY_GUIDE_BRAND_REPLACEMENTS.reduce(
    (brandedText, [legacyPattern, replacement]) => brandedText.replace(legacyPattern, replacement),
    text
  )
}
