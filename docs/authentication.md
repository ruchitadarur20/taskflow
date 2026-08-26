# Authentication

TaskFlow authentication is implemented as a FastAPI domain module backed by PostgreSQL.
It intentionally includes only account and session management for this milestone.

## Architecture

- `users` stores identity, display name, status, password hash, and timestamps.
- `refresh_tokens` stores hashed opaque refresh tokens, token family metadata, expiration, rotation links, and revocation state.
- Route handlers live in `app/api/auth.py`.
- Auth business rules live in `app/domains/auth/service.py`.
- Password, JWT, and token hashing helpers live in `app/domains/auth/security.py`.
- Protected routes depend on `get_current_user`, which validates a bearer access token and loads an active user.

## Token Lifecycle

1. Registration or login returns a short-lived JWT access token and an opaque refresh token.
2. The access token is sent as `Authorization: Bearer <token>` to protected API routes.
3. The refresh token is sent only to `/auth/refresh` or `/auth/logout`.
4. A successful refresh revokes the presented refresh token with reason `rotated` and creates a replacement in the same `family_id`.
5. The old row points to the replacement through `replaced_by_token_id`.
6. If an already revoked refresh token is presented again, TaskFlow treats it as reuse and revokes the remaining active tokens in that family.
7. Logout revokes the presented refresh token. Unknown refresh tokens return success so logout remains idempotent.

## Security Decisions

- Passwords are hashed with Argon2id via `argon2-cffi`.
- Plaintext passwords are never stored.
- Refresh tokens are random opaque values and only SHA-256 hashes are stored.
- JWT access tokens include `sub`, `type`, `exp`, `iat`, and `jti` claims.
- Access tokens expire after `ACCESS_TOKEN_EXPIRES_MINUTES`.
- Refresh tokens expire after `REFRESH_TOKEN_EXPIRES_DAYS`.
- The JWT signing key is provided through `JWT_SECRET_KEY`; no production secret is committed.
- Login failures return a generic `Invalid credentials` response.
- Refresh-token reuse revokes the token family to limit replay impact.

## Environment Variables

- `JWT_SECRET_KEY`: required, at least 32 characters. Use a high-entropy secret in every environment.
- `ACCESS_TOKEN_EXPIRES_MINUTES`: optional, defaults to `15`.
- `REFRESH_TOKEN_EXPIRES_DAYS`: optional, defaults to `30`.
- `DATABASE_URL`: SQLAlchemy database URL.
- `REDIS_URL`: Redis URL for infrastructure readiness and later milestones.

Copy `.env.example` to `.env` for local development and replace `JWT_SECRET_KEY` with a generated value.

## Endpoints

- `POST /auth/register`: creates an active user and returns token pair plus user profile. Duplicate email returns `409`.
- `POST /auth/login`: verifies credentials and returns a token pair. Invalid credentials return `401`.
- `POST /auth/refresh`: rotates a refresh token and returns a new token pair. Invalid, expired, revoked, or replayed tokens return `401`.
- `POST /auth/logout`: revokes the supplied refresh token and returns `200`.
- `GET /auth/me`: returns the current user for a valid bearer access token. Missing or invalid access tokens return `401`.

## Local Testing

From `backend/`:

```bash
JWT_SECRET_KEY=test-secret-key-with-at-least-thirty-two-characters pytest
JWT_SECRET_KEY=test-secret-key-with-at-least-thirty-two-characters ruff check .
JWT_SECRET_KEY=test-secret-key-with-at-least-thirty-two-characters mypy app tests
```

With Docker running from the repository root:

```bash
docker compose up -d postgres redis
cd backend
JWT_SECRET_KEY=local-development-secret-with-32-characters DATABASE_URL=postgresql+psycopg://taskflow:taskflow_dev_password@localhost:5432/taskflow alembic upgrade head
cd ..
docker compose up -d
```
