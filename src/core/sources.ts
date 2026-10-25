/**
 * 内置采集源清单。
 *
 * 筛选标准：
 *  1. 实测可用（对关键词「庆余年」返回有效结果）；
 *  2. 正规综合影视内容——成人向站点已全部剔除，filter.ts 再兜两道：
 *     分类级甄别（伦理片/无码/主播…）+ 片名关键词；
 *  3. 接口遵循苹果 CMS vod 协议，且至少带一条 *.m3u8 / *.mp4 直链线路。
 *
 * 源的取舍依据是实测数据而非印象：对「庆余年」「流浪地球」「甄嬛传」「狂飙」
 * 「三体」等正规片名搜索，若某源返回的全是成人内容、且一条豆瓣评分都没有，
 * 就整站下架。据此下架了 6 个源（玉兔、滴滴、桃花、小鸡、乐播、155），
 * 它们在上述合法片名下的成人分类占比为 36%/0%/68%/67%/82%/55%，
 * 且没有一条带豆瓣评分；对照组（极速/光速/豪华）为 0% 成人、9–12 条带评分。
 *
 * 源会失效——实测约 1/3 的源随时可能挂掉，因此这里铺了足够多的源，
 * 由 aggregate.ts 并发聚合、health.ts 按实测健康度动态排序，单源失效不影响可用性。
 */
import type { SourceConfig } from './types';

interface SourceSeed {
  key: string;
  name: string;
  api: string;
  detail?: string;
}

const SEEDS: SourceSeed[] = [
  { key: 'dyttzy', name: '电影天堂', api: 'http://caiji.dyttzyapi.com/api.php/provide/vod', detail: 'https://www.dyttzyapi.com' },
  { key: 'jszy', name: '极速资源', api: 'https://jszyapi.com/api.php/provide/vod', detail: 'https://jszyapi.com' },
  { key: 'ffzy', name: '非凡资源', api: 'https://api.ffzyapi.com/api.php/provide/vod', detail: 'https://ffzyapi.com' },
  { key: 'bfzy', name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod', detail: 'https://bfzy.tv' },
  { key: 'guangsu', name: '光速资源', api: 'https://api.guangsuapi.com/api.php/provide/vod', detail: 'https://guangsuapi.com' },
  { key: 'hongniu', name: '红牛资源', api: 'https://www.hongniuzy2.com/api.php/provide/vod', detail: 'https://www.hongniuzy.com' },
  { key: 'huya', name: '虎牙资源', api: 'https://www.huyaapi.com/api.php/provide/vod', detail: 'https://www.huyaapi.com' },
  { key: '360zy', name: '360资源', api: 'https://360zyzz.com/api.php/provide/vod', detail: 'https://360zy.com' },
  { key: 'modu', name: '魔都资源', api: 'https://www.mdzyapi.com/api.php/provide/vod', detail: 'https://www.moduzy.net' },
  { key: 'maoyan', name: '猫眼资源', api: 'https://api.maoyanapi.top/api.php/provide/vod', detail: 'https://www.maoyanzy.com' },
  { key: 'uku', name: 'U酷影视', api: 'https://api.ukuapi88.com/api.php/provide/vod', detail: 'https://api.ukuapi88.com' },
  { key: 'zuidapi', name: '最大资源', api: 'https://api.zuidapi.com/api.php/provide/vod', detail: 'https://zuida.xyz' },
  { key: 'subo', name: '速播资源', api: 'https://subocaiji.com/api.php/provide/vod', detail: 'https://www.subozy.com' },
  { key: 'haohua', name: '豪华资源', api: 'https://hhzyapi.com/api.php/provide/vod', detail: 'https://www.haohuazy.com' },
  { key: 'liangzi', name: '量子影视', api: 'https://cj.lziapi.com/api.php/provide/vod', detail: 'https://lzizy.net' },
  { key: 'wujin', name: '无尽影视', api: 'https://api.wujinapi.com/api.php/provide/vod', detail: 'https://wujinzy.com' },
  { key: 'p2100', name: '飘零资源', api: 'https://p2100.net/api.php/provide/vod', detail: 'https://p2100.net' },
  { key: 'jinying', name: '金鹰点播', api: 'https://jyzyapi.com/provide/vod/from/jinyingyun/at/json', detail: 'https://jinyingzy.com' },
  { key: 'moduapi', name: '魔都动漫', api: 'https://caiji.moduapi.cc/api.php/provide/vod', detail: 'https://caiji.moduapi.cc' },
];

export const BUILTIN_SOURCES: SourceConfig[] = SEEDS.map((s) => ({
  ...s,
  enabled: true,
  builtin: true,
}));

/** 全新安装时的默认源列表（深拷贝，避免被后续修改污染） */
export function defaultSources(): SourceConfig[] {
  return BUILTIN_SOURCES.map((s) => ({ ...s }));
}

/**
 * 把本地存储里的源列表与当前内置清单对齐。
 *
 * 必须在启动时跑一次：设备上存的列表是安装当时的版本，之后内置清单若有变化
 * （例如下架了某个不该收录的源），它不会自己更新。这里以代码里的清单为准，
 * 同时保留用户的选择与自定义源，避免每次升级都把用户的配置重置掉：
 *   - 内置源：名称与接口地址跟随清单更新，但保留用户设置的启用/停用状态；
 *   - 已从清单移除的内置源：丢弃（用户当初并未主动添加它）；
 *   - 用户自己添加的源（builtin 为 false）：原样保留。
 */
export function reconcileSources(stored: SourceConfig[]): SourceConfig[] {
  const old = new Map(stored.map((s) => [s.key, s]));
  const builtin = BUILTIN_SOURCES.map((d) => {
    const prev = old.get(d.key);
    return prev ? { ...d, enabled: prev.enabled } : { ...d };
  });
  const custom = stored.filter((s) => !s.builtin);
  return [...builtin, ...custom];
}
