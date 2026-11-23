/**
 * tests/ui_redesign_verification.test.js
 * Verification test suite for Homepage Generator & Pipeline Monitoring Redesign
 * Checks fidelity to IMAGE 1 (Generator), IMAGE 3 (Pipeline & Terminal), and public/image.png asset usage.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Homepage UI Redesign & Monitoring Verification (IMAGE 1 & 3)', () => {
  const indexHtmlPath = path.resolve('public/index.html');
  const styleCssPath = path.resolve('public/style.css');
  const appJsPath = path.resolve('public/app.js');
  const imagePngPath = path.resolve('public/image.png');

  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  const styleCss = fs.readFileSync(styleCssPath, 'utf8');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  describe('1. Asset & Video Preview Container (IMAGE 1)', () => {
    it('confirms public/image.png exists and is non-empty', () => {
      assert.ok(fs.existsSync(imagePngPath), 'public/image.png must exist');
      const stats = fs.statSync(imagePngPath);
      assert.ok(stats.size > 1000, `public/image.png should be a valid image file, got ${stats.size} bytes`);
    });

    it('embeds image.png in the workspace video placeholder container', () => {
      assert.ok(
        indexHtml.includes('src="image.png"') || indexHtml.includes("src='image.png'"),
        'public/index.html must reference image.png for the video placeholder'
      );
      assert.ok(indexHtml.includes('id="placeholder-hero-img"'), 'Must have placeholder-hero-img ID');
    });

    it('styles the video preview container with rounded corners and dark backdrop', () => {
      assert.ok(styleCss.includes('.workspace-video-container'), 'style.css must style workspace-video-container');
      assert.ok(styleCss.includes('.workspace-placeholder-img'), 'style.css must style workspace-placeholder-img');
      assert.ok(styleCss.includes('.placeholder-overlay-hint'), 'style.css must style placeholder-overlay-hint');
    });
  });

  describe('2. Generator Configuration Panel (IMAGE 1 Target Order)', () => {
    it('contains Genre dropdown with Auto-detect default', () => {
      assert.ok(indexHtml.includes('id="genre-select"'), 'Must contain #genre-select');
      assert.ok(indexHtml.includes('Auto-detect Genre'), 'Must have Auto-detect Genre option');
    });

    it('contains Manual Timestamps row and + Add Timestamp outline button', () => {
      assert.ok(indexHtml.includes('id="ts-start"'), 'Must contain #ts-start');
      assert.ok(indexHtml.includes('id="ts-end"'), 'Must contain #ts-end');
      assert.ok(indexHtml.includes('id="ts-add-btn"'), 'Must contain #ts-add-btn');
      assert.ok(indexHtml.includes('id="ts-chip-list"'), 'Must contain #ts-chip-list');
    });

    it('contains How To Use These radio pills (Add to AI clips vs Only these clips)', () => {
      assert.ok(indexHtml.includes('id="how-to-use-pills"'), 'Must contain #how-to-use-pills');
      assert.ok(indexHtml.includes('Add to AI clips'), 'Must contain "Add to AI clips"');
      assert.ok(indexHtml.includes('Only these clips'), 'Must contain "Only these clips"');
      assert.ok(indexHtml.includes('id="ts-only-toggle"'), 'Must preserve #ts-only-toggle for compatibility');
    });

    it('contains Number of Clips chips (Auto, 3, 5, 10, 15, 20, Custom #)', () => {
      assert.ok(indexHtml.includes('id="clip-count-chips"'), 'Must contain #clip-count-chips');
      assert.ok(indexHtml.includes('data-count="auto"'), 'Must contain Auto chip');
      assert.ok(indexHtml.includes('data-count="3"'), 'Must contain 3 chip');
      assert.ok(indexHtml.includes('data-count="5"'), 'Must contain 5 chip');
      assert.ok(indexHtml.includes('data-count="10"'), 'Must contain 10 chip');
      assert.ok(indexHtml.includes('data-count="15"'), 'Must contain 15 chip');
      assert.ok(indexHtml.includes('data-count="20"'), 'Must contain 20 chip');
      assert.ok(indexHtml.includes('id="btn-custom-clip-count"'), 'Must contain Custom # button');
      assert.ok(indexHtml.includes('id="custom-clip-count-input"'), 'Must contain custom input');
    });

    it('contains Output Ratio chips (9:16, 1:1, 4:5, 16:9) and Zoom slider (0.1x to 3.0x)', () => {
      assert.ok(indexHtml.includes('id="ratio-chips"'), 'Must contain #ratio-chips');
      assert.ok(indexHtml.includes('data-ratio="9:16"'), 'Must contain 9:16 chip');
      assert.ok(indexHtml.includes('data-ratio="1:1"'), 'Must contain 1:1 chip');
      assert.ok(indexHtml.includes('data-ratio="4:5"'), 'Must contain 4:5 chip');
      assert.ok(indexHtml.includes('data-ratio="16:9"'), 'Must contain 16:9 chip');
      assert.ok(indexHtml.includes('id="pre-gen-zoom-slider"'), 'Must contain #pre-gen-zoom-slider');
      assert.ok(indexHtml.includes('id="pre-gen-zoom-val"'), 'Must contain #pre-gen-zoom-val');
      assert.ok(indexHtml.includes('id="pre-gen-zoom-slider" min="0.1" max="3.0"'), 'Zoom slider must range between 0.1x and 3.0x');
    });

    it('contains Source Download Quality chips (Best 4K, 1080p, 720p, Audio)', () => {
      assert.ok(indexHtml.includes('id="source-quality-chips"'), 'Must contain #source-quality-chips');
      assert.ok(indexHtml.includes('data-quality="best"'), 'Must contain Best 4K chip');
      assert.ok(indexHtml.includes('data-quality="1080p"'), 'Must contain 1080p chip');
      assert.ok(indexHtml.includes('data-quality="720p"'), 'Must contain 720p chip');
      assert.ok(indexHtml.includes('data-quality="audio"'), 'Must contain Audio chip');
    });

    it('contains Export Encoding Profile chips (Fast, Balanced, High Q, Max Q)', () => {
      assert.ok(indexHtml.includes('id="export-profile-chips"'), 'Must contain #export-profile-chips');
      assert.ok(indexHtml.includes('data-profile="fast"'), 'Must contain fast chip');
      assert.ok(indexHtml.includes('data-profile="balanced"'), 'Must contain balanced chip');
      assert.ok(indexHtml.includes('data-profile="high"'), 'Must contain high chip');
      assert.ok(indexHtml.includes('data-profile="max"'), 'Must contain max chip');
      assert.ok(indexHtml.includes('id="export-profile-badge"'), 'Must contain #export-profile-badge');
    });

    it('contains Generate Clips hero button and dynamic Stop button with confirmation modal', () => {
      assert.ok(indexHtml.includes('id="generate-btn"'), 'Must contain #generate-btn');
      assert.ok(indexHtml.includes('btn-generate-hero'), 'Must use btn-generate-hero class');
      assert.ok(styleCss.includes('.btn-generate-hero'), 'style.css must style btn-generate-hero with gradient');

      // Stop button dynamic transition
      assert.ok(indexHtml.includes('id="stop-btn"'), 'Must contain #stop-btn');
      assert.ok(indexHtml.includes('btn-stop-hero'), 'Must style stop button with .btn-stop-hero');
      assert.ok(styleCss.includes('.btn-stop-hero'), 'style.css must define .btn-stop-hero');
      assert.ok(styleCss.includes('.btn-stop-hero.visible'), 'style.css must support .btn-stop-hero.visible state');

      // Confirmation modal
      assert.ok(indexHtml.includes('id="stop-confirm-modal"'), 'Must contain #stop-confirm-modal');
      assert.ok(indexHtml.includes('id="btn-stop-cancel"'), 'Must contain #btn-stop-cancel');
      assert.ok(indexHtml.includes('id="btn-stop-confirm"'), 'Must contain #btn-stop-confirm');
    });
  });

  describe('3. Pipeline Progress & Terminal (IMAGE 3)', () => {
    it('contains Pipeline Progress header with timer badge', () => {
      assert.ok(indexHtml.includes('class="pipeline-header-bar"'), 'Must contain .pipeline-header-bar');
      assert.ok(indexHtml.includes('id="pipeline-timer"'), 'Must contain #pipeline-timer');
      assert.ok(indexHtml.includes('Pipeline Progress'), 'Must have "Pipeline Progress" title');
    });

    it('contains all 5 connected stages (download, transcribe, analyze, rank, render)', () => {
      assert.ok(indexHtml.includes('data-step="download"'), 'Must have download stage');
      assert.ok(indexHtml.includes('data-step="transcribe"'), 'Must have transcribe stage');
      assert.ok(indexHtml.includes('data-step="analyze"'), 'Must have analyze stage');
      assert.ok(indexHtml.includes('data-step="rank"'), 'Must have rank stage');
      assert.ok(indexHtml.includes('data-step="render"'), 'Must have render stage');
    });

    it('contains macOS terminal card with traffic light dots and clear button', () => {
      assert.ok(indexHtml.includes('class="terminal-card-v2"'), 'Must contain .terminal-card-v2');
      assert.ok(indexHtml.includes('mac-red') && indexHtml.includes('mac-yellow') && indexHtml.includes('mac-green'), 'Must have macOS traffic light dots');
      assert.ok(indexHtml.includes('id="clear-terminal"'), 'Must contain #clear-terminal');
      assert.ok(indexHtml.includes('id="terminal"'), 'Must contain #terminal');
    });
  });

  describe('4. Bottom System Status (Section 13)', () => {
    it('contains #home-system-status section with 3 diagnostic cards', () => {
      assert.ok(indexHtml.includes('id="home-system-status"'), 'Must contain #home-system-status');
      assert.ok(indexHtml.includes('id="card-ollama-status"'), 'Must contain Ollama status card');
      assert.ok(indexHtml.includes('id="card-groq-status"'), 'Must contain Groq status card');
      assert.ok(indexHtml.includes('id="card-hw-status"'), 'Must contain Hardware status card');
      assert.ok(indexHtml.includes('id="btn-refresh-status"'), 'Must contain #btn-refresh-status button');
    });

    it('contains dynamic status badges for Ollama, Groq, and Hardware', () => {
      assert.ok(indexHtml.includes('id="badge-ollama"'), 'Must have #badge-ollama');
      assert.ok(indexHtml.includes('id="badge-groq"'), 'Must have #badge-groq');
      assert.ok(indexHtml.includes('id="badge-hw"'), 'Must have #badge-hw');
    });
  });

  describe('5. Client JS Logic Integration', () => {
    it('app.js initializes loadHomepageSystemStatus without errors', () => {
      assert.ok(appJs.includes('loadHomepageSystemStatus'), 'app.js must define loadHomepageSystemStatus');
      assert.ok(appJs.includes('/api/providers'), 'Must query /api/providers');
      assert.ok(appJs.includes('/api/hardware'), 'Must query /api/hardware');
    });

    it('app.js updateStep supports all 5 stages', () => {
      assert.ok(appJs.includes('updateStep'), 'app.js must define updateStep');
      assert.ok(appJs.includes('PROCESSING') && appJs.includes('COMPLETED') && appJs.includes('FAILED'), 'Must update status labels');
    });

    it('app.js wires chip selectors for quality, ratio, zoom, and clip count', () => {
      assert.ok(appJs.includes('#ratio-chips'), 'app.js must wire #ratio-chips');
      assert.ok(appJs.includes('#source-quality-chips'), 'app.js must wire #source-quality-chips');
      assert.ok(appJs.includes('#clip-count-chips'), 'app.js must wire #clip-count-chips');
      assert.ok(appJs.includes('#how-to-use-pills'), 'app.js must wire #how-to-use-pills');
    });
  });
});
