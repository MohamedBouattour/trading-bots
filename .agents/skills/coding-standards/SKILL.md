---name: coding-standardsdescription: Defines the coding standards for the smart-grid project.---
# Coding Standards for Smart-Grid Trading Bot

This document outlines the coding standards for the `smart-grid` project, ensuring consistency, maintainability, and readability across the codebase. Adherence to these standards is mandatory for all contributions.

## 1. Language and Type Safety

*   **TypeScript First**: All new code must be written in TypeScript (`.ts` files). Leverage TypeScript's static typing to catch errors early and improve code clarity.
*   **Strict Mode**: The project uses `"strict": true` in `tsconfig.json`. Ensure all code adheres to strict type checking rules.
*   **Explicit Types**: Prefer explicit type declarations for variables, function parameters, and return types, especially in public APIs and interfaces, unless type inference is immediately obvious and unambiguous.

## 2. Linting and Formatting

*   **ESLint**: The project uses ESLint for code quality and style enforcement, configured via `eslint.config.mts`. All code must pass ESLint checks without warnings or errors.
    *   Run `eslint` as part of your development workflow and before committing.
*   **Automated Formatting**: While a dedicated formatter like Prettier is not explicitly configured in `package.json`, maintain consistent formatting:
    *   **Indentation**: Use 2 spaces for indentation.
    *   **Quotes**: Use double quotes for strings.
    *   **Semicolons**: Always use semicolons at the end of statements.
    *   **Trailing Commas**: Use trailing commas where appropriate (e.g., in multi-line object literals, array literals).

## 3. Naming Conventions

*   **Files**: Use `kebab-case` for filenames (e.g., `smart-grid-bot.ts`, `indicator-service.ts`).
*   **Folders**: Use `kebab-case` for directory names (e.g., `smart-grid`, `shared`).
*   **Classes and Interfaces**: Use `PascalCase` (e.g., `SmartGridBot`, `IMarketDataProvider`, `GridConfig`).
*   **Functions and Variables**: Use `camelCase` (e.g., `computeCapital`, `currentPrice`, `perOrderBudget`).
*   **Constants**: Use `SCREAMING_SNAKE_CASE` for global constants (e.g., `MAX_DRAWDOWN_EXIT_PCT`).
*   **Enums**: Use `PascalCase` for enum names and `PascalCase` for their members (e.g., `OrderSide.BUY`).

## 4. Code Structure and Modularity

*   **Modular Design**: Adhere to the established modular structure within `src/smart-grid/`:
    *   `application/`: Business logic orchestration (use cases).
    *   `domain/`: Core business entities, value objects, domain services, and interfaces (ports).
    *   `infrastructure/`: Implementations of domain ports, external service integrations.
    *   `ports/`: TypeScript interfaces defining contracts for external dependencies.
    *   `presentation/`: Entry points (e.g., CLI scripts).
*   **Shared Utilities**: Place common, reusable utilities and models in `src/shared/` and `src/models/` respectively.
    *   `src/shared/indicators/`: For technical indicator calculations (e.g., `IndicatorService.ts`).
    *   `src/shared/utils/`: For general-purpose utility functions (e.g., `MathUtils.ts`).
    *   `src/models/`: For common data structures used across modules (e.g., `Candle.ts`, `Position.ts`).
*   **Pure Functions**: Favor pure functions, especially in the `domain` and `shared` layers, as exemplified by `CapitalCalculator.ts` and `GridCalculator.ts`. These functions should have no side effects and produce the same output for the same input.

## 5. Documentation and Comments

*   **JSDoc**: Use JSDoc comments for all exported functions, classes, interfaces, and complex types. Document parameters, return values, and a brief description of purpose.
*   **Inline Comments**: Use inline comments sparingly for explaining complex logic or non-obvious choices, not for restating the obvious.

## 6. Error Handling

*   **Explicit Error Handling**: Use `try-catch` blocks for asynchronous operations and external interactions (e.g., `BinanceOrderExecutionService.ts`).
*   **Meaningful Errors**: Throw descriptive error messages when validation fails or unexpected states occur.

## 7. Configuration

*   **Environment Variables**: Use `dotenv` for managing environment-specific configuration. Load configuration via `EnvConfigLoader.ts` from `.env` files. Never hardcode sensitive information.

## 8. TypeScript Compiler Options

*   **Target**: `es2020` for modern JavaScript features.
*   **Module**: `commonjs` for module resolution, as specified in `tsconfig.json` and `package.json` (`"type": "commonjs"`).
*   **`esModuleInterop`**: Enabled to allow default imports from CommonJS modules.
*   **`skipLibCheck`**: Enabled to speed up compilation by skipping type checking of declaration files.
*   **`forceConsistentCasingInFileNames`**: Enabled to prevent issues on case-sensitive file systems.