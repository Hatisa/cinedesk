/**
 * 内容甄别的自动化测试。
 *
 * 用例里的分类名与片名**全部取自实测数据**（对内置源调 ac=list 拿到的真实分类清单，
 * 以及 ac=videolist 的真实搜索结果），不是编造的示例。这样测试才真正锁住行为：
 * 一旦规则被改得放过了实测出现过的成人分类，测试立刻失败。
 *
 * 运行：npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyContent,
  contentRank,
  isAdultClass,
  isBlocked,
  isShortDramaClass,
  normalizeName,
  shortRemarks,
} from './filter.ts';

/* ------------------------------------------------------------------ *
 * 一、成人分类甄别：这些分类名都实测存在于内置源的分类清单里
 * ------------------------------------------------------------------ */

test('实测存在的成人向分类一律判为成人', () => {
  /*
   * 下面 58 个分类名是完整抄录：对内置源逐个调 ac=list 取回分类清单后，
   * 筛出成人向分类并合并去重得到的全集（括号内为出现该分类的源数量）。
   * 全量锁住，才能保证规则改动时不会悄悄放过其中某一个。
   */
  const adultClasses = [
    // 最多源在用的一批
    '伦理片', // 16 源
    '里番动漫', // 3 源
    '日本有码', // 3 源
    '日本无码', // 3 源
    '强奸乱伦', // 3 源
    '三级伦理', // 3 源
    '麻豆传媒', // 3 源
    '国产自拍', // 3 源
    // 其余实测分类
    '港台三级',
    '韩国伦理',
    '西方伦理',
    '日本伦理',
    '写真热舞',
    '自拍偷拍',
    '乱伦',
    '主播网红',
    '无码专区',
    '熟女人妻',
    '制服诱惑',
    '福利',
    '伦理',
    '主播秀色',
    '性感人妻',
    '欧美情色',
    '国产乱伦',
    '国产人妻',
    '探花嫖娼',
    '主播视讯',
    '中字无码',
    '中字有码',
    '91制片厂',
    '蜜桃影像传媒',
    '天美传媒',
    '精东影业',
    '星空无限传媒',
    '美女写真',
    '探花',
    '丝袜制服',
    '无码高清',
    '经典有码',
    '性感网红',
    '激情H漫',
    '国产三级',
    '日韩三级',
    '亚洲情色',
    '国产主播',
    '视频伦理',
    '重口色情',
    '福利姬',
    '美女主播',
    '人妻熟女',
    '街拍偷拍',
    '网友自拍',
    '露出激情',
    '唯美写真',
    '韩国主播',
    '网红头条',
    '欧美无码',
  ];
  assert.equal(adultClasses.length, 58, '实测成人分类全集应为 58 个');
  for (const c of adultClasses) {
    assert.equal(isAdultClass(c), true, `应判为成人分类: ${c}`);
  }
});

test('正规影视分类不会被误判为成人', () => {
  // 同样取自实测分类清单
  const legitClasses = [
    '内地剧',
    '国产剧',
    '古装仙侠',
    '动作片',
    '恐怖片',
    '喜剧片',
    '奇幻片',
    '韩剧',
    '欧美剧',
    '中国动漫',
    '国产动漫',
    '爱情片',
    '科幻片',
    '剧情片',
    '纪录片',
    '预告片',
    '综艺',
    '电影',
  ];
  for (const c of legitClasses) {
    assert.equal(isAdultClass(c), false, `不应判为成人分类: ${c}`);
  }
});

test('片名拦截不误伤正常片名', () => {
  // 这些片名含 'av'/'91'/'美女' 等易误伤子串，必须放行
  for (const name of ['阿凡达', 'Avatar', '美女与野兽', '91天', '三体', '狂飙', '庆余年 第一季']) {
    assert.equal(isBlocked(name), false, `不应拦截: ${name}`);
  }
  // 明确命中的成人关键词
  for (const name of ['某某色情片', '麻豆传媒出品', 'porn 合集']) {
    assert.equal(isBlocked(name), true, `应拦截: ${name}`);
  }
});

/* ------------------------------------------------------------------ *
 * 二、classifyContent 的组合判定
 * ------------------------------------------------------------------ */

test('成人分类的条目被丢弃，即使带可播线路', () => {
  const v = classifyContent({ name: '夫妻性爱：最完美的性契合', classText: '伦理片', score: 0 });
  assert.equal(v.adult, true);
});

test('豆瓣评分可豁免误归类的正规电影', () => {
  // 实测：「伦理片」分类下混有正规电影，它们只是被源归错了类。
  // 豆瓣不收录色情内容，有评分即为正规作品。
  const cases = [
    { name: '再次死亡', score: 5.7 },
    { name: '青春2000', score: 6.6 },
    { name: '唐朝艳妃', score: 4.6 },
  ];
  for (const c of cases) {
    const v = classifyContent({ name: c.name, classText: '伦理片', score: c.score });
    assert.equal(v.adult, false, `有豆瓣分应豁免: ${c.name}`);
  }
});

test('片名命中成人关键词时，豆瓣评分不能豁免', () => {
  // 片名级判据置信度最高：这类名字不可能是正规作品
  const v = classifyContent({ name: '色情片合集', classText: '电影', score: 7.9 });
  assert.equal(v.adult, true);
});

test('vod_class 多值串里的成人标记也能识别', () => {
  // 实测 vod_class 形如「剧情,古装,内地剧」；成人分类以同样方式出现在串里
  const v = classifyContent({ name: '某片', classText: '剧情,伦理,内地剧', score: 0 });
  assert.equal(v.adult, true);
});

/* ------------------------------------------------------------------ *
 * 三、短剧识别
 * ------------------------------------------------------------------ */

test('实测存在的短剧分类一律识别为短剧', () => {
  for (const c of [
    '短剧', // 15 源
    'AI漫剧', // 11 源
    '反转爽剧', // 10 源
    '擦边短剧', // 9 源
    '爽文短剧',
    '漫剧',
    '短剧大全',
    '短剧现代都市',
    '短剧脑洞悬疑',
    '短剧年代穿越',
    '短剧古装仙侠',
    '短剧女频恋爱',
    '短剧成长逆袭',
    'AI短剧',
  ]) {
    assert.equal(isShortDramaClass(c), true, `应识别为短剧: ${c}`);
  }
});

test('正规分类不会被误判为短剧', () => {
  for (const c of ['内地剧', '古装仙侠', '国产剧', '动作片', '欧美剧', '电影']) {
    assert.equal(isShortDramaClass(c), false, `不应判为短剧: ${c}`);
  }
});

test('短剧条目标记为短剧', () => {
  const v = classifyContent({ name: '庆余年之风起沧州', classText: '短剧', score: 0 });
  assert.equal(v.adult, false);
  assert.equal(v.shortDrama, true);
});

/* ------------------------------------------------------------------ *
 * 四、内容分层与排序权重
 * ------------------------------------------------------------------ */

test('分层：豆瓣评分提升普通作品，但短剧始终沉底', () => {
  assert.equal(classifyContent({ name: '庆余年 第一季', classText: '内地剧', score: 7.9 }).tier, 'mainstream');
  assert.equal(classifyContent({ name: '某片', classText: '短剧', score: 7.5 }).tier, 'shortDrama');
});

test('分层：普通影视 > 短剧', () => {
  assert.equal(classifyContent({ name: '某剧', classText: '内地剧', score: 0 }).tier, 'general');
  assert.equal(classifyContent({ name: '某短剧', classText: '短剧', score: 0 }).tier, 'shortDrama');
});

test('排序权重：主流作品在短剧之前', () => {
  const mainstream = contentRank({ score: 7.9, shortDrama: false });
  const general = contentRank({ score: 0, shortDrama: false });
  const short = contentRank({ score: 0, shortDrama: true });
  assert.ok(mainstream < general, '有评分应排在普通作品前');
  assert.ok(general < short, '普通作品应排在短剧前');
});

test('排序权重：带分短剧与站内高分都不会越过普通作品', () => {
  assert.equal(contentRank({ score: 9, shortDrama: true }), 2);
  assert.equal(contentRank({ score: 10, scoreSource: 'site', shortDrama: false }), 1);
  assert.equal(contentRank({ score: 8, scoreSource: 'douban', shortDrama: false }), 0);
});

test('排序权重：评分与收录源数无关，短剧即使被多源收录也沉底', () => {
  // 旧实现按「收录源数」打头，导致流水线短剧被十几个源同时收录而排到最前
  const shortWithManySources = contentRank({ score: 0, shortDrama: true });
  const regular = contentRank({ score: 0, shortDrama: false });
  assert.ok(regular < shortWithManySources);
});

/* ------------------------------------------------------------------ *
 * 五、名称归一化（聚合去重的键），保持既有行为
 * ------------------------------------------------------------------ */

test('归一化：空白与标点被抹平，全半角一致', () => {
  assert.equal(normalizeName('庆余年 第二季'), normalizeName('庆余年第二季'));
  assert.equal(normalizeName('庆余年·第一季'), '庆余年第一季');
  assert.equal(normalizeName('The Matrix'), 'thematrix');
  assert.equal(normalizeName('《流浪地球》'), '流浪地球');
});

test('备注压缩为短标签', () => {
  assert.equal(shortRemarks(''), '');
  assert.equal(shortRemarks('正片'), '正片');
  assert.equal(shortRemarks('第61-74集完结'), '第61-74集完结');
  assert.ok(shortRemarks('这是一个非常长的备注文本内容').length <= 12);
});
