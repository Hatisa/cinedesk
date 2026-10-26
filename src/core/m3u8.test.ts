/**
 * m3u8 解析的自动化测试。
 *
 * 用例取自**实测数据**：光速源某剧的 master（相对路径）与 media
 * （629 个绝对地址 .ts 分片、每片 7–9 秒、无加密）。这样测试才真正
 * 锁住行为——一旦解析被改得吃不下其中一种写法，换个源就整个下载失败。
 *
 * 运行：npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalPlaylist,
  extOf,
  isMaster,
  pad,
  parseMaster,
  parseMedia,
  pickVariant,
  resolveUrl,
  safeName,
} from './m3u8.ts';

// 实测 master：nginx 站常见的相对路径写法
const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1024000,RESOLUTION=640x360',
  '/play/hls/aaa/low.m3u8',
  '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=2048000,RESOLUTION=1280x720',
  '/play/hls/aaa/mid.m3u8',
  '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=4096000,RESOLUTION=1920x1080',
  '/play/hls/aaa/index.m3u8',
].join('\n');

const BASE = 'https://v.gsuus.com/play/ZdPNR6wa/index.m3u8';

// 实测 media：绝对地址分片
const MEDIA = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:10',
  '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXTINF:7.416667,',
  'https://gs.gszyi.com:999/hls/764/20251008/165025/plist0.ts',
  '#EXTINF:9.375000,',
  'https://gs.gszyi.com:999/hls/764/20251008/165025/plist1.ts',
  '#EXTINF:8.0,',
  'https://gs.gszyi.com:999/hls/764/20251008/165025/plist2.ts',
  '#EXT-X-ENDLIST',
].join('\n');

test('master 识别与档位解析：相对路径按基准补全，按码率升序', () => {
  assert.equal(isMaster(MASTER), true);
  const vs = parseMaster(MASTER, BASE);
  assert.equal(vs.length, 3);
  assert.equal(vs[0].bandwidth, 1024000);
  assert.equal(vs[2].bandwidth, 4096000);
  // 相对路径必须补成绝对地址，否则下载器无从下手
  assert.equal(vs[2].url, 'https://v.gsuus.com/play/hls/aaa/index.m3u8');
  assert.equal(vs[2].resolution, '1920x1080');
});

test('media 不是 master（含分片却无 STREAM-INF）', () => {
  assert.equal(isMaster(MEDIA), false);
});

test('选档：high 取最高画质，low 取最低，mid 取约 1Mbps', () => {
  const vs = parseMaster(MASTER, BASE);
  assert.equal(pickVariant(vs, 'high')?.resolution, '1920x1080');
  assert.equal(pickVariant(vs, 'low')?.resolution, '640x360');
  assert.equal(pickVariant(vs, 'mid')?.resolution, '1280x720');
  assert.equal(pickVariant([], 'high'), null);
});

test('media 解析：分片、时长合计、绝对地址原样保留', () => {
  const m = parseMedia(MEDIA, BASE);
  assert.equal(m.segments.length, 3);
  assert.equal(m.segments[0].duration, 7.416667);
  assert.equal(m.segments[0].url, 'https://gs.gszyi.com:999/hls/764/20251008/165025/plist0.ts');
  assert.equal(Math.round(m.totalDuration), Math.round(7.416667 + 9.375 + 8));
  assert.equal(m.encrypted, false);
  assert.equal(m.live, false); // 有 ENDLIST，是点播
});

test('media 解析：相对分片、加密与直播标记、EXT-X-MAP 初始化分片', () => {
  const text = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:6,',
    'seg0.m4s',
    '#EXTINF:6,',
    'seg1.m4s',
  ].join('\n');
  const m = parseMedia(text, 'https://cdn.test/hls/index.m3u8');
  assert.equal(m.segments[0].url, 'https://cdn.test/hls/seg0.m4s');
  assert.equal(m.initSegment, 'https://cdn.test/hls/init.mp4');
  assert.equal(m.encrypted, true);
  assert.equal(m.live, true); // 无 ENDLIST：不能缓存
});

test('KEY 为 METHOD=NONE 不算加密', () => {
  const m = parseMedia('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST', BASE);
  assert.equal(m.encrypted, false);
});

test('本地播放列表：指向本地文件、保留时长、以 ENDLIST 结束', () => {
  const segs = [
    { name: 'seg-000001.ts', duration: 7.416667 },
    { name: 'seg-000002.ts', duration: 9.375 },
  ];
  const out = buildLocalPlaylist(segs, (n) => `https://localhost/_capacitor_file_/data/${n}`);
  assert.match(out, /^#EXTM3U/);
  assert.match(out, /#EXT-X-PLAYLIST-TYPE:VOD/);
  assert.match(out, /#EXT-X-TARGETDURATION:10/); // 取最大时长向上取整
  assert.match(out, /#EXTINF:7\.416667,\nhttps:\/\/localhost\/_capacitor_file_\/data\/seg-000001\.ts/);
  assert.match(out, /#EXT-X-ENDLIST$/);
});

test('文件名清洗：路径分隔符与非法字符被替换，且非空', () => {
  assert.equal(safeName('庆余年 第一季'), '庆余年 第一季');
  assert.equal(safeName('A/B:C?D*E"F<G>H|I'), 'A_B_C_D_E_F_G_H_I');
  assert.equal(safeName('   '), 'untitled');
  assert.equal(safeName('....'), 'untitled');
  assert.ok(safeName('x'.repeat(200)).length <= 60);
});

test('零填充：文件管理器按名排序即播出顺序', () => {
  assert.equal(pad(1), '001');
  assert.equal(pad(12), '012');
  assert.equal(pad(123), '123');
  assert.ok(pad(2) < pad(10)); // 字符串比较下顺序仍正确
});

test('扩展名识别：拿不到就回退 .ts', () => {
  assert.equal(extOf('https://a/b/plist0.ts'), '.ts');
  assert.equal(extOf('https://a/b/seg.m4s'), '.m4s');
  assert.equal(extOf('https://a/b/x.mp4?token=1'), '.mp4');
  assert.equal(extOf('https://a/b/unknown'), '.ts');
});

test('resolveUrl：绝对地址原样返回，相对地址按基准补全', () => {
  assert.equal(resolveUrl('https://x/y.ts', BASE), 'https://x/y.ts');
  assert.equal(resolveUrl('/play/hls/a.ts', 'https://v.gsuus.com/play/x/index.m3u8'), 'https://v.gsuus.com/play/hls/a.ts');
  assert.equal(resolveUrl('seg0.ts', 'https://cdn.test/hls/index.m3u8'), 'https://cdn.test/hls/seg0.ts');
});
