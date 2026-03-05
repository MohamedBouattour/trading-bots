import { describe, it, expect, vi, beforeEach } from "vitest";
import { BinanceOrderExecutionService } from "./BinanceOrderExecutionService";

const mockPrices = vi.fn();
const mockOrderTest = vi.fn();
const mockOrder = vi.fn();

// Mock binance-api-node
vi.mock("binance-api-node", () => {
  return {
    default: vi.fn(() => ({
      prices: mockPrices,
      orderTest: mockOrderTest,
      order: mockOrder,
    })),
    OrderType: {
      MARKET: "MARKET",
    },
    OrderSide: {
      BUY: "BUY",
      SELL: "SELL",
    },
  };
});

describe("BinanceOrderExecutionService", () => {
  let service: BinanceOrderExecutionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BinanceOrderExecutionService("api-key", "api-secret");
  });

  it("should call orderTest when testOnly is true", async () => {
    mockPrices.mockResolvedValue([{ symbol: "BTCUSDT", price: "50000" }]);
    mockOrderTest.mockResolvedValue({ status: "OK" });

    await service.openMarketOrder("BTCUSDT", "BUY", 100, true);

    expect(mockOrderTest).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quoteOrderQty: "100",
      }),
    );
    expect(mockOrder).not.toHaveBeenCalled();
  });

  it("should call order when testOnly is false", async () => {
    mockPrices.mockResolvedValue([{ symbol: "BTCUSDT", price: "50000" }]);
    mockOrder.mockResolvedValue({ status: "FILLED" });

    await service.openMarketOrder("BTCUSDT", "BUY", 100, false);

    expect(mockOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        quoteOrderQty: "100",
      }),
    );
    expect(mockOrderTest).not.toHaveBeenCalled();
  });

  it("should throw error if symbol price not found", async () => {
    mockPrices.mockResolvedValue([{ symbol: "ETHUSDT", price: "3000" }]);

    await expect(
      service.openMarketOrder("BTCUSDT", "BUY", 100),
    ).rejects.toThrow("Could not find price for symbol: BTCUSDT");
  });
});
