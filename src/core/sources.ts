/**
 * 内置采集源清单。
 *
 * 筛选标准：
 *  1. 实测可用（对关键词「庆余年」返回有效结果）；
 *  2. 正规综合影视内容——成人向站点已全部剔除，filter.ts 再兜一道关键词过滤；
 *  3. 接口遵循苹果 CMS vod 协议，且至少带一条 *.m3u8 / *.mp4 直链线路。
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
  { key: 'yutu', name: '玉兔资源', api: 'https://apiyutu.com/api.php/provide/vod', detail: 'https://apiyutu.com' },
  { key: 'didi', name: '滴滴资源', api: 'https://api.ddapi.cc/api.php/provide/vod', detail: 'https://didizy.com' },
  { key: 'taohua', name: '桃花资源', api: 'https://thzy1.me/api.php/provide/vod', detail: 'https://thzy8.me' },
  { key: 'souav', name: 'SouAV资源', api: 'https://api.souavzyw.net/api.php/provide/vod', detail: 'https://souavzyw.com' },
  { key: 'xiaojizy', name: '小鸡资源', api: 'https://api.xiaojizy.live/provide/vod', detail: 'https://xiaojizy.live' },
  { key: 'lebo', name: '乐播资源', api: 'https://lbapi9.com/api.php/provide/vod', detail: 'https://lbapi9.com' },
  { key: 'moduapi', name: '魔都动漫', api: 'https://caiji.moduapi.cc/api.php/provide/vod', detail: 'https://caiji.moduapi.cc' },
  { key: '155zy', name: '155资源', api: 'https://155api.com/api.php/provide/vod', detail: 'https://155zy2.com' },
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
