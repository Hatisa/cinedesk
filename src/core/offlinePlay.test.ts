/**
 * 离线播放地址生成的自动化测试。
 *
 * 锁住的是「分片地址拼接」这一步：它出错的表现是离线时整集 404，
 * 而离线场景恰恰没法在线排查，必须在测试里锁死。
 *
 * 运行：npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localPlaylistUrl, type PlaylistDeps } from './offlinePlay.ts';
import type { OfflineEpisode } from './offline.ts';

const DIR = '庆余年 第一季/001_第01集';
const BASE = `https://localhost/_capacitor_file_/data/user/0/com.cinedesk.app/files/cinedesk/${DIR}`;

const EP: OfflineEpisode = {
  epIndex: 0,
  epName: '第01集',
  dir: DIR,
  segments: [
    { name: 'seg-000001.ts', duration: 7.416667 },
    { name: 'seg-000002.ts', duration: 9.375 },
  ],
  bytes: 1024,
  duration: 16.79,
  quality: 'high',
  sourceKey: 'gs',
  sourceName: '光速资源',
  lineName: 'gsm3u8',
  createdAt: 1,
};

/** 记录所有写盘内容，并按路径返回可播放地址 */
function makeDeps() {
  const written: Record<string, string> = {};
  const asked: string[] = [];
  const deps: PlaylistDeps = {
    localUrlOf: async (path) => {
      asked.push(path);
      return `${BASE.replace(DIR, path.replace(/\/index\.m3u8$/, ''))}${path.endsWith('.m3u8') ? '/index.m3u8' : ''}`;
    },
    writeText: async (path, text) => {
      written[path] = text;
    },
  };
  return { deps, written, asked };
}

test('生成播放列表：分片地址指向本地文件，前缀取自集目录', async () => {
  const t = makeDeps();
  const url = await localPlaylistUrl(EP, t.deps);

  const text = t.written[`${DIR}/index.m3u8`];
  assert.ok(text, '应写入 index.m3u8');
  assert.match(text, new RegExp(`#EXTINF:7\\.416667,\n${BASE}/seg-000001\\.ts`));
  assert.match(text, new RegExp(`${BASE}/seg-000002\\.ts`));
  assert.match(text, /#EXT-X-ENDLIST$/);
  assert.ok(url?.endsWith('/index.m3u8'), `返回的播放地址应指向播放列表，实际 ${url}`);
});

test('目录地址结尾带斜杠时不会产生双斜杠', async () => {
  const written: Record<string, string> = {};
  const deps: PlaylistDeps = {
    localUrlOf: async () => `${BASE}/`, // 故意带尾斜杠
    writeText: async (path, text) => {
      written[path] = text;
    },
  };
  await localPlaylistUrl(EP, deps);
  assert.doesNotMatch(written[`${DIR}/index.m3u8`], /\/\/seg-/);
  assert.match(written[`${DIR}/index.m3u8`], new RegExp(`${BASE}/seg-000001\\.ts`));
});

test('没有分片时返回 null（不生成空播放列表）', async () => {
  const t = makeDeps();
  const url = await localPlaylistUrl({ ...EP, segments: [] }, t.deps);
  assert.equal(url, null);
  assert.deepEqual(Object.keys(t.written), []);
});

test('取不到目录地址时返回 null，交由调用方回退在线播放', async () => {
  const deps: PlaylistDeps = {
    localUrlOf: async () => null,
    writeText: async () => undefined,
  };
  assert.equal(await localPlaylistUrl(EP, deps), null);
});
