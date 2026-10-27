/** 非法、未知及片尾位置都不应写入 currentTime。 */
export function resumePosition(position: number, duration: number): number {
  if (!Number.isFinite(position) || !Number.isFinite(duration)) return 0;
  if (position <= 1 || position >= duration - 5) return 0;
  return Math.max(0, position);
}
