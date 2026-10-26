/**
 * 下载引擎的自动化测试。
 *
 * 断点续传、并发上限、取消这些行为光看代码看不出来，必须有测试锁住：
 * 写错的后果是「重下整部剧浪费流量」或「并发打满把源站惹毛」，
 * 两者在真机上都不好复现。
 *
 * 运行：npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ivFromSeq } from './aes.ts';
import { downloadEpisode, fmtBytes, fmtSpeed, resolveMedia, type DownloadDeps } from './download.ts';

/** 用同一套 WebCrypto 加密，构造测试用的密文 */
async function encryptCbc(
  key: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
  return crypto.subtle.encrypt({ name: 'AES-CBC', iv }, imported, data);
}

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=1024000,RESOLUTION=640x360',
  'low.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=4096000,RESOLUTION=1920x1080',
  'high.m3u8',
].join('\n');

const media = (n: number, extra: string[] = []): string =>
  ['#EXTM3U', ...extra, ...Array.from({ length: n }, (_, i) => `#EXTINF:7.0,\nseg${i}.ts`), '#EXT-X-ENDLIST'].join('\n');

const SRC = 'https://cdn.test/hls/index.m3u8';

/** 造一个可控的假依赖，并记录所有发生的动作 */
function makeDeps(over: Partial<DownloadDeps> = {}) {
  const calls = { text: [] as string[], binary: [] as string[], writes: [] as string[] };
  const files = new Map<string, number>();
  let inflight = 0;
  let peak = 0;
  let failFirst = 0;

  const deps: DownloadDeps = {
    getText: async (url) => {
      calls.text.push(url);
      if (url.endsWith('index.m3u8')) return { ok: true, status: 200, text: MASTER };
      if (url.endsWith('high.m3u8')) return { ok: true, status: 200, text: media(6) };
      return { ok: true, status: 200, text: media(6) };
    },
    getBinary: async (url) => {
      calls.binary.push(url);
      inflight += 1;
      peak = Math.max(peak, inflight);
      // 模拟网络耗时，让并发真正重叠
      await new Promise((r) => setTimeout(r, 5));
      inflight -= 1;
      // 前 failFirst 次失败，用来验证重试
      if (failFirst > 0) {
        failFirst -= 1;
        return { ok: false, status: 502, data: null };
      }
      return { ok: true, status: 200, data: new Uint8Array([1, 2, 3, 4]).buffer };
    },
    sizeOf: async (path) => files.get(path) ?? 0,
    writeBinary: async (path, data) => {
      calls.writes.push(path);
      files.set(path, data.byteLength);
    },
    ...over,
  };
  return {
    deps,
    calls,
    files,
    peak: () => peak,
    setFailFirst: (n: number) => {
      failFirst = n;
    },
  };
}

test('下载一集：分片落盘、命名零填充、进度回调到 100%', async () => {
  const t = makeDeps();
  const seen: number[] = [];
  const res = await downloadEpisode(SRC, {
    dir: '庆余年/第001集',
    quality: 'high',
    deps: t.deps,
    onProgress: (done, total) => {
      assert.equal(total, 6);
      seen.push(done);
    },
  });

  assert.equal(res.segments.length, 6);
  // 集内序号零填充，文件管理器里才按顺序
  assert.equal(res.segments[0].name, 'seg-000001.ts');
  assert.equal(res.segments[5].name, 'seg-000006.ts');
  assert.equal(t.calls.writes.length, 6);
  assert.equal(seen.at(-1), 6); // 进度最终到满
  assert.equal(res.bytes, 24); // 每片 4 字节
  assert.equal(res.duration, 42); // 6 片 × 7 秒
});

test('断点续传：已在本地且非空的分片不重复下载', async () => {
  const t = makeDeps();
  // 预先存在两片（模拟上次中断）
  t.files.set('剧/第001集/seg-000001.ts', 4);
  t.files.set('剧/第001集/seg-000002.ts', 4);

  const res = await downloadEpisode(SRC, {
    dir: '剧/第001集',
    quality: 'high',
    deps: t.deps,
  });

  assert.equal(t.calls.writes.length, 4); // 只写了缺的 4 片
  assert.equal(res.segments.length, 6); // 结果仍覆盖全集
  assert.equal(res.bytes, 24); // 已存在的字节也计入总量
});

test('零字节的残留文件会被重下（上次写到一半）', async () => {
  const t = makeDeps();
  t.files.set('剧/第001集/seg-000001.ts', 0); // 空文件
  await downloadEpisode(SRC, { dir: '剧/第001集', quality: 'high', deps: t.deps });
  assert.equal(t.calls.writes.length, 6); // 6 片全写，空的没被当成已完成
});

test('并发上限被遵守', async () => {
  const t = makeDeps();
  await downloadEpisode(SRC, { dir: '剧/第001集', quality: 'high', deps: t.deps, concurrency: 2 });
  assert.ok(t.peak() <= 2, `并发峰值 ${t.peak()} 应不超过 2`);
});

test('分片失败会重试，重试成功则整集成功', async () => {
  const t = makeDeps();
  t.setFailFirst(2); // 前两次失败
  const res = await downloadEpisode(SRC, {
    dir: '剧/第001集',
    quality: 'high',
    deps: t.deps,
    retries: 3,
  });
  assert.equal(res.segments.length, 6);
  assert.ok(t.calls.binary.length > 6, '应有重试产生的额外请求');
});

test('重试耗尽后抛错，但已成功的分片保留（可续传）', async () => {
  const t = makeDeps({
    getBinary: async (url) => {
      // 固定让某一片失败
      if (url.endsWith('seg3.ts')) return { ok: false, status: 500, data: null };
      await new Promise((r) => setTimeout(r, 2));
      return { ok: true, status: 200, data: new Uint8Array([1, 2, 3, 4]).buffer };
    },
  });
  await assert.rejects(
    () => downloadEpisode(SRC, { dir: '剧/第001集', quality: 'high', deps: t.deps, retries: 1 }),
    /分片下载失败/,
  );
  // 其余 5 片已落盘，下次重跑只需补 seg3
  assert.equal(t.calls.writes.length, 5);
});

test('取消：signal 中止后抛 AbortError', async () => {
  const t = makeDeps();
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(
    () => downloadEpisode(SRC, { dir: '剧/第001集', quality: 'high', deps: t.deps, signal: ctl.signal }),
    (e: unknown) => (e as Error).name === 'AbortError',
  );
  assert.equal(t.calls.writes.length, 0); // 取消后不应再写盘
});

test('加密流：下载时就地解密，落到本地的是明文', async () => {
  /*
   * 实测 8 个主要片源里 6 个是 AES-128 加密，所以这不是边角情况。
   * 断言「存下来的是明文」而不是「能解密」：离线播放时播放器直接读本地
   * 文件，若把密文写进去，表现是整集黑屏、且没有任何错误信息。
   */
  const key = new Uint8Array(16).fill(9);
  const iv = ivFromSeq(0);
  const plain = new TextEncoder().encode('this is a ts segment');
  const cipher = await encryptCbc(key, iv, plain);

  const written = new Map<string, ArrayBuffer>();
  const deps: DownloadDeps = {
    getText: async (url) =>
      url.endsWith('index.m3u8')
        ? { ok: true, status: 200, text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhigh.m3u8' }
        : {
            ok: true,
            status: 200,
            text: [
              '#EXTM3U',
              '#EXT-X-MEDIA-SEQUENCE:0',
              '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
              '#EXTINF:7,',
              'seg0.ts',
              '#EXT-X-ENDLIST',
            ].join('\n'),
          },
    getBinary: async (url) =>
      url.endsWith('key.bin')
        ? { ok: true, status: 200, data: key.buffer }
        : { ok: true, status: 200, data: cipher },
    sizeOf: async () => 0,
    writeBinary: async (path, data) => {
      written.set(path, data);
    },
  };

  await downloadEpisode(SRC, { dir: 'd', quality: 'high', deps });

  const got = written.get('d/seg-000001.ts');
  assert.ok(got, '分片应已落盘');
  assert.deepEqual([...new Uint8Array(got)], [...plain]);
});

test('密钥只取一次：整集共用同一个密钥地址时不重复请求', async () => {
  const key = new Uint8Array(16).fill(5);
  const cipher = await encryptCbc(key, ivFromSeq(0), new TextEncoder().encode('abcdefghijklmnop'));
  let keyFetches = 0;

  const deps: DownloadDeps = {
    getText: async (url) =>
      url.endsWith('index.m3u8')
        ? { ok: true, status: 200, text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhigh.m3u8' }
        : {
            ok: true,
            status: 200,
            text: [
              '#EXTM3U',
              '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
              ...Array.from({ length: 4 }, (_, i) => `#EXTINF:7,\nseg${i}.ts`),
              '#EXT-X-ENDLIST',
            ].join('\n'),
          },
    getBinary: async (url) => {
      if (url.endsWith('key.bin')) {
        keyFetches += 1;
        return { ok: true, status: 200, data: key.buffer };
      }
      return { ok: true, status: 200, data: cipher };
    },
    sizeOf: async () => 0,
    writeBinary: async () => {},
  };

  await downloadEpisode(SRC, { dir: 'd', quality: 'high', deps });
  // 4 片共用密钥，逐片去取会让请求数翻倍，还容易被源站限流
  assert.equal(keyFetches, 1);
});

test('直播流拒绝缓存（没有终点，存下来也无法完整播放）', async () => {
  const live = makeDeps({
    getText: async (url) =>
      url.endsWith('index.m3u8')
        ? { ok: true, status: 200, text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhigh.m3u8' }
        : { ok: true, status: 200, text: '#EXTM3U\n#EXTINF:7,\na.ts' }, // 无 ENDLIST
  });
  await assert.rejects(
    () => downloadEpisode(SRC, { dir: 'd', quality: 'high', deps: live.deps }),
    /直播/,
  );
});

test('resolveMedia：master 时按画质选档，并把相对地址补全', async () => {
  const t = makeDeps();
  const m = await resolveMedia(SRC, 'high', t.deps);
  assert.equal(m.segments.length, 6);
  // 选的是最高档，且相对路径已按 master 所在地址补全
  assert.equal(t.calls.text[1], 'https://cdn.test/hls/high.m3u8');
  assert.equal(m.live, false);
});

test('resolveMedia：播放列表取不到时抛出可读错误', async () => {
  const bad = makeDeps({ getText: async () => ({ ok: false, status: 404, text: '' }) });
  await assert.rejects(() => resolveMedia(SRC, 'high', bad.deps), /播放列表获取失败/);
});

test('体积格式化', () => {
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtBytes(2048), '2 KB');
  assert.equal(fmtBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(fmtBytes(3 * 1024 * 1024 * 1024), '3.00 GB');
});

test('速度格式化，未知速度返回空串', () => {
  // KB 档沿用 fmtBytes 的取整口径（1536 B → 2 KB）
  assert.equal(fmtSpeed(1536), '2 KB/s');
  assert.equal(fmtSpeed(2 * 1024 * 1024), '2.0 MB/s');
  assert.equal(fmtSpeed(0), '');
  assert.equal(fmtSpeed(Number.NaN), '');
});

test('解析完立刻上报一次进度，界面不会停在「准备中」', async () => {
  /*
   * 这是真机上「通知栏一直显示准备中」的修复点。
   * 原先只有第一个分片写完之后才回调，在那之前 total 恒为 0，
   * 界面只能显示「准备中」；若首个分片因故卡住，就永远停在准备中。
   * 现在解析出分片清单后立即以 done=0 上报，用户马上能看到总数。
   */
  const t = makeDeps();
  const seen: Array<{ done: number; total: number }> = [];
  await downloadEpisode(SRC, {
    dir: '剧/第001集',
    quality: 'high',
    deps: t.deps,
    onProgress: (done, total) => seen.push({ done, total }),
  });

  assert.ok(seen.length > 0, '应至少回调一次');
  assert.equal(seen[0].done, 0, '第一次回调必须在任何分片完成之前');
  assert.equal(seen[0].total, 6, '第一次回调就要带上总分片数');
  assert.equal(seen.at(-1)?.done, 6, '最终进度到满');
});

test('进度回调带出速度，且速度为正数', async () => {
  const t = makeDeps();
  const speeds: number[] = [];
  await downloadEpisode(SRC, {
    dir: '剧/第001集',
    quality: 'high',
    deps: t.deps,
    onProgress: (_d, _t, _b, speed) => speeds.push(speed),
  });
  assert.ok(speeds.length > 0);
  assert.ok(speeds.every((s) => Number.isFinite(s) && s >= 0), '速度必须是有限非负数');
});
