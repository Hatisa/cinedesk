# 影视大全

无广告、多源聚合的在线影视搜索与观看 App。全网搜索公开的影视采集接口，自动合并同一部作品的多个来源，点击即播。

**没有服务器，没有账号，不收集任何数据。** 所有搜索与播放都在你的手机上直接完成。

---

## 它解决什么问题

网上现成的影视聚合站点，通常有两个绕不过去的毛病：

1. **必须自己搭服务器。** 网页版直接请求资源站接口会被浏览器的同源策略（CORS）拦住，所以多数项目要求你部署一个后端做转发——要么花钱买服务器，要么忍受慢速的免费容器。
2. **单一资源源随时会挂。** 实测同一批公开采集源里，**任意时刻约 1/3 是无法访问的**，而且哪些可用会随时间变化。只接一两个源的站点，往往过几周就不能用了。

这个 App 用两个手段同时解决：**打包成 APK 后请求走 Android 原生网络层，跨域限制根本不存在**；同时内置 19 个源并发搜索、按实测健康度自动排序，单源失效不影响使用。

## 核心特性

- **多源并发聚合** —— 同时搜索 19 个资源站，同名影片合并为一条，保留全部可用线路
- **实时热搜榜** —— 首页展示豆瓣实时热播（电影 / 电视剧 / 综艺三档），本地缓存 6 小时，接口不可达时回退内置片名
- **自动探测与降级** —— 记住每个源的真实成功率与响应速度，好源优先、坏源自动沉底
- **播放失败自动换源** —— 某条线路挂掉时自动切到下一条可用线路，无需手动处理
- **猜你喜欢** —— 详情页按同导演 / 同演员 / 同类型 / 评分相近 / 年代相近加权推荐，候选跨页码采样避免只推最新
- **安卓体验** —— 返回键逐级返回而非直接退出；全屏播放自动转横屏；播放页常驻选集
- **返回不丢结果** —— 从详情页返回首页，搜索结果原样保留
- **内容甄别** —— 下架成人向站点，按实测分类清单拦截（52 个成人分类词 + 片名关键词兜底），避免误伤《Avatar》等正常片名
- **短剧沉底** —— 识别网络短剧（短剧 / 爽剧 / 漫剧 / 微短剧 / 竖屏等）排在正规影视之后，豆瓣评分优先展示
- **无广告、无跳转** —— 不加载任何广告脚本，不跳转第三方页面
- **完全离线存储** —— 收藏、历史、源配置都留在设备本地
- **可自定义源** —— 支持自行添加任意苹果 CMS（MacCMS）协议的采集接口

---

## 安装（推荐：云端自动构建 APK）

本机不需要安装 Android Studio 或 JDK，构建在 GitHub 的免费额度上完成。

1. 在 GitHub 新建一个仓库（可以设为 Private）。**不要勾选** Add README / .gitignore / license——这三个文件项目里已经有定制版本，勾了会造成历史冲突。
2. 把本项目推上去：

   ```bash
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git push -u origin main
   ```

3. 打开仓库的 **Actions** 页面，等待 `Build Android APK` 跑完（首次约 5–8 分钟）。
4. 进入这次运行，在页面底部 **Artifacts** 里下载 `cinedesk-apk`，解压得到 `app-debug.apk`，传到手机安装。

安装时系统会提示「未知来源应用」，允许后继续即可。

> **想要正式签名的发布版？** 打一个 tag 就会自动发布到 Releases：
> ```bash
> git tag v1.0.0 && git push origin v1.0.0
> ```

> **构建失败？** 失败的那一步会在日志末尾打印错误摘要，并把完整构建日志存成 `build-log` artifact——下载它看最后 80 行即可定位。

### 本地开发调试

```bash
npm install
npm run dev          # 浏览器打开 http://localhost:5173
npm test             # 内容甄别与排序规则的单元测试（node --test）
npm run typecheck    # tsc --noEmit
```

桌面浏览器里会通过 Vite 的 `/__proxy` 中间件转发请求（仅开发期使用，不进生产构建）。注意**播放问题在桌面浏览器里复现不出来**——浏览器的 fetch 没有原生拦截补丁，见下文「一个必须在 Android 上绕开的坑」。

### 本地构建 APK（可选）

需要自备 JDK 21 与 Android SDK：

```bash
npm run build
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug     # Windows: gradlew.bat
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。

---

## 技术方案

```
src/
├── core/                 不依赖 UI 的核心层
│   ├── types.ts          领域模型
│   ├── http.ts           HTTP 通道：原生走 OkHttp，绕过 CORS
│   ├── cms.ts            苹果 CMS vod 协议解析
│   ├── aggregate.ts      多源并发搜索与跨源合并
│   ├── health.ts         源健康度评分（成功率 + 响应速度）
│   ├── sources.ts        内置源清单（19 个）
│   ├── filter.ts         内容甄别（成人/短剧识别、分层排序）与片名归一化
│   ├── trending.ts       豆瓣实时热搜（三档 + 缓存 + 兜底）
│   ├── recommend.ts      猜你喜欢（同导演/演员/类型/评分/年代加权）
│   ├── hlsLoader.ts      自定义 hls.js loader（修复 Android 相对地址基准）
│   ├── native.ts         返回键接管、横屏锁定、全屏状态
│   ├── store.ts          本地持久化（Preferences）
│   ├── cache.ts          搜索结果内存复用
│   └── filter.test.ts    甄别与排序的单元测试（16 项）
├── components/           Player / VodCard / BottomNav / Toast
├── pages/                Home / Detail / Play / Favorites / Settings
└── state/AppState.tsx    全局状态与落盘（含搜索结果快照）
```

### 为什么不需要服务器

普通网页版搜索影视接口会撞上 CORS，所以需要后端中转。而在 Capacitor 打包的 App 里，开启 `CapacitorHttp` 后所有 `fetch` 都由原生 OkHttp 发出——**原生请求不受浏览器同源策略约束**，因此：

- 不需要代理服务器，零运维成本
- 顺带解决了部分资源站的 Referer 防盗链校验
- 请求从手机直连资源站，不多一次中转，速度更快

### 一个必须在 Android 上绕开的坑

这是本项目最隐蔽的一个问题，表现为：**搜索一切正常，但点播放后一直停在「正在缓冲」**。

根因在 hls.js 解析播放列表时的**相对地址基准**上。

启用 `CapacitorHttp` 后，Capacitor 会给 `window.fetch` 打补丁：跨域请求被改写成

```
https://localhost/_capacitor_http_interceptor_?u=<原始地址>
```

再由 WebView 的 `shouldInterceptRequest` 交给原生 OkHttp 拉取。问题在于**拦截发生在原生层**——WebView 只知道"我请求的是 localhost 上这个代理地址"，无法得知响应真正来自哪个站点，于是 `response.url` 恒等于那个代理地址。

而 hls.js 恰恰用 `response.url` 作为解析 m3u8 内相对路径的基准（`getResponseUrl` → `new URL(uri, baseUrl)`）。绝大多数资源站的 master playlist 写的正是相对路径：

```
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=4096000,RESOLUTION=1920x1080
/play/hls/xxxx/index.m3u8
```

基准一旦变成 localhost，解析结果就成了 `https://localhost/play/hls/...`，请求打到 WebView 的本地文件服务器上，永远取不到数据，只能反复重试——也就是"一直缓冲"。

> 这个坑在桌面浏览器里完全复现不出来（那里没有 fetch 补丁），只在 APK 里发作。

因此 `src/core/hlsLoader.ts` 提供了自定义的 `NativeHttpLoader`，`Player.tsx` 通过 `loader: NativeHttpLoader` 使用它：

| 要点 | 做法 |
|---|---|
| 走哪条通道 | 直接用 `CapacitorHttp` 插件——也就是搜索功能正在用的那条原生通道 |
| 相对地址基准 | 把 `LoaderResponse.url` 固定为 `context.url`（真实地址），不依赖被改写的 `response.url` |
| 二进制数据 | 原生侧 `arraybuffer` 返回的是 base64 字符串，在 `toArrayBuffer()` 里解码回 `ArrayBuffer` |
| 卡死兜底 | 自定义 loader 会按 `loadPolicy` 自行调度超时；播放器另有 20 秒 watchdog，超时即上报错误以触发自动换源 |

另外，播放器对致命错误**只自愈一次**（网络错误 `startLoad()`、媒体错误 `recoverMediaError()` 各一次）。早期版本是无条件重试，结果永远走不到"上报失败"这一步，导致自动换源无法触发，界面也就永远停在了缓冲状态。

### 推荐是怎么算出来的

「猜你喜欢」不依赖任何云端推荐接口，全部在设备本地计算：

1. **取候选**：用影片真实所在源的采集接口，按影片的分类拉片单。分类接口按时间倒序返回，只取前几页会推出一堆最新片，因此页码在前 / 中 / 后段采样。
2. **打相似度分**：同导演 +45、同演员（按交集数，封顶 3 人）每人 +30、同类型每个 +12（封顶 3 类）、评分相近最高 +20、年代相近最高 +10。
3. **过滤与排序**：剔除网络短剧与无直链线路的条目，按相似度降序取前 10 部。

演员 / 导演取自该影片「线路最多」的来源版本——同一部影片在不同采集站录入的元数据详略不同。

### 为什么"稳定"

稳定性不来自"选对了源"——没有任何一个源能长期稳定。它来自这几层配合：

| 机制 | 作用 |
|---|---|
| 19 个源并发 | 单源失效不影响整体 |
| 健康度评分 | 好源排前、坏源沉底，排序随真实表现自我修正 |
| 同名合并 | 一部影片有多条线路可切换 |
| 播放失败自动换源 | 线路挂掉时用户无感 |
| 一键停用失效源 | 清理长期不可用的源，避免每次搜索白等 |

健康度用指数移动平均计算，同时惩罚连续失败与高延迟；失败只是降权而非拉黑，恢复的源几轮后会被重新优先使用。

---

## 常见问题

**搜索没有结果？**
多数是个别源临时故障，属正常现象。换个片名再试，或到「设置 → 全部测速」看哪些源可用。

**某个影片所有线路都放不了？**
资源站的片源本身会失效。返回搜索页换个片名——不同资源站收录的片源不同，通常能找到可用的。

**为什么用 Debug 包而不是 Release？**
Debug 包用系统调试证书签名，无需你自己生成密钥库，方便直接安装。介意的话可以按上面的 tag 流程自行配置正式签名。

**播放卡顿？**
点播放页右上角切换线路。不同源的画质码率与服务器速度差别很大，换一条通常就好了。

**Android 15 上页面顶部被状态栏压住？**
系统在 Android 15 起强制 edge-to-edge，WebView 会铺满整屏。项目曾用 `adjustMarginsForEdgeToEdge` 避让，后按需求回退；如需要可在 `capacitor.config.ts` 的 `android` 块加回 `adjustMarginsForEdgeToEdge: 'auto'`，或在 CSS 里用 `env(safe-area-inset-*)` 自行留白。

---

## 免责声明

本项目**不提供、不存储、不转码**任何影视资源，仅实现了一个客户端，用于检索互联网上公开的采集接口。

- 所有内容均来自第三方站点，本项目的开发者无法控制这些内容
- 请仅将本项目用于个人学习与技术研究
- 请在下载后 24 小时内删除，或购买正版支持创作者
- 因使用本项目产生的任何后果由使用者自行承担

如本项目对任何权益方造成困扰，请提交 Issue，我会及时处理。

## 许可

MIT
