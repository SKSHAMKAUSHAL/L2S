// =============================================
// L2S — Hardware Detector & Auto-Model Selector
// =============================================
// Dynamically inspects local host hardware (GPU VRAM, System RAM, CPU cores)
// to automatically recommend and configure the optimal Ollama model
// for any device where L2S is cloned and run.

import os from 'os';
import { spawnSync } from 'child_process';

let cachedDetection = null;

/**
 * Detect host hardware specifications and recommend the best Ollama model
 * @param {boolean} forceRefresh - Bypass cache if true
 * @returns {Object} Hardware details and recommended Ollama model
 */
export function detectHardwareAndRecommendedModel(forceRefresh = false) {
  if (cachedDetection && !forceRefresh) {
    return cachedDetection;
  }

  const cpuCores = os.cpus().length;
  const cpuModel = os.cpus()[0]?.model || 'Generic CPU';
  const totalRamGB = Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10;

  let gpu = {
    hasNvidia: false,
    name: 'None / Integrated Graphics',
    vramMB: 0,
    vramGB: 0,
  };

  try {
    const res = spawnSync(
      'nvidia-smi',
      ['--query-gpu=gpu_name,memory.total', '--format=csv,noheader,nounits'],
      {
        timeout: 2500,
        encoding: 'utf-8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );

    if (!res.error && res.status === 0 && res.stdout) {
      const line = res.stdout.trim().split('\n')[0];
      if (line) {
        const parts = line.split(',');
        if (parts.length >= 2) {
          const name = parts[0].trim();
          const vram = parseInt(parts[1].trim(), 10) || 0;
          gpu = {
            hasNvidia: true,
            name,
            vramMB: vram,
            vramGB: Math.round((vram / 1024) * 10) / 10,
          };
        }
      }
    }
  } catch (err) {
    // nvidia-smi not available or failed; fallback to CPU profile
  }

  // Model Recommendation Logic based on detected hardware:
  let recommendedModel = 'llama3.2:1b';
  let tier = 'low';
  let reason = '';

  if (gpu.hasNvidia && gpu.vramMB >= 7500) {
    recommendedModel = 'llama3.1:8b';
    tier = 'high';
    reason = `High-capacity GPU (${gpu.name}, ${gpu.vramGB}GB VRAM) — llama3.1:8b delivers supreme reasoning.`;
  } else if (gpu.hasNvidia && gpu.vramMB >= 3500) {
    // Perfect fit for RTX 2050 / RTX 3050 (4GB GDDR6)
    recommendedModel = 'llama3.2:3b';
    tier = 'balanced';
    reason = `Dedicated GPU (${gpu.name}, ${gpu.vramGB}GB VRAM) — llama3.2:3b provides ideal balance of speed and viral accuracy.`;
  } else if (gpu.hasNvidia && gpu.vramMB > 0) {
    recommendedModel = 'llama3.2:1b';
    tier = 'entry';
    reason = `Entry GPU (${gpu.name}, ${gpu.vramGB}GB VRAM) — llama3.2:1b runs ultra-fast without risk of VRAM exhaustion.`;
  } else {
    // CPU Inference
    if (totalRamGB >= 16 && cpuCores >= 8) {
      recommendedModel = 'llama3.2:3b';
      tier = 'balanced_cpu';
      reason = `Multi-core CPU (${cpuCores} cores, ${totalRamGB}GB RAM) — llama3.2:3b runs comfortably on CPU.`;
    } else {
      recommendedModel = 'llama3.2:1b';
      tier = 'lightweight_cpu';
      reason = `Standard host (${cpuCores} cores, ${totalRamGB}GB RAM) — llama3.2:1b runs snappy and lightweight on CPU.`;
    }
  }

  cachedDetection = {
    cpu: {
      model: cpuModel,
      cores: cpuCores,
    },
    ram: {
      totalGB: totalRamGB,
    },
    gpu,
    recommendedModel,
    tier,
    reason,
    detectedAt: new Date().toISOString(),
  };

  return cachedDetection;
}
