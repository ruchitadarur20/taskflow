# Security

## Authentication And Sessions

TaskFlow uses short-lived JWT access tokens and rotating refresh tokens.
Passwords are hashed with Argon2. Refresh tokens are generated with secure
random bytes, stored only as SHA-256 hashes, and rotated on every refresh.

If a revoked refresh token is reused, TaskFlow revokes the remaining active
tokens in that token family and requires reauthentication. Logout revokes the
presented refresh token.

Known limitation: the frontend stores access and refresh tokens in
`localStorage`. This keeps the current API simple, but any future XSS bug would
have higher impact because browser script could read tokens. A later session
architecture can move refresh tokens to secure, HTTP-only cookies.

## RBAC

Workspace roles are enforced in backend services, not only in route handlers or
frontend controls. The same workspace/project authorization checks are reused
for REST endpoints and WebSocket subscriptions.

## Rate Limiting

Redis-backed fixed-window rate limiting protects login, registration, refresh,
and WebSocket connection attempts. Limiter keys include the operation name and a
hash of the client address; they do not include passwords, JWTs, refresh tokens,
emails, or raw credentials.

If Redis is unavailable, the limiter currently fails open by default so users
can still authenticate during a limiter outage. Readiness reports Redis failure
separately.

## CORS And Trusted Hosts

CORS allowed origins and trusted hosts are configured through settings. Localhost
origins remain the development default. In production, TaskFlow rejects
localhost-only CORS settings, wildcard CORS origins, wildcard trusted hosts, and
localhost-only trusted hosts.

## Security Headers

The API adds these application-level headers:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY`
- `Content-Security-Policy: frame-ancestors 'none'`

HSTS and frontend CSP should be finalized with the production TLS terminator and
static-asset host in Milestone 11.

## WebSockets

The frontend requests a short-lived, one-time WebSocket ticket from
`POST /auth/ws-ticket` using its normal bearer token. The raw ticket is returned
once, stored only as a SHA-256-derived Redis key with a quick expiry, and
consumed with `GET /ws?ticket=...` during the WebSocket handshake. Replays and
expired tickets are rejected.

Explicit browser `Origin` headers must match configured CORS origins. Workspace
and project subscriptions are authorized before a socket is added to a channel.

Backward compatibility: `GET /ws?token=...` still accepts an access token for
older clients and tests. Production clients should use WebSocket tickets because
query strings may be captured by proxy or access logs.

## Secrets Policy

Real secrets must not be committed. `.env` and `.env.*` are ignored except for
`.env.example`. `JWT_SECRET_KEY` is required and placeholder values are rejected.
