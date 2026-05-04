import type { ConditionGroup, Condition } from '../models/StrategyBlueprint.js';
import type { IndicatorValues } from './IndicatorService.js';

function resolveValue(ref: string | number, indicators: IndicatorValues, price: Record<string, number>): number {
  if (typeof ref === 'number') return ref;
  if (ref.startsWith('price.')) return price[ref.split('.')[1]] ?? NaN;
  return indicators[ref] ?? NaN;
}

function evaluateCondition(cond: Condition, indicators: IndicatorValues, price: Record<string, number>): boolean {
  const left = resolveValue(cond.left, indicators, price);
  const right = resolveValue(cond.right, indicators, price);
  if (isNaN(left) || isNaN(right)) return false;

  switch (cond.operator) {
    case '>':  return left > right;
    case '<':  return left < right;
    case '>=': return left >= right;
    case '<=': return left <= right;
    case '==': return left === right;
    case '!=': return left !== right;
    default:   return false;
  }
}

function evaluateGroup(
  group: ConditionGroup,
  indicators: IndicatorValues,
  price: Record<string, number>
): boolean {
  const results = group.conditions.map((item) => {
    if ('group' in item) {
      return evaluateGroup((item as { group: ConditionGroup }).group, indicators, price);
    }
    return evaluateCondition(item as Condition, indicators, price);
  });

  return group.logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
}

export class ConditionEvaluator {
  evaluate(
    group: ConditionGroup,
    indicators: IndicatorValues,
    latestCandle: { close: number; open: number; high: number; low: number; volume: number }
  ): boolean {
    const price = {
      close: latestCandle.close,
      open: latestCandle.open,
      high: latestCandle.high,
      low: latestCandle.low,
      volume: latestCandle.volume,
    };
    return evaluateGroup(group, indicators, price);
  }
}
