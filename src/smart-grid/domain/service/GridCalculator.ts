import { GridConfig } from "../model/GridConfig";
import { GridLevel } from "../model/GridLevel";

/**
 * Pure function — no side effects, no I/O.
 * Computes N buy grid levels spread linearly below currentPrice.
 *
 * Each level is spaced stepPct = (swingPct / gridCount) % below the previous.
 * Quantity at each level = perOrderBudget / levelPrice, rounded to 2 dp.
 * Take-profit = buyPrice * (1 + takeProfitPct / 100), rounded to 2 dp.
 */
export function computeBuyGrid(
  currentPrice: number,
  perOrderBudget: number,
  config: GridConfig,
): GridLevel[] {
  const stepPct = config.swingPct / config.gridCount / 100;

  return Array.from({ length: config.gridCount }, (_, i) => {
    const price = round2(currentPrice * (1 - stepPct * (i + 1)));
    const quantity = round2(perOrderBudget / price);
    const takeProfitPrice = round2(price * (1 + config.takeProfitPct / 100));
    return { price, quantity, takeProfitPrice };
  });
}

/** Rounds a number to 2 decimal places, keeping it as a number (not a string). */
function round2(value: number): number {
  return parseFloat(value.toFixed(2));
}
