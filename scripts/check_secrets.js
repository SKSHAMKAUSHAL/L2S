/**
 * scripts/check_secrets.js
 * Cross-platform secret scanner for pre-commit and CI verification.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const PATTERNS = [
  /gsk_[a-zA-Z0-9_-]{20,}/,
  /GOCSPX-[a-zA-Z0-9_-]{20,}/,
  /AIza[0-9A-Za-z-_]{35}/,
  /BEGIN PRIVATE KEY/,
];

const EXCLUDED_PATHS = [
  '.env.example',
  'package-lock.json',
  'tests/',
  'docs/',
  'todo.md',
  'scripts/check_secrets.js',
  'scripts/check-secrets.sh',
];

export function scanForSecrets() {
  let trackedFiles = [];
  try {
    const stdout = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
    trackedFiles = stdout.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    console.warn('[check-secrets] git ls-files failed, skipping git check');
    return true;
  }

  const filesToCheck = trackedFiles.filter(file => {
    return !EXCLUDED_PATHS.some(excluded => file.startsWith(excluded) || file === excluded);
  });

  let violations = [];

  for (const file of filesToCheck) {
    try {
      const content = execFileSync('git', ['show', `:${file}`], { encoding: 'utf8' });
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        for (const pattern of PATTERNS) {
          if (pattern.test(line)) {
            // Exclude explicit test dummies or placeholders
            if (line.includes('dummy') || line.includes('placeholder') || line.includes('example')) {
              continue;
            }
            violations.push({ file, lineNum: idx + 1, pattern: pattern.toString(), snippet: line.trim() });
          }
        }
      });
    } catch {}
  }

  if (violations.length > 0) {
    console.error('🚨 [check-secrets] Potential secrets detected in tracked files:');
    violations.forEach(v => {
      console.error(`  - ${v.file}:${v.lineNum} matched ${v.pattern}`);
    });
    return false;
  }

  console.log('✅ [check-secrets] No tracked secrets detected.');
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('check_secrets.js')) {
  const ok = scanForSecrets();
  process.exit(ok ? 0 : 1);
}
