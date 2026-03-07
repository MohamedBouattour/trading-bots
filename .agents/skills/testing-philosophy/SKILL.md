---name: testing-philosophydescription: Outlines the testing strategy and practices for the smart-grid project.---
# Testing Philosophy for Smart-Grid Trading Bot

This document describes the testing philosophy and practices for the `smart-grid` project, aiming to ensure the reliability, correctness, and robustness of the trading bot's logic.

## 1. Test Runner and Framework

*   **Vitest**: All unit and integration tests are executed using `vitest`, as configured in `vitest.config.ts` and the `test` script in `package.json` (`vitest run`).
*   **Node.js Environment**: Tests run in a Node.js environment (`environment: "node"`) with global APIs enabled (`globals: true`) for convenience.

## 2. Test Types and Focus

### 2.1. Unit Tests

*   **Purpose**: To verify the correctness of individual functions, methods, or small components in isolation.
*   **Scope**: Focus on pure functions and domain logic that have no side effects or external dependencies.
    *   **Examples**: `src/shared/indicators/IndicatorService.test.ts` and `src/shared/utils/MathUtils.test.ts` demonstrate testing utility functions with various inputs and edge cases.
    *   **Domain Logic**: Critical domain services like `CapitalCalculator.ts` and `GridCalculator.ts` (though not explicitly shown in tests) should be thoroughly unit tested due to their pure functional nature.
*   **Mocks/Stubs**: Use mocks or stubs for external dependencies (e.g., market data providers, order executors) to ensure tests are fast, deterministic, and isolated.
    *   `SmartGridBot.test.ts` implicitly uses a simplified environment for the bot's internal state management.
*   **Assertions**: Use `expect` from Vitest for clear and concise assertions. Pay attention to floating-point comparisons using `toBeCloseTo` where necessary.

### 2.2. Integration Tests

*   **Purpose**: To verify that different modules or services interact correctly with each other.
*   **Scope**: Test the interaction between application use cases and domain services, or between infrastructure adapters and external APIs (using test doubles for the external systems).
    *   While not explicitly shown as separate files, the `SmartGridBot.test.ts` contains elements of integration testing by simulating candle events and observing the bot's state changes and order placement logic.

### 2.3. End-to-End (E2E) / Backtesting Tests

*   **Purpose**: To simulate the bot's behavior over historical data and verify its overall performance and decision-making in a realistic scenario.
*   **Execution**: The `npm run backtest` script (`ts-node src/smart-grid/presentation/cli/backtest_cli.ts`) serves as the primary E2E testing mechanism.
*   **Validation**: Backtesting results (`smart_backtest_results.html`) are crucial for validating the strategy's profitability and risk management.
*   **Optimization**: `npm run optimize` and `npm run optimize-roi` are used to find optimal parameters, which also serve as a form of extensive scenario testing.

## 3. Test File Structure and Naming

*   **Co-location**: Test files are typically co-located with the source files they test, following the pattern `*.test.ts` (e.g., `IndicatorService.ts` has `IndicatorService.test.ts`).
*   **Descriptive Naming**: Use `describe` blocks to group related tests and `it` blocks for individual test cases with clear, descriptive names that explain what is being tested.

## 4. Key Testing Principles

*   **Fast Feedback**: Tests should run quickly to provide immediate feedback during development.
*   **Reliability**: Tests should be deterministic; running the same test multiple times should yield the same result.
*   **Readability**: Tests should be easy to read and understand, acting as living documentation for the code.
*   **Coverage**: Strive for high test coverage, especially for critical business logic in the `domain` layer.
*   **Edge Cases**: Explicitly test edge cases, boundary conditions, and error scenarios (e.g., `computeSMA` with insufficient data, `SmartGridBot` emergency drawdown).

## 5. Specific Test Scenarios (from `SmartGridBot.test.ts`)

*   **Bot Initialization**: Verify correct initial balance and configuration.
*   **State Updates**: Ensure timestamps and internal state are correctly updated on candle events.
*   **Order Placement**: Confirm buy orders are placed under specific market conditions.
*   **Emergency Exits**: Validate the `max_drawdown_exit_pct` logic for liquidating positions.
*   **Martingale Cap**: Test that order costs adhere to `max_order_cost_pct` limits.
*   **Stale Order Cancellation**: Verify that orders open for too long (`TTL`) are cancelled.
*   **Position Deduplication**: Ensure positions within a small price difference are merged.
*   **Sell-Side Grid Generation**: Confirm sell orders are generated above entry prices after a buy fill.
*   **Adaptive Take Profit**: Test dynamic adjustment of take-profit levels.