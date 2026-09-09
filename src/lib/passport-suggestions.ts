/**
 * Suggested compliance bands for common water quality metrics.
 *
 * IMPORTANT: These are editable suggestions for the farmer, not legal export
 * limits. Actual limits depend on destination market, species, product and the
 * applicable regulation, so they must be explicitly accepted/adjusted when a
 * profile rule is created.
 *
 * Client-safe module (no Node-only imports) so it can be used in the browser.
 */
export const DEFAULT_COMPLIANCE_BANDS = {
  water_ph: { min: 6.5, max: 9.0 },
  water_temperature: { min: 20, max: 32 },
  turbidity: { min: 0, max: 50 },
} as const;

export function getSuggestedBand(template: string): { min: number; max: number } | null {
  return DEFAULT_COMPLIANCE_BANDS[template as keyof typeof DEFAULT_COMPLIANCE_BANDS] ?? null;
}
