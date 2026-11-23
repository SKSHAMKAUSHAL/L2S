import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../fixtures');

export function loadFixture(name) {
  const file = name.endsWith('.json') ? name : `${name}.json`;
  const filePath = path.join(fixturesDir, file);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function loadEnglishTranscript() {
  return loadFixture('en');
}

export function loadHindiTranscript() {
  return loadFixture('hi');
}

export function loadHinglishTranscript() {
  return loadFixture('hinglish');
}
