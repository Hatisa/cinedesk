/**
 * AES-128 解密的自动化测试。
 *
 * 为什么要测：实测 8 个主要片源里 6 个是 AES-128 加密。解密逻辑一旦有偏差
 * （IV 推导错、填充没去掉），表现是「整集每一片都解不开」，而真机上只看得到
 * 一句「解密失败」——分片是几百个二进制文件，没法肉眼排查。
 *
 * 运行：npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aes128CbcDecrypt, ivFromSeq, parseIv } from './aes.ts';

/** 用同一套 WebCrypto 加密，构造测试用的密文 */
async function encryptCbc(
  key: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
  return crypto.subtle.encrypt({ name: 'AES-CBC', iv }, imported, data);
}

test('解密往返：加密后能原样解回', async () => {
  const key = new Uint8Array(16).fill(7);
  const iv = ivFromSeq(0);
  const plain = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

  const cipher = await encryptCbc(key, iv, plain);
  const out = new Uint8Array(await aes128CbcDecrypt(key.buffer, iv, cipher));

  assert.deepEqual([...out], [...plain]);
});

test('解密后去掉 PKCS7 填充：长度回到原始明文', async () => {
  const key = new Uint8Array(16).fill(3);
  const iv = ivFromSeq(9);
  // 9 字节明文会被补齐到 16 字节，解密后必须还原成 9 字节
  const plain = new TextEncoder().encode('hello hls');

  const cipher = await encryptCbc(key, iv, plain);
  const out = new Uint8Array(await aes128CbcDecrypt(key.buffer, iv, cipher));

  assert.equal(out.length, plain.length);
  assert.equal(new TextDecoder().decode(out), 'hello hls');
});

test('IV 推导：按 128 位大端编码媒体序号，前 12 字节为 0', () => {
  assert.deepEqual([...ivFromSeq(0)], new Array(16).fill(0));
  // 序号 1 → 最后一字节为 1
  assert.deepEqual([...ivFromSeq(1)].slice(12), [0, 0, 0, 1]);
  // 大端：高位在前
  assert.deepEqual([...ivFromSeq(0x01020304)].slice(12), [1, 2, 3, 4]);
  // 每片之间 IV 必须不同，否则同一密钥下密文会相互影响
  assert.notDeepEqual([...ivFromSeq(5)], [...ivFromSeq(6)]);
});

test('解析 IV：合法的 32 位十六进制被采纳，异常值退回序号推导', () => {
  const hex = '0000000000000000000000000000000a';
  assert.deepEqual([...parseIv(hex, 0)], [...ivFromSeq(10)]);
  assert.deepEqual([...parseIv(`0x${hex}`, 0)], [...ivFromSeq(10)]);
  // 未声明、长度不对、含非法字符：都退回按序号推导，
  // 而不是拿半个 IV 去解密（那会整集解不开）
  assert.deepEqual([...parseIv(null, 4)], [...ivFromSeq(4)]);
  assert.deepEqual([...parseIv('abcd', 4)], [...ivFromSeq(4)]);
  assert.deepEqual([...parseIv('z'.repeat(32), 4)], [...ivFromSeq(4)]);
});

test('密钥长度异常时抛出可读错误', async () => {
  const iv = ivFromSeq(0);
  await assert.rejects(
    () => aes128CbcDecrypt(new Uint8Array(8).buffer, iv, new ArrayBuffer(16)),
    /密钥长度异常/,
  );
});
