/**
 * 离线库索引的自动化测试。
 *
 * 重点锁两件事：
 * 1) **不同剧不会混进同一目录**——两部作品的片名清洗后可能同名
 *    （「庆余年:第一季」与「庆余年 第一季」都变成「庆余年_第一季」），
 *    撞车会让两剧的分片落在同一目录，正是用户要求避免的。
 * 2) **同一集的重复缓存按集号覆盖**，不会在离线页出现两条记录。
 *
 * 运行：npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocShowDir,
  epDir,
  findEpisode,
  hash4,
  removeEpisode,
  removeShow,
  totalBytes,
  totalEpisodes,
  upsertEpisode,
  type OfflineEpisode,
  type OfflineShow,
} from './offline.ts';

const ep = (epIndex: number, bytes = 100): OfflineEpisode => ({
  epIndex,
  epName: `第${String(epIndex + 1).padStart(2, '0')}集`,
  dir: `某剧/${String(epIndex + 1).padStart(3, '0')}_第${String(epIndex + 1).padStart(2, '0')}集`,
  segments: [{ name: 'seg-000001.ts', duration: 7 }],
  bytes,
  duration: 7,
  quality: 'high',
  sourceKey: 'gs',
  sourceName: '光速资源',
  lineName: 'gsm3u8',
  createdAt: 1,
});

const show = (key: string, name: string, showDir?: string) => ({ key, name, pic: '', year: '2024', typeName: '剧情', showDir });

test('剧目录名：同一部剧复用同一目录，不同剧撞名时加短哈希', () => {
  const list: OfflineShow[] = [];
  const a = allocShowDir(list, '庆余年:第一季', 'key-a');
  assert.equal(a, '庆余年_第一季');

  // 同 key 再来一次，必须还是同一个目录
  const list2: OfflineShow[] = [{ ...show('key-a', '庆余年:第一季'), showDir: a, episodes: [] }];
  assert.equal(allocShowDir(list2, '庆余年:第一季', 'key-a'), a);

  // 另一部作品清洗后同名（冒号与斜杠都变成下划线）必须拆开，
  // 否则两剧分片混进一个目录，正是用户要求避免的「不同剧混杂」。
  const b = allocShowDir(list2, '庆余年/第一季', 'key-b');
  assert.notEqual(b, a);
  assert.match(b, /^庆余年_第一季_/);
});

test('剧目录名：不会出现纯点号目录（穿越风险）', () => {
  assert.equal(allocShowDir([], '..', 'k'), 'untitled');
  assert.equal(allocShowDir([], '   ', 'k'), 'untitled');
});

test('集目录名：集号零填充，文件管理器按名排序即播出顺序', () => {
  assert.equal(epDir(0, '第01集'), '001_第01集');
  assert.equal(epDir(9, '第10集'), '010_第10集');
  assert.equal(epDir(99, '第100集'), '100_第100集');
  assert.ok(epDir(1, 'x') < epDir(10, 'x'));
});

test('写入一集：新剧置顶，集按集序升序', () => {
  let list: OfflineShow[] = [];
  list = upsertEpisode(list, show('k1', '剧一'), ep(2));
  list = upsertEpisode(list, show('k1', '剧一'), ep(0));
  list = upsertEpisode(list, show('k2', '剧二'), ep(0));

  assert.equal(list.length, 2);
  assert.equal(list[0].key, 'k2'); // 最近写入的剧在前
  const k1 = list.find((s) => s.key === 'k1')!;
  assert.deepEqual(k1.episodes.map((e) => e.epIndex), [0, 2]); // 升序
});

test('同一集重复写入按集号覆盖，不产生两条', () => {
  let list: OfflineShow[] = [];
  list = upsertEpisode(list, show('k1', '剧一'), { ...ep(1), bytes: 100 });
  list = upsertEpisode(list, show('k1', '剧一'), { ...ep(1), bytes: 999 });

  assert.equal(list[0].episodes.length, 1);
  assert.equal(list[0].episodes[0].bytes, 999); // 取后写入的
});

test('删除一集：保留其余集；删掉最后一集时整部剧条目一并移除', () => {
  let list: OfflineShow[] = [];
  list = upsertEpisode(list, show('k1', '剧一'), ep(0));
  list = upsertEpisode(list, show('k1', '剧一'), ep(1));

  list = removeEpisode(list, 'k1', 0);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].episodes.map((e) => e.epIndex), [1]);

  // 最后一集删掉后，空条目不应留在离线页
  list = removeEpisode(list, 'k1', 1);
  assert.equal(list.length, 0);
});

test('删除整部剧与查询', () => {
  let list: OfflineShow[] = [];
  list = upsertEpisode(list, show('k1', '剧一'), ep(0));
  list = upsertEpisode(list, show('k2', '剧二'), ep(3));

  assert.equal(findEpisode(list, 'k2', 3)?.epName, '第04集');
  assert.equal(findEpisode(list, 'k2', 0), undefined);

  list = removeShow(list, 'k1');
  assert.equal(list.length, 1);
  assert.equal(list[0].key, 'k2');
});

test('统计：总集数与总字节', () => {
  let list: OfflineShow[] = [];
  list = upsertEpisode(list, show('k1', '剧一'), ep(0, 500));
  list = upsertEpisode(list, show('k1', '剧一'), ep(1, 300));
  list = upsertEpisode(list, show('k2', '剧二'), ep(0, 200));

  assert.equal(totalEpisodes(list), 3);
  assert.equal(totalBytes(list), 1000);
  assert.equal(totalEpisodes([]), 0);
  assert.equal(totalBytes([]), 0);
});

test('hash4：稳定、定长、对不同键基本不撞', () => {
  assert.equal(hash4('庆余年'), hash4('庆余年')); // 稳定
  assert.equal(hash4('a').length, 4);
  assert.notEqual(hash4('key-a'), hash4('key-b'));
});
