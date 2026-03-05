import { describe, it, expect } from "vitest";
import { MathUtils } from "./MathUtils";

describe("MathUtils", () => {
  describe("stdDev", () => {
    it("should return 0 for an empty array", () => {
      expect(MathUtils.stdDev([])).toBe(0);
    });

    it("should calculate standard deviation correctly", () => {
      const data = [10, 12, 23, 23, 16, 23, 21, 16];
      // Mean = 18
      // Variances = [64, 36, 25, 25, 4, 25, 9, 4]
      // Sum = 192
      // Variance = 192 / 8 = 24
      // StdDev = sqrt(24) ≈ 4.898979485566356
      expect(MathUtils.stdDev(data)).toBeCloseTo(4.898979485566356);
    });
  });

  describe("linspace", () => {
    it("should return [start] if num <= 1", () => {
      expect(MathUtils.linspace(0, 10, 1)).toEqual([0]);
      expect(MathUtils.linspace(0, 10, 0)).toEqual([0]);
    });

    it("should return correct linear spacing", () => {
      expect(MathUtils.linspace(0, 10, 5)).toEqual([0, 2.5, 5, 7.5, 10]);
    });
  });
});
