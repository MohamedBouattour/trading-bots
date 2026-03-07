export interface AssetBalance {
  readonly asset: string;
  readonly free: number;
  readonly locked: number;
}

export function totalBalance(b: AssetBalance): number {
  return b.free + b.locked;
}
