import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const allowList = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'static_allowlist.json'), 'utf8')
);

function walkSync(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        walkSync(fullPath, fileList);
      }
    } else {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('Step 8: Static Analysis Security Linter (static_analysis.test.js)', () => {
  it('confirms no child_process.exec with template strings or unreviewed shell: true exists in src/', () => {
    const srcDir = path.join(rootDir, 'src');
    const srcFiles = walkSync(srcDir).filter((f) => f.endsWith('.js'));

    const unreviewedExec = [];
    const unreviewedShellTrue = [];

    for (const filePath of srcFiles) {
      const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
      const content = fs.readFileSync(filePath, 'utf8');

      // Check for exec( with template strings e.g. exec(`... ${...}`)
      if (/exec\(\s*`[^`]*\${/.test(content)) {
        unreviewedExec.push(relPath);
      }

      // Check for shell: true
      if (/shell:\s*true/.test(content)) {
        if (!allowList.allowedShellTrueOccurrences.includes(relPath)) {
          unreviewedShellTrue.push(relPath);
        }
      }
    }

    assert.equal(
      unreviewedExec.length,
      0,
      `Dangerous exec() with template strings found in: ${unreviewedExec.join(', ')}`
    );

    assert.equal(
      unreviewedShellTrue.length,
      0,
      `Unreviewed shell: true occurrences found in: ${unreviewedShellTrue.join(', ')}`
    );
  });

  it('confirms innerHTML in public/ is strictly restricted to reviewed files in allowlist', () => {
    const publicDir = path.join(rootDir, 'public');
    const publicFiles = walkSync(publicDir).filter((f) => f.endsWith('.js'));

    const unreviewedInnerHTML = [];

    for (const filePath of publicFiles) {
      const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
      const content = fs.readFileSync(filePath, 'utf8');

      if (content.includes('innerHTML')) {
        if (!allowList.allowedInnerHTMLFiles.includes(relPath)) {
          unreviewedInnerHTML.push(relPath);
        }
      }
    }

    assert.equal(
      unreviewedInnerHTML.length,
      0,
      `Unreviewed innerHTML sinks in public/: ${unreviewedInnerHTML.join(', ')}`
    );
  });
});
