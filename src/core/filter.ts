/**
 * 内容甄别与名称归一化。
 *
 * 三层过滤，逐层收紧：
 *   1. 源级白名单（sources.ts）—— 不收录已知的成人站；
 *   2. 分类级甄别（本文件 ADULT_CLASS_RE）—— 采集接口的「伦理片」「日本无码」
 *      「麻豆传媒」等分类下装的几乎全是成人内容，这是最可靠的判据；
 *   3. 片名级关键词（BLOCKED_WORDS）—— 兜住分类被标错或缺失的少量条目。
 *
 * 全部判据来自对内置源真实分类清单（ac=list）与真实搜索结果的实测，
 * 不是凭印象罗列。实测：25 个源共出现 57 个成人向分类名，条目占比高
 * （个别源高达 78%），仅靠片名关键词会大量漏过。
 */

/**
 * 成人向分类特征。
 *
 * 下面每个词都严格取自实测到的分类名，没有凭印象添加：
 *   伦理(伦理片/三级伦理/韩国伦理/日本伦理/西方伦理/视频伦理/伦理)、
 *   无码(日本无码/无码专区/中字无码/无码高清/欧美无码)、
 *   有码(日本有码/中字有码/经典有码)、里番(里番动漫)、H漫(激情H漫)、
 *   三级(三级伦理/港台三级/国产三级/日韩三级)、情色(欧美情色/亚洲情色)、
 *   色情(重口色情)、福利(福利/福利姬)、
 *   自拍(国产自拍/自拍偷拍/网友自拍)、偷拍(自拍偷拍/街拍偷拍)、
 *   主播(主播网红/主播秀色/主播视讯/国产主播/美女主播/韩国主播)、
 *   网红(主播网红/性感网红/网红头条)、
 *   人妻(熟女人妻/性感人妻/国产人妻/人妻熟女)、熟女(熟女人妻/人妻熟女)、
 *   乱伦(强奸乱伦/乱伦/国产乱伦)、强奸(强奸乱伦)、
 *   制服(制服诱惑/丝袜制服)、丝袜(丝袜制服)、
 *   写真(写真热舞/美女写真/唯美写真)、热舞(写真热舞)、
 *   探花(探花嫖娼/探花)、嫖(探花嫖娼)、
 *   激情(激情H漫/露出激情)、露出(露出激情)、秀色(主播秀色)、
 *   麻豆传媒/天美传媒/精东影业/星空无限传媒/蜜桃影像传媒（制作方）、
 *   91制片(91制片厂)。
 *
 * 这些词在正规影视分类里不出现，因此可整体拦截。刻意不使用 'av'、'91'、
 * '美女' 这类短词或泛词——它们会误伤 Avatar、91天、美女与野兽 等正常片名。
 */
const ADULT_CLASS_RE = new RegExp(
  [
    '伦理',
    '无码',
    '有码',
    '里番',
    'H漫',
    '三级',
    '情色',
    '色情',
    '福利',
    '自拍',
    '偷拍',
    '主播',
    '网红',
    '人妻',
    '熟女',
    '乱伦',
    '强奸',
    '制服',
    '丝袜',
    '写真',
    '热舞',
    '探花',
    '嫖',
    '激情',
    '露出',
    '秀色',
    '麻豆',
    '天美',
    '精东',
    '星空无限',
    '蜜桃',
    '91制片',
  ].join('|'),
  'i',
);

/**
 * 短剧向分类特征。
 *
 * 实测分类名：短剧、AI漫剧、反转爽剧、擦边短剧、爽文短剧、漫剧、短剧大全、
 * 短剧现代都市、短剧古装仙侠…共 15 种，可被 '短剧' / '爽剧' / '漫剧' 覆盖。
 *
 * 这些分类下是批量生产的网络短剧，与用户想看的影视作品不是一回事，
 * 搜索时统一沉底（而非丢弃，用户仍可点开）。
 */
const SHORT_CLASS_RE = /短剧|爽剧|漫剧|微短剧|竖屏/i;

/**
 * 高置信度成人关键词（片名与简介用）。
 * 作为分类甄别的补充：有些源把成人条目塞进正常分类，此时靠片名兜住。
 * 同样回避 'av'、'91' 等会误伤的短词。
 */
const BLOCKED_WORDS = [
  '成人片',
  '成人影视',
  '成人电影',
  '色情',
  '里番',
  '无码',
  '有码',
  '三级片',
  '做爱',
  '性爱',
  '裸聊',
  '约炮',
  '福利姬',
  '麻豆传媒',
  'porn',
  'hentai',
  'javbus',
  '淫',
  '嫖',
];

/** 内容分层：决定搜索结果里的先后顺序 */
export type ContentTier =
  /** 豆瓣有评分的作品 —— 用户最可能想看的那一类 */
  | 'mainstream'
  /** 普通影视作品 */
  | 'general'
  /** 网络短剧 —— 沉底但保留 */
  | 'shortDrama';

export interface ContentAssessment {
  /** 是否判为成人内容（应丢弃） */
  adult: boolean;
  /** 是否短剧（应沉底） */
  shortDrama: boolean;
  tier: ContentTier;
}

/** 判断片名是否命中成人关键词 */
export function isBlocked(...texts: (string | undefined)[]): boolean {
  const s = texts.filter(Boolean).join(' ').toLowerCase();
  if (!s) return false;
  return BLOCKED_WORDS.some((w) => s.includes(w));
}

/** 判断分类文本是否属于成人向分类 */
export function isAdultClass(classText: string | undefined): boolean {
  const s = (classText || '').trim();
  if (!s) return false;
  return ADULT_CLASS_RE.test(s);
}

/** 判断分类文本是否属于短剧向分类 */
export function isShortDramaClass(classText: string | undefined): boolean {
  const s = (classText || '').trim();
  if (!s) return false;
  return SHORT_CLASS_RE.test(s);
}

/**
 * 对一条影片做内容甄别。
 *
 * @param input.name      片名
 * @param input.classText 分类文本，建议把 vod_class 与 type_name 一并传入
 *                        （前者常含多个逗号分隔的分类，后者是主分类）
 * @param input.score     豆瓣评分，>0 表示豆瓣收录了这部作品
 *
 * 豆瓣评分在这里起到「豁免」作用：实测「伦理片」分类下混有正经电影
 * （再次死亡 5.7、青春2000 6.6、唐朝艳妃 4.6），它们只是被源归错了类。
 * 豆瓣不会收录色情内容，所以有评分即可判定为正规作品，不按成人处理。
 */
export function classifyContent(input: {
  name: string;
  classText?: string;
  score?: number;
}): ContentAssessment {
  const { name, classText = '', score = 0 } = input;

  // 片名直接命中成人关键词：最高置信度，不受评分豁免
  if (isBlocked(name)) {
    return { adult: true, shortDrama: false, tier: 'general' };
  }

  const adultByClass = isAdultClass(classText);
  // 有豆瓣评分 → 是正规作品，忽略分类层面的成人判定（源归类不准）
  const adult = adultByClass && !(score > 0);
  if (adult) {
    return { adult: true, shortDrama: isShortDramaClass(classText), tier: 'general' };
  }

  const shortDrama = isShortDramaClass(classText);
  const tier: ContentTier = shortDrama ? 'shortDrama' : score > 0 ? 'mainstream' : 'general';
  return { adult: false, shortDrama, tier };
}

/**
 * 排序权重：数字越小越靠前。
 *
 * 用户要的是影视作品，而不是流水线短剧，所以：
 *   0 - 豆瓣有评分（用户最可能想看，且是最强的「正规作品」信号）
 *   1 - 普通影视作品
 *   2 - 网络短剧（沉底）
 *
 * 单独抽成函数是为了便于测试，聚合层只负责调用。
 */
export function contentRank(input: {
  score: number;
  scoreSource?: 'douban' | 'site' | null;
  shortDrama: boolean;
}): number {
  // 短剧始终沉底；站内高分也不能冒充豆瓣分获得主流层级。
  if (input.shortDrama) return 2;
  return input.score > 0 && input.scoreSource !== 'site' ? 0 : 1;
}

/**
 * 归一化片名，用于跨源聚合去重。
 * 去掉空白与常见标点，统一全角/大小写，使「庆余年 第二季」与「庆余年第二季」归为同一条。
 */
export function normalizeName(name: string): string {
  return name
    .replace(/\s+/g, '')
    .replace(/[·・:：\-—_~～，,。.！!？?《》<>()（）\[\]【】{}'"“”‘’`|/\\*+]/g, '')
    .toLowerCase();
}

/** 把「更新至36集」「HD国语」「已完结」等备注压缩为简短标签 */
export function shortRemarks(remarks: string): string {
  const r = (remarks || '').trim();
  if (!r) return '';
  return r.length > 12 ? r.slice(0, 12) : r;
}
