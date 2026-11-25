// ═══════════════════════════════════════════
// SKATE v2 — Frontend Logic (Overhauled)
// ═══════════════════════════════════════════

// ─── Production-Grade Resilient CSRF Interceptor ────────────
let csrfTokenMemory = null;

function getCsrfToken() {
  // 1. Synchronously read standard XSRF-TOKEN cookie
  if (typeof document !== 'undefined' && document.cookie) {
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
    if (match && match[1]) {
      const decoded = decodeURIComponent(match[1]).trim();
      if (decoded) {
        csrfTokenMemory = decoded;
        return decoded;
      }
    }
  }
  // 2. Read from localStorage
  try {
    const local = localStorage.getItem('l2s_csrf_token');
    if (local && local.trim()) {
      csrfTokenMemory = local.trim();
      return csrfTokenMemory;
    }
  } catch (e) {}

  return csrfTokenMemory || null;
}

function updateStoredCsrfToken(newToken) {
  if (!newToken || typeof newToken !== 'string') return;
  const clean = newToken.trim();
  csrfTokenMemory = clean;
  try {
    localStorage.setItem('l2s_csrf_token', clean);
  } catch (e) {}
  try {
    if (typeof document !== 'undefined') {
      document.cookie = `XSRF-TOKEN=${encodeURIComponent(clean)}; path=/; SameSite=Lax`;
    }
  } catch (e) {}
}

// Bind original fetch to window to prevent 'Illegal invocation' exceptions in Chrome/WebKit
const originalFetch = window.fetch ? window.fetch.bind(window) : null;

window.fetch = async function (resource, init = {}) {
  const method = (init && init.method ? init.method : 'GET').toUpperCase();

  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    init = init || {};
    init.headers = init.headers || {};
    const token = getCsrfToken();

    if (token) {
      if (init.headers instanceof Headers) {
        if (!init.headers.has('x-csrf-token')) {
          init.headers.set('x-csrf-token', token);
        }
      } else if (Array.isArray(init.headers)) {
        const idx = init.headers.findIndex(([k]) => k.toLowerCase() === 'x-csrf-token');
        if (idx >= 0) init.headers[idx][1] = token;
        else init.headers.push(['x-csrf-token', token]);
      } else {
        delete init.headers['X-CSRF-Token'];
        delete init.headers['X-Csrf-Token'];
        delete init.headers['x-xsrf-token'];
        delete init.headers['X-XSRF-Token'];
        init.headers['x-csrf-token'] = token;
      }
    }
  }

  let response = await originalFetch(resource, init);

  // Transparent auto-recovery: If 403 CSRF error occurs, heal token and retry once
  if (response.status === 403 && typeof resource === 'string' && resource.startsWith('/api/') && !resource.startsWith('/api/auth/csrf')) {
    try {
      const cloned = response.clone();
      const errData = await cloned.json().catch(() => ({}));
      const isCsrfErr = (errData && errData.code === 'CSRF_INVALID') ||
                        (errData && errData.error && errData.error.toLowerCase().includes('csrf'));

      if (isCsrfErr) {
        let freshToken = errData.csrfToken || null;
        if (!freshToken) {
          const csrfRes = await originalFetch('/api/auth/csrf', { credentials: 'same-origin' });
          if (csrfRes.ok) {
            const csrfJson = await csrfRes.json().catch(() => ({}));
            freshToken = csrfJson.csrfToken;
          }
        }

        if (freshToken) {
          updateStoredCsrfToken(freshToken);

          if (init.headers instanceof Headers) {
            init.headers.set('x-csrf-token', freshToken);
          } else if (Array.isArray(init.headers)) {
            const idx = init.headers.findIndex(([k]) => k.toLowerCase() === 'x-csrf-token');
            if (idx >= 0) init.headers[idx][1] = freshToken;
            else init.headers.push(['x-csrf-token', freshToken]);
          } else {
            delete init.headers['X-CSRF-Token'];
            delete init.headers['X-Csrf-Token'];
            delete init.headers['x-xsrf-token'];
            delete init.headers['X-XSRF-Token'];
            init.headers['x-csrf-token'] = freshToken;
          }
          response = await originalFetch(resource, init);
        }
      }
    } catch (e) {
      // Return original response
    }
  }

  return response;
};

// ─── DOM Elements ────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  // Hero / Input
  heroSection: $('#hero-section'),
  form: $('#process-form'),
  sourceInput: $('#source-input'),
  genreSelect: $('#genre-select'),
  languageSelect: $('#language-select'),
  captionStyleSelect: $('#caption-style-select'),
  generateBtn: $('#generate-btn') || $('#process-btn'),
  stopBtn: $('#stop-btn'),
  inputHint: $('#input-hint'),
  // Save Path
  savePathInput: $('#save-path-input'),
  savePathSet: $('#save-path-set'),
  // Video Info
  videoInfoCard: $('#video-info-card'),
  videoThumb: $('#video-thumb'),
  videoTitle: $('#video-title'),
  videoChannel: $('#video-channel'),
  videoDuration: $('#video-duration'),
  videoViews: $('#video-views'),
  videoInfoClose: $('#video-info-close'),
  // Workspace
  workspaceSection: $('#workspace-section'),
  workspaceVideoContainer: $('#workspace-video-container'),
  workspaceVideoPlaceholder: $('#workspace-video-placeholder'),
  workspaceYtIframe: $('#workspace-yt-iframe'),
  workspaceLocalVideo: $('#workspace-local-video'),
  ytEmbedNotice: $('#yt-embed-notice'),
  btnToggleYtPoster: $('#btn-toggle-yt-poster'),
  btnYtNoticeExternal: $('#btn-yt-notice-external'),
  workspaceYtPoster: $('#workspace-yt-poster'),
  ytPosterImg: $('#yt-poster-img'),
  ytPosterPlayBtn: $('#yt-poster-play-btn'),
  // Pipeline
  pipelineSection: $('#pipeline-section') || $('#progress-section'),
  pipelineTimer: $('#pipeline-timer'),
  terminal: $('#terminal'),
  clearTerminal: $('#clear-terminal'),
  // Review
  reviewSection: $('#review-section'),
  reviewGrid: $('#review-grid'),
  reviewLanguage: $('#review-language'),
  selectAllBtn: $('#select-all-btn'),
  renderSelectedBtn: $('#render-selected-btn'),
  selectedCount: $('#selected-count'),
  // Results
  resultsSection: $('#results-section'),
  resultsList: $('#results-list'),
  downloadAllBtn: $('#download-all-btn'),
  newVideoBtn: $('#new-video-btn'),
  // Status
  statusSection: $('#status-section'),
  statusGrid: $('#status-grid'),
  recheckBtn: $('#recheck-deps'),
  statusHint: $('#status-hint'),
  // Header
  connectionDot: $('#connection-dot'),
  connectionText: $('#connection-text'),
  // Toast
  toastContainer: $('#toast-container'),
  // Editor Modal
  editorModal: $('#editor-modal'),
  editorCloseBtn: $('#editor-close'),
  editorCancelBtn: $('#editor-cancel'),
  editorSaveBtn: $('#editor-save'),
  editorVideo: $('#editor-video'),
  editorCanvasContainer: $('#editor-canvas-container'),
  editorStart: $('#editor-start'),
  editorEnd: $('#editor-end'),
  editorZoom: $('#editor-zoom'),
  editorExposure: $('#editor-exposure'),
  editorContrast: $('#editor-contrast'),
  editorSaturation: $('#editor-saturation'),
  editorSharpen: $('#editor-sharpen'),
  editorCaptionsToggle: $('#editor-captions-toggle'),
  editorValLength: $('#editor-val-length'),
  editorValZoom: $('#editor-val-zoom'),
  editorValExposure: $('#editor-val-exposure'),
  editorValContrast: $('#editor-val-contrast'),
  editorValSaturation: $('#editor-val-saturation'),
  editorValSharpen: $('#editor-val-sharpen'),
  editorValRatio: $('#editor-val-ratio'),
  editorValCaptions: $('#editor-val-captions'),
  // Caption Studio & Comparison View
  editorViewModeToggle: $('#editor-view-mode-toggle'),
  stageViewB: $('#stage-view-b'),
  editorVideoB: $('#editor-video-b'),
  editorCaptionBoxB: $('#editor-caption-box-b'),
  editorCaptionOverlayB: $('#editor-caption-overlay-b'),
  editorComparePresetSelect: $('#editor-compare-preset-select'),
  btnUseStyleB: $('#btn-use-style-b'),
  stageBadgeAText: $('#stage-badge-a-text'),
  editorMarginV: $('#editor-margin-v'),
  editorMarginVVal: $('#editor-margin-v-val'),
  editorSafeZoneStatus: $('#editor-safe-zone-status'),
  editorApplyAllBtn: $('#editor-apply-all'),
  // Volume Controls
  volumeToggle: $('#volume-toggle'),
  volumeSlider: $('#volume-slider'),
  // Ratio Selector
  ratioSelector: $('#ratio-selector'),
  // Advanced Options (now in workspace)
  timestampRows: $('#timestamp-rows'),
  btnAddTs: $('#btn-add-ts'),
  tsStart: $('#ts-start'),
  tsEnd: $('#ts-end'),
  tsAddBtn: $('#ts-add-btn'),
  tsChipList: $('#ts-chip-list'),
  tsOnlyToggle: $('#ts-only-toggle'),
  tsModeToggle: $('#ts-mode-toggle'),
  // Publish Section
  publishSection: $('#publish-section'),
  btnConnectIg: $('#btn-connect-ig'),
  btnConnectYt: $('#btn-connect-yt'),
  igStatus: $('#ig-status'),
  ytStatus: $('#yt-status'),
  btnPublish: $('#btn-publish'),
  // Pre-Generate Ratio & Zoom
  preGenPreview: $('#pre-gen-preview'),
  preGenOverlay: $('#pre-gen-overlay'),
  preGenLabel: $('#pre-gen-label'),
  preGenRatioBtns: $('#pre-gen-ratio-btns'),
  preGenZoom: $('#pre-gen-zoom'),
  preGenZoomVal: $('#pre-gen-zoom-val'),
  qualitySelectorBtns: $('#quality-selector-btns'),
  // Error panel
  errorPanel: $('#error-panel'),
  errorPanelTitle: $('#error-panel-title'),
  errorPanelMsg: $('#error-panel-msg'),
  errorPanelFix: $('#error-panel-fix'),
  errorPanelActions: $('#error-panel-actions'),
  errorPanelClose: $('#error-panel-close'),
};

// ─── State ───────────────────────────────────
let selectedClips = new Set();
let allClips = [];
let renderedFiles = [];
let pipelineTimerInterval = null;
let pipelineStartTime = null;
let detectedLanguage = 'unknown';
let videoInfoTimeout = null;
let currentEditorRatio = '9:16';
let editorReRenderIndex = -1;
let customOutputDir = '';
let currentVideoTitle = '';
let preGenRatio = '9:16';
let preGenReframeMode = 'auto';
let preGenZoom = 1.0;
let clipCount = 'auto';
let videoQuality = 'best'; // Video download quality profile
let exportQuality = 'balanced'; // Export encoding profile
let currentCaptionPreset = 'hormozi'; // Active selected caption preset
let comparisonCaptionPreset = 'karaoke'; // Side-by-side comparison preset
let captionCustomSettings = {
  fontFamily: 'Montserrat',
  fontSize: 38,
  textColor: '#ffffff',
  highlightColor: '#fee440',
  bottomMargin: 140,
  wordsPerLine: 'short',
  captionsEnabled: true
};

// ✅ NEW: Session tracking
let currentSessionId = generateSessionId();
let pipelineRunning = false;

function generateSessionId() {
  // Create unique session ID per page load
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function saveSessionId() {
  localStorage.setItem('l2s_session_id', currentSessionId);
}

async function restoreSessionId() {
  const saved = localStorage.getItem('l2s_session_id');
  if (saved) {
    try {
      // Check if session is still active
      const statusRes = await fetch(`/api/session-status/${saved}`);
      if (statusRes.ok) {
        const data = await statusRes.json();
        if (data.active && data.state === 'running') {
          // Session still running, warn user
          showToast('⚠️ Previous pipeline still running. Click Stop or wait.', 'warning');
          // Don't reuse this session ID
          currentSessionId = generateSessionId();
        }
      }
    } catch (e) {
      // Server unreachable, safe to use new session
      currentSessionId = generateSessionId();
    }
  }
  return currentSessionId;
}

// On page load
window.addEventListener('load', async () => {
  await restoreSessionId();
  saveSessionId();
});

// ─── Save session on unload ──────────────
window.addEventListener('beforeunload', () => {
  if (pipelineRunning) {
    // Use navigator.sendBeacon for reliability
    navigator.sendBeacon('/api/stop', JSON.stringify({ sessionId: currentSessionId }));
  }
});

// ─── WebSocket ───────────────────────────────
let socket = null;
let reconnectTimeout = null;

function connectWebSocket() {
  if (!window.location.host) return; // Prevent connecting if opened via file:// protocol
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  try {
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    socket.onopen = () => {
      if (els.connectionDot) els.connectionDot.className = 'status-dot connected';
      if (els.connectionText) els.connectionText.textContent = 'Connected';
    };

    socket.onclose = () => {
      if (els.connectionDot) els.connectionDot.className = 'status-dot disconnected';
      if (els.connectionText) els.connectionText.textContent = 'Disconnected';
      clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = () => {
      if (els.connectionDot) els.connectionDot.className = 'status-dot disconnected';
      if (els.connectionText) els.connectionText.textContent = 'Disconnected';
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (err) {
        console.warn('Malformed WS message:', err);
      }
    };
  } catch (e) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connectWebSocket, 3000);
  }
}

connectWebSocket();

// ─── Message Handler ─────────────────────────
function handleMessage(data) {
  switch (data.type) {
    case 'log':
      appendLog(data.msg, data.level || 'info');
      break;

    case 'started':
      appendLog('🚀 Video processing pipeline started...', 'info');
      break;

    case 'progress':
      if (data.msg) appendLog(data.msg, 'info');
      break;

    case 'completed':
      stopTimer();
      pipelineRunning = false;
      setProcessingState(false);
      appendLog('✅ Video processing completed successfully!', 'success');
      break;

    case 'failed':
      stopTimer();
      pipelineRunning = false;
      setProcessingState(false);
      appendLog(`❌ Processing failed: ${data.error || data.msg || 'Unknown error'}`, 'error');
      showToast(`Processing failed: ${data.error || data.msg || 'Unknown error'}`, 'error');
      break;

    case 'cancelled':
      stopTimer();
      pipelineRunning = false;
      setProcessingState(false);
      appendLog('🛑 Pipeline cancelled.', 'warning');
      showToast('Pipeline cancelled', 'info');
      break;

    case 'step':
      updateStep(data.step, data.status);
      // When download completes, switch to local video
      if (data.step === 'download' && data.status === 'done') {
        switchToLocalVideo();
      }
      break;

    case 'language':
      detectedLanguage = data.language || 'unknown';
      break;

    case 'clips_ready':
      allClips = data.clips || [];
      detectedLanguage = data.language || detectedLanguage;
      showReviewSection(allClips);
      break;

    case 'render_done':
      renderedFiles = data.files || [];
      currentJobId = data.jobId || (data.outputDir ? data.outputDir.replace(/^\/output\//, '') : currentJobId);
      showResultsSection(renderedFiles);
      break;

    case 'social_content': {
      // Lazy social content arrived — update clip data and refresh result card
      const ci = data.clipIndex;
      if (ci >= 0 && allClips[ci]) {
        if (data.title) allClips[ci].title = data.title;
        if (data.description) allClips[ci].description = data.description;
        if (data.hashtags) allClips[ci].hashtags = data.hashtags;
        if (data.caption) allClips[ci].caption = data.caption;

        // Refresh the result card's social blocks if visible
        const card = els.resultsList?.querySelector(`[data-result-index="${ci}"]`);
        if (card) {
          const descEl = card.querySelector('.social-block-content');
          if (descEl) descEl.textContent = data.description || descEl.textContent;
          const tagEl = card.querySelector('.social-block-hashtags');
          if (tagEl) tagEl.textContent = data.hashtags || tagEl.textContent;
        }
      }
      break;
    }

    case 're_render_done': {
      const { clipIndex, fileUrl } = data;
      if (fileUrl && clipIndex >= 0) {
        if (renderedFiles[clipIndex]) {
          renderedFiles[clipIndex] = fileUrl;
        }
        const resultCard = els.resultsList.querySelector(`[data-result-index="${clipIndex}"]`);
        if (resultCard) {
          const videoEl = resultCard.querySelector('video');
          if (videoEl) {
            videoEl.src = `${fileUrl}?t=${Date.now()}`;
          }
        }
        showToast(`Clip ${clipIndex + 1} re-rendered!`, 'success');
        appendLog(`✅ Clip ${clipIndex + 1} re-rendered successfully`, 'success');
      }
      break;
    }

    case 'done':
      stopTimer();
      pipelineRunning = false;
      setProcessingState(false);
      break;

    case 'stopped':
      stopTimer();
      pipelineRunning = false;
      setProcessingState(false);
      appendLog('Pipeline stopped.', 'warning');
      showToast('Pipeline cancelled', 'info');
      break;

    case 'error': {
      const errMsg = data.msg || 'An unknown error occurred';
      appendLog(`Error: ${errMsg}`, 'error');
      pipelineRunning = false;
      setProcessingState(false);
      stopTimer();
      if (data.step) updateStep(data.step, 'error');
      // Only treat non-recoverable errors as full failures in the UI
      if (!data.recoverable) {
        showErrorPanel(data.errorCode, errMsg);
      } else {
        showToast(errMsg, 'error');
      }
      break;
    }

    case 'connection_update': {
      const { platform, connected, username } = data;
      if (connected) {
        setPlatformConnected(platform, username);
      } else {
        setPlatformDisconnected(platform);
      }
      break;
    }

    case 'publish_progress': {
      const { clipIndex, total, status, result } = data;
      updatePublishProgress(clipIndex, total, status, result);
      break;
    }

    case 'publish_done': {
      const { summary } = data;
      els.btnPublish.disabled = false;
      els.btnPublish.classList.remove('loading');
      updatePublishButton();
      if (summary) {
        if (summary.success > 0) {
          showToast(`Published ${summary.success} clip(s) successfully!`, 'success');
        } else {
          showToast(`Publishing completed with ${summary.failed} failure(s)`, 'error');
        }
      }
      break;
    }
  }
}

// ─── Terminal Logging ────────────────────────
function appendLog(msg, level = 'info') {
  const line = document.createElement('div');
  line.className = `terminal-line terminal-${level}`;
  line.textContent = msg;
  els.terminal.appendChild(line);
  els.terminal.scrollTop = els.terminal.scrollHeight;
}

els.clearTerminal.addEventListener('click', () => {
  els.terminal.innerHTML = '<div class="terminal-line terminal-muted">Terminal cleared.</div>';
});

// ─── Pipeline Steps ──────────────────────────
function updateStep(stepId, status) {
  const stepEls = document.querySelectorAll(`[data-step="${stepId}"]`);
  if (!stepEls || stepEls.length === 0) return;

  stepEls.forEach(stepEl => {
    stepEl.classList.remove('active', 'done', 'error');
    stepEl.classList.add(status);

    const statusText = stepEl.querySelector('.step-status');
    if (statusText) {
      const labels = { active: 'PROCESSING', done: 'COMPLETED', error: 'FAILED' };
      statusText.textContent = labels[status] || 'WAITING';
    }
  });
}

function resetSteps() {
  document.querySelectorAll('.step, .step-card, [data-step]').forEach(el => {
    el.classList.remove('active', 'done', 'error');
    const statusText = el.querySelector('.step-status');
    if (statusText) statusText.textContent = 'WAITING';
  });
}

// ─── Timer ───────────────────────────────────
function startTimer() {
  pipelineStartTime = Date.now();
  const timerEl = els.pipelineTimer || document.getElementById('pipeline-timer');
  if (timerEl) timerEl.textContent = '00:00';
  clearInterval(pipelineTimerInterval);
  pipelineTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - pipelineStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    const t = els.pipelineTimer || document.getElementById('pipeline-timer');
    if (t) t.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(pipelineTimerInterval);
}

// ─── Processing State ────────────────────────
function setProcessingState(isProcessing) {
  const genBtn = els.generateBtn || document.getElementById('generate-btn') || document.getElementById('process-btn');
  const stpBtn = els.stopBtn || document.getElementById('stop-btn');

  if (isProcessing) {
    genBtn?.classList.add('hidden');
    stpBtn?.classList.add('visible');
    if (stpBtn) stpBtn.style.display = 'flex';
    if (genBtn) genBtn.style.display = 'none';
    if (els.sourceInput) els.sourceInput.disabled = true;
    if (els.genreSelect) els.genreSelect.disabled = true;
  } else {
    genBtn?.classList.remove('hidden');
    stpBtn?.classList.remove('visible');
    if (stpBtn) stpBtn.style.display = 'none';
    if (genBtn) genBtn.style.display = 'flex';
    if (els.sourceInput) els.sourceInput.disabled = false;
    if (els.genreSelect) els.genreSelect.disabled = false;
  }
}

// ─── Save Path ───────────────────────────────
els.savePathSet.addEventListener('click', async () => {
  const dirPath = els.savePathInput.value.trim();
  if (!dirPath) return;

  try {
    const res = await fetch('/api/set-output-dir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirPath }),
    });
    const data = await res.json();
    if (data.success) {
      customOutputDir = data.path;
      els.savePathInput.value = data.path;
      showToast(`Save path set: ${data.path}`, 'success');
    } else {
      showToast(data.error || 'Invalid path', 'error');
    }
  } catch (err) {
    showToast('Failed to set save path', 'error');
  }
});

// ─── Caption Style Selector ───────────────────
if (els.captionStyleSelect) {
  els.captionStyleSelect.addEventListener('change', () => {
    const val = els.captionStyleSelect.value;
    currentCaptionPreset = val;
    const previewSample = document.getElementById('caption-style-preview-sample');
    if (previewSample) {
      if (val === 'neon') {
        previewSample.style.color = '#00FFFF';
        previewSample.style.textShadow = '0 0 8px #FF00FF';
        previewSample.style.textDecoration = 'none';
      } else if (val === 'karaoke') {
        previewSample.style.color = '#00FF66';
        previewSample.style.textShadow = 'none';
        previewSample.style.textDecoration = 'none';
      } else if (val === 'pop') {
        previewSample.style.color = '#FFE600';
        previewSample.style.textShadow = '2px 2px 0 #000';
        previewSample.style.textDecoration = 'none';
      } else if (val === 'underline') {
        previewSample.style.color = '#FF5533';
        previewSample.style.textShadow = 'none';
        previewSample.style.textDecoration = 'underline';
      } else if (val === 'cinematic') {
        previewSample.style.color = '#E5B533';
        previewSample.style.textShadow = '0 2px 4px rgba(0,0,0,0.8)';
        previewSample.style.textDecoration = 'none';
      } else {
        previewSample.style.color = '#FFE600';
        previewSample.style.textShadow = 'none';
        previewSample.style.textDecoration = 'none';
      }
    }
  });
}

// ─── Video Info Fetch & Workspace ────────────
const dynamicSourceIconEl = document.getElementById('dynamic-source-icon');

function isYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)/i.test(url);
}

function isInstagramUrl(url) {
  return /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/(?:reel|reels|p|tv)\/([a-zA-Z0-9_-]+)/i.test(url);
}

function isLocalMediaPath(path) {
  return /^[a-zA-Z]:[\\/]|^\/|^\.\.?\/|\.(mp4|mov|mkv|webm|m4v)$/i.test(path);
}

function updateDynamicSourceIcon(url) {
  if (!dynamicSourceIconEl) return;
  if (!url) {
    dynamicSourceIconEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 18.333a8.333 8.333 0 1 0 0-16.667 8.333 8.333 0 0 0 0 16.667Z" stroke="currentColor" stroke-width="1.5"/><path d="M8.333 12.5V7.5l4.167 2.5-4.167 2.5Z" fill="currentColor"/></svg>`;
    return;
  }
  if (isYouTubeUrl(url)) {
    dynamicSourceIconEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="#ef4444"><path d="M22.54 6.42a2.78 2.78 0 00-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 00-1.94 2A29.94 29.94 0 001 12a29.94 29.94 0 00.46 5.58 2.78 2.78 0 001.94 2c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 001.94-2A29.94 29.94 0 0023 12a29.94 29.94 0 00-.46-5.58z"/><path d="M9.75 15.02l5.75-3.27-5.75-3.27v6.54z" fill="#ffffff"/></svg>`;
  } else if (isInstagramUrl(url)) {
    dynamicSourceIconEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" stroke="#ec4899" stroke-width="2"/><circle cx="12" cy="12" r="4.5" stroke="#ec4899" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.5" fill="#ec4899"/></svg>`;
  } else if (isLocalMediaPath(url)) {
    dynamicSourceIconEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00f5d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
  } else {
    dynamicSourceIconEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 18.333a8.333 8.333 0 1 0 0-16.667 8.333 8.333 0 0 0 0 16.667Z" stroke="currentColor" stroke-width="1.5"/><path d="M8.333 12.5V7.5l4.167 2.5-4.167 2.5Z" fill="currentColor"/></svg>`;
  }
}

els.sourceInput.addEventListener('input', () => {
  clearTimeout(videoInfoTimeout);
  const url = els.sourceInput.value.trim();
  updateDynamicSourceIcon(url);

  if (!url || (!isYouTubeUrl(url) && !isInstagramUrl(url))) {
    return;
  }

  videoInfoTimeout = setTimeout(() => {
    fetchVideoInfo(url);
    showWorkspaceWithEmbed(url);
  }, 750);
});

// Also handle paste event for instant response
els.sourceInput.addEventListener('paste', () => {
  setTimeout(() => {
    const url = els.sourceInput.value.trim();
    updateDynamicSourceIcon(url);
    if (url && (isYouTubeUrl(url) || isInstagramUrl(url))) {
      fetchVideoInfo(url);
      showWorkspaceWithEmbed(url);
    }
  }, 100);
});

function extractYouTubeVideoId(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

let currentLoadedYtVideoId = null;
let isYtPosterMode = false;

function showWorkspaceWithEmbed(url) {
  els.workspaceSection.classList.add('visible');

  const videoId = extractYouTubeVideoId(url);
  if (videoId) {
    currentLoadedYtVideoId = videoId;
    isYtPosterMode = false;

    // Use standard embed with enablejsapi and origin to prevent Error 153 configuration failure
    const originParam = window.location.origin && window.location.origin !== 'null' ? `&origin=${encodeURIComponent(window.location.origin)}` : '';
    els.workspaceYtIframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0${originParam}`;
    els.workspaceYtIframe.style.display = 'block';

    if (els.workspaceYtPoster) els.workspaceYtPoster.style.display = 'none';
    els.workspaceVideoPlaceholder.style.display = 'none';
    els.workspaceLocalVideo.style.display = 'none';

    // Configure fallback links and notice
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const posterUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    if (els.ytEmbedNotice) els.ytEmbedNotice.style.display = 'flex';
    if (els.btnYtNoticeExternal) els.btnYtNoticeExternal.href = watchUrl;
    if (els.ytPosterImg) els.ytPosterImg.src = posterUrl;
    if (els.ytPosterPlayBtn) els.ytPosterPlayBtn.href = watchUrl;
    if (els.btnToggleYtPoster) els.btnToggleYtPoster.textContent = '🖼️ Switch to Poster';
  } else if (isInstagramUrl(url)) {
    if (els.ytEmbedNotice) els.ytEmbedNotice.style.display = 'none';
    if (els.workspaceYtPoster) els.workspaceYtPoster.style.display = 'none';
    els.workspaceYtIframe.style.display = 'none';
    els.workspaceYtIframe.src = '';
    els.workspaceLocalVideo.style.display = 'none';
    els.workspaceVideoPlaceholder.style.display = 'flex';
    const match = url.match(/(?:reel|reels|p|tv)\/([a-zA-Z0-9_-]+)/i);
    const shortcode = match ? match[1] : '';
    els.workspaceVideoPlaceholder.innerHTML = `
      <div style="text-align:center;padding:24px;max-width:320px">
        <div style="font-size:2.8rem;margin-bottom:8px">🟣</div>
        <div style="font-weight:700;font-size:1.05rem;color:var(--text-primary);margin-bottom:4px">Instagram Media Detected</div>
        <div style="font-size:0.8rem;color:var(--text-muted);font-family:var(--font-mono);margin-bottom:12px">Shortcode: ${escapeHtml(shortcode)}</div>
        <div style="font-size:0.75rem;color:#00f5d4;background:rgba(0,245,212,0.08);padding:6px 12px;border-radius:16px;border:1px solid rgba(0,245,212,0.2)">✓ Ready to download &amp; process with Whisper</div>
      </div>
    `;
  }
}

els.btnToggleYtPoster?.addEventListener('click', () => {
  if (!currentLoadedYtVideoId) return;
  isYtPosterMode = !isYtPosterMode;
  if (isYtPosterMode) {
    els.workspaceYtIframe.style.display = 'none';
    if (els.workspaceYtPoster) els.workspaceYtPoster.style.display = 'block';
    if (els.btnToggleYtPoster) els.btnToggleYtPoster.textContent = '🎬 Switch to Player';
  } else {
    if (els.workspaceYtPoster) els.workspaceYtPoster.style.display = 'none';
    els.workspaceYtIframe.style.display = 'block';
    if (els.btnToggleYtPoster) els.btnToggleYtPoster.textContent = '🖼️ Switch to Poster';
  }
});

function switchToLocalVideo() {
  if (els.ytEmbedNotice) els.ytEmbedNotice.style.display = 'none';
  if (els.workspaceYtPoster) els.workspaceYtPoster.style.display = 'none';
  // After pipeline download, switch from iframe to local video
  els.workspaceYtIframe.style.display = 'none';
  els.workspaceYtIframe.src = '';
  els.workspaceLocalVideo.src = '/api/raw_video';
  els.workspaceLocalVideo.style.display = 'block';
  els.workspaceVideoPlaceholder.style.display = 'none';
}

async function fetchVideoInfo(url) {
  try {
    const res = await fetch('/api/video-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) return;
    const info = await res.json();

    currentVideoTitle = info.title || 'Unknown';
    els.videoThumb.src = info.thumbnail || '';
    els.videoTitle.textContent = info.title || 'Unknown';
    els.videoChannel.textContent = info.channel || '';
    els.videoDuration.textContent = formatDuration(info.duration || 0);
    els.videoViews.textContent = info.viewCount ? `${formatNumber(info.viewCount)} views` : '';
    els.videoInfoCard.classList.add('visible');

    if (info.sourceResolution) {
      currentSourceMeta = info.sourceResolution;
      checkQualityMismatch();
    }
  } catch (e) {
    // Silently fail — video info is optional
  }
}

function checkQualityMismatch() {
  const infoEl = document.getElementById('source-resolution-info');
  const textEl = document.getElementById('source-res-text');
  if (!infoEl || !textEl || !currentSourceMeta) return;

  const maxHeight = currentSourceMeta.maxHeight || 1080;
  infoEl.style.display = 'flex';

  if (videoQuality === '4k' && maxHeight < 2160) {
    infoEl.className = 'source-res-pill has-warning';
    textEl.textContent = `⚠️ Source native max is ${currentSourceMeta.maxResolution}. Will download in native resolution.`;
  } else if (videoQuality === '1080p' && maxHeight < 1080) {
    infoEl.className = 'source-res-pill has-warning';
    textEl.textContent = `⚠️ Source native max is ${currentSourceMeta.maxResolution}. Will download in native resolution without upscaling.`;
  } else {
    infoEl.className = 'source-res-pill';
    textEl.textContent = `📥 Source detected: ${currentSourceMeta.maxResolution} @ ${currentSourceMeta.nativeFps}fps`;
  }
}

els.videoInfoClose?.addEventListener('click', () => {
  els.videoInfoCard?.classList.remove('visible');
});

// ─── Form Submit (Generate) ──────────────────
const generateBtnTarget = els.generateBtn || document.getElementById('generate-btn') || document.getElementById('process-btn');
generateBtnTarget?.addEventListener('click', async (e) => {
  e.preventDefault();
  
  // ✅ NEW: Check if pipeline already running
  if (pipelineRunning) {
    showToast('Pipeline already running. Click Stop first.', 'warning');
    return;
  }
  
  const source = els.sourceInput.value.trim();
  const genre = els.genreSelect.value;
  const language = els.languageSelect ? els.languageSelect.value : 'auto';

  if (!source) return;

  // Collect timestamps
  const timestamps = getTimestamps();

  // ── FIX: #ts-only-toggle or radio button determines clipMode ──
  const tsOnlyToggle = document.getElementById('ts-only-toggle');
  let clipMode = document.querySelector('input[name="clip-mode"]:checked')?.value || 'add';
  if (tsOnlyToggle && tsOnlyToggle.checked) {
    clipMode = 'only';
  }

  // Collect pre-generate ratio and zoom
  const defaultRatio = preGenRatio;
  const defaultZoom = preGenZoom;

  // Reset UI
  hideErrorPanel();
  setProcessingState(true);
  resetSteps();
  els.terminal.innerHTML = '';
  els.reviewSection.classList.remove('visible');
  document.getElementById('caption-studio-section')?.classList.remove('visible');
  els.resultsSection.classList.remove('visible');
  els.publishSection?.classList.remove('visible');
  els.publishSection?.removeAttribute('data-enabled');
  
  // ✅ Disable publish button at start
  const btnPublish = document.getElementById('btn-publish');
  if (btnPublish) {
    btnPublish.disabled = true;
  }
  
  els.pipelineSection?.classList.add('visible');
  selectedClips.clear();
  allClips = [];
  renderedFiles = [];

  pipelineRunning = true;
  startTimer();

  try {
    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, genre, language, timestamps, clipMode, clipCount, defaultRatio, defaultZoom, videoQuality, exportQuality, captionStyle: els.captionStyleSelect?.value || currentCaptionPreset || 'hormozi', sessionId: currentSessionId }),
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        showToast('⚠️ Session expired or sign-in required. Please log in.', 'warning');
        setTimeout(() => { window.location.href = '/login.html'; }, 800);
        return;
      }
      if (data.error === 'MISSING_API_KEY') {
        showGlobalAlert(data.message);
        throw new Error(data.message);
      }
      throw new Error(data.message || data.error || 'Failed to start pipeline');
    }

    if (data && data.jobId) {
      currentJobId = data.jobId;
    }
    appendLog('📋 Video queued for processing. Starting pipeline...', 'info');
    els.pipelineSection?.classList.add('visible');
    els.pipelineSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    appendLog(`Failed to start: ${err.message}`, 'error');
    pipelineRunning = false;
    setProcessingState(false);
    stopTimer();
    showToast(err.message, 'error');
  }
});

// Prevent form default submit
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  els.generateBtn.click();
});

// ─── Stop Pipeline & Confirmation Modal ───────
function openStopModal() {
  const modal = document.getElementById('stop-confirm-modal');
  if (modal) {
    modal.classList.add('visible');
  } else if (confirm('Do you actually want to stop generating clips?')) {
    executeStopPipeline();
  }
}

function closeStopModal() {
  const modal = document.getElementById('stop-confirm-modal');
  modal?.classList.remove('visible');
}

async function executeStopPipeline() {
  closeStopModal();
  try {
    const res = await fetch('/api/process/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: currentJobId, sessionId: currentSessionId }),
    });
    
    if (!res.ok) throw new Error('Stop failed');
    
    appendLog('🛑 Pipeline stopped immediately by user', 'warning');
    pipelineRunning = false;
    setProcessingState(false);
    stopTimer();
    showToast('Pipeline cancelled', 'info');
    
  } catch (err) {
    appendLog(`Stop failed: ${err.message}`, 'error');
    showToast(`Stop failed: ${err.message}`, 'error');
  }
}

// Clicking the Stop button triggers the confirmation popup
const stopBtnTarget = els.stopBtn || document.getElementById('stop-btn');
stopBtnTarget?.addEventListener('click', (e) => {
  e.preventDefault();
  openStopModal();
});

// Confirmation popup buttons
const btnStopCancel = document.getElementById('btn-stop-cancel');
const btnStopConfirm = document.getElementById('btn-stop-confirm');
const stopModalClose = document.getElementById('stop-modal-close');
const stopConfirmModal = document.getElementById('stop-confirm-modal');

btnStopCancel?.addEventListener('click', (e) => {
  e.preventDefault();
  closeStopModal(); // Cancel -> Continue generating
});

stopModalClose?.addEventListener('click', (e) => {
  e.preventDefault();
  closeStopModal(); // Cancel -> Continue generating
});

btnStopConfirm?.addEventListener('click', (e) => {
  e.preventDefault();
  executeStopPipeline(); // Yes -> Stop immediately
});

// Close when clicking modal backdrop overlay (cancels stopping)
stopConfirmModal?.addEventListener('click', (e) => {
  if (e.target === stopConfirmModal) {
    closeStopModal();
  }
});

// Escape key dismisses the confirmation modal (cancels stopping)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stopConfirmModal?.classList.contains('visible')) {
    closeStopModal();
  }
});

// ─── Review Section ──────────────────────────
function showReviewSection(clips) {
  els.reviewSection.classList.add('visible');
  els.reviewGrid.innerHTML = '';
  selectedClips.clear();

  // Language badge
  if (detectedLanguage && detectedLanguage !== 'unknown') {
    els.reviewLanguage.innerHTML = `<span class="language-badge">🌐 ${detectedLanguage}</span>`;
  }

  // Auto-select all clips
  clips.forEach((_, i) => selectedClips.add(i));

  // Assign pre-gen ratio and zoom to each clip
  clips.forEach((clip, i) => {
    clip.aspectRatio = clip.aspectRatio || preGenRatio;
    clip.zoom = clip.zoom || preGenZoom;
    clip.reframeMode = clip.reframeMode || preGenReframeMode;
  });

  clips.forEach((clip, i) => {
    const card = document.createElement('div');
    card.className = 'clip-card selected';
    card.innerHTML = `
      <div class="clip-card-header">
        <div class="clip-card-badges">
          <span class="badge badge-score">★ ${clip.score || 0}</span>
          <span class="badge badge-duration">${clip.duration || 0}s</span>
          ${clip.language && clip.language !== 'unknown' ? `<span class="badge badge-lang">${clip.language}</span>` : ''}
          ${clip.source === 'description' ? '<span class="badge badge-source-desc">📝 Description</span>' : ''}
          ${clip.source === 'timestamp' ? '<span class="badge badge-source-ts">⏱️ Manual</span>' : ''}
          ${clip.source === 'ai' ? '<span class="badge badge-source">🤖 AI</span>' : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="button" class="btn-preview-studio" data-index="${i}" title="Preview and style captions side-by-side">🎨 Style Captions</button>
          <button type="button" class="btn-edit-clip" data-index="${i}">✏️ Edit</button>
          <div class="clip-check">
            <svg class="clip-check-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
      </div>
      <div class="clip-card-title">${escapeHtml(clip.title || 'Untitled')}</div>
      <div class="clip-card-text">${escapeHtml(clip.text || '')}</div>
      <div class="clip-card-score-bar">
        <div class="clip-card-score-fill" style="width: ${Math.min(100, (clip.score || 0) * 10)}%"></div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-edit-clip') || e.target.closest('.btn-preview-studio')) return;
      toggleClipSelection(card, i);
    });
    
    card.querySelector('.btn-edit-clip').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor(i);
    });

    card.querySelector('.btn-preview-studio').addEventListener('click', (e) => {
      e.stopPropagation();
      selectStudioClip(i);
      const studioSec = document.getElementById('caption-studio-section');
      if (studioSec) {
        studioSec.classList.add('visible');
        studioSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    els.reviewGrid.appendChild(card);
  });

  // Reveal Caption Studio and initialize clip options
  const studioSec = document.getElementById('caption-studio-section');
  if (studioSec) {
    studioSec.classList.add('visible');
  }
  if (typeof initStudioClipsList === 'function') {
    initStudioClipsList(clips);
  }

  updateSelectedCount();
  els.reviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleClipSelection(card, index) {
  if (selectedClips.has(index)) {
    selectedClips.delete(index);
    card.classList.remove('selected');
  } else {
    selectedClips.add(index);
    card.classList.add('selected');
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  els.selectedCount.textContent = selectedClips.size;
  els.renderSelectedBtn.disabled = selectedClips.size === 0;
}

// Select All
els.selectAllBtn.addEventListener('click', () => {
  const cards = els.reviewGrid.querySelectorAll('.clip-card');
  const allSelected = selectedClips.size === allClips.length;

  if (allSelected) {
    selectedClips.clear();
    cards.forEach(c => c.classList.remove('selected'));
    els.selectAllBtn.textContent = 'Select All';
  } else {
    allClips.forEach((_, i) => selectedClips.add(i));
    cards.forEach(c => c.classList.add('selected'));
    els.selectAllBtn.textContent = 'Deselect All';
  }
  updateSelectedCount();
});

// ─── Render Selected ─────────────────────────
els.renderSelectedBtn.addEventListener('click', async () => {
  if (selectedClips.size === 0) return;

  els.renderSelectedBtn.disabled = true;
  appendLog(`Rendering ${selectedClips.size} clips...`, 'info');

    try {
      const selectedIndicesArr = Array.from(selectedClips);
      const selectedClipsData = selectedIndicesArr.map(i => allClips[i]);

      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          selectedIndices: selectedIndicesArr, 
          selectedClipsData, 
          customOutputDir,
          captionStyle: currentCaptionPreset || 'bold',
          exportQuality: exportQuality || 'balanced'
        }),
      });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Render failed');
  } catch (err) {
    appendLog(`Render failed: ${err.message}`, 'error');
    els.renderSelectedBtn.disabled = false;
    showToast('Render failed', 'error');
  }
});

// ─── Results Section ─────────────────────────
function showResultsSection(files) {
  els.resultsSection.classList.add('visible');
  els.publishSection?.classList.add('visible');
  els.publishSection?.setAttribute('data-enabled', 'true');
  
  // ✅ Enable publish button after render
  const btnPublish = document.getElementById('btn-publish');
  if (btnPublish) {
    btnPublish.disabled = false;
  }
  
  els.resultsList.innerHTML = '';

  if (files.length === 0) {
    const selectedIndicesArray = Array.from(selectedClips);
    selectedIndicesArray.forEach((actualClipIndex, loopIndex) => {
      const clip = allClips[actualClipIndex] || {};
      els.resultsList.appendChild(createResultCard(clip, null, actualClipIndex));
    });
  } else {
    const selectedIndicesArray = Array.from(selectedClips);
    files.forEach((fileData, renderIndex) => {
      // Map loop index to actual clip index
      const actualClipIndex = selectedIndicesArray[renderIndex];
      const clip = allClips[actualClipIndex] || {};
      
      // Handle both old string format and new object format
      const videoUrl = typeof fileData === 'string' ? fileData : fileData?.url;
      const storageType = typeof fileData === 'string' ? 'local' : (fileData?.type || 'local');
      
      // Pass actual index, not loop counter
      els.resultsList.appendChild(createResultCard(clip, videoUrl, actualClipIndex, storageType));
    });
  }

  showToast(`${Math.max(files.length, selectedClips.size)} clips ready!`, 'success');
  els.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Sanitize filename ───────────────────────
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w\-_.]/g, '')
    .slice(0, 80) || 'clip';
}

function createResultCard(clip, videoUrl, index, storageType = 'local') {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.setAttribute('data-result-index', index);

  const clipTitle = clip.title || `Clip ${index + 1}`;
  const safeFilename = sanitizeFilename(clipTitle);

  const videoHtml = videoUrl
    ? `<video src="${videoUrl}?t=${Date.now()}" controls playsinline preload="metadata"></video>`
    : `<div class="result-video-placeholder">
        <div>
          <div style="font-size:2rem;margin-bottom:8px">🎬</div>
          <div>Clip ${index + 1}</div>
          <div style="font-size:0.7rem;margin-top:4px;color:var(--text-muted)">${clip.duration || 0}s • ${clip.start || 0}s–${clip.end || 0}s</div>
        </div>
       </div>`;

  // ✅ NEW: Show storage type badge
  const storageBadge = storageType === 'cloud' 
    ? '<span class="badge badge-cloud">☁️ Cloud</span>'
    : '<span class="badge badge-local">💾 Local</span>';

  card.innerHTML = `
    <div class="result-video-wrap">
      ${videoHtml}
    </div>
    <div class="result-social">
      <div class="result-social-header">
        <div class="result-title">${escapeHtml(clipTitle)}</div>
        <div class="result-badges">
          ${storageBadge}
          <span class="badge badge-score">★ ${clip.score || 0}</span>
          <span class="badge badge-duration">${clip.duration || 0}s</span>
          ${clip.language && clip.language !== 'unknown' ? `<span class="badge badge-lang">${clip.language}</span>` : ''}
          ${clip.source === 'description' ? '<span class="badge badge-source-desc">📝 Description</span>' : ''}
          ${clip.source === 'timestamp' ? '<span class="badge badge-source-ts">⏱️ Manual</span>' : ''}
          ${clip.source === 'ai' ? '<span class="badge badge-source">🤖 AI</span>' : ''}
        </div>
      </div>

      <div class="social-block">
        <div class="social-block-label">
          <span>📝 Caption</span>
          <button class="copy-btn" data-copy="${escapeAttr(clip.caption || '')}">Copy</button>
        </div>
        <div class="social-block-content">${escapeHtml(clip.caption || 'No caption generated')}</div>
      </div>

      <div class="social-block">
        <div class="social-block-label">
          <span>📄 Description</span>
          <button class="copy-btn" data-copy="${escapeAttr(clip.description || '')}">Copy</button>
        </div>
        <div class="social-block-content">${escapeHtml(clip.description || 'No description generated')}</div>
      </div>

      <div class="social-block">
        <div class="social-block-label">
          <span># Hashtags</span>
          <button class="copy-btn" data-copy="${escapeAttr(clip.hashtags || '')}">Copy</button>
        </div>
        <div class="social-block-hashtags">${escapeHtml(clip.hashtags || 'No hashtags generated')}</div>
      </div>

      <div class="result-actions">
        <button class="btn-edit-rerender" data-result-index="${index}">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Edit & Re-render
        </button>
        ${videoUrl
          ? `<a href="${videoUrl}" download="${safeFilename}.mp4" class="btn-download">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v8m0 0l2.5-2.5M8 10L5.5 7.5M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Download
            </a>
            <button class="btn-publish-direct-yt" data-clip-index="${index}" title="Upload to YouTube Shorts">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M22.54 6.42a2.78 2.78 0 00-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 00-1.94 2A29.94 29.94 0 001 12a29.94 29.94 0 00.46 5.58 2.78 2.78 0 001.94 2c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 001.94-2A29.94 29.94 0 0023 12a29.94 29.94 0 00-.46-5.58z" stroke="currentColor" stroke-width="1.5"/><path d="M9.75 15.02l5.75-3.27-5.75-3.27v6.54z" fill="currentColor"/></svg>
              <span>YouTube</span>
            </button>
            <button class="btn-publish-direct-ig" data-clip-index="${index}" title="Upload to Instagram Reels">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1.5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor"/></svg>
              <span>Instagram</span>
            </button>`
          : `<span style="font-size:0.78rem;color:var(--text-muted)">Install FFmpeg + yt-dlp for real clips</span>`
        }
      </div>
    </div>
  `;

  // Attach copy handlers
  card.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.getAttribute('data-copy');
      copyToClipboard(text, btn);
    });
  });

  // Attach edit & re-render handler
  const editBtn = card.querySelector('.btn-edit-rerender');
  if (editBtn) {
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const resultIdx = parseInt(editBtn.getAttribute('data-result-index'), 10);
      editorReRenderIndex = resultIdx;
      const selectedArr = Array.from(selectedClips);
      const clipIndex = selectedArr[resultIdx] ?? resultIdx;
      openEditor(clipIndex);
    });
  }

  // Attach direct social upload handlers
  const ytBtn = card.querySelector('.btn-publish-direct-yt');
  if (ytBtn) {
    ytBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(ytBtn.getAttribute('data-clip-index'), 10);
      publishSingleClip(idx, 'youtube');
    });
  }

  const igBtn = card.querySelector('.btn-publish-direct-ig');
  if (igBtn) {
    igBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(igBtn.getAttribute('data-clip-index'), 10);
      publishSingleClip(idx, 'instagram');
    });
  }

  return card;
}

// ─── Per-Clip Publish ────────────────────────
async function publishSingleClip(index, platform) {
  if (!platformConnections[platform]) {
    showToast(`Redirecting to ${platform === 'youtube' ? 'Google / YouTube' : 'Instagram / Meta'} login...`, 'info');
    window.open(`/api/connect/${platform}`, '_blank', 'width=620,height=720');
    return;
  }

  const selectedArr = Array.from(selectedClips);
  const clip = allClips[selectedArr[index]] || allClips[index] || {};
  const fileUrl = renderedFiles[index];
  if (!fileUrl) {
    showToast('No rendered file for this clip', 'error');
    return;
  }

  showToast(`Uploading to ${platform}...`, 'info');

  try {
    // Build workflow metadata from the clip itself with proper fallbacks
    const workflow = {
      youtube: {
        title: clip.title || `Clip ${index + 1}`,
        description: clip.description || clip.caption || '',
        tags: clip.hashtags || '',
        visibility: 'public',
        audience: 'general',
      },
      instagram: {
        caption: clip.caption || clip.title || `Clip ${index + 1}`,
        hashtags: clip.hashtags || '',
      }
    };

    const metadata = platform === 'instagram' ? workflow.instagram : workflow.youtube;
    const res = await fetch('/api/publish-clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: currentJobId || clip.job_id,
        clipId: clip.id,
        clipIndex: index,
        platform,
        metadata,
        clip,
        fileUrl,
        workflow
      }),
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || `Failed to upload to ${platform}`, 'error');
    } else {
      showToast(`Uploaded to ${platform}!`, 'success');
    }
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
  }
}

// ─── Download All ────────────────────────────
els.downloadAllBtn.addEventListener('click', () => {
  if (renderedFiles.length === 0) {
    showToast('No rendered files to download', 'error');
    return;
  }

  const selected = Array.from(selectedClips).map(i => allClips[i]).filter(Boolean);
  renderedFiles.forEach((url, i) => {
    const clip = selected[i] || allClips[i] || {};
    const title = clip.title || `Clip ${i + 1}`;
    const safeFilename = sanitizeFilename(title);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFilename}.mp4`;
    a.click();
  });

  showToast(`Downloading ${renderedFiles.length} clips`, 'success');
});

// ─── New Video ───────────────────────────────
els.newVideoBtn.addEventListener('click', () => {
  els.sourceInput.value = '';
  els.videoInfoCard.classList.remove('visible');
  els.workspaceSection.classList.remove('visible');
  els.pipelineSection?.classList.remove('visible');
  els.reviewSection.classList.remove('visible');
  document.getElementById('caption-studio-section')?.classList.remove('visible');
  els.resultsSection.classList.remove('visible');
  els.publishSection?.classList.remove('visible');
  els.terminal.innerHTML = '<div class="terminal-line terminal-muted">Ready for a new video...</div>';
  // Reset workspace video
  els.workspaceYtIframe.style.display = 'none';
  els.workspaceYtIframe.src = '';
  els.workspaceLocalVideo.style.display = 'none';
  els.workspaceLocalVideo.src = '';
  els.workspaceVideoPlaceholder.style.display = 'flex';
  resetSteps();
  selectedClips.clear();
  allClips = [];
  renderedFiles = [];
  currentVideoTitle = '';
  stopTimer();
  els.heroSection.scrollIntoView({ behavior: 'smooth' });
  els.sourceInput.focus();
});

// ─── System Status ───────────────────────────
async function checkStatus() {
  if (!els.statusGrid) return;
  els.statusGrid.innerHTML = '<div class="status-card loading"><span class="status-card-label">Checking dependencies...</span></div>';

  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (!els.statusGrid) return;
    els.statusGrid.innerHTML = '';
    let allOk = true;

    const names = { ffmpeg: 'FFmpeg', ytdlp: 'yt-dlp', ollama: 'Ollama' };

    Object.entries(data).forEach(([key, info]) => {
      if (!info.installed) allOk = false;

      const card = document.createElement('div');
      card.className = 'status-card';

      const iconSvg = info.installed
        ? '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>';

      card.innerHTML = `
        <div class="status-card-icon ${info.installed ? 'ok' : 'missing'}">${iconSvg}</div>
        <div class="status-card-info">
          <span class="status-card-label">${names[key] || key}</span>
          <span class="status-card-version">${info.version}</span>
        </div>
      `;
      els.statusGrid.appendChild(card);
    });

    if (els.statusHint) {
      els.statusHint.textContent = allOk
        ? '✅ All dependencies installed — full pipeline ready!'
        : '⚠️ Some dependencies missing — demo mode will be used. Install missing tools for real processing.';
    }

  } catch (err) {
    if (els.statusGrid) {
      els.statusGrid.innerHTML = '<div class="status-card loading" style="color:var(--accent-red)"><span class="status-card-label">Could not reach server</span></div>';
    }
  }
}

els.recheckBtn?.addEventListener('click', checkStatus);
if (els.statusGrid) checkStatus();

// ─── Utility Functions ───────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return String(num);
}

function copyToClipboard(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    const original = button.textContent;
    button.textContent = 'Copied!';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    button.textContent = 'Copied!';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = 'Copy';
      button.classList.remove('copied');
    }, 1500);
  });
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${escapeHtml(message)}</span>`;

  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Logo click → reset ──────────────────────
$('#logo')?.addEventListener('click', () => {
  els.newVideoBtn?.click();
});

// ─── Error Panel ─────────────────────────────
const ERROR_SOLUTIONS = {
  OLLAMA_CONNECTION: {
    title: '🔌 Ollama Not Running',
    fix: 'Ollama is not running or cannot be reached at localhost:11434.',
    steps: [
      'Open a terminal and run: <code>ollama serve</code>',
      'Make sure the model is downloaded: <code>ollama pull llama3.2:3b</code>',
      'Alternatively, add a <code>GROQ_API_KEY</code> to your .env for cloud-based transcription.',
    ],
    actions: [{ label: 'Re-check Status', action: () => checkStatus() }],
  },
  OLLAMA_TIMEOUT: {
    title: '⏱️ Ollama Timed Out',
    fix: 'Ollama took too long to respond. This usually means your model is too large for your hardware.',
    steps: [
      'Try a smaller model: change <code>MODEL=llama3.2:3b</code> in your .env file',
      'Make sure no other heavy apps are running',
      'Check if Ollama is using your GPU: run <code>ollama ps</code> in a terminal',
    ],
    actions: [{ label: 'Re-check Status', action: () => checkStatus() }],
  },
  YTDLP_FAILED: {
    title: '📥 Download Failed',
    fix: 'yt-dlp could not download the video. YouTube may be blocking the request.',
    steps: [
      'Make sure you are logged into YouTube in Chrome, then try again (yt-dlp will use your cookies)',
      'Update yt-dlp: run <code>yt-dlp -U</code> in a terminal',
      'Try a different YouTube URL or check if the video is private/age-restricted',
    ],
    actions: [],
  },
  FFMPEG_FAILED: {
    title: '🎬 FFmpeg Error',
    fix: 'FFmpeg failed during audio extraction or video trimming.',
    steps: [
      'Verify FFmpeg is installed: run <code>ffmpeg -version</code> in a terminal',
      'Make sure the video file is not corrupted',
      'If using a local file, try re-downloading the video',
    ],
    actions: [{ label: 'Re-check Status', action: () => checkStatus() }],
  },
  TRANSCRIPTION_FAILED: {
    title: '🎤 Transcription Failed',
    fix: 'Whisper could not transcribe the audio.',
    steps: [
      'Add a <code>GROQ_API_KEY</code> to your .env for fast cloud transcription (free at console.groq.com)',
      'Or install local Whisper: <code>pip install faster-whisper</code>',
      'Check that the video has clear speech (not music-only)',
    ],
    actions: [],
  },
  NO_MANUAL_CLIPS_FOUND: {
    title: '🔍 No Matching Clips',
    fix: 'No clips were found matching your description or timestamps.',
    steps: [
      'Check that your timestamps are within the video duration',
      'Try different search words in the description field',
      'Switch to "Add to AI clips" mode to also get AI-generated clips',
    ],
    actions: [],
  },
  YOUTUBE_QUOTA: {
    title: '📊 YouTube Daily Upload Limit Reached',
    fix: 'You have reached the YouTube daily upload quota (6 videos per day).',
    steps: [
      'The quota resets at midnight Pacific Time (PT)',
      'You can still download clips locally and upload manually',
      'Consider using the Unlisted visibility option to test uploads',
    ],
    actions: [],
  },
  INSTAGRAM_API: {
    title: '📱 Instagram Upload Failed',
    fix: 'Instagram API rejected the upload.',
    steps: [
      'Make sure your Instagram account is a Business or Creator account',
      'Your account must be linked to a Facebook Page',
      'Instagram requires videos to be under 90 seconds for Reels',
      'If running locally, Instagram cannot access localhost — you need a public URL (ngrok)',
    ],
    actions: [],
  },
  UNKNOWN: {
    title: '❌ Pipeline Error',
    fix: 'An unexpected error occurred during processing.',
    steps: [
      'Check the terminal log above for detailed error messages',
      'Re-check that all dependencies (FFmpeg, yt-dlp, Ollama) are installed and running',
      'Try running with a shorter test video first',
    ],
    actions: [{ label: 'Re-check Status', action: () => checkStatus() }],
  },
};

function showErrorPanel(errorCode, message) {
  if (!els.errorPanel) return;

  const solution = ERROR_SOLUTIONS[errorCode] || ERROR_SOLUTIONS['UNKNOWN'];

  els.errorPanelTitle.textContent = solution.title;
  els.errorPanelMsg.innerHTML = `<strong>Error:</strong> ${escapeHtml(message)}`;
  els.errorPanelFix.innerHTML = `
    <p>${escapeHtml(solution.fix)}</p>
    <ul class="error-fix-list">
      ${solution.steps.map(s => `<li>${s}</li>`).join('')}
    </ul>
  `;

  // Action buttons
  els.errorPanelActions.innerHTML = '';
  solution.actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'btn-secondary btn-sm';
    btn.textContent = a.label;
    btn.addEventListener('click', a.action);
    els.errorPanelActions.appendChild(btn);
  });

  els.errorPanel.style.display = 'block';
  els.errorPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideErrorPanel() {
  if (els.errorPanel) els.errorPanel.style.display = 'none';
}

// Close error panel button
els.errorPanelClose?.addEventListener('click', hideErrorPanel);

// ─── Trim Controls ───────────────────────────
els.trimClearBtn?.addEventListener('click', () => {
  if (els.trimStart) els.trimStart.value = '';
  if (els.trimEnd) els.trimEnd.value = '';
  if (els.trimPreview) els.trimPreview.textContent = '';
});

// Show trim preview when values change
function updateTrimPreview() {
  if (!els.trimPreview) return;
  const start = parseTimeStr(els.trimStart?.value);
  const end = parseTimeStr(els.trimEnd?.value);
  if (!isNaN(start) && !isNaN(end) && end > start) {
    const dur = Math.round(end - start);
    els.trimPreview.innerHTML = `✂️ Will trim to: <strong>${formatDuration(start)}</strong> → <strong>${formatDuration(end)}</strong> (${formatDuration(dur)} clip)`;
  } else if (!isNaN(start) && isNaN(end)) {
    els.trimPreview.innerHTML = `✂️ Will start from: <strong>${formatDuration(start)}</strong>`;
  } else {
    els.trimPreview.textContent = '';
  }
}

els.trimStart?.addEventListener('blur', updateTrimPreview);
els.trimEnd?.addEventListener('blur', updateTrimPreview);

// ─── Bind static first timestamp row ─────────
// The first row is in the HTML, not dynamically added, so bind it here
(function() {
  const firstRow = els.timestampRows?.querySelector('.timestamp-row');
  if (firstRow) bindTimestampRow(firstRow);
})();



// ─── Global Alert Banner Helpers ───────────────
function showGlobalAlert(msg) {
  const banner = document.getElementById('global-alert-banner');
  const text = document.getElementById('global-alert-message');
  if (banner && text) {
    text.textContent = msg;
    banner.style.display = 'flex';
  }
  showToast(msg, 'error');
}

function hideGlobalAlert() {
  const banner = document.getElementById('global-alert-banner');
  if (banner) banner.style.display = 'none';
}

// ─── Creative Studio & Editor Modal Logic ─────
let editingClipIndex = -1;
let currentClipData = null;

function openEditor(index) {
  editingClipIndex = index;
  currentClipData = allClips[index];
  if (!currentClipData) return;
  
  const start = currentClipData.editStart ?? currentClipData.start ?? 0;
  const end = currentClipData.editEnd ?? currentClipData.end ?? 0;
  
  currentClipData.zoom = currentClipData.zoom ?? preGenZoom ?? 1.0;
  currentClipData.panX = currentClipData.panX ?? 0;
  currentClipData.panY = currentClipData.panY ?? 0;
  currentClipData.brightness = currentClipData.brightness ?? 0.0;
  currentClipData.contrast = currentClipData.contrast ?? 1.0;
  currentClipData.exposure = currentClipData.exposure ?? 0.0;
  currentClipData.saturation = currentClipData.saturation ?? 1.0;
  currentClipData.sharpen = currentClipData.sharpen ?? 0.0;
  currentClipData.aspectRatio = currentClipData.aspectRatio ?? '9:16';
  
  // Custom caption settings for this clip
  const custom = currentClipData.custom = currentClipData.custom || {};
  custom.captionPreset = custom.captionPreset || 'bold';
  custom.captionsEnabled = custom.captionsEnabled ?? true;
  custom.fontFamily = custom.fontFamily || 'Outfit';
  custom.fontSize = custom.fontSize || 52;
  custom.highlightColor = custom.highlightColor || '#fee440';
  custom.textColor = custom.textColor || '#ffffff';
  custom.textCase = custom.textCase || 'uppercase';
  custom.marginV = custom.marginV ?? 420;

  // Sync Vertical Margin & Safe Area indicator
  if (els.editorMarginV) els.editorMarginV.value = custom.marginV;
  if (els.editorMarginVVal) els.editorMarginVVal.textContent = `${custom.marginV}px`;
  updateSafeZoneStatus(custom.marginV);

  // Sync Preset Badges
  updatePresetBadgeA(custom.captionPreset);
  if (els.editorComparePresetSelect) {
    els.editorComparePresetSelect.value = custom.captionPreset === 'bold' ? 'karaoke' : 'bold';
  }

  els.editorStart.min = 0;
  els.editorStart.max = currentClipData.end + 10;
  els.editorStart.value = start;
  
  els.editorEnd.min = 0;
  els.editorEnd.max = currentClipData.end + 10;
  els.editorEnd.value = end;

  els.editorZoom.value = currentClipData.zoom;
  els.editorContrast.value = currentClipData.contrast;
  els.editorExposure.value = currentClipData.exposure;
  els.editorSaturation.value = currentClipData.saturation;
  els.editorSharpen.value = currentClipData.sharpen;

  // Sync Captions Toggle
  if (els.editorCaptionsToggle) {
    els.editorCaptionsToggle.checked = custom.captionsEnabled;
    if (els.editorValCaptions) els.editorValCaptions.textContent = custom.captionsEnabled ? 'ON' : 'OFF';
  }

  // Sync Preset Chips
  document.querySelectorAll('#editor-presets-grid .preset-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.preset === custom.captionPreset);
  });

  // Sync Typography Controls
  const fontSelect = document.getElementById('editor-font-family');
  if (fontSelect) fontSelect.value = custom.fontFamily;

  const fontSizeSlider = document.getElementById('editor-font-size');
  const fontSizeVal = document.getElementById('editor-font-size-val');
  if (fontSizeSlider) fontSizeSlider.value = custom.fontSize;
  if (fontSizeVal) fontSizeVal.textContent = `${custom.fontSize}px`;

  const colorHighlight = document.getElementById('editor-color-highlight');
  if (colorHighlight) colorHighlight.value = custom.highlightColor;

  const colorText = document.getElementById('editor-color-text');
  if (colorText) colorText.value = custom.textColor;

  document.querySelectorAll('#editor-case-btns .btn-case').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.case === custom.textCase);
  });

  // Set aspect ratio (default to 9:16)
  currentEditorRatio = currentClipData.aspectRatio;
  setEditorRatio(currentEditorRatio);

  // Enable audio & stream video
  els.editorVideo.src = '/api/raw_video';
  els.editorVideo.volume = parseFloat(els.volumeSlider.value);
  els.editorVideo.muted = false;

  els.editorVideo.addEventListener('loadedmetadata', () => {
    els.editorVideo.currentTime = start;
    updateEditorLabels();
    renderEditorCaption(start);
    els.editorVideo.play().catch(err => console.warn('Autoplay prevented:', err));
  }, { once: true });

  els.editorModal.classList.add("visible");
  loadCaptionsForEditor(index);
}

function closeEditor() {
  els.editorModal.classList.remove("visible");
  els.editorVideo.pause();
  els.editorVideo.removeAttribute('src');
  if (els.editorVideoB) {
    els.editorVideoB.pause();
    els.editorVideoB.removeAttribute('src');
  }
  editingClipIndex = -1;
  currentClipData = null;
  editorReRenderIndex = -1;
  isEditorDirty = false;
}

function requestCloseEditor() {
  if (isEditorDirty) {
    if (!confirm('You have unsaved caption edits. Are you sure you want to exit without saving?')) {
      return;
    }
  }
  closeEditor();
}

// ─── Step 4: Caption Editor Live State & Word List ────
let currentJobId = '';
let editorWords = [];
let isEditorDirty = false;

async function loadCaptionsForEditor(index) {
  const clipNum = index + 1;
  const listEl = document.getElementById('editor-caption-rows-list');
  const countEl = document.getElementById('editor-words-count');
  if (listEl) listEl.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted);padding:8px">Loading captions...</div>';

  let words = currentClipData?.words || currentClipData?.chunk?.words || [];
  if (currentJobId) {
    try {
      const res = await fetch(`/api/clips/${currentJobId}/${clipNum}/captions`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.words) && data.words.length > 0) {
          words = data.words;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch clip captions from API:', e);
    }
  }

  editorWords = JSON.parse(JSON.stringify(words));
  if (currentClipData) currentClipData.words = editorWords;
  isEditorDirty = false;
  renderEditorWordsList();
}

function renderEditorWordsList() {
  const listEl = document.getElementById('editor-caption-rows-list');
  const countEl = document.getElementById('editor-words-count');
  if (!listEl) return;
  if (countEl) countEl.textContent = `${editorWords.length} words`;

  if (editorWords.length === 0) {
    listEl.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted);padding:8px">No word-level captions found for this clip.</div>';
    return;
  }

  listEl.innerHTML = '';
  editorWords.forEach((w, i) => {
    const row = document.createElement('div');
    row.className = 'caption-word-row';
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 0;';

    const timeBtn = document.createElement('button');
    timeBtn.type = 'button';
    timeBtn.className = 'btn-seek-word';
    timeBtn.style.cssText = 'font-size:0.7rem;padding:2px 5px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:var(--accent-purple);border-radius:4px;cursor:pointer;font-family:monospace;';
    const s = Number(w.start) || 0;
    const mins = Math.floor(s / 60);
    const secs = (s % 60).toFixed(1).padStart(4, '0');
    timeBtn.textContent = `${mins}:${secs}`;
    timeBtn.title = `Seek to ${s.toFixed(2)}s`;
    timeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (els.editorVideo) {
        els.editorVideo.currentTime = s;
        renderEditorCaption(s);
      }
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'caption-word-input';
    input.value = w.word || '';
    input.style.cssText = 'flex:1;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:4px;padding:3px 6px;font-size:0.8rem;';
    input.addEventListener('input', (e) => {
      isEditorDirty = true;
      w.word = e.target.value;
      if (currentClipData) currentClipData.words = editorWords;
      if (els.editorVideo) renderEditorCaption(els.editorVideo.currentTime);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.innerHTML = '&times;';
    delBtn.title = 'Remove word';
    delBtn.style.cssText = 'background:none;border:none;color:#ef4444;font-size:1rem;cursor:pointer;padding:0 4px;';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isEditorDirty = true;
      editorWords.splice(i, 1);
      if (currentClipData) currentClipData.words = editorWords;
      renderEditorWordsList();
      if (els.editorVideo) renderEditorCaption(els.editorVideo.currentTime);
    });

    row.appendChild(timeBtn);
    row.appendChild(input);
    row.appendChild(delBtn);
    listEl.appendChild(row);
  });
}

async function saveEditorCaptions() {
  if (!currentJobId || editingClipIndex < 0) {
    isEditorDirty = false;
    return;
  }
  const clipNum = editingClipIndex + 1;
  const custom = currentClipData?.custom || {};
  const preset = custom.captionPreset || 'hormozi';
  const overrides = {
    fontSize: Number(document.getElementById('editor-font-size')?.value) || 52,
    position: Number(els.editorMarginV?.value) || 420,
    colour: document.getElementById('editor-color-text')?.value || '#ffffff',
    uppercase: custom.textCase === 'uppercase',
  };

  try {
    const res = await fetch(`/api/clips/${currentJobId}/${clipNum}/captions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: editorWords, preset, overrides }),
    });
    if (res.ok) {
      isEditorDirty = false;
      showToast('Captions saved successfully!', 'success');
    }
  } catch (err) {
    showToast(`Save error: ${err.message}`, 'error');
  }
}

// ─── Preset Display Helpers & Shared Style Models ──
function getPresetDisplayName(presetId) {
  const map = {
    minimal: 'Clean Minimal',
    cinematic: 'Cinematic',
    bold: 'Bold Highlight',
    karaoke: 'Karaoke Word',
    pop: 'Animated Pop',
    podcast: 'Podcast Sub',
    educational: 'Educational',
    gaming: 'Gaming Neon',
  };
  return map[presetId] || 'Bold Highlight';
}

function updatePresetBadgeA(presetId) {
  if (els.stageBadgeAText) {
    els.stageBadgeAText.textContent = `Style A: ${getPresetDisplayName(presetId)}`;
  }
}

function updateSafeZoneStatus(marginV) {
  if (!els.editorSafeZoneStatus) return;
  if (marginV >= 350) {
    els.editorSafeZoneStatus.className = 'safe-zone-status safe';
    els.editorSafeZoneStatus.innerHTML = '<span>✅ Platform Safe: Avoids TikTok & Reels bottom engagement UI</span>';
  } else {
    els.editorSafeZoneStatus.className = 'safe-zone-status warn';
    els.editorSafeZoneStatus.innerHTML = '<span>⚠️ Caution: May be obscured by bottom titles and action buttons on mobile</span>';
  }
}

function positionCaptionOverlay(overlay, marginV, presetId) {
  if (!overlay) return;
  if (presetId === 'pop') {
    overlay.style.bottom = '50%';
    overlay.style.transform = 'translateY(50%)';
  } else {
    const bottomPercent = Math.min(65, Math.max(10, ((marginV || 420) / 1920) * 100));
    overlay.style.bottom = `${bottomPercent.toFixed(1)}%`;
    overlay.style.transform = 'none';
  }
}

function getCaptionWordHtml(windowWords, currentTime, presetId, custom, textCase) {
  return windowWords.map(w => {
    const isActive = currentTime >= w.start && currentTime <= w.end;
    let wordText = w.word;
    if (textCase === 'uppercase') wordText = wordText.toUpperCase();
    else if (textCase === 'capitalize') wordText = wordText.charAt(0).toUpperCase() + wordText.slice(1);

    const baseFont = custom.fontFamily || (presetId === 'cinematic' ? 'Georgia' : (presetId === 'gaming' ? 'Impact' : 'Outfit'));
    const fontSizePx = Math.round((custom.fontSize || 52) * 0.38);
    const textColor = custom.textColor || '#ffffff';
    const highlightColor = custom.highlightColor || (presetId === 'karaoke' ? '#00FF66' : (presetId === 'cinematic' ? '#F0F0F0' : '#fee440'));

    let style = `font-family: '${baseFont}', sans-serif; font-size: ${fontSizePx}px;`;

    switch (presetId) {
      case 'minimal':
        style += `font-weight: 700; color: ${textColor}; background: rgba(0,0,0,0.65); padding: 4px 10px; border-radius: 6px;`;
        break;
      case 'cinematic':
        style += `font-family: 'Georgia', serif; font-style: italic; font-weight: 400; letter-spacing: 0.08em; text-shadow: 0 4px 10px rgba(0,0,0,0.9); color: ${isActive ? highlightColor : '#D0D0D0'};`;
        break;
      case 'karaoke':
        style += `font-weight: 900;`;
        if (isActive) {
          style += `color: ${highlightColor}; text-shadow: 0 0 10px ${highlightColor}, -2px -2px 0 #000, 2px 2px 0 #000; transform: scale(1.1); display: inline-block;`;
        } else {
          style += `color: ${textColor}; text-shadow: -2px -2px 0 #000, 2px -2px 0 #000, 0 2px 4px rgba(0,0,0,0.8);`;
        }
        break;
      case 'pop':
        style += `font-weight: 900; text-transform: uppercase;`;
        if (isActive) {
          style += `color: ${highlightColor}; transform: scale(1.28); display: inline-block; text-shadow: -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 6px 14px rgba(0,0,0,0.95);`;
        } else {
          style += `color: ${textColor}; text-shadow: -2px -2px 0 #000, 2px -2px 0 #000;`;
        }
        break;
      case 'podcast':
        style += `font-weight: 700; background: rgba(0,0,0,0.45); padding: 2px 8px; border-radius: 4px;`;
        style += isActive ? `color: ${highlightColor}; text-shadow: 0 2px 6px rgba(0,0,0,0.8);` : `color: ${textColor};`;
        break;
      case 'educational':
        style += `font-family: 'Trebuchet MS', 'Segoe UI', sans-serif; font-weight: 700;`;
        if (isActive) {
          style += `color: #38bdf8; background: rgba(15,23,42,0.8); padding: 2px 6px; border-radius: 6px; text-shadow: 0 0 8px rgba(56,189,248,0.5);`;
        } else {
          style += `color: ${textColor}; text-shadow: -2px -2px 0 #0f172a, 2px 2px 0 #0f172a;`;
        }
        break;
      case 'gaming':
        style += `font-family: Impact, sans-serif; font-style: italic; font-weight: 900; text-transform: uppercase;`;
        if (isActive) {
          style += `color: ${highlightColor}; text-shadow: -3px -3px 0 #000, 3px -3px 0 #000, 0 0 14px #ff4500; transform: scale(1.15); display: inline-block;`;
        } else {
          style += `color: #ff4500; text-shadow: -2px -2px 0 #000, 2px -2px 0 #000;`;
        }
        break;
      case 'bold':
      default:
        style += `font-weight: 900;`;
        if (isActive) {
          style += `color: ${highlightColor}; transform: scale(1.18); display: inline-block; text-shadow: -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 4px 8px rgba(0,0,0,0.9);`;
        } else {
          style += `color: ${textColor}; text-shadow: -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000;`;
        }
        break;
    }
    return `<span style="${style}">${escapeHtml(wordText)}</span>`;
  }).join(' ');
}

// ─── Real-Time Caption Renderer in Editor Canvas (View A) ──
function renderEditorCaption(currentTime) {
  const box = document.getElementById('editor-caption-box');
  const overlay = document.getElementById('editor-caption-overlay');
  if (!box || !overlay || !currentClipData) return;

  const custom = currentClipData.custom || {};
  if (custom.captionsEnabled === false) {
    overlay.style.display = 'none';
    return;
  }
  overlay.style.display = 'flex';

  const presetId = custom.captionPreset || 'bold';
  const marginV = custom.marginV ?? 420;
  positionCaptionOverlay(overlay, marginV, presetId);

  const clipStart = currentClipData.editStart ?? currentClipData.start ?? 0;
  let words = currentClipData.words;
  if (!words || words.length === 0) {
    const textWords = (currentClipData.text || '').trim().split(/\s+/).filter(Boolean);
    const dur = Math.max(1, (currentClipData.end || 30) - (currentClipData.start || 0));
    const wordDur = dur / Math.max(1, textWords.length);
    words = textWords.map((w, i) => ({ word: w, start: clipStart + (i * wordDur), end: clipStart + ((i + 1) * wordDur) }));
  }

  const activeWordIdx = words.findIndex(w => currentTime >= w.start && currentTime <= w.end);
  const safeIdx = activeWordIdx >= 0 ? activeWordIdx : words.findIndex(w => w.start > currentTime);
  const targetIdx = safeIdx === -1 ? words.length - 1 : safeIdx;

  const chunkSize = presetId === 'pop' ? 2 : (presetId === 'gaming' ? 3 : 4);
  const startWindow = Math.max(0, Math.floor(targetIdx / chunkSize) * chunkSize);
  const windowWords = words.slice(startWindow, startWindow + chunkSize);

  box.innerHTML = getCaptionWordHtml(windowWords, currentTime, presetId, custom, custom.textCase || 'uppercase');
}

// ─── Real-Time Caption Renderer in Comparison View (View B) ──
function renderCompareCaptionB(currentTime) {
  const box = document.getElementById('editor-caption-box-b');
  const overlay = document.getElementById('editor-caption-overlay-b');
  if (!box || !overlay || !currentClipData) return;

  const custom = currentClipData.custom || {};
  if (custom.captionsEnabled === false) {
    overlay.style.display = 'none';
    return;
  }
  overlay.style.display = 'flex';

  const presetIdB = els.editorComparePresetSelect?.value || 'karaoke';
  const marginV = custom.marginV ?? 420;
  positionCaptionOverlay(overlay, marginV, presetIdB);

  const clipStart = currentClipData.editStart ?? currentClipData.start ?? 0;
  let words = currentClipData.words;
  if (!words || words.length === 0) {
    const textWords = (currentClipData.text || '').trim().split(/\s+/).filter(Boolean);
    const dur = Math.max(1, (currentClipData.end || 30) - (currentClipData.start || 0));
    const wordDur = dur / Math.max(1, textWords.length);
    words = textWords.map((w, i) => ({ word: w, start: clipStart + (i * wordDur), end: clipStart + ((i + 1) * wordDur) }));
  }

  const activeWordIdx = words.findIndex(w => currentTime >= w.start && currentTime <= w.end);
  const safeIdx = activeWordIdx >= 0 ? activeWordIdx : words.findIndex(w => w.start > currentTime);
  const targetIdx = safeIdx === -1 ? words.length - 1 : safeIdx;

  const chunkSize = presetIdB === 'pop' ? 2 : (presetIdB === 'gaming' ? 3 : 4);
  const startWindow = Math.max(0, Math.floor(targetIdx / chunkSize) * chunkSize);
  const windowWords = words.slice(startWindow, startWindow + chunkSize);

  box.innerHTML = getCaptionWordHtml(windowWords, currentTime, presetIdB, custom, custom.textCase || 'uppercase');
}

// Synchronize video playback with caption rendering
els.editorVideo.addEventListener('timeupdate', () => {
  const cur = els.editorVideo.currentTime;
  renderEditorCaption(cur);
  if (editorViewMode === 'compare') {
    if (els.editorVideoB && Math.abs(els.editorVideoB.currentTime - cur) > 0.3) {
      els.editorVideoB.currentTime = cur;
    }
    renderCompareCaptionB(cur);
  }
});

// Dual video playback sync
if (els.editorVideo && els.editorVideoB) {
  els.editorVideo.addEventListener('play', () => {
    if (editorViewMode === 'compare') els.editorVideoB.play().catch(() => {});
  });
  els.editorVideo.addEventListener('pause', () => {
    if (editorViewMode === 'compare') els.editorVideoB.pause();
  });
  els.editorVideo.addEventListener('seeking', () => {
    if (editorViewMode === 'compare') els.editorVideoB.currentTime = els.editorVideo.currentTime;
  });
}

// ─── View Mode Toggle (Single vs Compare Side-by-Side) ──
let editorViewMode = 'single';
els.editorViewModeToggle?.querySelectorAll('.view-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    els.editorViewModeToggle.querySelectorAll('.view-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    editorViewMode = btn.dataset.mode || 'single';

    const modalContent = document.querySelector('.studio-modal-content');
    if (editorViewMode === 'compare') {
      modalContent?.classList.add('compare-active');
      if (els.stageViewB) els.stageViewB.style.display = 'flex';
      if (els.editorVideo && els.editorVideoB) {
        els.editorVideoB.src = els.editorVideo.src;
        els.editorVideoB.currentTime = els.editorVideo.currentTime;
        if (!els.editorVideo.paused) els.editorVideoB.play().catch(() => {});
      }
      renderCompareCaptionB(els.editorVideo.currentTime);
    } else {
      modalContent?.classList.remove('compare-active');
      if (els.stageViewB) els.stageViewB.style.display = 'none';
      if (els.editorVideoB) els.editorVideoB.pause();
    }
  });
});

// ─── Compare Preset Dropdown Listener ────────
els.editorComparePresetSelect?.addEventListener('change', () => {
  renderCompareCaptionB(els.editorVideo.currentTime);
});

// ─── Choose Style B Button ───────────────────
els.btnUseStyleB?.addEventListener('click', () => {
  const chosenPreset = els.editorComparePresetSelect?.value || 'karaoke';
  if (currentClipData) {
    currentClipData.custom = currentClipData.custom || {};
    currentClipData.custom.captionPreset = chosenPreset;

    document.querySelectorAll('#editor-presets-grid .preset-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.preset === chosenPreset);
    });

    updatePresetBadgeA(chosenPreset);
    renderEditorCaption(els.editorVideo.currentTime);
    showToast(`Adopted ${getPresetDisplayName(chosenPreset)} as active clip style!`, 'success');
  }
});

// ─── Apply to All Clips Button ───────────────
els.editorApplyAllBtn?.addEventListener('click', () => {
  if (!currentClipData || !allClips || allClips.length === 0) return;
  const custom = currentClipData.custom || {};
  const presetId = custom.captionPreset || 'bold';

  allClips.forEach(clip => {
    clip.custom = clip.custom || {};
    clip.custom.captionPreset = presetId;
    clip.custom.captionsEnabled = els.editorCaptionsToggle.checked;
    clip.custom.fontFamily = custom.fontFamily;
    clip.custom.fontSize = custom.fontSize;
    clip.custom.highlightColor = custom.highlightColor;
    clip.custom.textColor = custom.textColor;
    clip.custom.textCase = custom.textCase;
    clip.custom.marginV = custom.marginV;
  });

  showToast(`✨ Caption preset '${getPresetDisplayName(presetId)}' applied to all ${allClips.length} clips!`, 'success');
});

// ─── Vertical Position (Safe Zone) Slider Listener ──
els.editorMarginV?.addEventListener('input', (e) => {
  const marginV = parseInt(e.target.value, 10);
  if (els.editorMarginVVal) els.editorMarginVVal.textContent = `${marginV}px`;
  updateSafeZoneStatus(marginV);

  if (currentClipData) {
    currentClipData.custom = currentClipData.custom || {};
    currentClipData.custom.marginV = marginV;
    renderEditorCaption(els.editorVideo.currentTime);
    if (editorViewMode === 'compare') {
      renderCompareCaptionB(els.editorVideo.currentTime);
    }
  }
});

// ─── Preset Selection in Studio (View A) ─────
document.querySelectorAll('#editor-presets-grid .preset-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#editor-presets-grid .preset-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    if (currentClipData) {
      currentClipData.custom = currentClipData.custom || {};
      currentClipData.custom.captionPreset = chip.dataset.preset;
      updatePresetBadgeA(chip.dataset.preset);
      renderEditorCaption(els.editorVideo.currentTime);
    }
  });
});

// ─── Safe Area Toggle ────────────────────────
document.getElementById('toggle-editor-safe-zone')?.addEventListener('change', (e) => {
  els.editorCanvasContainer.classList.toggle('hide-safe-zone', !e.target.checked);
});

// ─── Typography Inputs Listeners ─────────────
document.getElementById('editor-font-family')?.addEventListener('change', (e) => {
  if (currentClipData) {
    currentClipData.custom = currentClipData.custom || {};
    currentClipData.custom.fontFamily = e.target.value;
    renderEditorCaption(els.editorVideo.currentTime);
  }
});

document.getElementById('editor-font-size')?.addEventListener('input', (e) => {
  const val = parseInt(e.target.value, 10);
  const valEl = document.getElementById('editor-font-size-val');
  if (valEl) valEl.textContent = `${val}px`;
  if (currentClipData) {
    currentClipData.custom = currentClipData.custom || {};
    currentClipData.custom.fontSize = val;
    renderEditorCaption(els.editorVideo.currentTime);
  }
});

document.getElementById('editor-color-highlight')?.addEventListener('input', (e) => {
  if (currentClipData) {
    currentClipData.custom = currentClipData.custom || {};
    currentClipData.custom.highlightColor = e.target.value;
    renderEditorCaption(els.editorVideo.currentTime);
  }
});

document.getElementById('editor-color-text')?.addEventListener('input', (e) => {
  if (currentClipData) {
    currentClipData.custom = currentClipData.custom || {};
    currentClipData.custom.textColor = e.target.value;
    renderEditorCaption(els.editorVideo.currentTime);
  }
});

document.querySelectorAll('#editor-case-btns .btn-case').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#editor-case-btns .btn-case').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (currentClipData) {
      currentClipData.custom = currentClipData.custom || {};
      currentClipData.custom.textCase = btn.dataset.case;
      renderEditorCaption(els.editorVideo.currentTime);
    }
  });
});

// ─── Subtitle Exports (.SRT & .ASS) ───────────
document.getElementById('btn-editor-export-srt')?.addEventListener('click', () => {
  if (!currentClipData) return;
  const clipStart = currentClipData.editStart ?? currentClipData.start ?? 0;
  let words = currentClipData.words;
  if (!words || words.length === 0) {
    const textWords = (currentClipData.text || '').trim().split(/\s+/).filter(Boolean);
    const dur = Math.max(1, (currentClipData.end || 30) - (currentClipData.start || 0));
    const wordDur = dur / Math.max(1, textWords.length);
    words = textWords.map((w, i) => ({ word: w, start: i * wordDur, end: (i + 1) * wordDur }));
  } else {
    words = words.map(w => ({ word: w.word, start: Math.max(0, (w.start || 0) - clipStart), end: Math.max(0.1, (w.end || 0) - clipStart) }));
  }

  // Group into ~4 words per caption card
  let srt = '';
  let cardIdx = 1;
  const chunkSize = 4;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    const sTime = formatSRTTime(chunk[0].start);
    const eTime = formatSRTTime(chunk[chunk.length - 1].end);
    const text = chunk.map(w => w.word).join(' ');
    srt += `${cardIdx++}\n${sTime} --> ${eTime}\n${text}\n\n`;
  }

  downloadTextFile(srt.trim(), `clip-${(editingClipIndex + 1) || 1}-subtitles.srt`, 'text/plain');
  showToast('Downloaded .SRT subtitles!', 'success');
});

document.getElementById('btn-editor-export-ass')?.addEventListener('click', () => {
  if (!currentClipData) return;
  const custom = currentClipData.custom || {};
  const clipStart = currentClipData.editStart ?? currentClipData.start ?? 0;
  const presetId = custom.captionPreset || 'bold';
  const marginV = custom.marginV ?? 420;
  const fontFamily = custom.fontFamily || 'Outfit';
  const fontSize = Math.round((custom.fontSize || 52) * 1.5);
  const textCase = custom.textCase || 'uppercase';

  function hexToAss(hex, alpha = '00') {
    if (!hex || typeof hex !== 'string') return '&H00FFFFFF';
    let clean = hex.replace('#', '').trim();
    if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
    if (clean.length !== 6) return '&H00FFFFFF';
    return `&H${alpha}${clean.slice(4, 6)}${clean.slice(2, 4)}${clean.slice(0, 2)}`.toUpperCase();
  }

  const primaryCol = hexToAss(custom.textColor || '#ffffff');
  const highlightCol = hexToAss(custom.highlightColor || (presetId === 'karaoke' ? '#00FF66' : '#fee440'));

  let words = currentClipData.words;
  if (!words || words.length === 0) {
    const textWords = (currentClipData.text || '').trim().split(/\s+/).filter(Boolean);
    const dur = Math.max(1, (currentClipData.end || 30) - (currentClipData.start || 0));
    const wordDur = dur / Math.max(1, textWords.length);
    words = textWords.map((w, i) => ({ word: w, start: i * wordDur, end: (i + 1) * wordDur }));
  } else {
    words = words.map(w => ({ word: w.word, start: Math.max(0, (w.start || 0) - clipStart), end: Math.max(0.1, (w.end || 0) - clipStart) }));
  }

  let ass = `[Script Info]
Title: L2S Professional Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamily},${fontSize},${primaryCol},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Chunk into 3-4 word lines with safe escaping and active highlight tags
  const chunkSize = presetId === 'pop' ? 2 : 4;
  for (let i = 0; i < words.length; i += chunkSize) {
    const group = words.slice(i, i + chunkSize);
    for (let j = 0; j < group.length; j++) {
      const activeW = group[j];
      const start = formatASSTimeLocal(activeW.start);
      const nextW = group[j + 1];
      const end = formatASSTimeLocal(nextW ? nextW.start : (activeW.end + 0.1));

      let lineText = '';
      for (let k = 0; k < group.length; k++) {
        let txt = group[k].word || '';
        if (textCase === 'uppercase') txt = txt.toUpperCase();
        else if (textCase === 'capitalize') txt = txt.charAt(0).toUpperCase() + txt.slice(1);
        txt = txt.replace(/\\/g, '/').replace(/\{/g, '｛').replace(/\}/g, '｝');

        if (k === j) {
          lineText += `{\\c${highlightCol}\\fscx110\\fscy110}${txt}{\\c${primaryCol}\\fscx100\\fscy100} `;
        } else {
          lineText += `${txt} `;
        }
      }
      ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,${lineText.trim()}\n`;
    }
  }

  downloadTextFile(ass, `clip-${(editingClipIndex + 1) || 1}-subtitles.ass`, 'text/plain');
  showToast('Downloaded professional .ASS subtitles!', 'success');
});

// ─── Aspect Ratio Logic ─────────────────────
function setEditorRatio(ratio) {
  currentEditorRatio = ratio;
  
  els.ratioSelector.querySelectorAll('.ratio-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-ratio') === ratio);
  });

  const ratioMap = {
    '9:16': '9/16',
    '16:9': '16/9',
    '1:1': '1/1',
    '4:5': '4/5',
  };
  els.editorCanvasContainer.style.aspectRatio = ratioMap[ratio] || '9/16';
  
  if (els.editorValRatio) {
    els.editorValRatio.textContent = ratio;
  }
}

// Ratio selector click handlers
els.ratioSelector.querySelectorAll('.ratio-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const ratio = btn.getAttribute('data-ratio');
    setEditorRatio(ratio);
  });
});

// ─── Captions Toggle ────────────────────────
els.editorCaptionsToggle.addEventListener('change', () => {
  const enabled = els.editorCaptionsToggle.checked;
  if (els.editorValCaptions) els.editorValCaptions.textContent = enabled ? 'ON' : 'OFF';
  if (currentClipData) {
    currentClipData.custom = currentClipData.custom || {};
    currentClipData.custom.captionsEnabled = enabled;
    renderEditorCaption(els.editorVideo.currentTime);
  }
});

// ─── Volume Controls ────────────────────────
els.volumeToggle.addEventListener('click', () => {
  const vid = els.editorVideo;
  vid.muted = !vid.muted;
  const iconOn = els.volumeToggle.querySelector('.vol-icon-on');
  const iconOff = els.volumeToggle.querySelector('.vol-icon-off');
  if (vid.muted) {
    iconOn.style.display = 'none';
    iconOff.style.display = 'block';
  } else {
    iconOn.style.display = 'block';
    iconOff.style.display = 'none';
  }
});

els.volumeSlider.addEventListener('input', () => {
  els.editorVideo.volume = parseFloat(els.volumeSlider.value);
  if (els.editorVideo.muted && parseFloat(els.volumeSlider.value) > 0) {
    els.editorVideo.muted = false;
    els.volumeToggle.querySelector('.vol-icon-on').style.display = 'block';
    els.volumeToggle.querySelector('.vol-icon-off').style.display = 'none';
  }
});

function updateEditorLabels() {
  if (!currentClipData) return;

  const start = parseFloat(els.editorStart.value);
  const end = parseFloat(els.editorEnd.value);
  let len = end - start;
  if (len < 0) len = 0;
  els.editorValLength.textContent = `${len.toFixed(1)}s`;

  const zoom = Math.min(3.0, Math.max(0.1, parseFloat(els.editorZoom.value) || 1.0));
  els.editorValZoom.textContent = `${zoom.toFixed(1)}x`;

  const bright = 0.0;
  const contrast = parseFloat(els.editorContrast.value);
  const exposure = parseFloat(els.editorExposure.value);
  const saturation = parseFloat(els.editorSaturation.value);
  const sharpen = parseFloat(els.editorSharpen.value);
  
  els.editorValContrast.textContent = contrast.toFixed(2);
  els.editorValExposure.textContent = exposure.toFixed(2);
  els.editorValSaturation.textContent = saturation.toFixed(2);
  els.editorValSharpen.textContent = sharpen.toFixed(2);

  const cssBright = 1 + bright + exposure;
  els.editorVideo.style.filter = `brightness(${cssBright}) contrast(${contrast}) saturate(${saturation})`;

  const panX = currentClipData.panX ?? 0;
  const panY = currentClipData.panY ?? 0;
  els.editorVideo.style.transform = `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${zoom})`;

  // Synchronize quick zoom preset chips
  document.querySelectorAll('.btn-zoom-chip').forEach(c => {
    const cVal = parseFloat(c.dataset.zoom);
    if (Math.abs(cVal - zoom) < 0.08) {
      c.classList.add('active');
    } else {
      c.classList.remove('active');
    }
  });
}

// Drag logic for Canvas Video
let isDraggingCanvas = false;
let startDragX = 0;
let startDragY = 0;
let initialPanX = 0;
let initialPanY = 0;

els.editorCanvasContainer.addEventListener('mousedown', (e) => {
  isDraggingCanvas = true;
  startDragX = e.clientX;
  startDragY = e.clientY;
  initialPanX = currentClipData.panX ?? 0;
  initialPanY = currentClipData.panY ?? 0;
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!isDraggingCanvas || !currentClipData) return;
  const deltaX = e.clientX - startDragX;
  const deltaY = e.clientY - startDragY;
  
  currentClipData.panX = initialPanX + deltaX;
  currentClipData.panY = initialPanY + deltaY;
  updateEditorLabels();
});

window.addEventListener('mouseup', () => {
  isDraggingCanvas = false;
});

// Responsive Trimming (Scrubbing)
els.editorStart.addEventListener('input', () => {
  const start = parseFloat(els.editorStart.value);
  if (els.editorVideo.readyState >= 1) {
    els.editorVideo.currentTime = start;
  }
  updateEditorLabels();
});

// Editor Event Listeners
[els.editorEnd, els.editorZoom, els.editorExposure, els.editorContrast, els.editorSaturation, els.editorSharpen].forEach(el => {
  if(el) el.addEventListener("input", updateEditorLabels);
});

els.editorCloseBtn.addEventListener("click", requestCloseEditor);
els.editorCancelBtn.addEventListener("click", requestCloseEditor);

els.editorSaveBtn.addEventListener("click", async () => {
  if (editingClipIndex >= 0 && currentClipData) {
    const start = parseFloat(els.editorStart.value);
    const end = parseFloat(els.editorEnd.value);
    if (start >= end) {
      showToast("Start time must be before end time", "error");
      return;
    }

    allClips[editingClipIndex].editStart = start;
    allClips[editingClipIndex].editEnd = end;
    allClips[editingClipIndex].duration = Math.round(end - start);
    allClips[editingClipIndex].zoom = parseFloat(els.editorZoom.value);
    allClips[editingClipIndex].panX = currentClipData.panX;
    allClips[editingClipIndex].panY = currentClipData.panY;
    
    const containerHeight = els.editorCanvasContainer.clientHeight || 320;
    allClips[editingClipIndex].normPanX = currentClipData.panX / containerHeight;
    allClips[editingClipIndex].normPanY = currentClipData.panY / containerHeight;
    
    allClips[editingClipIndex].brightness = 0.0;
    allClips[editingClipIndex].contrast = parseFloat(els.editorContrast.value);
    allClips[editingClipIndex].exposure = parseFloat(els.editorExposure.value);
    allClips[editingClipIndex].saturation = parseFloat(els.editorSaturation.value);
    allClips[editingClipIndex].sharpen = parseFloat(els.editorSharpen.value);
    allClips[editingClipIndex].aspectRatio = currentEditorRatio;
    allClips[editingClipIndex].captionsEnabled = els.editorCaptionsToggle.checked;
    
    const cards = els.reviewGrid.querySelectorAll(".clip-card");
    if (cards[editingClipIndex]) {
      const durBadge = cards[editingClipIndex].querySelector(".badge-duration");
      if (durBadge) durBadge.textContent = `${allClips[editingClipIndex].duration}s`;
    }

    await saveEditorCaptions();
    showToast("Clip settings & captions saved!", "success");
    closeEditor();
  }
});

// Find & Replace in All Clips Handler
document.getElementById('btn-editor-replace-all')?.addEventListener('click', async () => {
  if (!currentJobId) {
    showToast('No active rendered job to replace captions', 'error');
    return;
  }
  const findVal = document.getElementById('editor-find-input')?.value;
  const replaceVal = document.getElementById('editor-replace-input')?.value;
  const caseSensitive = document.getElementById('editor-replace-case-sensitive')?.checked || false;

  if (!findVal) {
    showToast('Please enter text to find', 'warning');
    return;
  }

  try {
    const res = await fetch(`/api/clips/${currentJobId}/captions/replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ find: findVal, replace: replaceVal || '', caseSensitive }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Replace failed');
    showToast(`Replaced: ${data.changedWords} words updated across all clips!`, 'success');
    if (editingClipIndex >= 0) {
      loadCaptionsForEditor(editingClipIndex);
    }
  } catch (err) {
    showToast(`Replace error: ${err.message}`, 'error');
  }
});

// Apply & Fast Re-Render Button (Step 4)
document.getElementById('editor-rerender-btn')?.addEventListener('click', async () => {
  if (editingClipIndex >= 0 && currentClipData) {
    const btn = document.getElementById('editor-rerender-btn');
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Re-rendering...</span>';

    try {
      await saveEditorCaptions();

      if (!currentJobId) {
        // Fallback to legacy re-render if not part of a job
        const clipData = allClips[editingClipIndex];
        const res = await fetch('/api/re-render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clipIndex: editingClipIndex, clipData }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Re-render failed');
        showToast('Re-rendering queued!', 'success');
        return;
      }

      const clipNum = editingClipIndex + 1;
      const res = await fetch(`/api/clips/${currentJobId}/${clipNum}/rerender`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.status === 409) {
        showToast('Re-render already in progress for this clip', 'warning');
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Re-render failed');

      showToast(`Clip ${clipNum} re-rendered successfully!`, 'success');
      if (data.fileUrl && els.editorVideo) {
        els.editorVideo.src = `${data.fileUrl}&t=${Date.now()}`;
        els.editorVideo.load();
        els.editorVideo.play().catch(() => {});
      }

      // Update card in results list
      const resultCard = els.resultsList?.querySelector(`[data-result-index="${editingClipIndex}"]`);
      if (resultCard && data.fileUrl) {
        const vid = resultCard.querySelector('video');
        if (vid) vid.src = `${data.fileUrl}&t=${Date.now()}`;
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
});

// Sane Keyboard Shortcuts (Esc closes with dirty check, Ctrl+S saves)
window.addEventListener('keydown', (e) => {
  if (!els.editorModal?.classList.contains('visible')) return;
  if (e.key === 'Escape') {
    requestCloseEditor();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    els.editorSaveBtn.click();
  }
});

// ─── Timestamp Logic ─────────────────────────

// Parse time string "mm:ss" or "h:mm:ss" to seconds
function parseTimeStr(str) {
  if (!str || !str.trim()) return NaN;
  const parts = str.trim().split(':').map(Number);
  if (parts.some(isNaN)) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return NaN;
}

// Get all valid timestamps as [{start, end}]
function getTimestamps() {
  const result = [];

  // 1. Gather all added chips from #ts-chip-list
  const chipContainer = els.tsChipList || document.getElementById('ts-chip-list');
  if (chipContainer) {
    const chips = chipContainer.querySelectorAll('.ts-chip');
    chips.forEach(chip => {
      const start = parseFloat(chip.dataset.start);
      const end = parseFloat(chip.dataset.end);
      if (!isNaN(start) && !isNaN(end) && end > start) {
        result.push({ start, end });
      }
    });
  }

  // 2. Check if user typed into #ts-start / #ts-end directly without clicking "+ Add"
  const startInput = els.tsStart || document.getElementById('ts-start');
  const endInput = els.tsEnd || document.getElementById('ts-end');
  if (startInput && endInput && startInput.value.trim() && endInput.value.trim()) {
    const start = parseTimeStr(startInput.value.trim());
    const end = parseTimeStr(endInput.value.trim());
    if (!isNaN(start) && !isNaN(end) && end > start) {
      if (!result.some(r => Math.abs(r.start - start) < 0.1 && Math.abs(r.end - end) < 0.1)) {
        result.push({ start, end });
      }
    }
  }

  // 3. Fallback: check #timestamp-rows if present
  if (els.timestampRows) {
    const rows = els.timestampRows.querySelectorAll('.timestamp-row');
    rows.forEach(row => {
      const startStr = row.querySelector('.ts-start')?.value;
      const endStr = row.querySelector('.ts-end')?.value;
      const start = parseTimeStr(startStr);
      const end = parseTimeStr(endStr);
      if (!isNaN(start) && !isNaN(end) && end > start) {
        if (!result.some(r => Math.abs(r.start - start) < 0.1 && Math.abs(r.end - end) < 0.1)) {
          result.push({ start, end });
        }
      }
    });
  }

  return result;
}

// ─── Workspace Manual Timestamp Chips (#ts-add-btn & #ts-chip-list) ───
(function initTimestampControls() {
  const addBtn = els.tsAddBtn || document.getElementById('ts-add-btn');
  const startInput = els.tsStart || document.getElementById('ts-start');
  const endInput = els.tsEnd || document.getElementById('ts-end');
  const chipList = els.tsChipList || document.getElementById('ts-chip-list');
  const modeToggle = els.tsModeToggle || document.getElementById('ts-mode-toggle');

  function updateToggleVisibility() {
    if (!modeToggle) return;
    const count = chipList ? chipList.querySelectorAll('.ts-chip').length : 0;
    modeToggle.style.display = count > 0 ? 'block' : 'none';
  }

  function addChip(start, end) {
    if (!chipList) return;
    const chip = document.createElement('div');
    chip.className = 'ts-chip';
    chip.dataset.start = start;
    chip.dataset.end = end;
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:rgba(139,92,246,0.18);border:1px solid rgba(139,92,246,0.35);padding:4px 10px;border-radius:20px;font-size:0.75rem;margin:3px 4px 3px 0;color:#e2e8f0;';
    chip.innerHTML = `
      <span>⏱️ ${formatDuration(start)} → ${formatDuration(end)} (${(end - start).toFixed(0)}s)</span>
      <button type="button" class="ts-chip-remove" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;line-height:1;padding:0 2px" title="Remove">&times;</button>
    `;
    chip.querySelector('.ts-chip-remove').addEventListener('click', () => {
      chip.remove();
      updateToggleVisibility();
    });
    chipList.appendChild(chip);
    updateToggleVisibility();
  }

  addBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!startInput || !endInput) return;
    const start = parseTimeStr(startInput.value.trim());
    const end = parseTimeStr(endInput.value.trim());

    if (isNaN(start) || isNaN(end)) {
      showToast('Please enter valid timestamps (e.g. 1:20 to 2:05)', 'warning');
      return;
    }
    if (end <= start) {
      showToast('End time must be greater than start time', 'warning');
      return;
    }
    addChip(start, end);
    startInput.value = '';
    endInput.value = '';
    startInput.focus();
  });

  // Enter key support in end input
  endInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBtn?.click();
    }
  });

  // Preview seek on startInput blur
  startInput?.addEventListener('blur', () => {
    const time = parseTimeStr(startInput.value.trim());
    if (!isNaN(time) && els.workspaceLocalVideo?.readyState >= 1) {
      els.workspaceLocalVideo.currentTime = time;
    }
  });
})();

// Legacy/Alternative row support
let tsCounter = 1;
els.btnAddTs?.addEventListener('click', () => {
  if (!els.timestampRows) return;
  const row = document.createElement('div');
  row.className = 'timestamp-row';
  row.setAttribute('data-ts-index', tsCounter++);
  row.innerHTML = `
    <input type="text" class="ts-start" placeholder="0:00" />
    <span class="timestamp-sep">→</span>
    <input type="text" class="ts-end" placeholder="0:30" />
    <button type="button" class="btn-remove-ts" title="Remove">×</button>
  `;
  els.timestampRows.appendChild(row);
  bindRemoveBtn(row.querySelector('.btn-remove-ts'));
  bindTimestampRow(row);
  row.querySelector('.ts-start').focus();
});

// ─── FIX: Bind timestamp row inputs ──────────
// Uses 'blur' for video seeking (not 'change') so tabbing does NOT trigger seeks
// Uses 'keydown' to prevent Enter from submitting the form
function bindTimestampRow(row) {
  const startInput = row.querySelector('.ts-start');
  const endInput = row.querySelector('.ts-end');

  if (!startInput || !endInput) return;

  // Helper: parse time string to seconds
  function validateTime(str) {
    if (!str) return NaN;
    const parts = str.match(/^(\d+):(\d+):?(\d+)?$|^(\d+(?:\.\d+)?)$/);
    if (!parts) return NaN;
    
    if (parts[4] !== undefined) {
      // Seconds only: "30" → 30
      return parseFloat(parts[4]);
    } else {
      // mm:ss or mm:ss:ms format
      const min = parseInt(parts[1], 10);
      const sec = parseInt(parts[2], 10);
      const ms = parts[3] ? parseInt(parts[3], 10) : 0;
      return min * 60 + sec + ms / 1000;
    }
  }

  // Seek video when user LEAVES the field (blur) — not on change/Enter
  startInput.addEventListener('blur', () => {
    const time = validateTime(startInput.value);
    if (!isNaN(time) && els.workspaceLocalVideo?.readyState >= 1) {
      els.workspaceLocalVideo.currentTime = time;
    }
    
    // Auto-add new row if both fields filled
    const end = validateTime(endInput.value);
    if (!isNaN(time) && !isNaN(end) && end > time) {
      const lastRow = document.querySelector('.timestamp-row:last-of-type');
      if (lastRow === row) {
        // Check if there's already an empty row below
        const allRows = document.querySelectorAll('.timestamp-row');
        const nextEmpty = Array.from(allRows).find(r => 
          !validateTime(r.querySelector('.ts-start')?.value) &&
          !validateTime(r.querySelector('.ts-end')?.value)
        );
        
        if (!nextEmpty) {
          // Only add if this was the last row and it's now complete
          setTimeout(() => els.btnAddTs?.click(), 100);
        }
      }
    }
  });

  endInput.addEventListener('blur', () => {
    const time = validateTime(endInput.value);
    if (!isNaN(time) && els.workspaceLocalVideo?.readyState >= 1) {
      els.workspaceLocalVideo.currentTime = time;
    }
    
    // Auto-add new row if both fields filled
    const start = validateTime(startInput.value);
    if (!isNaN(start) && !isNaN(time) && time > start) {
      const lastRow = document.querySelector('.timestamp-row:last-of-type');
      if (lastRow === row) {
        const allRows = document.querySelectorAll('.timestamp-row');
        const nextEmpty = Array.from(allRows).find(r => 
          !validateTime(r.querySelector('.ts-start')?.value) &&
          !validateTime(r.querySelector('.ts-end')?.value)
        );
        
        if (!nextEmpty) {
          setTimeout(() => els.btnAddTs?.click(), 100);
        }
      }
    }
  });

  // Handle key down on both inputs
  [startInput, endInput].forEach((input, idx) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        // Allow default Tab behavior (move to next field)
        return;
      }
      
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        
        if (idx === 0) {
          // In start input: move to end input on Enter
          endInput.focus();
          endInput.select();
        } else {
          // In end input: trigger add new row on Enter
          const start = validateTime(startInput.value);
          const end = validateTime(endInput.value);
          
          if (!isNaN(start) && !isNaN(end) && end > start) {
            // Valid range: add new row
            setTimeout(() => els.btnAddTs?.click(), 0);
          } else {
            // Invalid: show hint
            showToast('Invalid time range. End must be after start.', 'warning');
          }
        }
      }
    });
  });
}

// Remove timestamp row
function bindRemoveBtn(btn) {
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const row = btn.closest('.timestamp-row');
    if (row) {
      row.style.animation = 'none';
      row.style.opacity = '0';
      row.style.transform = 'translateX(-10px)';
      row.style.transition = 'all 0.2s ease';
      setTimeout(() => row.remove(), 200);
    }
  });
}

// Bind existing remove buttons
els.timestampRows?.querySelectorAll('.btn-remove-ts').forEach(bindRemoveBtn);

// ─── Quality Selector & Chips ────────────────
(function initQualitySelector() {
  const qualitySelect = document.getElementById('quality-select');
  if (qualitySelect) {
    qualitySelect.addEventListener('change', (e) => {
      videoQuality = e.target.value;
      // Sync chip UI
      document.querySelectorAll('#source-quality-chips .gen-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.quality === videoQuality);
      });
      if (typeof checkQualityMismatch === 'function') checkQualityMismatch();
    });
  }

  // Source Quality Chips (IMAGE 1)
  const sourceChips = document.querySelectorAll('#source-quality-chips .gen-chip');
  if (sourceChips && sourceChips.length > 0) {
    sourceChips.forEach(chip => {
      chip.addEventListener('click', () => {
        sourceChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        videoQuality = chip.dataset.quality || 'best';
        if (qualitySelect) qualitySelect.value = videoQuality;
        if (typeof checkQualityMismatch === 'function') checkQualityMismatch();
      });
    });
  }

  const exportChips = document.querySelectorAll('#export-profile-chips .export-chip');
  const exportProfileHints = {
    fast: '⚡ Fast: High-speed draft render (H.264 CQ 28 / CRF 26, 128k AAC audio, 30fps CFR)',
    balanced: '⚖️ Balanced: Optimal clarity & render speed (H.264 CQ 22 / CRF 22, 192k AAC audio, fast-start)',
    high: '💎 High Quality: Pristine for YouTube Shorts & Reels (H.264 CQ 18 / CRF 18, 256k audio, max 60fps)',
    max: '👑 Maximum: Studio master fidelity (H.264 CQ 15 / CRF 15, 320k studio audio, near lossless)',
  };

  if (exportChips && exportChips.length > 0) {
    exportChips.forEach(chip => {
      chip.addEventListener('click', () => {
        exportChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        exportQuality = chip.dataset.profile || 'balanced';
        const hintEl = document.getElementById('export-profile-hint');
        if (hintEl) {
          hintEl.textContent = exportProfileHints[exportQuality] || exportProfileHints.balanced;
        }
      });
    });
  }

  // Detect and display GPU status badge
  fetch('/api/export-profiles').then(r => r.json()).then(data => {
    const badge = document.getElementById('export-profile-badge');
    if (badge && data.detectedEncoder) {
      const isGpu = data.detectedEncoder.codec.includes('nvenc');
      badge.textContent = isGpu ? '⚡ NVENC GPU' : '💻 CPU libx264';
      badge.style.color = isGpu ? 'var(--accent-cyan)' : 'var(--text-muted)';
    }
  }).catch(() => {});
})();

// ─── Publish Section Logic ───────────────────
let platformConnections = { instagram: false, youtube: false };

// ─── Setup Guide Toggle ─────────────────────
const setupGuideToggle = $('#setup-guide-toggle');
const setupGuidePanel = $('#setup-guide-panel');
if (setupGuideToggle && setupGuidePanel) {
  setupGuideToggle.addEventListener('click', () => {
    setupGuideToggle.classList.toggle('open');
    setupGuidePanel.classList.toggle('open');
  });
}

// ─── Connection Status ──────────────────────
async function checkConnectionStatus() {
  try {
    const res = await fetch('/api/connection-status');
    const data = await res.json();

    if (data.connections) {
      if (data.connections.youtube?.connected) {
        setPlatformConnected('youtube', data.connections.youtube.username);
      } else if (data.connections.youtube?.needsReconnect) {
        const ytStatus = document.getElementById('settings-yt-status');
        if (ytStatus) {
          ytStatus.textContent = 'Session Expired — Reconnect Required';
          ytStatus.style.color = '#ff4d4f';
        }
      }

      if (data.connections.instagram?.enabled === false) {
        const igRow = document.getElementById('settings-row-ig');
        if (igRow) igRow.style.display = 'none';
      } else if (data.connections.instagram?.connected) {
        setPlatformConnected('instagram', data.connections.instagram.username);
      }
    }

    // Show YouTube Quota badge if YouTube is connected
    if (data.ytQuota) {
      updateYouTubeQuotaBadge(data.ytQuota);
    }

    // Show Instagram localhost warning if running locally
    checkInstagramLocalhostWarning();

  } catch (e) {
    // Server not ready yet
  }
}

function checkInstagramLocalhostWarning() {
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const warnEl = document.getElementById('ig-localhost-warn');
  if (warnEl) {
    warnEl.style.display = isLocalhost ? 'block' : 'none';
  }
}

function updateYouTubeQuotaBadge(quota) {
  const badgeEl = document.getElementById('yt-quota-badge');
  if (!badgeEl || !quota) return;

  const uploadsToday = quota.user?.uploadsToday ?? quota.uploadsToday ?? 0;
  const maxUploads = quota.user?.userLimit ?? quota.maxUploads ?? 2;
  const isDanger = Boolean(quota.isAppAtLimit || quota.user?.isUserAtLimit || quota.isAtLimit);
  const pct = Math.min(100, Math.round((uploadsToday / Math.max(1, maxUploads)) * 100));

  badgeEl.innerHTML = `
    <div class="quota-bar-row">
      <span class="quota-label">📊 Today's Uploads: <strong>${uploadsToday} / ${maxUploads}</strong></span>
      <span class="quota-reset">Resets midnight PT</span>
    </div>
    <div class="quota-bar">
      <div class="quota-bar-fill ${isDanger ? 'danger' : ''}" style="width:${Math.max(pct, 4)}%"></div>
    </div>
    ${isDanger ? '<div class="quota-limit-msg error">⛔ Daily upload limit reached. Quota resets at midnight Pacific Time.</div>' : ''}
  `;
  badgeEl.style.display = 'block';
}

function setPlatformConnected(platform, username) {
  platformConnections[platform] = true;
  const statusEl = platform === 'youtube' ? els.ytStatus : els.igStatus;
  const btnEl = platform === 'youtube' ? els.btnConnectYt : els.btnConnectIg;

  statusEl.textContent = username || 'Connected';
  statusEl.classList.add('connected');
  btnEl.innerHTML = `✓ Connected`;
  btnEl.classList.add('connected');

  // Show quota badge when YouTube connects
  if (platform === 'youtube') {
    fetch('/api/youtube-quota')
      .then(r => r.json())
      .then(q => updateYouTubeQuotaBadge(q))
      .catch(() => {});
  }

  updatePublishButton();
}

function setPlatformDisconnected(platform) {
  platformConnections[platform] = false;
  const statusEl = platform === 'youtube' ? els.ytStatus : els.igStatus;
  const btnEl = platform === 'youtube' ? els.btnConnectYt : els.btnConnectIg;

  statusEl.textContent = 'Not Connected';
  statusEl.classList.remove('connected');
  btnEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Connect`;
  btnEl.classList.remove('connected');
  updatePublishButton();
}

function updatePublishButton() {
  const anyConnected = platformConnections.instagram || platformConnections.youtube;
  const hasFiles = renderedFiles.length > 0 || selectedClips.size > 0;
  if (els.btnPublish) {
    els.btnPublish.disabled = !(anyConnected && hasFiles);
  }
}

checkConnectionStatus();

// Listen for OAuth callback from popup window
window.addEventListener('message', (event) => {
  if (event.data?.type === 'oauth_callback') {
    const { platform, success, username, error } = event.data;
    if (success) {
      setPlatformConnected(platform, username);
      showToast(`${platform.charAt(0).toUpperCase() + platform.slice(1)} connected as ${username}!`, 'success');
    } else {
      showToast(`${platform} auth failed: ${error || 'Unknown error'}`, 'error');
    }
  }
});

// ─── Instagram Connect ──────────────────────
els.btnConnectIg?.addEventListener('click', async () => {
  if (platformConnections.instagram) {
    try {
      await fetch('/api/disconnect/instagram', { method: 'POST' });
      setPlatformDisconnected('instagram');
      showToast('Instagram disconnected', 'info');
    } catch (err) {
      showToast('Failed to disconnect Instagram', 'error');
    }
    return;
  }

  try {
    const res = await fetch('/api/connect/instagram', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      setPlatformConnected('instagram', data.username);
      showToast('Instagram connected!', 'success');
    } else if (data.authUrl) {
      window.open(data.authUrl, '_blank', 'width=600,height=700');
      showToast('Complete login in the popup window', 'info');
    } else if (data.needsSetup) {
      setupGuideToggle?.classList.add('open');
      setupGuidePanel?.classList.add('open');
      showToast(data.message || 'OAuth not configured. See Setup Guide.', 'warning');
    } else {
      showToast(data.message || 'OAuth not configured yet', 'warning');
    }
  } catch (err) {
    showToast('Failed to connect Instagram', 'error');
  }
});

// ─── YouTube Connect ────────────────────────
els.btnConnectYt?.addEventListener('click', async () => {
  if (platformConnections.youtube) {
    try {
      await fetch('/api/disconnect/youtube', { method: 'POST' });
      setPlatformDisconnected('youtube');
      showToast('YouTube disconnected', 'info');
    } catch (err) {
      showToast('Failed to disconnect YouTube', 'error');
    }
    return;
  }

  try {
    const res = await fetch('/api/connect/youtube', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      setPlatformConnected('youtube', data.username);
      showToast('YouTube connected!', 'success');
    } else if (data.authUrl) {
      window.open(data.authUrl, '_blank', 'width=600,height=700');
      showToast('Complete login in the popup window', 'info');
    } else if (data.needsSetup) {
      setupGuideToggle?.classList.add('open');
      setupGuidePanel?.classList.add('open');
      showToast(data.message || 'OAuth not configured. See Setup Guide.', 'warning');
    } else {
      showToast(data.message || 'OAuth not configured yet', 'warning');
    }
  } catch (err) {
    showToast('Failed to connect YouTube', 'error');
  }
});

// ─── Auto-Fill Buttons ──────────────────────
function getFirstClipContent() {
  const selectedArr = Array.from(selectedClips);
  if (selectedArr.length > 0 && allClips[selectedArr[0]]) {
    return allClips[selectedArr[0]];
  }
  if (allClips.length > 0) {
    return allClips[0];
  }
  return null;
}

function autoFillField(fieldId, value, btnId) {
  const field = $(`#${fieldId}`);
  const btn = $(`#${btnId}`);
  if (field && value) {
    field.value = value;
    if (btn) {
      btn.classList.add('filled');
      btn.textContent = '✅ Filled';
      setTimeout(() => {
        btn.textContent = '🤖 AI Fill';
        btn.classList.remove('filled');
      }, 2000);
    }
  } else {
    showToast('No AI content available yet. Generate clips first.', 'warning');
  }
}

$('#btn-autofill-ig-caption')?.addEventListener('click', () => {
  const clip = getFirstClipContent();
  if (clip) {
    const caption = `${clip.caption || ''}\n\n${clip.hashtags || ''}\n\n🔥 Follow for more!`;
    autoFillField('ig-caption', caption.trim(), 'btn-autofill-ig-caption');
  } else {
    showToast('No AI content available. Generate clips first.', 'warning');
  }
});

$('#btn-autofill-ig-tags')?.addEventListener('click', () => {
  const clip = getFirstClipContent();
  autoFillField('ig-hashtags', clip?.hashtags || '#reels #viral #trending', 'btn-autofill-ig-tags');
});

$('#btn-autofill-yt-title')?.addEventListener('click', () => {
  const clip = getFirstClipContent();
  autoFillField('yt-title', clip ? `${clip.title} #Shorts` : '', 'btn-autofill-yt-title');
});

$('#btn-autofill-yt-desc')?.addEventListener('click', () => {
  const clip = getFirstClipContent();
  if (clip) {
    const desc = `${clip.description || ''}\n\n${clip.hashtags || ''}\n\n📌 Subscribe for more content!`;
    autoFillField('yt-description', desc.trim(), 'btn-autofill-yt-desc');
  } else {
    showToast('No AI content available. Generate clips first.', 'warning');
  }
});

$('#btn-autofill-yt-tags')?.addEventListener('click', () => {
  const clip = getFirstClipContent();
  const tags = clip?.hashtags
    ? clip.hashtags.replace(/#/g, '').split(/\s+/).filter(Boolean).join(', ')
    : 'shorts, viral, trending';
  autoFillField('yt-tags', tags, 'btn-autofill-yt-tags');
});

// ─── Publish Progress ───────────────────────
const publishProgressEl = $('#publish-progress');

function updatePublishProgress(clipIndex, total, status, result) {
  if (!publishProgressEl) return;

  let statusRow = publishProgressEl.querySelector(`[data-publish-clip="${clipIndex}"]`);

  if (!statusRow) {
    statusRow = document.createElement('div');
    statusRow.className = 'publish-clip-status';
    statusRow.setAttribute('data-publish-clip', clipIndex);
    statusRow.innerHTML = `
      <span class="clip-label">Clip ${clipIndex + 1}</span>
      <div class="clip-platforms"></div>
    `;
    publishProgressEl.appendChild(statusRow);
  }

  const platformsEl = statusRow.querySelector('.clip-platforms');

  if (status === 'uploading') {
    platformsEl.innerHTML = '';
    if (platformConnections.youtube) {
      platformsEl.innerHTML += `<span class="publish-platform-tag uploading">📺 YouTube — Uploading...</span>`;
    }
    if (platformConnections.instagram) {
      platformsEl.innerHTML += `<span class="publish-platform-tag uploading">📱 Instagram — Uploading...</span>`;
    }
  } else if (status === 'done' || status === 'error') {
    platformsEl.innerHTML = '';
    if (result?.youtube) {
      const ytClass = result.youtube.success ? 'done' : 'error';
      const ytText = result.youtube.success ? `✅ Published` : `❌ ${result.youtube.error || 'Failed'}`;
      platformsEl.innerHTML += `<span class="publish-platform-tag ${ytClass}">📺 YouTube — ${ytText}</span>`;
    }
    if (result?.instagram) {
      const igClass = result.instagram.success ? 'done' : 'error';
      const igText = result.instagram.success ? `✅ Published` : `❌ ${result.instagram.error || 'Failed'}`;
      platformsEl.innerHTML += `<span class="publish-platform-tag ${igClass}">📱 Instagram — ${igText}</span>`;
    }
  }
}

// ─── Publish Clips ──────────────────────────
els.btnPublish?.addEventListener('click', async () => {
  if (els.btnPublish?.disabled) return;
  if (els.btnPublish) {
    els.btnPublish.disabled = true;
    els.btnPublish.classList.add('loading');
  }

  if (publishProgressEl) publishProgressEl.innerHTML = '';

  const workflow = {
    instagram: platformConnections.instagram ? {
      caption: $('#ig-caption')?.value || '{caption}\n\n{hashtags}',
      hashtags: $('#ig-hashtags')?.value || '',
    } : null,
    youtube: platformConnections.youtube ? {
      title: $('#yt-title')?.value || '{title} #Shorts',
      description: $('#yt-description')?.value || '{description}\n\n{hashtags}',
      tags: $('#yt-tags')?.value || 'shorts, viral, trending',
      audience: $('#yt-audience')?.value || 'all',
      visibility: $('#yt-visibility')?.value || 'public',
    } : null,
  };

  try {
    const selectedArr = Array.from(selectedClips).map(i => allClips[i]).filter(Boolean);
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clips: selectedArr,
        files: renderedFiles,
        workflow,
      }),
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Publishing started...', 'info');
    } else {
      showToast(data.message || 'Publish failed', 'error');
      els.btnPublish.disabled = false;
      els.btnPublish.classList.remove('loading');
    }
  } catch (err) {
    showToast('Publish failed: ' + err.message, 'error');
    els.btnPublish.disabled = false;
    els.btnPublish.classList.remove('loading');
  }
});

// ─── Pre-Generate Ratio & Zoom ───────────────
(function initPreGen() {
  const ratioChips = document.querySelectorAll('#ratio-chips .gen-chip');
  const zoomSlider = document.getElementById('pre-gen-zoom-slider');
  const zoomVal = document.getElementById('pre-gen-zoom-val');
  const ratioDisplay = document.getElementById('current-ratio-display');
  const ratioSelect = document.getElementById('pre-gen-ratio-select');
  const reframeSelect = document.getElementById('pre-gen-reframe-mode');

  if (reframeSelect) {
    reframeSelect.addEventListener('change', () => {
      preGenReframeMode = reframeSelect.value || 'auto';
    });
  }

  // Also support legacy ratio buttons if present
  const ratioBtns = els.preGenRatioBtns;
  const legacyZoom = els.preGenZoom;

  if (ratioChips && ratioChips.length > 0) {
    ratioChips.forEach(chip => {
      chip.addEventListener('click', () => {
        ratioChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        preGenRatio = chip.dataset.ratio || '9:16';
        if (ratioDisplay) ratioDisplay.textContent = preGenRatio;
        if (ratioSelect) ratioSelect.value = preGenRatio;
      });
    });
  }

  // Ratio button clicks (legacy fallback)
  ratioBtns?.addEventListener('click', (e) => {
    const btn = e.target.closest('.ratio-btn');
    if (!btn) return;
    ratioBtns.querySelectorAll('.ratio-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    preGenRatio = btn.dataset.ratio;
    if (ratioDisplay) ratioDisplay.textContent = preGenRatio;
    if (ratioSelect) ratioSelect.value = preGenRatio;
  });

  // Zoom slider (redesigned)
  zoomSlider?.addEventListener('input', () => {
    preGenZoom = Math.min(3.0, Math.max(0.1, parseFloat(zoomSlider.value) || 1.0));
    if (zoomVal) zoomVal.textContent = `${preGenZoom.toFixed(1)}x`;
  });

  // Zoom slider (legacy)
  legacyZoom?.addEventListener('input', () => {
    preGenZoom = Math.min(3.0, Math.max(0.1, parseFloat(legacyZoom.value) || 1.0));
    if (els.preGenZoomVal) els.preGenZoomVal.textContent = `${preGenZoom.toFixed(1)}x`;
  });
})();

// ─── Number of Clips Chips & Custom Input ─────
(function initClipCountChips() {
  const countChips = document.querySelectorAll('#clip-count-chips .gen-chip');
  const countSelect = document.getElementById('clip-count-select');
  const customWrap = document.getElementById('custom-clip-count-input-wrap');
  const customInput = document.getElementById('custom-clip-count-input');

  if (countChips && countChips.length > 0) {
    countChips.forEach(chip => {
      chip.addEventListener('click', () => {
        countChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const count = chip.dataset.count;
        if (count === 'custom') {
          if (customWrap) customWrap.style.display = 'block';
          if (customInput) {
            customInput.focus();
            if (customInput.value) {
              clipCount = parseInt(customInput.value, 10) || 'auto';
            }
          }
        } else {
          if (customWrap) customWrap.style.display = 'none';
          clipCount = count === 'auto' ? 'auto' : parseInt(count, 10);
          if (countSelect) countSelect.value = count;
        }
      });
    });
  }

  if (customInput) {
    customInput.addEventListener('input', () => {
      const val = parseInt(customInput.value, 10);
      if (!isNaN(val) && val > 0) {
        clipCount = val;
      }
    });
  }
})();

// ─── How To Use These (Radio Pills) ───────────
(function initHowToUsePills() {
  const pills = document.querySelectorAll('#how-to-use-pills .how-pill, .how-to-use-pills .how-pill');
  const tsOnlyToggle = document.getElementById('ts-only-toggle');

  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const radio = pill.querySelector('input[type="radio"]');
      if (radio) {
        radio.checked = true;
        if (tsOnlyToggle) {
          tsOnlyToggle.checked = (radio.value === 'only');
        }
        updateClipCountVisibility();
      }
    });
  });
})();

// ─── Clip Mode & Count Visibility ─────────────
function updateClipCountVisibility() {
  const mode = document.querySelector('input[name="clip-mode"]:checked')?.value || 'add';
  const group = document.getElementById('clip-count-group');
  if (group) {
    group.style.display = mode === 'add' ? 'flex' : 'none';
  }
}
document.querySelectorAll('input[name="clip-mode"]').forEach(radio => {
  radio.addEventListener('change', updateClipCountVisibility);
});
updateClipCountVisibility();

// ─── Bottom Homepage System Status (Section 13) ───────────────
async function loadHomepageSystemStatus() {
  try {
    // 1. Providers (Ollama & Groq)
    const provRes = await fetch('/api/providers');
    if (provRes.ok) {
      const provData = await provRes.json();
      const ollama = provData.providers?.ollama;
      const groq = provData.providers?.groq;

      // Ollama Card
      const badgeOllama = document.getElementById('badge-ollama');
      const statOllamaDaemon = document.getElementById('stat-ollama-daemon');
      const statOllamaModel = document.getElementById('stat-ollama-model');
      const statOllamaInst = document.getElementById('stat-ollama-installed');

      if (ollama) {
        const isOnline = ollama.status === 'online';
        if (badgeOllama) {
          badgeOllama.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
          badgeOllama.className = `sys-badge ${isOnline ? 'badge-ok' : 'badge-warn'}`;
        }
        if (statOllamaDaemon) {
          statOllamaDaemon.textContent = isOnline ? 'Running (11434)' : 'Not Connected';
        }
        if (statOllamaModel) {
          statOllamaModel.textContent = ollama.selectedModel || 'llama3.2:3b';
        }
        if (statOllamaInst) {
          statOllamaInst.textContent = isOnline ? 'Ready (Local GPU/CPU)' : 'Daemon Inactive';
        }
      }

      // Groq Card
      const badgeGroq = document.getElementById('badge-groq');
      const statGroqApi = document.getElementById('stat-groq-api');
      const statGroqKey = document.getElementById('stat-groq-key');
      const statGroqModel = document.getElementById('stat-groq-model');

      if (groq) {
        const hasKey = !!groq.hasApiKey;
        if (badgeGroq) {
          badgeGroq.textContent = hasKey ? 'READY' : 'NEEDS KEY';
          badgeGroq.className = `sys-badge ${hasKey ? 'badge-ok' : 'badge-warn'}`;
        }
        if (statGroqApi) {
          statGroqApi.textContent = hasKey ? 'Configured (LPUs)' : 'Needs API Key';
        }
        if (statGroqKey) {
          statGroqKey.textContent = hasKey ? 'gsk_... (Configured)' : 'Missing';
        }
        if (statGroqModel) {
          statGroqModel.textContent = groq.selectedModel || 'llama-3.3-70b-versatile';
        }
      }
    }

    // 2. Engine & Hardware Status
    const [depRes, hwRes, storRes] = await Promise.allSettled([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/hardware').then(r => r.json()),
      fetch('/api/storage/status').then(r => r.json())
    ]);

    const statHwFfmpeg = document.getElementById('stat-hw-ffmpeg');
    const statHwYtdlp = document.getElementById('stat-hw-ytdlp');
    const statHwStorage = document.getElementById('stat-hw-storage');
    const badgeHw = document.getElementById('badge-hw');

    if (depRes.status === 'fulfilled' && depRes.value) {
      const deps = depRes.value;
      if (statHwYtdlp) {
        statHwYtdlp.textContent = deps.ytdlp ? 'Installed (Ready)' : 'Not Found';
      }
    }

    if (hwRes.status === 'fulfilled' && hwRes.value) {
      const hw = hwRes.value;
      if (statHwFfmpeg) {
        if (hw.gpu && hw.gpu.name && !hw.gpu.name.includes('None')) {
          statHwFfmpeg.textContent = `NVENC GPU (${hw.gpu.name.split(' ')[0]} / ${hw.gpu.vram || 'Active'})`;
        } else {
          statHwFfmpeg.textContent = 'CPU (libx264)';
        }
      }
    }

    if (storRes.status === 'fulfilled' && storRes.value) {
      const stor = storRes.value;
      if (statHwStorage) {
        const mb = stor.temp?.sizeBytes ? (stor.temp.sizeBytes / (1024 * 1024)).toFixed(1) : '0.0';
        statHwStorage.textContent = `${mb} MB Used (Clean)`;
      }
    }

    if (badgeHw) {
      badgeHw.textContent = 'READY';
      badgeHw.className = 'sys-badge badge-ok';
    }
  } catch (err) {
    console.warn('loadHomepageSystemStatus error:', err.message);
  }
}

// Initial load & refresh button
loadHomepageSystemStatus();
document.getElementById('btn-refresh-status')?.addEventListener('click', () => {
  loadHomepageSystemStatus();
  showToast('System status refreshed', 'success');
});

// ═══════════════════════════════════════════════════════════════════════════
// ─── SETTINGS MODAL, AI ENGINES & HARDWARE AUTO-DETECTION ───────────────────
// ═══════════════════════════════════════════════════════════════════════════

const btnSettingsTrigger = document.getElementById('btn-settings-trigger');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const settingsDoneBtn = document.getElementById('settings-done-btn');
const settingsLlmSelect = document.getElementById('settings-llm-select');
const settingsModelSelect = document.getElementById('settings-model-select');
const btnSaveModel = document.getElementById('btn-save-model');
const settingsModelHint = document.getElementById('settings-model-hint');
const settingsSttSelect = document.getElementById('settings-stt-select');
const settingsApiKeyGroup = document.getElementById('settings-api-key-group');
const settingsApiKeyLabel = document.getElementById('settings-api-key-label');
const settingsApiKeyInput = document.getElementById('settings-api-key-input');
const btnSaveApiKey = document.getElementById('btn-save-api-key');
const settingsApiKeyWarn = document.getElementById('settings-api-key-warn');
const settingsBtnClean = document.getElementById('settings-btn-clean');
const settingsBtnYt = document.getElementById('settings-btn-yt');
const settingsBtnIg = document.getElementById('settings-btn-ig');

async function openSettingsModal() {
  if (!settingsModal) return;
  settingsModal.classList.add('visible');
  await refreshSettingsModal();
}

function closeSettingsModal() {
  if (settingsModal) settingsModal.classList.remove('visible');
}

btnSettingsTrigger?.addEventListener('click', openSettingsModal);
document.getElementById('btn-open-settings-alert')?.addEventListener('click', openSettingsModal);
document.getElementById('btn-close-alert')?.addEventListener('click', hideGlobalAlert);
settingsClose?.addEventListener('click', closeSettingsModal);

async function loadModelsForProvider(providerId) {
  if (!settingsModelSelect) return;
  settingsModelSelect.innerHTML = '<option value="">Loading models...</option>';
  try {
    const res = await fetch(`/api/providers/models?provider=${providerId}`);
    const data = await res.json();
    if (data.models && data.models.length > 0) {
      settingsModelSelect.innerHTML = data.models
        .map(m => `<option value="${m}" ${m === data.activeModel ? 'selected' : ''}>${m}</option>`)
        .join('');
      if (settingsModelHint) {
        settingsModelHint.textContent = `Active ${providerId} model: ${data.activeModel || data.models[0]}`;
      }
    } else {
      settingsModelSelect.innerHTML = `<option value="">No models detected</option>`;
    }
  } catch (e) {
    settingsModelSelect.innerHTML = `<option value="">Error loading models</option>`;
  }
}

btnSaveModel?.addEventListener('click', async () => {
  const provider = settingsLlmSelect?.value || 'ollama';
  const model = settingsModelSelect?.value;
  if (!model) return;
  try {
    const res = await fetch('/api/providers/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model }),
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`AI Model set to: ${model}`, 'success');
      if (settingsModelHint) settingsModelHint.textContent = `Active ${provider} model: ${model}`;
    } else {
      showToast(data.error || 'Failed to update model', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
});

settingsModelSelect?.addEventListener('change', async (e) => {
  const provider = settingsLlmSelect?.value || 'ollama';
  const model = e.target.value;
  if (!model) return;
  try {
    const res = await fetch('/api/providers/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model }),
    });
    if (res.ok) {
      if (settingsModelHint) settingsModelHint.textContent = `Active ${provider} model: ${model}`;
    }
  } catch (err) {}
});

settingsDoneBtn?.addEventListener('click', async () => {
  const llm = settingsLlmSelect?.value;
  const stt = settingsSttSelect?.value;
  const model = settingsModelSelect?.value;

  if (llm || stt) {
    try {
      const res = await fetch('/api/providers/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmId: llm, sttId: stt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Switch failed');

      if (model) {
        await fetch('/api/providers/model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: llm, model }),
        }).catch(() => {});
      }

      if (data.needsKey) {
        showGlobalAlert(`${llm.toUpperCase()} is active, but its API key is missing. Ollama is disabled.`);
      } else {
        hideGlobalAlert();
      }
      showToast(`AI Provider updated: ${llm.toUpperCase()}`, 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  }
  closeSettingsModal();
});

async function refreshSettingsModal() {
  try {
    const [provRes, hwRes, connRes] = await Promise.all([
      fetch('/api/providers').then(r => r.json()).catch(() => null),
      fetch('/api/hardware').then(r => r.json()).catch(() => null),
      fetch('/api/connection-status').then(r => r.json()).catch(() => null),
    ]);

    if (provRes) {
      const activeLLM = provRes.activeLLM || 'ollama';
      if (settingsLlmSelect) settingsLlmSelect.value = activeLLM;
      if (settingsSttSelect) settingsSttSelect.value = provRes.activeSTT || 'local_whisper';
      updateApiKeyUI(activeLLM, provRes.llmProviders);
      await loadModelsForProvider(activeLLM);
    }

    if (hwRes) {
      const gpuName = document.getElementById('hw-gpu-name');
      const gpuVram = document.getElementById('hw-gpu-vram');
      const ramTotal = document.getElementById('hw-ram-total');
      const cpuModel = document.getElementById('hw-cpu-model');
      const recModel = document.getElementById('hw-recommended-model');

      if (gpuName) gpuName.textContent = hwRes.gpu?.name || 'Integrated / CPU';
      if (gpuVram) gpuVram.textContent = hwRes.gpu?.vramGB ? `${hwRes.gpu.vramGB} GB GDDR` : 'N/A';
      if (ramTotal) ramTotal.textContent = hwRes.ram?.totalGB ? `${hwRes.ram.totalGB} GB` : 'System RAM';
      if (cpuModel) cpuModel.textContent = `${hwRes.cpu?.cores || 4} Cores (${(hwRes.cpu?.model || '').slice(0, 24)})`;
      if (recModel) recModel.textContent = `✨ ${hwRes.recommendedModel || 'llama3.2:3b'} (${hwRes.tier || 'optimal'})`;
    }

    if (connRes) {
      const ytStatus = document.getElementById('settings-yt-status');
      const igStatus = document.getElementById('settings-ig-status');
      if (connRes.connections?.youtube?.connected) {
        if (ytStatus) {
          ytStatus.textContent = `Connected: ${connRes.connections.youtube.username || 'Channel'}`;
          ytStatus.style.color = '#10b981';
        }
        if (settingsBtnYt) settingsBtnYt.textContent = 'Disconnect';
      } else {
        if (ytStatus) {
          ytStatus.textContent = 'Not Connected';
          ytStatus.style.color = 'var(--text-muted)';
        }
        if (settingsBtnYt) settingsBtnYt.textContent = 'Connect';
      }

      if (connRes.connections?.instagram?.connected) {
        if (igStatus) {
          igStatus.textContent = `Connected: ${connRes.connections.instagram.username || 'Account'}`;
          igStatus.style.color = '#10b981';
        }
        if (settingsBtnIg) settingsBtnIg.textContent = 'Disconnect';
      } else {
        if (igStatus) {
          igStatus.textContent = 'Not Connected';
          igStatus.style.color = 'var(--text-muted)';
        }
        if (settingsBtnIg) settingsBtnIg.textContent = 'Connect';
      }
    }
  } catch (e) {
    console.warn('[Settings] Error loading settings modal:', e);
  }
}

function updateApiKeyUI(activeLLM, providersList) {
  if (!settingsApiKeyGroup) return;
  if (activeLLM === 'groq') {
    settingsApiKeyGroup.style.display = 'block';
    if (settingsApiKeyLabel) {
      settingsApiKeyLabel.textContent = 'Groq Cloud API Key (gsk_...)';
    }
    const currentProv = (providersList || []).find(p => p.id === 'groq');
    const configured = currentProv ? currentProv.configured : false;

    if (!configured) {
      if (settingsApiKeyWarn) settingsApiKeyWarn.style.display = 'block';
      showGlobalAlert('GROQ is active, but its API key is missing. Please configure GROQ_API_KEY.');
    } else {
      if (settingsApiKeyWarn) settingsApiKeyWarn.style.display = 'none';
      hideGlobalAlert();
    }
  } else {
    settingsApiKeyGroup.style.display = 'none';
    if (settingsApiKeyWarn) settingsApiKeyWarn.style.display = 'none';
    hideGlobalAlert();
  }
}

settingsLlmSelect?.addEventListener('change', async () => {
  const chosen = settingsLlmSelect.value;
  try {
    const res = await fetch('/api/providers');
    const data = await res.json();
    updateApiKeyUI(chosen, data.llmProviders);
    await loadModelsForProvider(chosen);
  } catch (e) {}
});

btnSaveApiKey?.addEventListener('click', async () => {
  const providerId = settingsLlmSelect?.value;
  const apiKey = (settingsApiKeyInput?.value || '').trim();
  if (!apiKey) {
    showToast('Please enter an API key', 'warning');
    return;
  }
  try {
    const res = await fetch('/api/providers/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, apiKey }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save key');
    showToast(`Key saved for ${providerId.toUpperCase()}!`, 'success');
    if (settingsApiKeyInput) settingsApiKeyInput.value = '';
    if (settingsApiKeyWarn) settingsApiKeyWarn.style.display = 'none';
    hideGlobalAlert();
    await refreshSettingsModal();
  } catch (e) {
    showToast(e.message, 'error');
  }
});

settingsBtnClean?.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/storage/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cleanOutput: false }),
    });
    const data = await res.json();
    showToast(`Storage cleaned! Freed ${data.freedMB} MB`, 'success');
  } catch (e) {
    showToast('Storage clean failed', 'error');
  }
});

settingsBtnYt?.addEventListener('click', () => {
  window.open('/api/connect/youtube', '_blank', 'width=620,height=720');
  setTimeout(refreshSettingsModal, 2000);
});
settingsBtnIg?.addEventListener('click', () => {
  window.open('/api/connect/instagram', '_blank', 'width=620,height=720');
  setTimeout(refreshSettingsModal, 2000);
});

// Initial provider & hardware check on page load
refreshSettingsModal();


// ═══════════════════════════════════════════════════════════════════════════
// ─── PROFESSIONAL CAPTION STUDIO LOGIC ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

const stageVideoClean = document.getElementById('stage-video-clean');
const stageVideoA = document.getElementById('stage-video-a');
const stageVideoB = document.getElementById('stage-video-b');
const btnStagePlay = document.getElementById('btn-stage-play');
const stageCurrentTime = document.getElementById('stage-current-time');
const stageTotalTime = document.getElementById('stage-total-time');
const stageScrubber = document.getElementById('stage-scrubber');
const captionOverlayA = document.getElementById('caption-overlay-a');
const captionOverlayB = document.getElementById('caption-overlay-b');
const captionBoxA = document.getElementById('caption-box-a');
const captionBoxB = document.getElementById('caption-box-b');
const stageStyleAName = document.getElementById('stage-style-a-name');
const stageStyleBSelect = document.getElementById('stage-style-b-select');
const presetCardsGrid = document.getElementById('preset-cards-grid');
const toggleSafeArea = document.getElementById('toggle-safe-area');
const toggleCaptionsActive = document.getElementById('toggle-captions-active');

// Customizer Controls
const captionFontFamily = document.getElementById('caption-font-family');
const captionFontSize = document.getElementById('caption-font-size');
const captionFontSizeVal = document.getElementById('caption-font-size-val');
const captionTextColor = document.getElementById('caption-text-color');
const captionHighlightColor = document.getElementById('caption-highlight-color');
const captionMarginV = document.getElementById('caption-margin-v');
const captionMarginVal = document.getElementById('caption-margin-val');
const captionWordsPerLine = document.getElementById('caption-words-per-line');
const btnExportSrt = document.getElementById('btn-export-srt');
const btnExportAss = document.getElementById('btn-export-ass');
const btnApplyCurrentClip = document.getElementById('btn-apply-current-clip');
const btnApplyAllClips = document.getElementById('btn-apply-all-clips');

// Sample Words for Live Studio Preview
const samplePreviewWords = [
  { word: "Turn", start: 0.0, end: 0.35 },
  { word: "long-form", start: 0.35, end: 0.75 },
  { word: "videos", start: 0.75, end: 1.2 },
  { word: "into", start: 1.2, end: 1.55 },
  { word: "viral", start: 1.55, end: 2.0 },
  { word: "vertical", start: 2.0, end: 2.45 },
  { word: "shorts", start: 2.45, end: 2.9 },
  { word: "with", start: 2.9, end: 3.2 },
  { word: "AI!", start: 3.2, end: 3.8 }
];

let stageDuration = 3.8;
let stageCurrentPos = 0;
let stagePlaying = false;
let stageTimerId = null;
let activeClipWords = null;
let allCaptionPresets = [];

// Fetch Presets from Backend
async function loadCaptionPresets() {
  try {
    const res = await fetch('/api/caption-presets');
    if (!res.ok) return;
    const data = await res.json();
    allCaptionPresets = data.presets || [];
    renderPresetCards();
  } catch (err) {
    console.warn('[Caption Studio] Failed to load presets:', err.message);
  }
}

function renderPresetCards() {
  if (!presetCardsGrid || allCaptionPresets.length === 0) return;
  presetCardsGrid.innerHTML = '';

  allCaptionPresets.forEach(preset => {
    const card = document.createElement('div');
    card.className = `preset-card-item ${preset.id === currentCaptionPreset ? 'active' : ''}`;
    card.dataset.presetId = preset.id;

    // Build miniature visual preview styled according to preset
    const previewStyle = getPresetInlineStyle(preset.id);

    card.innerHTML = `
      <div class="preset-item-title">
        <span>${escapeHtml(preset.name)}</span>
        ${preset.id === currentCaptionPreset ? '<span class="badge-tag">Active</span>' : ''}
      </div>
      <div class="preset-item-preview-badge" style="${previewStyle}">
        VIRAL CLIP
      </div>
      <div class="preset-item-desc">${escapeHtml(preset.description)}</div>
    `;

    card.addEventListener('click', () => {
      selectCaptionPreset(preset.id);
    });

    presetCardsGrid.appendChild(card);
  });
}

function selectCaptionPreset(presetId) {
  currentCaptionPreset = presetId;
  if (stageStyleAName) {
    const found = allCaptionPresets.find(p => p.id === presetId);
    stageStyleAName.textContent = found ? found.name : presetId;
  }

  // Update active state on cards
  const cards = presetCardsGrid?.querySelectorAll('.preset-card-item');
  cards?.forEach(c => {
    const isActive = c.dataset.presetId === presetId;
    c.classList.toggle('active', isActive);
    const tag = c.querySelector('.badge-tag');
    if (tag) tag.remove();
    if (isActive) {
      const titleSpan = c.querySelector('.preset-item-title');
      if (titleSpan) titleSpan.insertAdjacentHTML('beforeend', '<span class="badge-tag">Active</span>');
    }
  });

  // Re-render live overlay
  renderStageCaptions(stageCurrentPos);
}

function getPresetInlineStyle(presetId) {
  switch (presetId) {
    case 'minimal':
      return 'background: rgba(0,0,0,0.7); color: #fff; font-family: Inter; font-weight: 600;';
    case 'cinematic':
      return 'background: transparent; color: #ffd700; font-family: Outfit; font-weight: 700; letter-spacing: 0.1em;';
    case 'bold':
      return 'background: #000; color: #fee440; font-family: Montserrat; font-weight: 900; -webkit-text-stroke: 1px #000;';
    case 'karaoke':
      return 'background: rgba(0,0,0,0.8); color: #00f5d4; font-family: Montserrat; font-weight: 800;';
    case 'pop':
      return 'background: rgba(157,78,221,0.3); color: #fee440; font-family: Montserrat; font-weight: 900; transform: scale(1.05);';
    case 'podcast':
      return 'background: rgba(0,0,0,0.85); color: #ffffff; font-family: Inter; font-weight: 600; border-left: 3px solid #3a86ff;';
    case 'educational':
      return 'background: rgba(0,245,212,0.15); color: #00f5d4; font-family: Inter; font-weight: 700;';
    case 'gaming':
      return 'background: #050508; color: #06d6a0; font-family: Montserrat; font-weight: 900; text-shadow: 0 0 8px #9d4edd;';
    default:
      return 'background: #000; color: #fee440; font-weight: 800;';
  }
}

// Stage Time and Scrubber Formatting
function formatStageTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.floor((secs % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${ms}`;
}

// Render captions in Viewport A and Viewport B at current timestamp
function renderStageCaptions(timestamp) {
  if (!captionBoxA || !captionBoxB) return;

  const words = activeClipWords || samplePreviewWords;
  const isEnabled = captionCustomSettings.captionsEnabled;

  if (!isEnabled) {
    captionBoxA.innerHTML = '';
    captionBoxB.innerHTML = '';
    return;
  }

  // Viewport A (Active Selected Preset)
  captionBoxA.style.fontFamily = captionCustomSettings.fontFamily;
  captionBoxA.style.fontSize = `${captionCustomSettings.fontSize}px`;
  captionBoxA.style.color = captionCustomSettings.textColor;
  if (captionOverlayA) {
    captionOverlayA.style.bottom = `${captionCustomSettings.bottomMargin / 7}px`;
  }

  captionBoxA.innerHTML = buildCaptionHTML(words, timestamp, currentCaptionPreset, captionCustomSettings);

  // Viewport B (Comparison Preset)
  const compPreset = stageStyleBSelect?.value || comparisonCaptionPreset || 'karaoke';
  captionBoxB.style.fontFamily = captionCustomSettings.fontFamily;
  captionBoxB.style.fontSize = `${captionCustomSettings.fontSize}px`;
  captionBoxB.style.color = captionCustomSettings.textColor;
  if (captionOverlayB) {
    captionOverlayB.style.bottom = `${captionCustomSettings.bottomMargin / 7}px`;
  }

  captionBoxB.innerHTML = buildCaptionHTML(words, timestamp, compPreset, captionCustomSettings);
}

let stageClipStart = 0;
let studioCurrentClipIndex = -1;

function transformTextCasing(text, textCase) {
  if (!text) return '';
  if (textCase === 'uppercase') return text.toUpperCase();
  if (textCase === 'capitalize') return text.replace(/\b\w/g, l => l.toUpperCase());
  return text;
}

function buildCaptionHTML(words, timestamp, presetId, custom) {
  // Determine active word window based on wordsPerLine setting
  let windowWords = words;
  const activeIndex = words.findIndex(w => timestamp >= w.start && timestamp <= w.end);
  const currentIndex = activeIndex !== -1 ? activeIndex : words.findIndex(w => w.start > timestamp);
  const safeIdx = currentIndex === -1 ? words.length - 1 : currentIndex;

  if (custom.wordsPerLine === 'single') {
    windowWords = [words[safeIdx] || words[0]];
  } else if (custom.wordsPerLine === 'short') {
    const startIdx = Math.max(0, Math.floor(safeIdx / 3) * 3);
    windowWords = words.slice(startIdx, startIdx + 3);
  }

  const textCase = custom.textCase || 'uppercase';
  const animType = custom.animationType || 'bounce';

  return windowWords.map((w) => {
    const isActive = timestamp >= w.start && timestamp <= w.end;
    const isPast = timestamp > w.end;
    const displayWord = transformTextCasing(w.word, textCase);

    let styleStr = '';
    let classNames = 'caption-word';

    if (presetId === 'bold') {
      if (isActive) {
        classNames += ' active-word';
        const animCss = animType === 'bounce' ? 'transform: scale(1.22);' : animType === 'glow' ? 'filter: drop-shadow(0 0 8px #fee440);' : '';
        styleStr = `color: ${custom.highlightColor}; text-shadow: 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000; ${animCss}`;
      } else {
        styleStr = `color: ${custom.textColor}; text-shadow: 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000;`;
      }
    } else if (presetId === 'pop') {
      if (isActive) {
        classNames += ' active-word';
        styleStr = `color: ${custom.highlightColor}; transform: scale(1.25); transition: transform 0.08s ease; text-shadow: 0 0 12px ${custom.highlightColor};`;
      } else {
        styleStr = `color: ${custom.textColor};`;
      }
    } else if (presetId === 'karaoke') {
      if (isActive || isPast) {
        classNames += ' karaoke-active';
        styleStr = `color: ${custom.highlightColor}; font-weight: 900;`;
      } else {
        styleStr = `color: rgba(255,255,255,0.4);`;
      }
    } else if (presetId === 'cinematic') {
      styleStr = isActive ? 'color: #ffd700; letter-spacing: 0.08em;' : 'color: #f1f5f9; letter-spacing: 0.08em;';
    } else if (presetId === 'gaming') {
      if (isActive) {
        styleStr = `color: #06d6a0; text-shadow: 0 0 14px #9d4edd, 2px 2px 0 #000; ${animType === 'bounce' ? 'transform: scale(1.18);' : ''}`;
      } else {
        styleStr = 'color: #ffffff; text-shadow: 2px 2px 0 #000;';
      }
    } else {
      styleStr = isActive ? `color: ${custom.highlightColor}; font-weight: 800;` : `color: ${custom.textColor};`;
    }

    return `<span class="${classNames}" style="${styleStr}">${escapeHtml(displayWord)}</span>`;
  }).join(' ');
}

// Stage Playback Sync
function toggleStagePlayback() {
  stagePlaying = !stagePlaying;
  if (btnStagePlay) {
    btnStagePlay.textContent = stagePlaying ? '⏸ Pause Sync' : '▶ Play Sync';
  }

  if (stagePlaying) {
    if (stageVideoClean && stageVideoClean.src) {
      stageVideoClean.currentTime = stageClipStart + stageCurrentPos;
      stageVideoClean.play().catch(() => {});
      if (stageVideoA) {
        stageVideoA.currentTime = stageClipStart + stageCurrentPos;
        stageVideoA.play().catch(() => {});
      }
      if (stageVideoB) {
        stageVideoB.currentTime = stageClipStart + stageCurrentPos;
        stageVideoB.play().catch(() => {});
      }
    }

    clearInterval(stageTimerId);
    stageTimerId = setInterval(() => {
      stageCurrentPos += 0.05;
      if (stageCurrentPos >= stageDuration) {
        stageCurrentPos = 0;
        if (stageVideoClean && stageVideoClean.src) {
          stageVideoClean.currentTime = stageClipStart;
          if (stageVideoA) stageVideoA.currentTime = stageClipStart;
          if (stageVideoB) stageVideoB.currentTime = stageClipStart;
        }
      }
      updateStageUI();
    }, 50);
  } else {
    clearInterval(stageTimerId);
    if (stageVideoClean) stageVideoClean.pause();
    if (stageVideoA) stageVideoA.pause();
    if (stageVideoB) stageVideoB.pause();
  }
}

function updateStageUI() {
  if (stageCurrentTime) stageCurrentTime.textContent = formatStageTime(stageCurrentPos);
  if (stageScrubber) {
    stageScrubber.value = ((stageCurrentPos / Math.max(0.1, stageDuration)) * 100).toFixed(1);
  }
  renderStageCaptions(stageCurrentPos);
}

btnStagePlay?.addEventListener('click', toggleStagePlayback);

stageScrubber?.addEventListener('input', () => {
  const pct = parseFloat(stageScrubber.value) / 100;
  stageCurrentPos = pct * stageDuration;
  if (stageVideoClean && stageVideoClean.src) {
    stageVideoClean.currentTime = stageClipStart + stageCurrentPos;
    if (stageVideoA) stageVideoA.currentTime = stageClipStart + stageCurrentPos;
    if (stageVideoB) stageVideoB.currentTime = stageClipStart + stageCurrentPos;
  }
  updateStageUI();
});

// Style B Dropdown Listener
stageStyleBSelect?.addEventListener('change', () => {
  comparisonCaptionPreset = stageStyleBSelect.value;
  renderStageCaptions(stageCurrentPos);
});

// Safe Area and Captions Toggle Listeners
toggleSafeArea?.addEventListener('change', () => {
  const container = document.querySelector('.stage-viewports-container');
  if (container) {
    container.classList.toggle('toggle-safe-area-off', !toggleSafeArea.checked);
  }
});

toggleCaptionsActive?.addEventListener('change', () => {
  captionCustomSettings.captionsEnabled = toggleCaptionsActive.checked;
  renderStageCaptions(stageCurrentPos);
});

// Detailed Customizer Form Listeners
captionFontFamily?.addEventListener('change', () => {
  captionCustomSettings.fontFamily = captionFontFamily.value;
  renderStageCaptions(stageCurrentPos);
});

captionFontSize?.addEventListener('input', () => {
  captionCustomSettings.fontSize = parseInt(captionFontSize.value, 10);
  if (captionFontSizeVal) captionFontSizeVal.textContent = `${captionFontSize.value}px`;
  renderStageCaptions(stageCurrentPos);
});

captionTextColor?.addEventListener('input', () => {
  captionCustomSettings.textColor = captionTextColor.value;
  renderStageCaptions(stageCurrentPos);
});

captionHighlightColor?.addEventListener('input', () => {
  captionCustomSettings.highlightColor = captionHighlightColor.value;
  renderStageCaptions(stageCurrentPos);
});

captionMarginV?.addEventListener('input', () => {
  captionCustomSettings.bottomMargin = parseInt(captionMarginV.value, 10);
  if (captionMarginVal) captionMarginVal.textContent = `${captionMarginV.value}px`;
  renderStageCaptions(stageCurrentPos);
});

captionWordsPerLine?.addEventListener('change', () => {
  captionCustomSettings.wordsPerLine = captionWordsPerLine.value;
  renderStageCaptions(stageCurrentPos);
});

// Quick Color Swatches Listener
const quickSwatches = document.getElementById('quick-swatches');
quickSwatches?.querySelectorAll('.swatch-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    quickSwatches.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const color = btn.dataset.color;
    captionCustomSettings.highlightColor = color;
    if (captionHighlightColor) captionHighlightColor.value = color;
    renderStageCaptions(stageCurrentPos);
  });
});

// Text Case Buttons Listener
const captionCaseBtns = document.getElementById('caption-case-btns');
captionCaseBtns?.querySelectorAll('.btn-case').forEach(btn => {
  btn.addEventListener('click', () => {
    captionCaseBtns.querySelectorAll('.btn-case').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    captionCustomSettings.textCase = btn.dataset.case;
    renderStageCaptions(stageCurrentPos);
  });
});

// Position Preset Buttons Listener
const captionPosPresets = document.getElementById('caption-pos-presets');
captionPosPresets?.querySelectorAll('.btn-pos').forEach(btn => {
  btn.addEventListener('click', () => {
    captionPosPresets.querySelectorAll('.btn-pos').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const pos = parseInt(btn.dataset.pos, 10);
    captionCustomSettings.bottomMargin = pos;
    if (captionMarginV) captionMarginV.value = pos;
    if (captionMarginVal) captionMarginVal.textContent = `${pos}px`;
    renderStageCaptions(stageCurrentPos);
  });
});

// Animation Type Selector
const captionAnimationType = document.getElementById('caption-animation-type');
captionAnimationType?.addEventListener('change', () => {
  captionCustomSettings.animationType = captionAnimationType.value;
  renderStageCaptions(stageCurrentPos);
});

// Clip Selection Engine for Caption Studio
function initStudioClipsList(clips) {
  const select = document.getElementById('studio-clip-select');
  if (!select) return;
  select.innerHTML = '';
  
  clips.forEach((clip, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `Clip ${idx + 1}: ${clip.title ? clip.title.slice(0, 24) : 'Untitled'} (${clip.duration || 0}s)`;
    select.appendChild(opt);
  });

  const demoOpt = document.createElement('option');
  demoOpt.value = -1;
  demoOpt.textContent = '✨ Demo Sample Words';
  select.appendChild(demoOpt);

  if (clips.length > 0) {
    selectStudioClip(0);
  }
}

function selectStudioClip(index) {
  studioCurrentClipIndex = index;
  const studioSelect = document.getElementById('studio-clip-select');
  const studioTitle = document.getElementById('studio-active-clip-title');
  if (studioSelect) studioSelect.value = index;

  // Highlight active clip in reviewGrid
  const cards = els.reviewGrid?.querySelectorAll('.clip-card');
  cards?.forEach((c, i) => c.classList.toggle('active-in-studio', i === index));

  if (index === -1 || !allClips[index]) {
    activeClipWords = samplePreviewWords;
    stageDuration = 3.8;
    stageClipStart = 0;
    if (studioTitle) studioTitle.textContent = 'Demo Sample Preview (3.8s)';
  } else {
    const clip = allClips[index];
    stageClipStart = clip.start || 0;
    stageDuration = clip.duration || (clip.end - clip.start) || 30;

    if (clip.words && clip.words.length > 0) {
      activeClipWords = clip.words.map(w => ({
        word: w.word,
        start: Math.max(0, w.start - stageClipStart),
        end: Math.max(0.1, w.end - stageClipStart)
      }));
    } else if (clip.text) {
      const textWords = clip.text.trim().split(/\s+/);
      const wordDur = stageDuration / Math.max(1, textWords.length);
      activeClipWords = textWords.map((word, wIdx) => ({
        word,
        start: wIdx * wordDur,
        end: (wIdx + 1) * wordDur
      }));
    } else {
      activeClipWords = samplePreviewWords;
    }

    if (studioTitle) {
      studioTitle.textContent = `Clip #${index + 1}: ${clip.title || 'Untitled'} (${Math.round(stageClipStart)}s - ${Math.round(stageClipStart + stageDuration)}s)`;
    }

    // Stream the downloaded source video into viewports
    syncCaptionStudioSource('/api/raw_video');
    if (stageVideoClean) stageVideoClean.currentTime = stageClipStart;
    if (stageVideoA) stageVideoA.currentTime = stageClipStart;
    if (stageVideoB) stageVideoB.currentTime = stageClipStart;
  }

  stageCurrentPos = 0;
  if (stageTotalTime) stageTotalTime.textContent = formatStageTime(stageDuration);
  updateStageUI();
}

// Studio Clip Navigation Buttons
document.getElementById('studio-clip-select')?.addEventListener('change', (e) => {
  selectStudioClip(parseInt(e.target.value, 10));
});

document.getElementById('btn-studio-prev-clip')?.addEventListener('click', () => {
  if (allClips.length === 0) return;
  const newIdx = studioCurrentClipIndex <= 0 ? allClips.length - 1 : studioCurrentClipIndex - 1;
  selectStudioClip(newIdx);
});

document.getElementById('btn-studio-next-clip')?.addEventListener('click', () => {
  if (allClips.length === 0) return;
  const newIdx = studioCurrentClipIndex >= allClips.length - 1 ? 0 : studioCurrentClipIndex + 1;
  selectStudioClip(newIdx);
});

// Mode Switcher for Caption Studio
document.getElementById('nav-caption-studio')?.addEventListener('click', (e) => {
  const studioSec = document.getElementById('caption-studio-section');
  if (!studioSec || !studioSec.classList.contains('visible')) {
    e.preventDefault();
    showToast('Generate clips first to customize captions in the studio!', 'info');
  }
});

// Apply chosen caption style to all clips
btnApplyAllClips?.addEventListener('click', () => {
  if (allClips.length === 0) {
    showToast('No generated clips yet. Generate clips first!', 'info');
    return;
  }

  allClips.forEach(clip => {
    clip.custom = clip.custom || {};
    clip.custom.captionPreset = currentCaptionPreset;
    clip.custom.captionsEnabled = captionCustomSettings.captionsEnabled;
    clip.custom.fontFamily = captionCustomSettings.fontFamily;
    clip.custom.fontSize = captionCustomSettings.fontSize;
    clip.custom.textColor = captionCustomSettings.textColor;
    clip.custom.highlightColor = captionCustomSettings.highlightColor;
    clip.custom.textCase = captionCustomSettings.textCase;
    clip.custom.animationType = captionCustomSettings.animationType;
  });

  showToast(`Applied "${currentCaptionPreset}" style to all ${allClips.length} clips!`, 'success');
  appendLog(`🎨 Applied caption preset [${currentCaptionPreset}] to all clips`, 'info');
});

// Apply to current clip
btnApplyCurrentClip?.addEventListener('click', () => {
  if (allClips.length === 0) {
    showToast('No clips available yet', 'info');
    return;
  }

  const activeIdx = studioCurrentClipIndex >= 0 ? studioCurrentClipIndex : 0;
  if (allClips[activeIdx]) {
    allClips[activeIdx].custom = allClips[activeIdx].custom || {};
    allClips[activeIdx].custom.captionPreset = currentCaptionPreset;
    allClips[activeIdx].custom.captionsEnabled = captionCustomSettings.captionsEnabled;
    allClips[activeIdx].custom.textCase = captionCustomSettings.textCase;
    allClips[activeIdx].custom.animationType = captionCustomSettings.animationType;
    showToast(`Applied "${currentCaptionPreset}" to Clip ${activeIdx + 1}!`, 'success');
  }
});

// Export Subtitle Files (.SRT / .ASS)
btnExportSrt?.addEventListener('click', () => {
  const words = activeClipWords || samplePreviewWords;
  let srtContent = '';
  words.forEach((w, i) => {
    const sTime = formatSRTTime(w.start);
    const eTime = formatSRTTime(w.end);
    const textWord = transformTextCasing(w.word, captionCustomSettings.textCase);
    srtContent += `${i + 1}\n${sTime} --> ${eTime}\n${textWord}\n\n`;
  });

  downloadTextFile(srtContent, 'clip-captions.srt', 'text/plain');
  showToast('Downloaded clip-captions.srt', 'success');
});

btnExportAss?.addEventListener('click', () => {
  const words = activeClipWords || samplePreviewWords;
  let assContent = `[Script Info]
Title: L2S Professional Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${captionCustomSettings.fontFamily},${captionCustomSettings.fontSize * 1.5},&H00FFFFFF,&H0040E4FE,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,40,40,${captionCustomSettings.bottomMargin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  words.forEach(w => {
    const sTime = formatASSTimeLocal(w.start);
    const eTime = formatASSTimeLocal(w.end);
    const textWord = transformTextCasing(w.word, captionCustomSettings.textCase);
    assContent += `Dialogue: 0,${sTime},${eTime},Default,,0,0,0,,${textWord}\n`;
  });

  downloadTextFile(assContent, 'clip-captions.ass', 'text/plain');
  showToast('Downloaded clip-captions.ass', 'success');
});

function formatSRTTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.floor((secs % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatASSTimeLocal(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const cs = Math.floor((secs % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function downloadTextFile(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Hook Caption Studio Video Sync when a video is loaded in workspace
function syncCaptionStudioSource(videoSrc) {
  if (!videoSrc) return;
  if (stageVideoClean && stageVideoClean.src !== window.location.origin + videoSrc) {
    stageVideoClean.src = videoSrc;
  }
  if (stageVideoA && stageVideoA.src !== window.location.origin + videoSrc) {
    stageVideoA.src = videoSrc;
  }
  if (stageVideoB && stageVideoB.src !== window.location.origin + videoSrc) {
    stageVideoB.src = videoSrc;
  }
}

// Initialize Studio
if (stageTotalTime) stageTotalTime.textContent = formatStageTime(stageDuration);
loadCaptionPresets();
renderStageCaptions(0);

// ─── AI Virality & Optimal Posting Guide Accordion ───────────────────────────
const viralityTipsToggle = document.getElementById('virality-tips-toggle');
const viralityTipsContent = document.getElementById('virality-tips-content');
const viralityTipsChevron = document.getElementById('virality-tips-chevron');
let viralityTipsLoaded = false;

if (viralityTipsToggle && viralityTipsContent) {
  viralityTipsToggle.addEventListener('click', async () => {
    const isExpanded = viralityTipsContent.style.display !== 'none';
    if (isExpanded) {
      viralityTipsContent.style.display = 'none';
      if (viralityTipsChevron) viralityTipsChevron.textContent = '▼';
    } else {
      viralityTipsContent.style.display = 'block';
      if (viralityTipsChevron) viralityTipsChevron.textContent = '▲';
      if (!viralityTipsLoaded) {
        viralityTipsContent.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem">Loading virality insights...</div>';
        try {
          const res = await fetch('/api/social/recommendations');
          const data = await res.json();
          let timesHtml = '';
          if (Array.isArray(data.bestPostingTimes)) {
            timesHtml = data.bestPostingTimes.map(t => `
              <div style="background:rgba(255,255,255,0.03);padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);margin-bottom:6px">
                <div style="display:flex;justify-content:space-between;font-weight:600;font-size:0.82rem;color:var(--text-primary)">
                  <span>${escapeHtml(t.platform)}</span>
                  <span style="color:var(--accent-purple)">${escapeHtml(t.time)}</span>
                </div>
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">${escapeHtml(t.reason)}</div>
              </div>
            `).join('');
          }
          let genreHtml = '';
          if (data.genrePrompts) {
            genreHtml = Object.entries(data.genrePrompts).map(([k, v]) => `
              <div style="font-size:0.76rem;margin-bottom:4px">
                <span style="font-weight:600;text-transform:capitalize;color:var(--accent-cyan)">${escapeHtml(k)}:</span>
                <span style="color:var(--text-secondary)">${escapeHtml(v)}</span>
              </div>
            `).join('');
          }
          viralityTipsContent.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:16px;">
              <div>
                <div style="font-size:0.76rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">⏰ Peak Posting Windows (Local)</div>
                ${timesHtml}
              </div>
              <div>
                <div style="font-size:0.76rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">⚡ Viral Hook & Pacing Rules</div>
                <div style="background:rgba(255,255,255,0.03);padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);margin-bottom:8px">
                  <div style="font-weight:600;font-size:0.8rem;color:#10b981">Optimal Length</div>
                  <div style="font-size:0.76rem;color:var(--text-secondary);margin-top:2px">${escapeHtml(data.optimalClipLength || '')}</div>
                </div>
                <div style="background:rgba(255,255,255,0.03);padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.06)">
                  <div style="font-weight:600;font-size:0.8rem;color:#f59e0b">Hook Rule (&lt; 2.5s)</div>
                  <div style="font-size:0.76rem;color:var(--text-secondary);margin-top:2px">${escapeHtml(data.hookTip || '')}</div>
                </div>
              </div>
            </div>
            ${genreHtml ? `
              <div style="margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.05)">
                <div style="font-size:0.76rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">🎯 Genre Virality Strategies</div>
                ${genreHtml}
              </div>
            ` : ''}
          `;
          viralityTipsLoaded = true;
        } catch (err) {
          viralityTipsContent.innerHTML = `<div style="color:#ef4444;font-size:0.8rem">Failed to load recommendations: ${escapeHtml(err.message)}</div>`;
        }
      }
    }
  });
}

// ─── Multi-User Auth Session Management (Header Pill & Login/Logout) ─────────
let currentAuthUser = null;

async function initAuthSession() {
  const pill = document.getElementById('header-user-pill');
  const loginBtn = document.getElementById('btn-header-login');
  const emailEl = document.getElementById('header-user-email');
  const planEl = document.getElementById('header-user-plan');

  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data && data.user) {
        currentAuthUser = data.user;
        if (data.csrfToken) {
          updateStoredCsrfToken(data.csrfToken);
        }
        if (emailEl) emailEl.textContent = data.user.email;
        if (planEl) {
          planEl.textContent = (data.user.plan || 'FREE').toUpperCase();
          planEl.className = `user-plan-badge ${data.user.plan === 'paid' ? 'pro' : 'free'}`;
        }
        if (pill) pill.style.display = 'inline-flex';
        if (loginBtn) loginBtn.style.display = 'none';
        return;
      }
    }
  } catch (err) {
    // Unauthenticated or network error
  }

  currentAuthUser = null;
  if (pill) pill.style.display = 'none';
  if (loginBtn) loginBtn.style.display = 'inline-flex';
}

document.getElementById('btn-header-logout')?.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    csrfTokenMemory = null;
    try { localStorage.removeItem('l2s_csrf_token'); } catch (e) {}
    try { document.cookie = 'XSRF-TOKEN=; path=/; max-age=0; SameSite=Lax'; } catch (e) {}
    showToast('Logged out of your account', 'info');
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 400);
  } catch (err) {
    showToast('Failed to log out: ' + err.message, 'error');
  }
});

// ─── Platform Tabs Selector (All / YouTube / Instagram / Local) ──────────────
const sourceTabs = document.querySelectorAll('.source-tab');
if (sourceTabs.length > 0) {
  sourceTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sourceTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const platform = tab.dataset.platform;
      if (platform === 'youtube') {
        els.sourceInput.placeholder = 'Paste YouTube video or Shorts link (e.g. https://youtube.com/watch?v=...)...';
        updateDynamicSourceIcon('https://youtube.com/watch?v=sample');
      } else if (platform === 'instagram') {
        els.sourceInput.placeholder = 'Paste Instagram Reel or Post link (e.g. https://instagram.com/reel/...)...';
        updateDynamicSourceIcon('https://instagram.com/reel/sample');
      } else if (platform === 'local') {
        els.sourceInput.placeholder = 'Enter local video path (e.g. C:/videos/clip.mp4)...';
        updateDynamicSourceIcon('C:/videos/clip.mp4');
      } else {
        els.sourceInput.placeholder = 'Paste YouTube link, Instagram Reel/post, or video path here...';
        updateDynamicSourceIcon(els.sourceInput.value);
      }
      els.sourceInput.focus();
    });
  });
}

// ─── Viewfinder Quick Zoom Chips (0.5x, 1.0x, 1.5x, 2.0x, 3.0x) ──────────────
document.querySelectorAll('.btn-zoom-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const zoomVal = parseFloat(chip.dataset.zoom);
    if (isNaN(zoomVal)) return;
    if (els.editorZoom) {
      els.editorZoom.value = zoomVal;
      if (els.editorValZoom) els.editorValZoom.textContent = `${zoomVal.toFixed(1)}x`;
      els.editorZoom.dispatchEvent(new Event('input'));
    }
    document.querySelectorAll('.btn-zoom-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });
});

// Initialize user authentication session
initAuthSession();
