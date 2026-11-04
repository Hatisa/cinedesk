import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShareText } from './share.ts';

test('分享文本包含核心信息', () => {
  const text = buildShareText({ name: '庆余年', score: 7.9, year: '2019', typeName: '剧情', actors: ['张若昀', '李沁'], keyword: '庆余年 第一季' });
  assert.match(text, /庆余年/);
  assert.match(text, /7\.9/);
  assert.match(text, /2019/);
  assert.match(text, /张若昀/);
  assert.match(text, /庆余年 第一季/);
});
