// =============================================
// L2S — Centralized Environment Loader
// =============================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

export function loadEnv() {
  try {
    const envPath = path.join(rootDir, '.env');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            // Populate if not already explicitly set in environment
            if (val !== undefined && (!process.env[key] || process.env[key] === '')) {
              process.env[key] = val;
            }
          }
        }
      }
    }
  } catch (e) {
    // Ignore read errors
  }
}

// Automatically execute on import
loadEnv();
