import { describe, it, expect } from "vitest";
import { IndicatorService } from "./IndicatorService";

describe("IndicatorService", () => {
  describe("computeSMA", () => {
    it("should return the last value if data length < period", () => {
      expect(IndicatorService.computeSMA([10, 20], 3)).toBe(20);
    });

    it("should calculate SMA correctly", () => {
      expect(IndicatorService.computeSMA([10, 20, 30, 40, 50], 3)).toBe(40);
    });
  });

  describe("computeRSI", () => {
    it("should return 50 if history is too short", () => {
      expect(IndicatorService.computeRSI([10, 20], 14)).toBe(50);
    });

    it("should return 100 if there are only gains", () => {
      const data = Array.from({ length: 15 }, (_, i) => 100 + i);
      expect(IndicatorService.computeRSI(data, 14)).toBe(100);
    });
  });

  describe("computeTrend", () => {
    it("should return ranging if history is too short", () => {
      expect(IndicatorService.computeTrend([100, 101], 10, 0.01)).toBe(
        "ranging",
      );
    });

    it("should detect uptrend", () => {
      const data = Array.from({ length: 30 }, (_, i) => 100 + i);
      expect(IndicatorService.computeTrend(data, 10, 0.001)).toBe("uptrend");
    });

    it("should detect downtrend", () => {
      const data = Array.from({ length: 30 }, (_, i) => 100 - i);
      expect(IndicatorService.computeTrend(data, 10, 0.001)).toBe("downtrend");
    });
  });
});
