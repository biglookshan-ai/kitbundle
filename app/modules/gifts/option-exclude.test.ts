import { describe, expect, it } from "vitest";
import { allowedVariants, mergeTriggerVariants, optionMatches } from "./option-exclude";

const MIRRORLESS = ["RF", "L", "X", "Z", "MFT", "M4/3", "EF-M", "DL"];

describe("option value carve-out", () => {
  it("matches mounts as whole words, ignoring 'Mount'", () => {
    for (const v of ["RF", "RF Mount", "Canon RF", "L-Mount", "Leica L", "X-Mount", "Fujifilm X", "Nikon Z", "Z mount", "MFT", "M4/3", "EF-M", "DL Mount"])
      expect(optionMatches(v, MIRRORLESS)).toBe(true);
    for (const v of ["E", "E Mount", "E-Mount", "Sony E", "FE", "PL", "EF", "PL&EF", "EF/PL", "LPL", "Leica M", "M", "Blue", "Amber", "35mm + 50mm", "Imperial", "XL"])
      expect(optionMatches(v, MIRRORLESS)).toBe(false);
  });
  it("allowed variants: null when nothing excluded, [] when everything is", () => {
    const vs = [{ id: "1", options: ["35mm / E Mount / Blue"] }, { id: "2", options: ["RF"] }, { id: "3", options: ["MFT / Amber"] }];
    expect(allowedVariants(vs, MIRRORLESS)).toEqual(["1"]);
    expect(allowedVariants([{ id: "1", options: ["PL"] }], MIRRORLESS)).toBeNull();
    expect(allowedVariants([{ id: "1", options: ["RF"] }], MIRRORLESS)).toEqual([]);
    expect(allowedVariants(vs, [])).toBeNull();
  });
  it("merges with a direct per-variant restriction", () => {
    expect(mergeTriggerVariants(undefined, null)).toBeUndefined();
    expect(mergeTriggerVariants(["1", "2"], null)).toEqual(["1", "2"]);
    expect(mergeTriggerVariants(undefined, ["1"])).toEqual(["1"]);
    expect(mergeTriggerVariants(["1", "2"], ["2", "3"])).toEqual(["2"]);
  });
});
