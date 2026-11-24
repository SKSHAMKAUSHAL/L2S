# YouTube Integration Notes & Policy Verification

This document verifies the technical facts, constraints, and security requirements against official Google OAuth 2.0 and YouTube Data API v3 policies as of 2024–2026.

---

## 1. Official Documentation References

- **Google OAuth 2.0 for Web Server Applications**:
  [https://developers.google.com/identity/protocols/oauth2/web-server](https://developers.google.com/identity/protocols/oauth2/web-server)
- **YouTube Data API v3 - videos.insert**:
  [https://developers.google.com/youtube/v3/docs/videos/insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- **Resumable Media Uploads Protocol**:
  [https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
- **YouTube Data API Quotas & Costs**:
  [https://developers.google.com/youtube/v3/determine_quota_cost](https://developers.google.com/youtube/v3/determine_quota_cost)
- **OAuth API Verification FAQ & Unverified Apps**:
  [https://support.google.com/cloud/answer/7454865](https://support.google.com/cloud/answer/7454865)
- **YouTube Developer Policies & Terms of Service**:
  [https://developers.google.com/youtube/terms/developer-policies](https://developers.google.com/youtube/terms/developer-policies)

---

## 2. Quota Costs & Economic Realities

### API Unit Cost
- A call to `videos.insert` has a fixed cost of **1,600 quota units**.
- Default daily project quota granted by Google Cloud is **10,000 units/day**.
- **Calculated capacity**:
  $$\lfloor 10,000 / 1,600 \rfloor = 6 \text{ uploads per day across the ENTIRE application}$$
- Attempting a 7th upload returns HTTP 403 with reason `quotaExceeded`.
- Quota counter resets daily at **Midnight Pacific Time** (`America/Los_Angeles`, PST UTC-8 or PDT UTC-7).
- **Quota Extension**: Commercial deployment requires submitting the YouTube API Services Quota Extension Form and completing an audit with Google. Until granted, the application enforces app-wide quota reservations and per-user daily caps (free plan: 2 uploads/day; paid plan: 10 uploads/day when quota allows).

---

## 3. Scope Minimization & Consent Verification

### Required Scopes
- `https://www.googleapis.com/auth/youtube.upload` (Sensitive scope: upload videos and manage video status)
- `openid` (Identity verification)
- `email` (User contact and verification)
- `profile` (User display name and avatar)

### Avoidance of `youtube.readonly`
- **Confirmed**: `youtube.readonly` is **NOT required** for uploading videos or setting video snippet/status metadata during `videos.insert`.
- In legacy code, `youtube.readonly` was requested solely to fetch the channel title via `channels.list(mine=true)`.
- Requesting `youtube.readonly` adds a second sensitive scope, triggering deeper audit scrutiny during Google verification.
- Instead, the application retrieves the user's name directly from the standard OpenID Connect `userinfo` endpoint (`https://www.googleapis.com/oauth2/v2/userinfo` or ID token).
- Therefore, `youtube.readonly` is completely removed from our requested scopes.

---

## 4. Privacy Status & Unverified App Restrictions

- **Unverified App Policy**: When an OAuth client is in "Testing" mode or unverified, uploaded videos are forced by YouTube to `private` privacy status, regardless of whether `public` or `unlisted` was requested in the upload payload.
- Default privacy in our application is configured via `process.env.YT_DEFAULT_PRIVACY || 'private'`.
- The user interface displays a prominent notice:
  > *"Until our app passes Google's verification, YouTube may keep uploads private."*
- **Post-Upload Status Check**: Calling `videos.list(part=status)` requires additional permissions not available under the upload-only scope. The application reads `privacyStatus` directly from the resource returned in the response of `videos.insert`.

---

## 5. Resumable Upload Architecture

### Chunk Sizing
- Google requires upload chunks to be multiples of **256 KB** ($256 \times 1024 = 262,144$ bytes).
- Our chunk size is **8 MB** ($8 \times 1024 \times 1024 = 8,388,608$ bytes, exactly 32 multiples of 256 KB).
- Uploading is performed using streaming `fs.createReadStream(path, { start, end })` rather than buffering the entire file into Node.js heap memory, ensuring RSS memory growth remains flat (< 100 MB).

### Disconnect & Resume Flow
1. **Initiate**: Send metadata to Google's resumable upload endpoint, receiving a unique session `Location` URL.
2. **Chunk PUT**: Upload 8 MB slices with `Content-Range: bytes start-end/totalSize`.
   - Intermediate response: `HTTP 308 Resume Incomplete` with `Range: bytes=0-X`.
   - Final response: `HTTP 200 OK` or `HTTP 201 Created` with video resource JSON.
3. **Recovery**: If a network drop or timeout occurs:
   - Query status via `PUT uploadUrl` with `Content-Length: 0` and `Content-Range: bytes */totalSize`.
   - Google responds with `HTTP 308` and the last byte received (`Range: bytes=0-Y`).
   - Resume immediately from byte `Y + 1`.
   - Retry up to 3 times per chunk with exponential backoff before failing.
