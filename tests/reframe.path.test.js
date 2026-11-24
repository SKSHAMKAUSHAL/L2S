import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeSmoothCropPath, sampleCropAt } from '../src/reframe.js';

describe('Step 6: Face-Tracked Reframe Path Logic', () => {
  const WIDTH = 1920;
  const HEIGHT = 1080;
  const TARGET_CROP_W = 608;
  const TARGET_CROP_H = 1080;

  it('1. dead zone ignores movements under 4% of frame width (76.8px)', () => {
    const rawSamples = [
      { t: 0.0, cx: 960, cy: 400, w: 200, h: 200, confidence: 0.9 },
      // Movement of 30px (1.5% of 1920) -> should be within dead zone
      { t: 0.2, cx: 990, cy: 400, w: 200, h: 200, confidence: 0.9 },
      { t: 0.4, cx: 975, cy: 400, w: 200, h: 200, confidence: 0.9 },
    ];

    const path = computeSmoothCropPath({
      width: WIDTH,
      height: HEIGHT,
      scene_cuts: [],
      path: rawSamples
    }, { deadZonePercent: 0.04 });

    assert.strictEqual(path.length, 3);
    // Crop X should remain identical to sample 0 because 30px is within dead zone
    assert.strictEqual(path[1].cropX, path[0].cropX);
    assert.strictEqual(path[2].cropX, path[0].cropX);
  });

  it('2. smoothing dampens high-frequency jitter', () => {
    // Alternating jitter between 800 and 1100
    const rawSamples = [];
    for (let i = 0; i < 20; i++) {
      rawSamples.push({
        t: Number((i * 0.2).toFixed(2)),
        cx: i % 2 === 0 ? 800 : 1100,
        cy: 400,
        w: 200,
        h: 200,
        confidence: 0.95
      });
    }

    const path = computeSmoothCropPath({
      width: WIDTH,
      height: HEIGHT,
      scene_cuts: [],
      path: rawSamples
    }, { deadZonePercent: 0.0, alpha: 0.25 });

    // Raw jitter delta is 300px each step. Smoothed delta between adjacent steps should be much lower.
    for (let i = 1; i < path.length; i++) {
      const stepDelta = Math.abs(path[i].cx - path[i - 1].cx);
      assert.ok(stepDelta < 150, `Step delta ${stepDelta} was not smoothed below 150`);
    }
  });

  it('3. maximum pan speed is strictly respected', () => {
    // Sudden teleport from cx=300 to cx=1600 in 0.2 seconds
    const maxSpeedPercent = 0.20; // 20% of 1920 = 384 px/sec
    const maxAllowedStepIn02s = 384 * 0.2; // 76.8 px

    const rawSamples = [
      { t: 0.0, cx: 300, cy: 400, w: 200, h: 200, confidence: 0.9 },
      { t: 0.2, cx: 1600, cy: 400, w: 200, h: 200, confidence: 0.9 },
    ];

    const path = computeSmoothCropPath({
      width: WIDTH,
      height: HEIGHT,
      scene_cuts: [],
      path: rawSamples
    }, { maxPanSpeedPercent: maxSpeedPercent, deadZonePercent: 0.0 });

    const stepDelta = Math.abs(path[1].cx - path[0].cx);
    assert.ok(stepDelta <= maxAllowedStepIn02s + 1.0, `Step delta ${stepDelta} exceeded max pan speed step ${maxAllowedStepIn02s}`);
  });

  it('4. scene cuts reset the path immediately without gradual pan', () => {
    // Face on left (cx=400), scene cut at t=1.0, face on right (cx=1500)
    const rawSamples = [
      { t: 0.8, cx: 400, cy: 400, w: 200, h: 200, confidence: 0.9 },
      { t: 1.2, cx: 1500, cy: 400, w: 200, h: 200, confidence: 0.9 },
    ];

    const path = computeSmoothCropPath({
      width: WIDTH,
      height: HEIGHT,
      scene_cuts: [1.0], // Scene cut at 1.0s
      path: rawSamples
    }, { maxPanSpeedPercent: 0.1 });

    // Because of the cut, path[1] should snap directly to sample cx=1500, bypassing maxPanSpeed
    assert.strictEqual(path[1].cx, 1500);
  });

  it('5. crop window NEVER leaves the source frame boundaries (property test)', () => {
    // Test across 100 random coordinate points, including negative and out-of-frame values
    const rawSamples = [];
    for (let i = 0; i < 100; i++) {
      rawSamples.push({
        t: Number((i * 0.1).toFixed(2)),
        cx: (Math.random() - 0.5) * 4000, // -2000 to +2000
        cy: (Math.random() - 0.5) * 3000, // -1500 to +1500
        w: Math.random() * 800,
        h: Math.random() * 800,
        confidence: Math.random()
      });
    }

    const path = computeSmoothCropPath({
      width: WIDTH,
      height: HEIGHT,
      scene_cuts: [],
      path: rawSamples
    });

    for (const point of path) {
      assert.ok(point.cropX >= 0, `cropX ${point.cropX} < 0`);
      assert.ok(point.cropY >= 0, `cropY ${point.cropY} < 0`);
      assert.ok(point.cropX + point.cropW <= WIDTH, `cropX + cropW (${point.cropX + point.cropW}) > ${WIDTH}`);
      assert.ok(point.cropY + point.cropH <= HEIGHT, `cropY + cropH (${point.cropY + point.cropH}) > ${HEIGHT}`);
    }
  });

  it('6. missing face holds position for < 1.5s then eases back to center', () => {
    const rawSamples = [
      { t: 0.0, cx: 400, cy: 400, w: 200, h: 200, confidence: 0.9 },
      // Face disappears at t=0.2
      { t: 0.4, cx: 960, cy: 540, w: 0, h: 0, confidence: 0.0 },
      { t: 1.0, cx: 960, cy: 540, w: 0, h: 0, confidence: 0.0 }, // gap = 1.0s (< 1.5s)
      { t: 3.0, cx: 960, cy: 540, w: 0, h: 0, confidence: 0.0 }, // gap = 3.0s (>= 1.5s, should ease towards 960)
    ];

    const path = computeSmoothCropPath({
      width: WIDTH,
      height: HEIGHT,
      scene_cuts: [],
      path: rawSamples
    }, { missingHoldSeconds: 1.5 });

    // At t=1.0 (gap < 1.5s), position holds near 400
    assert.ok(path[2].cx < 600, `At 1.0s gap, cx ${path[2].cx} should stay held near 400`);
    // At t=3.0 (gap > 1.5s), position has moved substantially towards center (960)
    assert.ok(path[3].cx > path[2].cx, `At 3.0s gap, cx ${path[3].cx} should move towards center from ${path[2].cx}`);
  });

  it('7. sampleCropAt linearly interpolates coordinates between sample points', () => {
    const smoothPath = [
      { t: 1.0, cropX: 100, cropY: 0, cropW: 608, cropH: 1080 },
      { t: 2.0, cropX: 300, cropY: 0, cropW: 608, cropH: 1080 }
    ];

    const mid = sampleCropAt(smoothPath, 1.5);
    assert.strictEqual(mid.cropX, 200);
    assert.strictEqual(mid.cropW, 608);

    const before = sampleCropAt(smoothPath, 0.5);
    assert.strictEqual(before.cropX, 100);

    const after = sampleCropAt(smoothPath, 3.0);
    assert.strictEqual(after.cropX, 300);
  });
});
