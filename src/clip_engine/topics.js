// =============================================
// L2S — Clip Engine: Topic Segmentation (TextTiling)
// =============================================
// Splits the video into coherent topic segments using TF-IDF cosine similarity
// across sliding blocks of sentences, cutting at similarity valleys.
// Merges segments shorter than 30 seconds.

const UNICODE_WORD_REGEX = /[\p{L}\p{N}]+/gu;

/**
 * Tokenize text into lowercase Unicode terms
 */
function tokenize(text) {
  if (!text) return [];
  const matches = text.toLowerCase().match(UNICODE_WORD_REGEX);
  return matches || [];
}

/**
 * Compute cosine similarity between two frequency maps
 */
function cosineSimilarity(mapA, mapB, idf) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, freqA] of mapA.entries()) {
    const weightA = freqA * (idf.get(term) || 1);
    normA += weightA * weightA;
    if (mapB.has(term)) {
      const weightB = mapB.get(term) * (idf.get(term) || 1);
      dotProduct += weightA * weightB;
    }
  }

  for (const [term, freqB] of mapB.entries()) {
    const weightB = freqB * (idf.get(term) || 1);
    normB += weightB * weightB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Segment sentences into topic segments
 *
 * @param {Array<Object>} sentences - Array of sentence objects from buildSentences
 * @param {Object} [options]
 * @param {number} [options.blockSize=8] - Number of sentences per block
 * @param {number} [options.minSegmentDuration=30] - Minimum duration in seconds
 * @returns {Array<{id: string, startSentenceId: string, endSentenceId: string, start: number, end: number, sentenceIndices: [number, number]}>}
 */
export function segmentTopics(sentences = [], options = {}) {
  if (!Array.isArray(sentences) || sentences.length === 0) {
    return [];
  }

  const { blockSize = 8, minSegmentDuration = 30 } = options;

  // Short transcripts: single topic segment
  if (sentences.length <= blockSize) {
    return [{
      id: 'T0',
      startSentenceId: sentences[0].id,
      endSentenceId: sentences[sentences.length - 1].id,
      start: sentences[0].start,
      end: sentences[sentences.length - 1].end,
      sentenceIndices: [0, sentences.length - 1],
    }];
  }

  // 1. Build sentence blocks
  const blocks = [];
  const blockSentenceMap = []; // maps block index to [startSentenceIdx, endSentenceIdx]

  for (let i = 0; i < sentences.length; i += Math.max(1, Math.floor(blockSize / 2))) {
    const slice = sentences.slice(i, i + blockSize);
    if (slice.length === 0) break;

    const blockTokens = [];
    for (const s of slice) {
      blockTokens.push(...tokenize(s.text));
    }

    const termFreq = new Map();
    for (const t of blockTokens) {
      termFreq.set(t, (termFreq.get(t) || 0) + 1);
    }

    blocks.push(termFreq);
    blockSentenceMap.push([i, Math.min(sentences.length - 1, i + slice.length - 1)]);

    if (i + blockSize >= sentences.length) break;
  }

  if (blocks.length <= 1) {
    return [{
      id: 'T0',
      startSentenceId: sentences[0].id,
      endSentenceId: sentences[sentences.length - 1].id,
      start: sentences[0].start,
      end: sentences[sentences.length - 1].end,
      sentenceIndices: [0, sentences.length - 1],
    }];
  }

  // 2. Compute IDF across blocks
  const docFreq = new Map();
  for (const b of blocks) {
    for (const term of b.keys()) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  const idf = new Map();
  const N = blocks.length;
  for (const [term, df] of docFreq.entries()) {
    idf.set(term, Math.log(1 + N / df));
  }

  // 3. Compute cosine similarity between adjacent blocks
  const similarities = [];
  for (let i = 0; i < blocks.length - 1; i++) {
    const sim = cosineSimilarity(blocks[i], blocks[i + 1], idf);
    similarities.push(sim);
  }

  // 4. Identify similarity valleys (local minima below moving average)
  const cutSentenceIndices = new Set();
  const avgSim = similarities.reduce((a, b) => a + b, 0) / Math.max(1, similarities.length);

  for (let i = 0; i < similarities.length; i++) {
    const curr = similarities[i];
    const prev = i > 0 ? similarities[i - 1] : 1;
    const next = i < similarities.length - 1 ? similarities[i + 1] : 1;

    // Local minimum lower than average
    if (curr <= prev && curr <= next && curr < avgSim) {
      // Cut at boundary between blocks
      const cutIdx = blockSentenceMap[i][1];
      if (cutIdx > 0 && cutIdx < sentences.length - 1) {
        cutSentenceIndices.add(cutIdx);
      }
    }
  }

  // 5. Construct preliminary segments
  const cuts = Array.from(cutSentenceIndices).sort((a, b) => a - b);
  const rawSegments = [];
  let prevStartIdx = 0;

  for (const cutIdx of cuts) {
    if (cutIdx >= prevStartIdx) {
      rawSegments.push({
        sentenceIndices: [prevStartIdx, cutIdx],
        start: sentences[prevStartIdx].start,
        end: sentences[cutIdx].end,
      });
      prevStartIdx = cutIdx + 1;
    }
  }

  if (prevStartIdx < sentences.length) {
    rawSegments.push({
      sentenceIndices: [prevStartIdx, sentences.length - 1],
      start: sentences[prevStartIdx].start,
      end: sentences[sentences.length - 1].end,
    });
  }

  // 6. Merge segments shorter than minSegmentDuration (30s)
  const mergedSegments = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    const dur = seg.end - seg.start;

    if (dur < minSegmentDuration && mergedSegments.length > 0) {
      // Merge into previous segment
      const last = mergedSegments[mergedSegments.length - 1];
      last.sentenceIndices[1] = seg.sentenceIndices[1];
      last.end = seg.end;
    } else if (dur < minSegmentDuration && i < rawSegments.length - 1) {
      // Merge into next segment
      const next = rawSegments[i + 1];
      next.sentenceIndices[0] = seg.sentenceIndices[0];
      next.start = seg.start;
    } else {
      mergedSegments.push(seg);
    }
  }

  const finalSegments = (mergedSegments.length > 0 ? mergedSegments : rawSegments).map((seg, idx) => ({
    id: `T${idx}`,
    startSentenceId: sentences[seg.sentenceIndices[0]].id,
    endSentenceId: sentences[seg.sentenceIndices[1]].id,
    start: seg.start,
    end: seg.end,
    sentenceIndices: seg.sentenceIndices,
  }));

  return finalSegments;
}
