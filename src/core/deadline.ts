/**
 * 兜底超时。
 *
 * 为什么必须有这一层：
 *   CapacitorHttp 只把 connectTimeout/readTimeout 交给原生 OkHttp，
 *   **JS 这侧的 Promise 本身没有任何兜底**。底层连接一旦卡在 DNS 解析、
 *   TLS 握手或某个插件内部的死锁上，这个 Promise 既不 resolve 也不 reject。
 *   Filesystem 的 stat/writeFile 同理，插件回调不来就永远悬着。
 *
 *   缓存功能的表现于是变成：通知栏永远停在「准备中」、进度一动不动，
 *   而且**没有任何错误信息可看**——用户既不知道在等什么，也没法重试。
 *   有了这层，最坏情况也会在可预期的时间内变成一条明确的失败原因。
 *
 * 用 Promise.race 而不是 AbortSignal：这里要救的正是「调用方拿不到
 * 取消句柄」的场景，超时后原 Promise 仍在后台挂着，但上层已经能
 * 标记失败并让用户重试。
 */
export function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}超时（${Math.round(ms / 1000)} 秒无响应）`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
