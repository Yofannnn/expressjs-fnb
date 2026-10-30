# Environment Variables

Everything configurable about Express F&B comes from environment variables. This page lists every variable, whether it is required, its default, how it is validated, and what it actually changes.

> The template with sample values is [`.env.example`](../../.env.example). Copy it to `.env` and edit. Related: [Integrations guide](./integrations.md) (where to get the keys) · [Architecture overview](../architecture/overview.md#policies-are-domain-interfaces-configs-are-infrastructure)

## How configuration is loaded

1. `import "dotenv/config"` at the top of `src/app.ts` (and in `prisma.config.ts`) loads `.env` from the **current working directory**, so start the app from the project root. Variables already set in the real environment win over `.env`.
2. When the server starts, `DIContainer` constructs one `*EnvConfig` class per concern (`src/infrastructure/configs/`). Each reads its variables through a small helper (`env-reader.ts`) and validates them.
3. **The app fails fast.** A missing or invalid variable throws during startup, before the port is opened, with a message such as `JWT_ACCESS_SECRET is required`.

### Parsing rules (`env-reader.ts`)

| Type    | Behaviour                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------- |
| string  | An **empty value counts as missing**. Without a default the app refuses to start                                |
| number  | Must be numeric, otherwise `X must be a number`. An empty value uses the default if there is one                |
| boolean | Only the text `true` (any capitalisation) is true. Anything else, including `1`, `yes` and a typo, is **false** |
| list    | Comma-separated, whitespace trimmed, for example `ONLINE,DINEIN`                                                |

Quotes in `.env` (`BRAND_NAME="My Cafe"`) are removed by dotenv. Do not quote values in a real process environment unless you want the quotes included.

### Read outside the config classes

A few variables are read directly with `process.env`, so they are **not** validated at startup:

| Variable        | Default | Used for                                                                                                                                |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`          | `3000`  | HTTP port                                                                                                                               |
| `NODE_ENV`      | unset   | `production` makes cookies `secure` and changes logging (see [Logging](#logging)). The health endpoint reports `development` when unset |
| `BCRYPT_ROUNDS` | `12`    | Password hashing cost. **`.env.example` shows `10`, but the code default is `12`**: whichever you set wins, and leaving it out gives 12 |
| `CLIENT_URL`    | none    | Also used as the CORS origin in `app.ts`, in addition to being validated as a required config                                           |

## Quick reference: required variables

The app will not start without these (no default exists):

| Variable                                                                        | What it is                                         |
| ------------------------------------------------------------------------------- | -------------------------------------------------- |
| `BRAND_NAME`, `SUPPORT_EMAIL`, `BASE_URL`, `CLIENT_URL`                         | App identity                                       |
| `STORE_LOCATION_ADDRESS`, `STORE_LOCATION_LATITUDE`, `STORE_LOCATION_LONGITUDE` | Where delivery distance is measured from           |
| `DATABASE_URL`                                                                  | PostgreSQL connection string                       |
| `REDIS_HOST`                                                                    | Redis host                                         |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                                       | Token signing secrets, at least 32 characters each |
| `MIDTRANS_SERVER_KEY`, `MIDTRANS_SNAP_BASE_URL`, `MIDTRANS_CORE_API_BASE_URL`   | Payment gateway                                    |
| `EMAIL_USER`, `EMAIL_PASSWORD`                                                  | SMTP credentials                                   |
| `VERCEL_BLOB_READ_WRITE_TOKEN`                                                  | Image storage                                      |

Everything else has a default.

## Full reference

"Req." means required. Validation text is the rule enforced at startup.

### Application identity

| Variable        | Req. | Default | Notes                                                                                                                                                                                    |
| --------------- | ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BRAND_NAME`    | yes  |         | Shown in email templates                                                                                                                                                                 |
| `SUPPORT_EMAIL` | yes  |         | "Contact support" link in emails                                                                                                                                                         |
| `BASE_URL`      | yes  |         | Public URL of **this API**. Printed in the startup log as the health check link                                                                                                          |
| `CLIENT_URL`    | yes  |         | Public URL of the **frontend**. Used for the CORS origin and for every link inside emails. No trailing slash. See [Integrations: frontend contract](./integrations.md#frontend-contract) |

### Store and delivery

| Variable                   | Req. | Default | Validation | Notes                                                                        |
| -------------------------- | ---- | ------- | ---------- | ---------------------------------------------------------------------------- |
| `STORE_LOCATION_ADDRESS`   | yes  |         |            |                                                                              |
| `STORE_LOCATION_LATITUDE`  | yes  |         | numeric    | Origin point for delivery distance                                           |
| `STORE_LOCATION_LONGITUDE` | yes  |         | numeric    |                                                                              |
| `BASE_FEE`                 |      | `5000`  |            | Rupiah, charged for distances beyond the free radius up to the base coverage |
| `BASE_FEE_COVERS_UP_TO_KM` |      | `3`     |            | Distance the base fee covers                                                 |
| `FREE_DELIVERY_RADIUS_KM`  |      | `1`     |            | Within this distance delivery is free                                        |
| `MAX_DELIVERY_DISTANCE_KM` |      | `30`    |            | Beyond this the order is rejected                                            |
| `PER_KM_RATE_BEYOND_BASE`  |      | `1500`  |            | Rupiah per additional kilometre (rounded up)                                 |

> The config class has a `validate()` method for these five values, but it is never called, so negative numbers are **not** rejected. Double-check them by hand.

**How the delivery fee is calculated** (`DeliveryFeeCalculatorService`), with distance `d` in km:

| Condition                       | Fee                                                                       |
| ------------------------------- | ------------------------------------------------------------------------- |
| `d > MAX_DELIVERY_DISTANCE_KM`  | Order rejected (`DeliveryDistanceExceededException`)                      |
| `d <= FREE_DELIVERY_RADIUS_KM`  | `0`                                                                       |
| `d <= BASE_FEE_COVERS_UP_TO_KM` | `BASE_FEE`                                                                |
| otherwise                       | `BASE_FEE + ceil(d - BASE_FEE_COVERS_UP_TO_KM) × PER_KM_RATE_BEYOND_BASE` |

With the defaults: 0.8 km is free, 2.5 km costs 5,000, and 5.2 km costs 5,000 + ceil(2.2) × 1,500 = **9,500**. Pickup orders and orders without coordinates cost 0.

### Pricing

| Variable                          | Req. | Default         | Validation                                                     | Notes                                                                        |
| --------------------------------- | ---- | --------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `TAX_RATE_PERCENT`                |      | `11`            | 0 to 100                                                       |                                                                              |
| `SERVICE_CHARGE_RATE_PERCENT`     |      | `5`             | 0 to 100                                                       |                                                                              |
| `SERVICE_CHARGE_APPLICABLE_TYPES` |      | `ONLINE,DINEIN` | each must be an order type (`ONLINE`, `DINEIN`, `RESERVATION`) | Validated but **not used yet**: the service charge is applied to every order |

Order total = `subtotal + tax + service charge + delivery fee - discount`, where tax and service charge are each a percentage of the **subtotal**, rounded to the nearest whole rupiah. (The discount is currently always 0.)

### Orders

| Variable                                              | Req. | Default | Validation | Notes                                                                                                                                                           |
| ----------------------------------------------------- | ---- | ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MINIMUM_ORDER_QUANTITY`                              |      | `1`     | > 0        | Minimum total item count in one order                                                                                                                           |
| `ORDER_EXPIRY_IN_MINUTES`                             |      | `15`    | > 0        | Intended lifetime of an unpaid order. **Validated but not used yet**: no code expires orders, so unpaid orders stay `PENDING` until something else changes them |
| `MAX_RESEND_GUEST_ORDER_MANAGEMENT_ATTEMPTS_PER_HOUR` |      | `3`     | > 0        | Guest token re-issue limit                                                                                                                                      |
| `GUEST_ORDER_MANAGEMENT_RESEND_COOLDOWN_IN_SECONDS`   |      | `60`    | > 0        | Wait between re-issues                                                                                                                                          |
| `GUEST_ORDER_MANAGEMENT_TOKEN_EXPIRY_IN_HOURS`        |      | `24`    | > 0        | Lifetime of the guest `guestToken`                                                                                                                              |

### Authentication and sessions

| Variable                           | Req. | Default | Validation                             | Notes                                           |
| ---------------------------------- | ---- | ------- | -------------------------------------- | ----------------------------------------------- |
| `JWT_ACCESS_SECRET`                | yes  |         | at least 32 characters                 | Signs access tokens                             |
| `JWT_REFRESH_SECRET`               | yes  |         | at least 32 characters                 | Signs refresh tokens. Use a **different** value |
| `ACCESS_TOKEN_LIFETIME_MINUTES`    |      | `15`    | > 0                                    |                                                 |
| `REFRESH_TOKEN_LIFETIME_DAYS`      |      | `30`    | > 0, and must outlast the access token | Also the lifetime of the `refresh_token` cookie |
| `BCRYPT_ROUNDS`                    |      | `12`    | none                                   | Read directly, see above                        |
| `MAX_LOGIN_ATTEMPTS`               |      | `5`     | > 0                                    | Failed logins before the account locks          |
| `ACCOUNT_LOCK_DURATION_IN_MINUTES` |      | `5`     | > 0                                    |                                                 |

Generate strong secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> **Changing a JWT secret signs everyone out.** Existing access tokens stop verifying immediately, and a changed refresh secret invalidates every session's refresh token.

### Email flows

| Variable                                          | Req. | Default | Validation | Notes                                                |
| ------------------------------------------------- | ---- | ------- | ---------- | ---------------------------------------------------- |
| `VERIFICATION_EMAIL_EXPIRY_IN_HOURS`              |      | `24`    | > 0        |                                                      |
| `VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS`   |      | `60`    | none       |                                                      |
| `MAX_RESEND_VERIFICATION_EMAIL_ATTEMPTS_PER_HOUR` |      | `3`     | > 0        |                                                      |
| `PASSWORD_RESET_EXPIRY_IN_MINUTES`                |      | `15`    | > 0        |                                                      |
| `PASSWORD_RESET_RESEND_COOLDOWN_IN_SECONDS`       |      | `60`    | none       |                                                      |
| `PASSWORD_RESET_GRACE_PERIOD_IN_MS`               |      | `30000` | none       | Extra time an expired reset token remains acceptable |
| `MAX_RESEND_PASSWORD_RESET_ATTEMPTS_PER_HOUR`     |      | `3`     | > 0        |                                                      |

### Database

| Variable       | Req. | Default | Notes                                                                                                                                     |
| -------------- | ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | yes  |         | `postgresql://USER:PASSWORD@HOST:5432/DBNAME`. Used by the app **and** by `prisma migrate`. URL-encode special characters in the password |

### Redis

| Variable                      | Req. | Default | Validation                | Notes                                   |
| ----------------------------- | ---- | ------- | ------------------------- | --------------------------------------- |
| `REDIS_HOST`                  | yes  |         |                           |                                         |
| `REDIS_PORT`                  |      | `6379`  |                           |                                         |
| `REDIS_USERNAME`              |      | empty   | requires `REDIS_PASSWORD` |                                         |
| `REDIS_PASSWORD`              |      | empty   |                           |                                         |
| `REDIS_TLS`                   |      | `false` |                           | `true` enables TLS with default options |
| `REDIS_CONNECT_TIMEOUT_IN_MS` |      | `1000`  | > 0                       |                                         |
| `REDIS_MAX_RETRIES`           |      | `3`     | >= 0                      | Per-request retries                     |

The client is created with the offline queue **disabled**: while Redis is unreachable, commands fail immediately instead of waiting. That is intentional, so requests are not held up by a dead Redis, but it means rate limiting and the event queue degrade right away (see [Request lifecycle](../architecture/request-lifecycle.md#3-rate-limiting-ratelimitmiddleware) and [Event system](../architecture/events.md#delivery-guarantees-and-known-gaps)).

### Rate limiting

| Variable                           | Req. | Default    | Validation      | Notes                                                                                                           |
| ---------------------------------- | ---- | ---------- | --------------- | --------------------------------------------------------------------------------------------------------------- |
| `RATE_LIMIT_COOLDOWN_PERIOD_IN_MS` |      | `30000`    | > 0             | How long the rate limiter's circuit breaker stays open                                                          |
| `RATE_LIMIT_ERROR_STRATEGY`        |      | `allow`    | **not checked** | `allow` or `deny`: what to do when a check fails unexpectedly. Any value other than `deny` behaves like `allow` |
| `RATE_LIMIT_CIRCUIT_OPEN_STRATEGY` |      | `throttle` | **not checked** | `allow`, `deny` or `throttle` while the breaker is open. A typo falls back to `allow`                           |
| `RATE_LIMIT_SECURITY_ALERTS`       |      | `false`    |                 | Triggers an alert hook on failures. The hook itself is a TODO in code, so this currently has no visible effect  |

Per-route limits are not environment variables. They are constants in `src/presentation/rate-limit/policies/`.

### Payments (Midtrans)

| Variable                     | Req. | Default | Notes                                                                                                                       |
| ---------------------------- | ---- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `MIDTRANS_SERVER_KEY`        | yes  |         | Secret server key. Sandbox and production keys differ                                                                       |
| `MIDTRANS_IS_PRODUCTION`     |      | `false` | **Currently has no effect.** The code never reads it. Which environment you hit is decided only by the two URLs below       |
| `MIDTRANS_SNAP_BASE_URL`     | yes  |         | Full Snap endpoint the app POSTs to, **including `/transactions`**. See [Integrations](./integrations.md#midtrans-payments) |
| `MIDTRANS_CORE_API_BASE_URL` | yes  |         | Base for status and refund calls, for example `https://api.sandbox.midtrans.com/v2`                                         |

### Email (SMTP)

| Variable         | Req. | Default          | Notes                                                                                          |
| ---------------- | ---- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `EMAIL_HOST`     |      | `smtp.gmail.com` |                                                                                                |
| `EMAIL_PORT`     |      | `465`            | The client always uses implicit TLS (`secure: true`), so use a TLS-on-connect port such as 465 |
| `EMAIL_USER`     | yes  |                  | Login **and** the From address                                                                 |
| `EMAIL_PASSWORD` | yes  |                  | For Gmail this must be an app password                                                         |

### Image storage (Vercel Blob)

| Variable                                      | Req. | Default | Notes                                                                            |
| --------------------------------------------- | ---- | ------- | -------------------------------------------------------------------------------- |
| `VERCEL_BLOB_READ_WRITE_TOKEN`                | yes  |         | Token of your Blob store                                                         |
| `VERCEL_BLOB_CACHE_CONTROL_MAX_AGE_IN_MONTHS` |      | `12`    | Browser and CDN cache lifetime of uploaded images. A month is counted as 30 days |

### Event system tuning

See [Event system](../architecture/events.md) for what these mean.

| Variable                                    | Default | Validation | Effect                                  |
| ------------------------------------------- | ------- | ---------- | --------------------------------------- |
| `EVENT_BATCH_SIZE`                          | `20`    | > 0        | Flush the in-memory batch at this size  |
| `EVENT_BATCH_MAX_WAIT_TIME_IN_MS`           | `1000`  |            | ...or when the oldest event is this old |
| `EVENT_QUEUE_MAX_RETRIES`                   | `3`     |            | Retries on Redis queue operations       |
| `EVENT_QUEUE_PROCESSOR_BATCH_SIZE`          | `20`    | > 0        | Events processed per poll               |
| `EVENT_QUEUE_PROCESSOR_POLL_INTERVAL_IN_MS` | `5000`  | > 0        | Delay between polls                     |
| `EVENT_BATCH_FLUSH_INTERVAL_IN_MS`          | `1000`  |            | **Read but unused**                     |
| `EVENT_BATCH_MAX_RETRIES`                   | `3`     | >= 0       | **Read but unused**                     |
| `EVENT_BATCH_RETRY_DELAY_IN_MS`             | `1000`  |            | **Read but unused**                     |
| `EVENT_QUEUE_HEALTH_CHECK_INTERVAL`         | `1000`  |            | **Read but unused**                     |
| `EVENT_QUEUE_BATCH_TIMEOUT`                 | `1000`  |            | **Read but unused**                     |

## Logging

There is no log-level variable. Logging is decided by `NODE_ENV`:

|                             | `NODE_ENV=production`                                | anything else                 |
| --------------------------- | ---------------------------------------------------- | ----------------------------- |
| Console                     | `error` and above                                    | `debug` and above, colourised |
| `logs/app-YYYY-MM-DD.log`   | `info` and above, JSON, 20 MB per file, kept 14 days | same                          |
| `logs/error-YYYY-MM-DD.log` | `error` only, kept 30 days                           | same                          |

The `logs/` directory is created in the working directory and is git-ignored. If your hosting platform discards the filesystem between restarts, ship the console output elsewhere or write the logs to persistent storage. In production the console shows **errors only**, so look in the log files for warnings and the `DISPATCH_SUMMARY` lines described in the [Event system](../architecture/events.md#observability) doc.

> The logger's own default level is `warn` in production, while the file transports are configured explicitly at `info` and `error`. Winston applies a transport's explicit level over the logger default, so `info` lines should reach `app-*.log`. After your first deployment, confirm that `info` lines such as `DISPATCH_SUMMARY` really appear there. If they do not, lower the logger-level in `src/infrastructure/configs/winston-logger.config.ts`.

## Starter `.env` for local development

```dotenv
NODE_ENV=development
PORT=3000

BRAND_NAME="Express F&B (dev)"
SUPPORT_EMAIL="support@example.com"
BASE_URL="http://localhost:3000"
CLIENT_URL="http://localhost:5173"      # your frontend's dev URL

STORE_LOCATION_ADDRESS="Jl. Contoh No. 1, Jakarta"
STORE_LOCATION_LATITUDE=-6.2088
STORE_LOCATION_LONGITUDE=106.8456

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/fnb"

REDIS_HOST="localhost"
REDIS_PORT=6379

JWT_ACCESS_SECRET="<48+ random chars>"
JWT_REFRESH_SECRET="<a different 48+ random chars>"

MIDTRANS_SERVER_KEY="<sandbox server key>"
MIDTRANS_SNAP_BASE_URL="https://app.sandbox.midtrans.com/snap/v1/transactions"
MIDTRANS_CORE_API_BASE_URL="https://api.sandbox.midtrans.com/v2"

EMAIL_USER="<gmail address>"
EMAIL_PASSWORD="<gmail app password>"

VERCEL_BLOB_READ_WRITE_TOKEN="<blob token>"

RATE_LIMIT_SECURITY_ALERTS=false
```

Everything not listed uses its default. Use throwaway sandbox credentials locally and never reuse production secrets.

On Windows, create the file with `copy .env.example .env` and edit it in a code editor. Notepad often saves it as `.env.txt`, which is silently ignored. A Windows environment variable of the same name overrides the file.

## Keeping secrets safe

- `.env` and `.env.*.local` are in `.gitignore`. Check with `git status` before every commit.
- Never put real values in `.env.example`. It is the template and is committed.
- Production secrets belong in your hosting platform's secret store, not in files.
- If a secret leaks (a key pasted in a chat or committed by mistake), **rotate it** at the provider rather than just deleting it from history.

## Troubleshooting startup

| Message                                                                  | Cause                                                   | Fix                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `X is required`                                                          | Missing or empty required variable                      | Set it in `.env`, and make sure you started the app from the folder containing `.env` |
| `X must be a number`                                                     | Non-numeric value, often a stray quote or unit (`30km`) | Use a plain number                                                                    |
| `JWT_ACCESS_SECRET must be at least 32 chars`                            | Placeholder or short secret                             | Generate one with the command above                                                   |
| `REFRESH_TOKEN_LIFETIME_DAYS must outlast ACCESS_TOKEN_LIFETIME_MINUTES` | Refresh lifetime shorter than access lifetime           | Raise the refresh lifetime                                                            |
| `REDIS_PASSWORD is required when REDIS_USERNAME is set`                  | Username without password                               | Set both or neither                                                                   |
| `TAX_RATE_PERCENT must be between 0 and 100`                             | Percent out of range                                    | Use 0 to 100, for example `11`, not `0.11`                                            |
| `Invalid order type: ...`                                                | Typo in `SERVICE_CHARGE_APPLICABLE_TYPES`               | Use `ONLINE`, `DINEIN`, `RESERVATION` (upper case)                                    |
| `/health` returns `503`                                                  | Postgres or Redis unreachable                           | Check `DATABASE_URL`, `REDIS_HOST`/`PORT`/`TLS`, and that both services are running   |
| Browser blocks API calls with a CORS error                               | `CLIENT_URL` does not exactly match the frontend origin | Match scheme, host and port, with no trailing slash                                   |
| Emails never arrive                                                      | SMTP credentials or port wrong                          | See [Integrations: SMTP](./integrations.md#email-smtp)                                |
