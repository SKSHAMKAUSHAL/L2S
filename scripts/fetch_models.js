#!/usr/bin/env node
/**
 * scripts/fetch_models.js
 * Downloads the official OpenCV YuNet face detection ONNX model and verifies its SHA-256 checksum.
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT_DIR, 'models');
const MODEL_NAME = 'face_detection_yunet_2023mar.onnx';
const MODEL_PATH = path.join(MODELS_DIR, MODEL_NAME);

export const EXPECTED_SHA256 = '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4';
const PRIMARY_URL = 'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx';
const FALLBACK_URL = 'https://huggingface.co/opencv/opencv_zoo/resolve/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx';

export function verifyModelHash(filePath = MODEL_PATH) {
  if (!fs.existsSync(filePath)) return false;
  const buffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  return hash.toLowerCase() === EXPECTED_SHA256.toLowerCase();
}

function downloadUrl(url, targetPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadUrl(res.headers.location, targetPath));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download: HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(targetPath);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(targetPath));
      });
      file.on('error', (err) => {
        fs.unlink(targetPath, () => reject(err));
      });
    }).on('error', reject);
  });
}

export async function ensureModel() {
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }

  if (verifyModelHash(MODEL_PATH)) {
    console.log(`[fetch_models] YuNet model already present and verified: ${MODEL_PATH}`);
    return MODEL_PATH;
  }

  console.log(`[fetch_models] Downloading YuNet ONNX model to ${MODEL_PATH}...`);
  try {
    await downloadUrl(PRIMARY_URL, MODEL_PATH);
  } catch (err) {
    console.warn(`[fetch_models] Primary URL failed (${err.message}), trying fallback...`);
    await downloadUrl(FALLBACK_URL, MODEL_PATH);
  }

  if (!verifyModelHash(MODEL_PATH)) {
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(MODEL_PATH)).digest('hex');
    throw new Error(`SHA256 verification failed! Expected: ${EXPECTED_SHA256}, Got: ${actualHash}`);
  }

  console.log(`[fetch_models] Successfully downloaded and verified YuNet model.`);
  return MODEL_PATH;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  ensureModel().catch((err) => {
    console.error(`[fetch_models] Error:`, err.message);
    process.exit(1);
  });
}
