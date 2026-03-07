---name: architecture-patternsdescription: Describes the architectural patterns and principles applied in the smart-grid project.---
# Architecture Patterns for Smart-Grid Trading Bot

This document outlines the key architectural patterns and principles employed in the `smart-grid` project. The design aims for modularity, maintainability, testability, and clear separation of concerns, crucial for a robust trading application.

## 1. Layered Architecture / Domain-Driven Design (DDD) Principles

The project structure `src/smart-grid/{application,domain,infrastructure,ports,presentation}` strongly indicates a layered architecture, drawing heavily from Domain-Driven Design (DDD) principles.

*   **Domain Layer (`src/smart-grid/domain/`)**:
    *   **Core Business Logic**: This is the heart of the application, containing the essential business rules and entities of the smart-grid trading strategy.
    *   **Entities & Value Objects**: `Balance.ts`, `GridConfig.ts`, `GridLevel.ts`, `MarketState.ts` represent the core data structures.
    *   **Domain Services**: `CapitalCalculator.ts` and `GridCalculator.ts` encapsulate domain-specific operations that don't naturally fit within an entity. These are typically pure functions, emphasizing testability and predictability.
    *   **Ports (Interfaces)**: `ILoggerPort.ts`, `IMarketDataPort.ts`, `IOrderExecutorPort.ts` define the contracts that external services must adhere to, enabling dependency inversion and making the domain independent of infrastructure details.
    *   **`SmartGridBot.ts`**: The central orchestrator of the domain logic, reacting to market events and managing the trading strategy.

*   **Application Layer (`src/smart-grid/application/`)**:
    *   **Use Cases**: `RunBacktestUseCase.ts`, `SyncGridOrdersUseCase.ts` define the application's capabilities and orchestrate the domain objects to fulfill specific user or system requests. They coordinate domain services and infrastructure components without containing business logic themselves.

*   **Infrastructure Layer (`src/smart-grid/infrastructure/`)**:
    *   **Implementations of Ports**: Provides concrete implementations for the interfaces defined in the domain layer's ports. This includes:
        *   `exchange/BinanceMarketDataAdapter.ts`, `market_data/BinanceMarketDataProvider.ts`, `market_data/LocalCsvMarketDataProvider.ts`, `market_data/SyntheticMarketDataProvider.ts`: Implementations of `IMarketDataPort` for various market data sources.
        *   `exchange/BinanceOrderExecutor.ts`, `execution/BinanceOrderExecutionService.ts`: Implementations of `IOrderExecutorPort` for interacting with the Binance exchange.
        *   `logger/ConsoleLogger.ts`: Implementation of `ILoggerPort`.
        *   `reporting/HtmlReportGenerator.ts`: For generating reports.
    *   **External Service Integration**: Handles communication with external systems like Binance API (`binance-api-node`, `axios`).
    *   **Configuration**: `config/EnvConfigLoader.ts` for loading environment-specific settings.

*   **Presentation Layer (`src/smart-grid/presentation/`)**:
    *   **User Interface / Entry Points**: Contains the entry points for interacting with the application, primarily Command Line Interface (CLI) scripts:
        *   `cli/run_bot.ts`: The main script for running the live trading bot.
        *   `cli/backtest_cli.ts`: For executing backtests.
        *   `cli/optimize_cli.ts`, `cli/optimize_max_roi_cli.ts`: For strategy optimization.

## 2. Modular Design

*   **Shared Modules (`src/shared/`)**: Common, reusable components that are not specific to the `smart-grid` domain but are useful across the application or other potential trading bots.
    *   `indicators/`: Contains generic technical indicator calculations (e.g., `IndicatorService.ts`).
    *   `utils/`: General utility functions (e.g., `MathUtils.ts`).
*   **General Models (`src/models/`)**: Contains basic, generic data structures that might be used across different domains or layers (e.g., `Candle.ts`, `Order.ts`, `Position.ts`, `Trade.ts`). This separates them from the more specific domain models.

## 3. Dependency Inversion Principle (DIP)

The extensive use of `ports` (interfaces) in the `domain` layer and their concrete `infrastructure` implementations demonstrates adherence to DIP. High-level modules (application, domain) do not depend on low-level modules (infrastructure); instead, both depend on abstractions (interfaces). This makes the core logic independent of external details and easily testable.

## 4. Configuration Management

*   **Environment Variables**: The project uses `dotenv` and `EnvConfigLoader.ts` to manage configuration, ensuring sensitive information and environment-specific settings are externalized and not hardcoded. This promotes flexibility and security across different deployment environments.

## 5. External Integrations

*   **Binance API**: Integration with the Binance cryptocurrency exchange is handled through `binance-api-node` and `axios`, encapsulated within the `infrastructure` layer. This isolation minimizes the impact of external API changes on the core domain logic.

## 6. Command Line Interface (CLI) Driven

The bot's primary interaction model is through a CLI, with distinct commands for running the bot, backtesting, and optimization. This is a practical choice for automated trading systems that typically run headless on servers.

## 7. Data Flow and Event Handling (Implicit)

The `on_candle` method in `SmartGridBot` suggests an event-driven approach where the bot reacts to incoming market data (candles). This reactive pattern is common in trading systems for real-time decision-making.