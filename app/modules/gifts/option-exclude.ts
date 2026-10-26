/**
 * Variant carve-out by option value (2026-10-26, Smart Fusion × compatible lenses).
 *
 * A campaign can list option values (`excludeOptions`, e.g. mirrorless mounts
 * "RF", "L", "X", "Z") whose variants must NOT trigger. The product still
 * triggers with its other variants: the allowed ones are written into the stamp
 * as `triggerVariants`, which the discount Function already enforces (an
 * off-list variant of the product doesn't qualify) and the storefront reads to
 * show / hide the offer for the selected variant.
 *
 * Matching (case-insensitive, per option value):
 *   - "Mount" / "-Mount" is ignored ("L-Mount", "RF Mount", "E-mount" → "L", "RF", "E")
 *   - the value is split into words on spaces / / , & + ( ) |
 *   - a keyword matches when its words appear in that order as whole words
 *     ("L" matches "Leica L" and "L-Mount" but not "PL"; "EF-M" doesn't match "EF";
 *      "M4/3" matches "M4/3")
 */

const SEP = /[\s/,&+()|]+/;

export function normalizeOption(v: string): string {
  return String(v ?? "")
    .toUpperCase()
    .replace(/[-\s]*MOUNT\b/g, " ")
    .split(SEP)
    .filter(Boolean)
    .join(" ");
}

/** True when an option value matches any keyword. */
export function optionMatches(value: string, keywords: string[]): boolean {
  const v = ` ${normalizeOption(value)} `;
  if (v.trim() === "") return false;
  return keywords.some((k) => {
    const n = normalizeOption(k);
    return n !== "" && v.includes(` ${n} `);
  });
}

export type VariantOptions = { id: string; options: string[] }; // id = numeric tail

/**
 * Allowed variant tails of a product, or null when nothing is excluded (every
 * variant counts — no `triggerVariants` needed). An empty array means every
 * variant is excluded (the product shouldn't trigger at all).
 */
export function allowedVariants(variants: VariantOptions[], keywords: string[]): string[] | null {
  const kw = keywords.map((k) => String(k).trim()).filter(Boolean);
  if (!kw.length || !variants.length) return null;
  const ok = variants.filter((v) => !v.options.some((o) => optionMatches(o, kw))).map((v) => v.id);
  return ok.length === variants.length ? null : ok;
}

/**
 * Combine with a member's existing per-variant restriction (directly listed
 * trigger products can already restrict variants): keep only variants allowed
 * by both. Returns undefined = no restriction, [] = nothing left.
 */
export function mergeTriggerVariants(existing: string[] | undefined, allowed: string[] | null): string[] | undefined {
  if (allowed === null) return existing;
  if (!existing?.length) return allowed;
  const set = new Set(allowed);
  return existing.filter((v) => set.has(String(v)));
}
