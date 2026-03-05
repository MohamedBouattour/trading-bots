export interface Order {
  order_id: number;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  status: "open" | "filled" | "cancelled";
  fill_price?: number;
}
