import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumePosition } from './media.ts';
test('MP4与原生HLS共用续播位置规则', () => {
  assert.equal(resumePosition(120, 300), 120);
  assert.equal(resumePosition(120, Number.NaN), 0);
  assert.equal(resumePosition(-5, 300), 0);
  assert.equal(resumePosition(298, 300), 0);
  assert.equal(resumePosition(0.5, 300), 0);
});
