/** 生成可离线分享的影片卡片文本，不上传观看记录。 */
export function buildShareText(input: { name: string; score: number; year: string; typeName: string; actors: string[]; keyword: string }): string {
  const lines = [
    `🎬 ${input.name}`,
    input.score > 0 ? `豆瓣评分 ${input.score.toFixed(1)}` : '',
    [input.year, input.typeName].filter(Boolean).join(' · '),
    input.actors.length ? `主演：${input.actors.join('、')}` : '',
    '',
    `🔎 搜索关键词：${input.keyword}`,
    '（在影视大全中粘贴关键词即可找到）',
  ];
  return lines.filter((l, i) => l !== '' || i === lines.length - 2).join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
