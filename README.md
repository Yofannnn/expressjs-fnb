# Express F&B

A backend API for a food-and-beverage business: menu management, online ordering (with guest checkout), payments, and staff/member accounts. Built with **Express 5 + TypeScript** using a **hexagonal (ports & adapters) architecture**.

## Features

- **Authentication & sessions**: register, login, email verification, password reset, short-lived JWT access tokens with rotating refresh tokens in an `httpOnly` cookie, and account lockout after repeated failed logins.
- **Products & categories**: multi-image upload, stock and status management, category ordering, browse and search.
- **Online orders**: price quotes (tax, service charge, distance-based delivery fee), orders for members or guests, and guest order management through an emailed token.
- **Payments**: charge initiation through Midtrans.
- **Event system**: domain events with immediate, batched, queued (Redis) or delayed delivery, retries, and a Postgres dead-letter queue.
- **Rate limiting**: Redis-backed, per-endpoint policies with a circuit breaker.
- **Roles**: `ADMIN`, `MANAGER`, `CASHIER`, `KITCHEN`, `BAR`, `MEMBER`.

## Tech stack

Node.js, Express 5, TypeScript · PostgreSQL with Prisma 7 · Redis (`ioredis`) · Zod · JWT and bcrypt · Midtrans · Nodemailer · Vercel Blob · Winston · Jest, ESLint, Prettier

## Quick start

**Prerequisites:** Node.js (current LTS), PostgreSQL, and Redis. Redis is required: the app checks it in `/health` and starts the event queue processor on boot. On Windows, run Node and PostgreSQL natively and Redis inside WSL (no Docker needed).

```bash
npm install
cp .env.example .env          # Windows Command Prompt: copy .env.example .env
# fill in .env (see "Environment variables" in the table below)
npx prisma generate
npx prisma migrate dev
npm run dev
```

The server listens on `PORT` (default `3000`). Check it with `curl http://localhost:3000/health`: `200` means PostgreSQL and Redis are both reachable, `503` means one is not. Then open the interactive API reference at `http://localhost:3000/docs`.

## Documentation

| I want to...                                                   | Read                                                                                                                                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Call the API (endpoints, request bodies, every error response) | **API reference**: run the app and open [`/docs`](http://localhost:3000/docs) (raw spec at `/docs/openapi.json`). It is generated from the Zod schemas in [`src/presentation/openapi`](src/presentation/openapi) |
| Configure environment variables                                | [Environment variables](docs/guides/environment.md)                                                                                                                                                              |
| Connect a frontend, or set up Midtrans and email               | [Integrations](docs/guides/integrations.md)                                                                                                                                                                      |
| Understand the architecture                                    | [Overview](docs/architecture/overview.md) · [Request lifecycle](docs/architecture/request-lifecycle.md) · [Events](docs/architecture/events.md)                                                                  |

## Scripts

| Command                | Description                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run dev`          | Watch-compile TypeScript and run with nodemon                                                                   |
| `npm run build`        | Clean, generate the Prisma client, compile into `dist/` (uses `rm -rf`: on Windows run it from Git Bash or WSL) |
| `npm start`            | Run the compiled app (`dist/app.js`)                                                                            |
| `npm run code-quality` | Lint + format check + type check                                                                                |
| `npm test`             | Run Jest (`test:watch`, `test:coverage` also available)                                                         |
