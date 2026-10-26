/**
 * HLS 播放列表解析与本地化改写。
 *
 * 缓存功能的地基：把源站的 m3u8 拆成「清晰度 / 分片清单」，
 * 下载完再把分片地址改写成设备上的本地文件，交给播放器离线播放。
 *
 * 实测（光速源某剧）：master 里是相对路径，media 里是 629 个绝对地址的
 * `.ts` 分片、每片 7–9 秒、无加密。相对与绝对两种写法这里都要能吃下——
 * 不同源站写法不同，只处理一种的话换个源就整个下载失败。
 */

/** 单个清晰度档位 */
export interface Variant {
  url: string;
  /** 码率（bps），用于挑最高画质 */
  bandwidth: number;
  /** 形如 1920x1080，可能为空 */
  resolution: string;
}

/** 单个媒体分片 */
export interface Segment {
  url: string;
  /** 时长（秒），0 表示缺失 */
  duration: number;
  /**
   * 该分片所属的密钥地址（AES-128 加密流才有）。
   * 密钥可以在播放列表中段切换，所以记录在分片而不是整个列表上。
   */
  keyUrl?: string;
  /** 该分片显式声明的 IV（十六进制）；未声明则为 null，按序号推导 */
  keyIv?: string | null;
}

/** 解析后的媒体播放列表 */
export interface Media {
  segments: Segment[];
  /** fMP4 流需要的初始化分片（#EXT-X-MAP），无则为 null */
  initSegment: string | null;
  /**
   * 是否加密（#EXT-X-KEY 且 METHOD 非 NONE）。
   * 加密不代表不能缓存——下载时会用密钥解密后落盘，本地存的是明文。
   */
  encrypted: boolean;
  /** 首个分片的媒体序号，用于推导未声明 IV 时的默认 IV */
  mediaSequence: number;
  /** 是否直播（无 #EXT-X-ENDLIST）；直播没有终点，不能缓存 */
  live: boolean;
  /** 总时长（秒） */
  totalDuration: number;
}

/** 把相对地址按基准地址补全；已是绝对地址则原样返回 */
export function resolveUrl(uri: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(uri)) return uri;
  try {
    return new URL(uri, baseUrl).href;
  } catch {
    return uri;
  }
}

/** 读取 #EXT-X-STREAM-INF 行里的属性值 */
function attr(line: string, name: string): string {
  const m = new RegExp(`${name}=("([^"]*)"|[^,]*)`, 'i').exec(line);
  if (!m) return '';
  return (m[2] ?? m[1] ?? '').trim();
}

/** 是否为 master（含多清晰度）播放列表 */
export function isMaster(text: string): boolean {
  return /#EXT-X-STREAM-INF/i.test(text);
}

/**
 * 解析 master 播放列表，返回按码率升序的档位列表。
 * 升序是为了让「最高画质」只需取最后一项。
 */
export function parseMaster(text: string, baseUrl: string): Variant[] {
  const lines = text.split(/\r?\n/);
  const out: Variant[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /#EXT-X-STREAM-INF:(.*)/i.exec(lines[i].trim());
    if (!m) continue;
    // 属性行的下一行「非空且非注释」才是地址
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith('#'))) j += 1;
    const uri = lines[j]?.trim();
    if (!uri) continue;
    out.push({
      url: resolveUrl(uri, baseUrl),
      bandwidth: Number(attr(m[1], 'BANDWIDTH')) || 0,
      resolution: attr(m[1], 'RESOLUTION'),
    });
    i = j;
  }
  out.sort((a, b) => a.bandwidth - b.bandwidth);
  return out;
}

/** 按画质偏好挑档位：high 取最高，low 取最低，mid 取居中的一档 */
export function pickVariant(variants: Variant[], quality: 'high' | 'mid' | 'low'): Variant | null {
  if (!variants.length) return null;
  if (quality === 'high') return variants[variants.length - 1];
  if (quality === 'low') return variants[0];
  // 按下标取中位档，而不是按码率阈值找：档位数量和码率各站差异很大，
  // 阈值法在「1M/2M/4M」这种常见三档里会直接落到最低档（中档形同虚设）。
  return variants[Math.floor(variants.length / 2)];
}

/** 解析 media 播放列表（分片清单） */
export function parseMedia(text: string, baseUrl: string): Media {
  const lines = text.split(/\r?\n/);
  const segments: Segment[] = [];
  let initSegment: string | null = null;
  let encrypted = false;
  let duration = 0;
  let total = 0;
  let mediaSequence = 0;
  // 当前生效的密钥，作用于其后所有分片，直到下一个 #EXT-X-KEY 覆盖它。
  // 记在分片上而不是整个列表上：密钥可以在播放列表中段切换。
  let curKeyUrl: string | undefined;
  let curKeyIv: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (/^#EXT-X-MEDIA-SEQUENCE/i.test(line)) {
      const v = parseInt(line.slice(line.indexOf(':') + 1), 10);
      mediaSequence = Number.isFinite(v) ? v : 0;
      continue;
    }
    if (/^#EXT-X-KEY/i.test(line)) {
      const method = attr(line, 'METHOD');
      if (!method || /NONE/i.test(method)) {
        // METHOD=NONE：从此处起恢复明文
        curKeyUrl = undefined;
        curKeyIv = null;
      } else if (/AES-128/i.test(method)) {
        const uri = attr(line, 'URI');
        curKeyUrl = uri ? resolveUrl(uri, baseUrl) : undefined;
        // 未声明 IV 时按分片序号推导，故先原样存 null
        curKeyIv = attr(line, 'IV') || null;
        encrypted = true;
      } else {
        // SAMPLE-AES 等模式无法用 WebCrypto 还原，早点报错好过下到一半失败
        throw new Error(`暂不支持的加密方式：${method}`);
      }
      continue;
    }
    if (/^#EXT-X-MAP/i.test(line)) {
      const uri = attr(line, 'URI');
      if (uri) initSegment = resolveUrl(uri, baseUrl);
      continue;
    }
    if (/^#EXTINF/i.test(line)) {
      const v = parseFloat(line.slice(line.indexOf(':') + 1));
      duration = Number.isFinite(v) ? v : 0;
      continue;
    }
    if (line.startsWith('#')) continue;

    segments.push({
      url: resolveUrl(line, baseUrl),
      duration,
      keyUrl: curKeyUrl,
      keyIv: curKeyIv,
    });
    total += duration;
    duration = 0;
  }

  return {
    segments,
    initSegment,
    encrypted,
    mediaSequence,
    live: !/#EXT-X-ENDLIST/i.test(text),
    totalDuration: total,
  };
}

/** 本地分片记录（下载完成后写入索引） */
export interface LocalSegment {
  /** 设备上的文件名，如 seg-000001.ts */
  name: string;
  duration: number;
}

/**
 * 生成指向本地分片的播放列表。
 *
 * 分片地址由 `srcOf` 在播放时现算，而不在下载时固化进文件：
 * 该地址里含运行时的本地服务地址（convertFileSrc 的结果），
 * 换设备、换 App 版本都可能变化，固化下来会导致离线播放全部 404。
 */
export function buildLocalPlaylist(segs: LocalSegment[], srcOf: (name: string) => string): string {
  const maxDur = Math.ceil(segs.reduce((m, s) => Math.max(m, s.duration), 0));
  const out = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${maxDur > 0 ? maxDur : 10}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];
  for (const s of segs) {
    out.push(`#EXTINF:${s.duration || 0},`);
    out.push(srcOf(s.name));
  }
  out.push('#EXT-X-ENDLIST');
  return out.join('\n');
}

/**
 * 文件名清洗。
 * 片名里可能带 `/`、`:`、`?` 等字符，直接当目录名会创建失败或写到别处，
 * 统一替换为下划线；同时截断长度，避免超出文件系统限制。
 */
export function safeName(name: string): string {
  const base = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  // 纯点号/空白组成的名字（".."、"...."）没有信息量，且 ".." 作目录名会指向
  // 上级目录，有穿越风险；这类名字统一落到 untitled。
  // 注意不能用「是否只含下划线」判断——"A/B" 清洗后是 "A_B"，那是有效名字。
  if (!base.replace(/[._\s]/g, '')) return 'untitled';
  const noLeadingDot = base.replace(/^\.+/, '_'); // 前导点在安卓上会被当作隐藏文件
  return noLeadingDot.slice(0, 60);
}

/** 零填充序号：文件管理器里按名称排序即播出顺序 */
export function pad(n: number, width = 3): string {
  return String(n).padStart(width, '0');
}

/** 从地址里取分片扩展名，用于本地文件命名（拿不到就用 .ts） */
export function extOf(url: string): string {
  const m = /\.(ts|m4s|mp4|aac|m4a|vtt|key)(\?|$)/i.exec(url);
  return m ? `.${m[1].toLowerCase()}` : '.ts';
}
