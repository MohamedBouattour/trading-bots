# BPML — Blueprint Metadata Language

All strategies are defined as JSON files in this directory. The engine discovers and runs them automatically.

## Schema

```typescript
interface StrategyBlueprint {
  id: string;                    // unique identifier, used for state file name
  name: string;
  symbols: string[];             // e.g. ["BTCUSDT", "ETHUSDT"]
  indicators: IndicatorDeclaration[];
  rules: Rule[];
  loop: { intervalSeconds: number };
  riskManagement: RiskConfig;
}

interface IndicatorDeclaration {
  id: string;                    // reference key used in conditions
  type: 'RSI' | 'SMA' | 'EMA' | 'ATR' | 'VWAP' | 'VOLUME_MA' | 'MACD' | 'BB';
  params: Record<string, number>;
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
}

interface Rule {
  id: string;
  name: string;
  priority: number;
  conditionGroup: ConditionGroup;
  action: 'BUY' | 'SELL' | 'CLOSE' | 'HOLD';
  params: ActionParams;
}

interface ConditionGroup {
  logic: 'AND' | 'OR';
  conditions: Condition[];       // can nest more ConditionGroups via 'group' key
}

interface Condition {
  left: string;                  // indicator id or 'price.close' | 'price.volume'
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  right: number | string;        // number or another indicator id
}
```

See `example-rsi-trend.json` for a complete working example.
