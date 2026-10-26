/**
 * HLS 的 AES-128 解密。
 *
 * 为什么必须支持：实测 8 个主要片源里 6 个用 AES-128 加密
 * （猫眼/光速/极速/红牛/虎牙/速播），只有暴风、最大资源是明文。
 * 「遇到加密就拒绝缓存」等于缓存功能对多数片源直接失效。
 *
 * 做法是**下载时解密、本地存明文**，而不是把密钥一起缓存下来让播放器解：
 * 后者要往本地播放列表里写 `#EXT-X-KEY`，还得保证播放器能读到本地密钥文件，
 * 多一条容易出错的链路；前者则让离线播放与明文片源走完全相同的路径
 * （该路径已实现并有测试覆盖）。
 *
 * 解密用 WebCrypto。Capacitor 在 Android 上以 https://localhost 加载页面，
 * 属于安全上下文，`crypto.subtle` 可用。
 */

/** HLS 里 AES-128 的块大小固定 16 字节 */
const AES_BLOCK = 16;

/**
 * 由分片序号推导默认 IV。
 *
 * HLS 规范：`#EXT-X-KEY` 没写 IV 时，用该分片的媒体序号作为 IV，
 * 按 128 位**大端**编码（前 12 字节为 0，后 4 字节放序号）。
 * 实测猫眼源就不写 IV，因此这条默认路径是必经之地。
 *
 * 返回类型写成 `Uint8Array<ArrayBuffer>` 而不是裸 `Uint8Array`：
 * TS 5.7 起后者的缓冲区类型是 `ArrayBufferLike`（可能是 SharedArrayBuffer），
 * 而 WebCrypto 只接受 `ArrayBuffer`，裸类型会直接编译不过。
 */
export function ivFromSeq(seq: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(AES_BLOCK);
  new DataView(iv.buffer).setUint32(12, seq >>> 0, false);
  return iv;
}

/**
 * 解析 `#EXT-X-KEY` 里的 IV。
 *
 * 支持 `0x...` 前缀的 32 位十六进制。缺失或格式不对时退回序号推导——
 * 宁可退回默认值，也不要拿半个 IV 去解密：那会让整集每一片都解不开，
 * 而错误现场只剩一句「解密失败」，排查成本极高。
 */
export function parseIv(hex: string | null, seq: number): Uint8Array<ArrayBuffer> {
  if (!hex) return ivFromSeq(seq);
  const clean = hex.trim().replace(/^0x/i, '');
  if (clean.length !== AES_BLOCK * 2 || !/^[0-9a-f]+$/i.test(clean)) return ivFromSeq(seq);
  const out = new Uint8Array(AES_BLOCK);
  for (let i = 0; i < AES_BLOCK; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * AES-128-CBC 解密，并去掉 PKCS7 填充（WebCrypto 会自动去填充）。
 * 密钥长度必须 16 字节。
 */
export async function aes128CbcDecrypt(
  key: ArrayBuffer,
  iv: Uint8Array<ArrayBuffer>,
  data: ArrayBuffer,
): Promise<ArrayBuffer> {
  if (key.byteLength !== AES_BLOCK) {
    throw new Error(`密钥长度异常（${key.byteLength} 字节，应为 16）`);
  }
  const imported = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
  return crypto.subtle.decrypt({ name: 'AES-CBC', iv }, imported, data);
}
