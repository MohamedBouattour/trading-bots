# Quick Start (Local Development)

1. Create a `.env` file in the root directory (see `.env.example` if it exists) or use the default provided `.env` created by the setup.
2. Start the local database:
   ```bash
   npm run dev:db
   ```
3. Push schema to the DB and generate Prisma client:
   ```bash
   npm run prisma:push
   npm run prisma:generate
   ```
4. Start backend services (API, Worker, Backtester, Analytics, Marketplace):
   ```bash
   npm run dev:back
   ```
5. Start frontend dashboard:
   ```bash
   npm run dev:front
   ```

# Alternative (Docker)
npm run docker            # Build and run full stack with Docker