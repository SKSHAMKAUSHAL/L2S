/**
 * tests/helpers/fake_google_server.js
 * In-process mock Google OAuth 2.0 & YouTube API server.
 */

import http from 'node:http';

export function createFakeGoogleServer(options = {}) {
  let tokenRefreshHandler = null;
  let simulateDropOnChunk = null; // e.g. 2 for dropping chunk 2
  let dropOccurred = false;
  let uploadQuotaExceeded = false;
  let uploadLimitExceeded = false;
  let bytesReceivedBySession = new Map();
  let receivedMetadata = null;
  let revokedTokens = [];
  let tokenRequests = [];

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // ── 1. OAuth Token Endpoint ──
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        tokenRequests.push(Object.fromEntries(params.entries()));

        const grantType = params.get('grant_type');

        if (grantType === 'authorization_code') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            access_token: 'fake_access_token_' + Date.now(),
            refresh_token: 'fake_refresh_token_' + Date.now(),
            expires_in: 3600,
            token_type: 'Bearer',
            scope: params.get('scope') || 'https://www.googleapis.com/auth/youtube.upload',
          }));
        }

        if (grantType === 'refresh_token') {
          if (tokenRefreshHandler) {
            return tokenRefreshHandler(params, res);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            access_token: 'fake_refreshed_access_token_' + Date.now(),
            expires_in: 3600,
            token_type: 'Bearer',
          }));
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
      });
      return;
    }

    // ── 2. Userinfo Endpoint ──
    if (url.pathname === '/userinfo' && req.method === 'GET') {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        id: 'google_user_123',
        name: 'Test Creator Channel',
        email: 'creator@example.com',
      }));
    }

    // ── 3. Revoke Token Endpoint ──
    if (url.pathname === '/revoke' && req.method === 'POST') {
      const token = url.searchParams.get('token');
      revokedTokens.push(token);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    }

    // ── 4. Resumable Upload Initiation Endpoint ──
    if (url.pathname === '/upload/init' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          receivedMetadata = JSON.parse(body);
        } catch {
          receivedMetadata = body;
        }

        if (uploadQuotaExceeded) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            error: {
              code: 403,
              message: 'The request cannot be completed because you have exceeded your quota.',
              errors: [{ reason: 'quotaExceeded' }],
            },
          }));
        }

        if (uploadLimitExceeded) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            error: {
              code: 403,
              message: 'The user has exceeded the number of videos they may upload.',
              errors: [{ reason: 'uploadLimitExceeded' }],
            },
          }));
        }

        const sessionId = 'session_' + Math.random().toString(36).substring(2, 9);
        bytesReceivedBySession.set(sessionId, 0);

        const serverPort = server.address().port;
        const locationUrl = `http://localhost:${serverPort}/upload/session/${sessionId}`;
        res.writeHead(200, {
          Location: locationUrl,
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ status: 'initiated' }));
      });
      return;
    }

    // ── 5. Chunk PUT & Status Query Endpoint ──
    if (url.pathname.startsWith('/upload/session/')) {
      const sessionId = url.pathname.split('/').pop();
      const contentRange = req.headers['content-range'] || '';

      // Status query: Content-Range: bytes */total
      if (contentRange.startsWith('bytes */')) {
        const received = bytesReceivedBySession.get(sessionId) || 0;
        res.writeHead(308, {
          Range: `bytes=0-${received > 0 ? received - 1 : 0}`,
        });
        return res.end();
      }

      // Chunk upload: bytes start-end/total
      const match = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (!match) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Invalid Content-Range');
      }

      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      const total = parseInt(match[3], 10);
      const chunkNumber = Math.floor(start / (8 * 1024 * 1024)) + 1;

      // Check simulated drop
      if (simulateDropOnChunk && chunkNumber === simulateDropOnChunk && !dropOccurred) {
        dropOccurred = true;
        // Destroy connection abruptly to simulate drop
        req.socket.destroy();
        return;
      }

      let receivedBytes = 0;
      req.on('data', chunk => {
        receivedBytes += chunk.length;
      });

      req.on('end', () => {
        bytesReceivedBySession.set(sessionId, end + 1);

        if (end + 1 >= total) {
          // Final chunk received
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            id: 'yt_vid_success_123',
            snippet: receivedMetadata?.snippet || {},
            status: {
              privacyStatus: receivedMetadata?.status?.privacyStatus || 'private',
            },
          }));
        } else {
          // Intermediate chunk received
          res.writeHead(308, {
            Range: `bytes=0-${end}`,
          });
          return res.end();
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  return {
    server,
    async start() {
      await new Promise(resolve => server.listen(0, resolve));
      const port = server.address().port;
      const baseUrl = `http://localhost:${port}`;
      return {
        port,
        baseUrl,
        authUrl: `${baseUrl}/auth`,
        tokenUrl: `${baseUrl}/token`,
        userinfoUrl: `${baseUrl}/userinfo`,
        revokeUrl: `${baseUrl}/revoke`,
        uploadUrl: `${baseUrl}/upload/init`,
      };
    },
    async stop() {
      await new Promise(resolve => server.close(resolve));
    },
    setTokenRefreshHandler(fn) {
      tokenRefreshHandler = fn;
    },
    setSimulateDropOnChunk(chunkNum) {
      simulateDropOnChunk = chunkNum;
      dropOccurred = false;
    },
    setUploadQuotaExceeded(val) {
      uploadQuotaExceeded = val;
    },
    setUploadLimitExceeded(val) {
      uploadLimitExceeded = val;
    },
    getRevokedTokens() {
      return [...revokedTokens];
    },
    getTokenRequests() {
      return [...tokenRequests];
    },
    getReceivedMetadata() {
      return receivedMetadata;
    },
  };
}
