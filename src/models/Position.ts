export class Position {
  entry_price: number;
  quantity: number;
  take_profit_price: number;
  stop_loss_price: number;
  trailing_stop_pct: number;
  highest_price_seen: number;
  meta?: any;

  constructor(
    entry_price: number,
    quantity: number,
    take_profit_price: number,
    stop_loss_price: number,
    trailing_stop_pct: number,
  ) {
    this.entry_price = entry_price;
    this.quantity = quantity;
    this.take_profit_price = take_profit_price;
    this.stop_loss_price = stop_loss_price;
    this.trailing_stop_pct = trailing_stop_pct;
    this.highest_price_seen = entry_price;
  }

  update_trailing_stop(current_price: number): void {
    if (current_price > this.highest_price_seen) {
      this.highest_price_seen = current_price;
      this.stop_loss_price =
        this.highest_price_seen * (1 - this.trailing_stop_pct / 100);
    }
  }

  get is_stop_hit(): boolean {
    return false;
  }
}
