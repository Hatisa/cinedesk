# 影视大全

无广告、多源聚合的在线影视搜索与观看 App。全网搜索公开的影视采集接口，自动合并同一部作品的多个来源，点击即播。

**没有服务器，没有账号，不收集任何数据。** 所有搜索与播放都在你的手机上直接完成。

---

## 它解决什么问题

网上现成的影视聚合站点，通常有两个绕不过去的毛病：

1. **必须自己搭服务器。** 网页版直接请求资源站接口会被浏览器的同源策略（CORS）拦住，所以多数项目要求你部署一个后端做转发——要么花钱买服务器，要么忍受慢速的免费容器。
2. **单一资源源随时会挂。** 实测同一批公开采集源里，**任意时刻约 1/3 是无法访问的**，而且哪些可用会随时间变化。只接一两个源的站点，往往过几周就不能用了。

这个 App 用两个手段同时解决：**打包成 APK 后请求走 Android 原生网络层，跨域限制根本不存在**；同时内置 26 个源并发搜索、按实测健康度自动排序，单源失效不影响使用。

## 核心特性

- **多源并发聚合** —— 同时搜索 26 个资源站，同名影片合并为一条，保留全部可用线路
- **自动探测与降级** —— 记住每个源的真实成功率与响应速度，好源优先、坏源自动沉底
- **播放失败自动换源** —— 某条线路挂掉时自动切到下一条可用线路，无需手动处理
- **无广告、无跳转** —— 不加载任何广告脚本，不跳转第三方页面
- **内容过滤** —— 内置源已人工剔除成人向站点，代码层再做一道关键词过滤
- **完全离线存储** —— 收藏、历史、源配置都留在设备本地
- **可自定义源** —— 支持自行添加任意苹果 CMS（MacCMS）协议的采集接口

---

## 安装（推荐：云端自动构建 APK）

本机不需要安装 Android Studio 或 JDK，构建在 GitHub 的免费额度上完成。

1. 在 GitHub 新建一个仓库（可以设为 Private）。
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

### 本地开发调试

```bash
npm install
npm run dev          # 浏览器打开 http://localhost:5173
```

桌面浏览器里会通过 Vite 的 `/__proxy` 中间件转发请求（仅开发期使用，不进生产构建）。

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
│   ├── sources.ts        内置源清单
│   ├── filter.ts         内容过滤与片名归一化
│   ├── store.ts          本地持久化（Preferences）
│   └── cache.ts          搜索结果内存复用
├── components/           Player / VodCard / BottomNav / Toast
├── pages/                Home / Detail / Play / Favorites / Settings
└── state/AppState.tsx    全局状态与落盘
```

### 为什么不需要服务器

普通网页版搜索影视接口会撞上 CORS，所以需要后端中转。而在 Capacitor 打包的 App 里，开启 `CapacitorHttp` 后所有 `fetch` 都由原生 OkHttp 发出——**原生请求不受浏览器同源策略约束**，因此：

- 不需要代理服务器，零运维成本
- 顺带解决了部分资源站的 Referer 防盗链校验
- 请求从手机直连资源站，不多一次中转，速度更快

### 一个必须在 Android 上绕开的坑

hls.js 默认用 `XMLHttpRequest` 拉取分片，而 Capacitor 对 XHR 的拦截实现在 `responseType='arraybuffer'` 时，会把原生返回的 **base64 字符串**直接赋给 `xhr.response`——类型与 hls.js 期望的 `ArrayBuffer` 不符，**在 Android 上会直接播放失败**（浏览器里却完全正常，很难察觉）。

因此 `Player.tsx` 显式指定了 `loader: FetchLoader`。它走 `window.fetch`：Capacitor 把外部 URL 转成代理 URL，由 `WebViewClient.shouldInterceptRequest` 交给 OkHttp 拉取，再以**二进制** `WebResourceResponse` 返回，分片数据完好无损。

### 为什么"稳定"

稳定性不来自"选对了源"——没有任何一个源能长期稳定。它来自这几层配合：

| 机制 | 作用 |
|---|---|
| 26 个源并发 | 单源失效不影响整体 |
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
