// =============================================
// L2S — Local Faster-Whisper STT Adapter
// =============================================

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { BaseSTTProvider } from '../contracts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IS_WINDOWS = process.platform === 'win32';
const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', '..', 'scripts');

function findPython() {
  const venvPython = IS_WINDOWS
    ? path.join(os.homedir(), '.skate', 'venv', 'Scripts', 'python.exe')
    : path.join(os.homedir(), '.skate', 'venv', 'bin', 'python3');

  if (fs.existsSync(venvPython)) return venvPython;
  return IS_WINDOWS ? 'python' : 'python3';
}

export class LocalWhisperSTT extends BaseSTTProvider {
  constructor(config = {}) {
    const model = config.modelSize || 'tiny.en';
    super('local_whisper', 'Faster-Whisper (Local STT)', 'local', model);
    this.modelSize = model;
  }

  isConfigured() {
    return true;
  }

  async testConnection() {
    const scriptPath = path.join(SCRIPTS_DIR, 'whisper_transcribe.py');
    const scriptExists = fs.existsSync(scriptPath);
    return {
      ok: scriptExists,
      available: scriptExists,
      model: this.modelSize,
      warning: scriptExists ? null : `Python transcription script missing at: ${scriptPath}`,
    };
  }

  async transcribe(audioPath, onProgress, options = {}) {
    const size = options.modelSize || this.modelSize || 'tiny.en';
    if (onProgress) onProgress(`Transcribing via local faster-whisper (${size})...`);
    const scriptPath = path.join(SCRIPTS_DIR, 'whisper_transcribe.py');
    const pythonBin = findPython();

    const result = spawnSync(pythonBin, [
      scriptPath,
      audioPath,
      size,
    ], {
      maxBuffer: 50 * 1024 * 1024,
      encoding: 'utf-8',
      windowsHide: true,
    });

    if (result.status !== 0) {
      throw new Error(`Local transcription failed: ${result.stderr || 'Python error'}`);
    }

    return JSON.parse(result.stdout.trim());
  }
}
