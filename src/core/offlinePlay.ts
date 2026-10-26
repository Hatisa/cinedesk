/**
 * 离线播放：把本地缓存的一集变成播放器能加载的地址。
 *
 * 播放列表**每次播放现生成**，而不是下载时固化：
 * 分片地址里含运行时的本地服务地址（convertFileSrc 的结果，形如
 * `https://localhost/_capacitor_file_/data/.../files/cinedesk/...`），
 * 这个前缀在换设备、App 重装、甚至重启后都可能变化。固化进文件的话，
 * 离线播放会整片 404——而用户恰恰是在没网的时候才来用这个功能，
 * 报错还没法在线排查。
 *
 * 分片地址只用一次原生桥调用算出：先取「集目录」的地址，再拼各分片名。
 * 逐片调用在几百片的剧集上会有几百次桥往返，慢到不可接受。
 */
import { localUrlOf as realLocalUrlOf, writeText as realWriteText } from './fs.ts';
import { buildLocalPlaylist } from './m3u8.ts';
import type { OfflineEpisode } from './offline.ts';

export interface PlaylistDeps {
  localUrlOf: (path: string) => Promise<string | null>;
  writeText: (path: string, text: string) => Promise<void>;
}

const realDeps: PlaylistDeps = {
  localUrlOf: realLocalUrlOf,
  writeText: realWriteText,
};

/**
 * 生成该集的本地播放列表并返回其可播放地址。
 * 返回 null 表示本地缓存不完整或地址取不到，调用方应回退到在线播放。
 */
export async function localPlaylistUrl(
  ep: OfflineEpisode,
  deps: PlaylistDeps = realDeps,
): Promise<string | null> {
  if (!ep.segments.length) return null;

  const dirUrl = await deps.localUrlOf(ep.dir);
  if (!dirUrl) return null;
  // 去掉结尾斜杠后作为前缀，避免出现 `//seg-000001.ts`
  const prefix = dirUrl.replace(/\/+$/, '');

  const playlist = buildLocalPlaylist(ep.segments, (name) => `${prefix}/${name}`);
  await deps.writeText(`${ep.dir}/index.m3u8`, playlist);

  return deps.localUrlOf(`${ep.dir}/index.m3u8`);
}
