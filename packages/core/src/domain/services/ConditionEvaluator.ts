import { Condition, ConditionGroup } from "../models/StrategyBlueprint";

type IndicatorValues = Map<string, number>;
type PriceContext = Record<string, number>;

/**
 * Pure evaluator: resolves nested AND/OR condition groups against
 * computed indicator values and current price context.
 *
 * Supports:
 *  - Nested ConditionGroup (AND/OR trees of arbitrary depth)
 *  - Left/right referencing indicator ids, "price.*" fields, or literal numbers
 */
export class ConditionEvaluator {
  static evaluate(
    group: ConditionGroup,
    indicators: IndicatorValues,
    price: PriceContext
  ): boolean {
    const results = group.conditions.map((item) => {
      if ("logic" in item) {
        return ConditionEvaluator.evaluate(item as ConditionGroup, indicators, price);
      }
      return ConditionEvaluator.evaluateLeaf(item as Condition, indicators, price);
    });
    return group.logic === "AND" ? results.every(Boolean) : results.some(Boolean);
  }

  private static resolve(
    ref: string | number,
    indicators: IndicatorValues,
    price: PriceContext
  ): number {
    if (typeof ref === "number") return ref;
    if (ref.startsWith("price.")) return price[ref.slice(6)] ?? 0;
    return indicators.get(ref) ?? 0;
  }

  private static evaluateLeaf(
    cond: Condition,
    indicators: IndicatorValues,
    price: PriceContext
  ): boolean {
    const l = ConditionEvaluator.resolve(cond.left, indicators, price);
    const r = ConditionEvaluator.resolve(cond.right, indicators, price);
    switch (cond.operator) {
      case ">": return l > r;
      case "<": return l < r;
      case ">=": return l >= r;
      case "<=": return l <= r;
      case "==": return l === r;
      case "!=": return l !== r;
    }
  }
}
