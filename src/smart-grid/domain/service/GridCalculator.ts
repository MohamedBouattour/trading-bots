import { GridConfig } from "../model/GridConfig";
import { GridLevel } from "../model/GridLevel";

/**
 * Pure function — no side effects, no I/O.
 * Computes N buy grid levels spread linearly below currentPrice.
 *
 * Each level is spaced stepPct = (swingPct / gridCount) % below the previous.
 * Quantity at each level = perOrderBudget / levelPrice.
 * Take-profit = buyPrice * (1 + takeProfitPct / 100).
 */
export function computeBuyGrid(
  currentPrice: number,
  perOrderBudget: number,
  config: GridConfig,
): GridLevel[] {
  const stepPct = config.swingPct / config.gridCount / 100;

  return Array.from({ length: config.gridCount }, (_, i) => {
    const price = currentPrice * (1 - stepPct * (i + 1));
    const quantity = perOrderBudget / price;
    const takeProfitPrice = price * (1 + config.takeProfitPct / 100);
    return { price, quantity, takeProfitPrice };
  });
}
