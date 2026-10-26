/**
 * 给生成出来的 Android 工程打补丁：注入后台下载所需的前台服务。
 *
 * 为什么需要这个脚本：
 *   1) `android/` 目录被 .gitignore 排除，CI 每次都重新 `npx cap add android`，
 *      所以任何手写的原生配置都会在下次构建时被冲掉 —— 必须脚本化；
 *   2) 前台服务插件只在自己的 manifest 里声明了 POST_NOTIFICATIONS，
 *      service 与 receiver 需要由使用方（这里）注入到 app 的 manifest。
 *
 * 为什么需要前台服务：
 *   熄屏后系统会冻结应用的网络与 CPU，纯 JS 的下载循环会被挂起。
 *   前台服务 + WAKE_LOCK 才能让「熄屏继续下载」真正成立。
 *
 * 幂等：可重复执行，已注入的内容不会重复写入。
 * 用法：node scripts/patch-android.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const DRAWABLE_DIR = 'android/app/src/main/res/drawable';
const DRAWABLE = `${DRAWABLE_DIR}/ic_stat_download.xml`;

/*
 * 前台服务类型选 dataSync：这类服务的语义正是「数据传输/下载」。
 * Android 14 起必须声明类型，否则 startForeground 会抛
 * MissingForegroundServiceTypeException，表现为「一点缓存就闪退」。
 */
const SERVICE_TYPE = 'dataSync';

const SERVICE_NAME = 'io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService';
const RECEIVER_NAME = 'io.capawesome.capacitorjs.plugins.foregroundservice.NotificationActionBroadcastReceiver';

/** 通知小图标：Android 只取 alpha 通道，所以画成纯白即可 */
const ICON_XML = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M5,20h14v-2H5V20zM19,9h-4V3H9v6H5l7,7 7,-7z" />
</vector>
`;

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

if (!existsSync(MANIFEST)) {
  fail(`找不到 ${MANIFEST} —— 请先执行 npx cap add android`);
}

let xml = readFileSync(MANIFEST, 'utf8');
const before = xml;

/* ---------- 1. 权限 ---------- */
const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  // dataSync 类型的配套权限，Android 14+ 必需
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  // 熄屏后保持 CPU 唤醒，下载才能继续
  'android.permission.WAKE_LOCK',
  // Android 13+ 显示前台服务通知需要
  'android.permission.POST_NOTIFICATIONS',
];

const missingPerms = PERMISSIONS.filter((p) => !xml.includes(`android:name="${p}"`));
if (missingPerms.length) {
  const lines = missingPerms
    .map((p) => `    <uses-permission android:name="${p}" />`)
    .join('\n');
  /*
   * 插到 <application 之前。
   * 权限必须写在 manifest 根节点下，放进 application 里会被构建报错。
   */
  const anchor = '    <application';
  const at = xml.indexOf(anchor);
  if (at < 0) fail('manifest 里找不到 <application>');
  xml = `${xml.slice(0, at)}<!-- 后台下载所需权限（由 scripts/patch-android.mjs 注入） -->\n${lines}\n\n${xml.slice(at)}`;
}

/* ---------- 2. service 与 receiver ---------- */
if (!xml.includes(SERVICE_NAME)) {
  const block = [
    '        <!-- 后台下载保活：熄屏/切后台后继续下载 -->',
    `        <service`,
    `            android:name="${SERVICE_NAME}"`,
    `            android:exported="false"`,
    `            android:foregroundServiceType="${SERVICE_TYPE}" />`,
    `        <receiver`,
    `            android:name="${RECEIVER_NAME}"`,
    `            android:exported="false" />`,
  ].join('\n');
  const close = '    </application>';
  const at = xml.lastIndexOf(close);
  if (at < 0) fail('manifest 里找不到 </application>');
  xml = `${xml.slice(0, at)}\n${block}\n${xml.slice(at)}`;
}

if (xml !== before) {
  writeFileSync(MANIFEST, xml);
  console.log(`✅ 已更新 ${MANIFEST}`);
} else {
  console.log(`ℹ️  ${MANIFEST} 无需改动（已注入过）`);
}

/* ---------- 3. 通知小图标 ---------- */
mkdirSync(DRAWABLE_DIR, { recursive: true });
if (!existsSync(DRAWABLE)) {
  writeFileSync(DRAWABLE, ICON_XML);
  console.log(`✅ 已生成 ${DRAWABLE}`);
} else {
  console.log(`ℹ️  ${DRAWABLE} 已存在，跳过`);
}

/* ---------- 4. 自检 ---------- */
const final = readFileSync(MANIFEST, 'utf8');
const checks = [
  ['FOREGROUND_SERVICE 权限', final.includes('android.permission.FOREGROUND_SERVICE"')],
  ['FOREGROUND_SERVICE_DATA_SYNC 权限', final.includes('FOREGROUND_SERVICE_DATA_SYNC')],
  ['WAKE_LOCK 权限', final.includes('android.permission.WAKE_LOCK')],
  ['service 声明', final.includes(SERVICE_NAME)],
  ['foregroundServiceType=dataSync', final.includes(`android:foregroundServiceType="${SERVICE_TYPE}"`)],
  ['receiver 声明', final.includes(RECEIVER_NAME)],
];
const bad = checks.filter(([, ok]) => !ok);
if (bad.length) {
  fail(`注入后自检未通过：${bad.map(([n]) => n).join('、')}`);
}
console.log('✅ 自检通过：' + checks.map(([n]) => n).join('、'));
