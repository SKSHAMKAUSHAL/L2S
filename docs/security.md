# Security Architecture & Controls

This document details the security controls implemented in L2S as part of **Step 8: Security Hardening**, addressing every identified vulnerability and hardening the attack surface before public deployment.

---

## 1. Identified Vulnerabilities & Resolution Mapping

| Vulnerability Found | Severity | Resolution & Control Location |
|---|---|---|
| **OAuth State CSRF**<br>State was generated but unverified in callback | **High** | `src/security/pkce.js`<br>Session-bound state with 10-minute TTL, single-use consumption, and `crypto.timingSafeEqual`. PKCE S256 code verifier added. |
| **Weak Token Encryption**<br>Key derived from hostname/username with AES-CBC without integrity tag | **High** | `src/security/crypto.js`<br>Migrated to AES-256-GCM with 96-bit random nonce, 128-bit authentication tag, and 32-byte cryptographic key via `TOKEN_ENC_KEY`. Key rotation supported via `scripts/rotate_token_key.js`. |
| **yt-dlp Argument Injection & SSRF**<br>No URL validation, missing `--` argument separator, accepted flags starting with `-` | **Critical** | `src/security/url.js` & `src/downloader.js`<br>Strict URL parser with exact host whitelist (`youtube.com`, `youtu.be`, etc.), HTTPS enforcement, port and userinfo rejection. `--` prefix precedes all CLI targets. |
| **Downloader Insecure Certificates & Browser Probing**<br>Used `--no-check-certificates` and attempted Chrome DPAPI cookie access on server | **Medium** | `src/downloader.js`<br>Removed all `--no-check-certificates` and `--cookies-from-browser` strategies. Added `--no-playlist`, `--max-filesize`, `--socket-timeout 30`, `--retries 3`. |
| **Synchronous Blocking Metadata Fetch**<br>`/api/video-info` used `spawnSync` up to 30 seconds blocking event loop | **Medium** | `src/downloader.js` & `src/server.js`<br>Replaced with non-blocking `fetchVideoInfoAsync` using tracked child processes, 30s timeout, and memory buffer capping. |
| **Missing Rate Limits & HTTP Security**<br>No request limits, missing security headers, unconstrained body size | **High** | `src/server.js` & `src/security/rate_limit.js`<br>Added `helmet` with strict CSP (no `'unsafe-inline'` in `script-src`), disabled `x-powered-by`, 1MB payload limits, CORS origin lockdown, and layered rate limits. |
| **Credential & Token Leakage in Logs**<br>Sensitive tokens, session cookies, and API keys logged in plain text | **High** | `src/security/logger.js`<br>Structured Pino logging with redaction paths for cookies, auth headers, passwords, and tokens. Added request correlation IDs and sanitized 500 error responses. |
| **Supply Chain & Secret Exposure**<br>Secrets committed to git, unpinned dependencies | **Medium** | `scripts/check_secrets.js`, `.githooks/pre-commit`<br>Automated pre-commit secret scanner, npm audit review, and pinned yt-dlp versioning. |

---

## 2. Core Security Controls

### 2.1 URL Validation & SSRF Prevention (`src/security/url.js`)
- **Protocol**: Strictly `https:` (no `http:`, `file:`, `javascript:`, or data URIs).
- **Host Whitelist**: Exact match only: `youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`.
- **Injection Defense**: Rejects inputs starting with `-` (CLI flag injection), URLs exceeding 2048 chars, userinfo (`user:pass@host`), and custom ports.
- **Normalization**: Canonicalizes video ID into `https://www.youtube.com/watch?v=<id>` and rejects playlist URLs or query parameters.

### 2.2 Process Sandboxing & Command Safety (`src/process_manager.js`, `src/downloader.js`)
- All child processes spawned with `shell: false`. No string interpolation into shell commands.
- Process tracking keyed by `jobId` for instant tree termination (`killJobProcesses`).
- Explicit argument array with `--` before user targets.
- Output buffer capping at 10 MB to prevent process out-of-memory crashes.

### 2.3 HTTP Hardening & Rate Limiting (`src/security/rate_limit.js`, `src/server.js`)
- **Headers**: `helmet` enforces `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and strict CSP without `'unsafe-inline'` scripts.
- **Rate Limits**:
  - `loginLimiter`: 10 requests per 15 minutes.
  - `registerLimiter`: 5 registrations per hour.
  - `jobCreationLimiter`: 10 jobs per hour for free plan.
  - `generalLimiter`: 300 requests per 15 minutes.
- **CORS**: Closed by default; respects `APP_ORIGIN` environment variable.
- **Proxy Configuration**: `app.set('trust proxy', 1)` for trusted Caddy reverse proxy headers.

### 2.4 OAuth 2.0 PKCE & Session-Bound State (`src/security/pkce.js`)
- Generates cryptographically random 32-byte `code_verifier` and S256 `code_challenge`.
- Random 64-hex state is tied to the user's session with a 10-minute expiration window.
- Verification uses `crypto.timingSafeEqual` and deletes the state on first access (single-use).

### 2.5 AES-256-GCM Token Encryption (`src/security/crypto.js`)
- Secret keys loaded from `TOKEN_ENC_KEY` (base64 32 bytes). Refuses startup in production if missing or malformed.
- Authenticated encryption format: `{ v: 1, kid, nonce, tag, ciphertext }`.
- Nonce generated via `crypto.randomBytes(12)` per encryption.
- Key rotation supported via `scripts/rotate_token_key.js`.

### 2.6 Pinned Dependencies & Tool Versions
- **Node.js**: 20 LTS (Bookworm slim).
- **yt-dlp**: Pinned version `2025.02.19` (or newer stable pinned release).
- **helmet**: `^8.0.0`
- **express-rate-limit**: `^7.5.0`
- **pino**: `^9.6.0`
