# DreamTV

> 本项目原名 **MoonTV**，自 v3.9.0 起更名为 **DreamTV**。应用内所有默认站点名称、页面标题、PWA 名称与备份文件名均已同步更新。GitHub 仓库名与 Docker 官方镜像名暂时保持原样，以免破坏现有部署与自动同步；如需自定义站点名称，请设置环境变量 `NEXT_PUBLIC_SITE_NAME`。

上游项目：[Stardm0/MoonTV](https://github.com/Stardm0/MoonTV)（其前身项目为 [MoonTechLab/LunaTV](https://github.com/MoonTechLab/LunaTV)）

<div align="center">
  <img src="public/logo.png" alt="DreamTV Logo" width="120">
</div>

> 🎬 **DreamTV** 是一个开箱即用的、跨平台的影视聚合播放器。它基于 **Next.js 14** + **Tailwind&nbsp;CSS** + **TypeScript** 构建，支持多资源搜索、在线播放、收藏同步、播放记录、本地/云端存储，让你可以随时随地畅享海量免费影视内容。

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-14-000?logo=nextdotjs)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss)
![TypeScript](https://img.shields.io/badge/TypeScript-4.x-3178c6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)
![Docker Ready](https://img.shields.io/badge/Docker-ready-blue?logo=docker)

</div>

---

## ✨ 功能特性

- 🔍 **多源聚合搜索**：快速返回结果。
- 🛡️ **AV 源过滤**：默认全局隐藏成人采集源，搜索、换源、搜索建议、播放源列表都不再使用；可在「本地设置」里一键关掉。
- 📄 **丰富详情页**：支持剧集列表、演员、年份、简介等完整信息展示。
- ▶️ **流畅在线播放**：基于 HLS.js 的自研播放器，换集 / 换源时冻结上一帧并显示加载步骤，始终只有一路声音；支持拖动预览、倍速、画中画、AirPlay、键盘快捷键、长按 3 倍速。
- 📥 **视频下载**：支持 M3U8 视频下载，多线程并发加速，边下边存功能（Chrome/Edge）。
- ❤️ **收藏 + 继续观看**：支持 Redis/Upstash 存储，多端同步进度。
- 📱 **PWA**：离线缓存、安装到桌面/主屏，移动端原生体验。
- 🌗 **响应式布局**：桌面顶部导航 + 移动底部导航，自适应各种屏幕尺寸。
- 🎨 **Organic 设计**：奶油底色、陶土主色、鼠尾草绿辅色，圆润的卡片与胶囊按钮；浅色 / 暖色深色主题，骨架屏、过渡与悬停动效（尊重系统“减少动态效果”设置）。
- 🌐 **中 / EN 界面**：导航栏一键切换界面语言，偏好保存在浏览器本地。
- 🧭 **一体化播放面板**：当前播放源（分辨率 / 速度 / 延迟）与选集同屏，其它源原地展开，⚡ 一键优选，坏源约 3 秒内提示换源。
- 🚀 **极简部署**：一条 Docker 命令即可将完整服务跑起来，或免费部署到 Vercel、Netlify、cloudflare。
- 👿 **智能去广告**：自动跳过视频中的切片广告（实验性）
- 💬 **弹幕支持**：以[danmu_api](https://github.com/huangxd-/danmu_api)为后端（需自行部署），播放器内置弹幕渲染，可自动匹配或手动选择弹幕源。

### 注意：部署后项目为空壳项目，无内置播放源，需要自行收集，需要弹幕请自行部署后端

<details>
  <summary>点击查看项目截图</summary>
  <img src="public/screenshot1.png" alt="项目截图" style="max-width:600px">
</details>

## 🗺 目录

- [DreamTV](#dreamtv)
  - [✨ 功能特性](#-功能特性)
    - [注意：部署后项目为空壳项目，无内置播放源，需要自行收集，需要弹幕请自行部署后端](#注意部署后项目为空壳项目无内置播放源需要自行收集需要弹幕请自行部署后端)
  - [🗺 目录](#-目录)
  - [技术栈](#技术栈)
  - [界面设计（Organic）](#界面设计organic)
  - [播放器说明](#播放器说明)
  - [开发与测试](#开发与测试)
    - [端到端测试](#端到端测试)
  - [AV 源过滤](#av-源过滤)
  - [部署](#部署)
    - [Vercel 部署](#vercel-部署)
      - [普通部署（localstorage）](#普通部署localstorage)
      - [Upstash Redis 支持](#upstash-redis-支持)
    - [Netlify 部署(推荐)](#netlify-部署推荐)
      - [普通部署（localstorage）](#普通部署localstorage-1)
      - [Upstash Redis 支持](#upstash-redis-支持-1)
    - [Cloudflare 部署](#cloudflare-部署)
      - [普通部署（localstorage）](#普通部署localstorage-2)
      - [D1 支持](#d1-支持)
    - [Docker 部署](#docker-部署)
      - [直接运行（最简单，localstorage）](#直接运行最简单localstorage)
      - [Docker Compose](#docker-compose)
        - [local storage 存储](#local-storage-存储)
        - [Kvrocks 存储（推荐）](#kvrocks-存储推荐)
        - [Redis 存储（有一定的丢数据风险）](#redis-存储有一定的丢数据风险)
        - [Upstash 存储](#upstash-存储)
  - [环境变量](#环境变量)
  - [配置说明](#配置说明)
  - [管理员配置](#管理员配置)
  - [AndroidTV 使用](#androidtv-使用)
  - [TVBox 对接](#tvbox-对接)
    - [本地存储(localstorage)模式](#本地存储localstorage模式)
  - [Selene 使用](#selene-使用)
  - [安全与隐私提醒](#安全与隐私提醒)
    - [请设置密码保护并关闭公网注册](#请设置密码保护并关闭公网注册)
    - [部署要求](#部署要求)
    - [重要声明](#重要声明)
  - [License](#license)
  - [致谢](#致谢)
  - [⭐ Star 趋势](#-star-趋势)

## 技术栈

| 分类      | 主要依赖                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 前端框架  | [Next.js 14](https://nextjs.org/) · App Router                                                        |
| UI & 样式 | [Tailwind&nbsp;CSS 3](https://tailwindcss.com/) · Organic 设计令牌（`o-*` 颜色）· Caprasimo / Figtree |
| 语言      | TypeScript 4                                                                                          |
| 播放器    | 自研播放器（`src/components/player`）· [HLS.js](https://github.com/video-dev/hls.js/)                 |
| 代码质量  | ESLint · Prettier · Jest                                                                              |
| 部署      | Docker · Vercel · pages                                                                               |

## 界面设计（Organic）

界面基于 Organic 设计系统：温暖、圆润、略带俏皮。

- **颜色**：设计令牌以 RGB 通道变量定义在 `src/app/globals.css`（浅色 `:root`，深色 `.dark`），在 Tailwind 中以 `o-*` 命名空间使用，例如 `bg-o-surface`、`text-o-accent-700`、`bg-o-accent/20`。深色主题由同一套色阶反转得到（100 为最深，900 为最浅），同一个类名在两种主题下都可读。
- **旧组件兼容**：后台、用户菜单、下载管理等仍使用 `gray / green / blue` 的旧组件，通过 `tailwind.config.ts` 中的色板重映射自动变为暖灰 / 陶土 / 鼠尾草绿。
- **字体**：标题与按钮使用 Caprasimo，正文使用 Figtree（`next/font` 加载）；Caprasimo 不含中文字形，中文标题使用系统字体。
- **组件类**：`o-btn`、`o-btn-primary`、`o-btn-secondary`、`o-btn-ghost`、`o-tag-*`、`o-eyebrow`、`o-skeleton`（骨架屏流光），通用组件见 `src/components/ui/`。
- **动效**：页面淡入、列表错峰入场、菜单弹出、卡片悬停抬升、顶部导航进度条；系统开启“减少动态效果”时全部关闭。
- **界面语言**：文案集中在 `src/lib/i18n.ts`（中文与英文键完全一致，有单元测试检查），通过 `useI18n()` 读取；影片标题、简介等来自播放源的内容不翻译。

## 播放器说明

播放器位于 `src/components/player/`，引擎在 `src/lib/player/engine.ts`：

- 整个播放页只有一个 `<video>`，任何时刻只挂载一路流。每次换集、换源或切换去广告都会先执行统一的 teardown（暂停 → 停止并销毁 Hls → 清空 src → `load()`），再挂载新的流；过期回调由 generation 计数丢弃，因此不会出现上一集 / 上一个源的声音残留。
- 切换期间冻结并压暗上一帧，显示“已停止上一路视频 → 已获取播放列表 → 缓冲中”和续播时间。
- 首次加载失败会在约 3 秒内提示“无法播放”并提供换源按钮；播放过程中的网络抖动仍会自动恢复。
- 设置菜单：去广告、跳过片头片尾（设为当前位置）、弹幕开关与弹幕源。
- 快捷键：空格播放 / 暂停，← / → 快退 / 快进 10 秒，↑ / ↓ 调节音量，F 全屏，Alt + ← / → 上一集 / 下一集。

### 首帧关键路径

播放页有两条互不阻塞的时间线：**关键路径只负责“拿到一个可播放地址”**，其余全部延后。

| 阶段     | 行为                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 关键路径 | URL 带 `source`+`id`（从搜索结果点进来）时，直接请求 `/api/detail` 取该源详情；否则用多源搜索流，**第一个匹配结果就开播**，不等整轮扇出 |
| 后台     | 多源搜索继续跑完，只为把其它源填进侧栏；搜索期间侧栏显示骨架行                                                                          |
| 播完之后 | 测速在后台进行，发现明显更优的源时给出提示条（可一键换源 / 关闭），**默认不自动切换**，以免丢进度、重置续播、打断弹幕                   |

开启「自动优选播放源」时仍会自动换到最优源，但发生在首帧之后。

页面只在“连一个地址都没拿到”时才显示整页骨架；其余情况海报、标题、选集、侧栏立即可见，`<video>` 用自己的 poster 与切换卡表示加载中。卡片悬停 / 按下时会预热 `/api/detail`，把 DNS、TLS 与上游连接的耗时挪到点击之前。

### 播放源测速

测速实现在 `src/lib/source-metrics.ts`。排序只需要三个信号，都不必解码任何视频：

- **分辨率**：解析 master playlist 里 `#EXT-X-STREAM-INF` 的 `RESOLUTION`（阈值与历史实现一致，按**宽度**判定）
- **延迟**：manifest 请求的 TTFB
- **带宽**：对首个分片做一次有上限的 GET 后立即取消（不带自定义头，避免 CORS 预检）

其它细节：

- 结果按地址缓存在 `localStorage` 5 分钟，复访即时显示；测的是**当前集**的实际地址，而不是固定第 2 集。
- 统一并发上限 6，当前集的源优先入队，不再分两批串行。
- 综合评分 = 分辨率 40% + 速度 40% + 延迟 20%，三者都归一化到 0–100。
- 无 `CORS` 头的源无法用轻量方式测量，会标记为错误 —— 这类流本来也无法在浏览器里播放。

## 开发与测试

```bash
pnpm install
pnpm dev          # 本地开发
pnpm typecheck    # 类型检查
pnpm lint         # ESLint
pnpm test         # Jest 单元测试（播放器引擎、弹幕解析、界面语言、测速与评分、测速 hook、AV 源过滤）
pnpm build        # 生产构建
```

### 端到端测试

端到端测试跑在本地：内置的 mock CMS V10 服务器提供接口和真实 HLS 测试流，Harness 会临时换成只含本地源的 `config.json`，退出时自动还原。**测试数据全部来自本地**；应用自身的外网请求（版本检查、首页豆瓣/Bangumi）在离线环境下失败不会让用例失败。

```bash
./tests/e2e/run-av-filter.sh                   # AV 源过滤（API 24 项 + 浏览器 31 项断言）
E2E_MODE=dev ./tests/e2e/run-av-filter.sh      # 用 next dev 起（更快但更容易 flaky）
./tests/e2e/make-media.sh                      # 生成 HLS 测试流（需要 ffmpeg）
CODEC=vp9 ./tests/e2e/make-media.sh            # 浏览器不支持 H.264 时（开源 Chromium）改用 VP9
node tests/e2e/serve.mjs                       # 启动 mock + next dev（性能基线用）
node tests/e2e/serve.mjs --build               # 或对生产构建跑
python -m pytest tests/e2e/test_play_perf.py -v    # 播放页 21 个用例
python tests/e2e/measure.py --scenario clicked     # 首帧耗时
```

`run-av-filter.sh` 默认走生产构建（`next build` + `next start`）：`next dev` 的按需编译
会让首次访问 `/search`、`/play` 慢上十几秒，长跑时还可能返回空结果或卡死，因此只有
`E2E_MODE=dev` 才用开发模式。

`perf` 档位给每个源配了可复现的上游延迟（`fast` 60ms … `slow2` 4000ms），因此
「页面是否在等最慢的源」是确定性问题。`test_play_perf.py` 覆盖三种进入方式的首帧预算、
`/api/detail` 确实在关键路径上、搜索仍在后台进行、加载期无整页骨架、始终只有一个
`<video>`、提示条的出现/关闭/换集后清除及文案（更清晰 vs 更快）、换集后确实在播放、
快捷键、续播记录越界时夹紧、搜索未完成时源列表显示「正在搜索」、卡片预热与播放页请求
同一个 `/api/detail` 地址，以及「后台测速永远不会把页面换成错误页」这条回归。

首帧实测（同一 mock，生产构建，多次运行）：点击搜索结果 ≈0.4s、从豆瓣卡片进入 ≈0.4s、
开启自动优选 ≈0.5s；改造前（`main`，同样是生产构建）分别为 0.86s / 4.6s / 4.7s。
早先在 `next dev` 下测得的「改造前」为 2.0s / 5.0s / 5.3s，含按需编译开销，偏高。
<video> 的挂载时间从 ~0.7–4.5s 降到 ~0.2s。

详见 [`tests/e2e/README.md`](tests/e2e/README.md)：包含 harness 组成、两种源配置档位
（`perf` / `avfilter`）、Playwright 安装方式，以及几处已知的 `next dev` 怪癖的规避方式。
浏览器套件需要 Playwright，API 套件只用 node。

评审记录、测试结论与设计决策见 [`docs/DEV_LOG.md`](docs/DEV_LOG.md)。

Harness 会把 HLS 片段落在 `tests/e2e/media/`（`.gitignore` 忽略，也在 `tsconfig.json`
的 `exclude` 里 —— 否则 ffmpeg 生成的二进制 `.ts` 会让 `pnpm typecheck` 报几百行
`Invalid character`）。

## AV 源过滤

采集源里成人站占了不小比例。DreamTV 默认把它们排除在搜索之外，并且这个开关是**每个浏览器本地**的，不影响其他用户。

- **开关位置**：导航栏头像 →「设置」→「本地设置」→「过滤 AV 资源」，默认开启。
- **作用范围**：搜索页搜索、播放页选源 / 换源、搜索建议、搜索源选择器，以及手动加载详情。`savedSources` 里残留的成人源不会被选中，但会保留在本地存储里——关掉开关就重新生效，不会丢选择。
- **判定方式**：优先用 `config.json` 里的 `is_adult` 标记；没有该字段时回退到名称前缀 `AV-` / `AV ` / `av_`（`AVPlayer` 这类普通源不会被误伤）。
- **不影响外部调用方**：接口默认不过滤，只有带 `filterAdult=1`（或 `true` / `on`）的请求才过滤，其余取值一律视为不过滤，因此 TVBox、OrionTV、定时刷新等调用方的行为不变。

实现要点：

- `src/lib/adult-filter.ts` —— 纯函数判定（客户端 / 服务端共用）
- `src/lib/adult-filter.client.ts` —— 本地偏好读写，并给搜索 / 加载请求追加 `filterAdult` 参数
- `src/lib/config.ts` —— `getAvailableApiSitesForRequest()` 是所有搜索接口的统一入口；`is_adult` 也在这里从 `api_site` 一路透传到 `SourceConfig`

## 部署

本项目**支持 Vercel、Docker、Netlify、Cloudflare** 部署。

存储支持矩阵

|               | Docker | Vercel | Netlify | Cloudflare |
| :-----------: | :----: | :----: | :-----: | :--------: |
| localstorage  |   ✅   |   ✅   |   ✅    |     ✅     |
|  原生 redis   |   ✅   |        |         |            |
| Cloudflare D1 |        |        |         |     ✅     |
| Upstash Redis |   ☑️   |   ✅   |   ✅    |     ✅     |

✅：经测试支持

☑️：理论上支持，未测试

### Vercel 部署

#### 普通部署（localstorage）

1. **Fork** 本仓库到你的 GitHub 账户。
2. 登陆 [Vercel](https://vercel.com/)，点击 **Add New → Project**，选择 Fork 后的仓库。
3. 设置 PASSWORD 环境变量。
4. 保持默认设置完成首次部署。
5. 如需自定义 `config.json`，请直接修改 Fork 后仓库中该文件。
6. 每次 Push 到 `main` 分支将自动触发重新构建。

部署完成后即可通过分配的域名访问，也可以绑定自定义域名。

#### Upstash Redis 支持

0. 完成普通部署并成功访问。
1. 在 [upstash](https://upstash.com/) 注册账号并新建一个 Redis 实例，名称任意。
2. 复制新数据库的 **HTTPS ENDPOINT 和 TOKEN**
3. 返回你的 Vercel 项目，新增环境变量 **UPSTASH_URL 和 UPSTASH_TOKEN**，值为第二步复制的 endpoint 和 token
4. 设置环境变量 NEXT_PUBLIC_STORAGE_TYPE，值为 **upstash**；设置 USERNAME 和 PASSWORD 作为站长账号
5. 重试部署

### Netlify 部署(推荐)

#### 普通部署（localstorage）

1. **Fork** 本仓库到你的 GitHub 账户。
2. 登陆 [Netlify](https://www.netlify.com/)，点击 **Add New project → Importing an existing project**，授权 Github，选择 Fork 后的仓库。
3. 设置 PASSWORD 环境变量。
4. 保持默认设置完成首次部署。
5. 每次 Push 到 `main` 分支将自动触发重新构建。

部署完成后即可通过分配的域名访问，也可以绑定自定义域名。

#### Upstash Redis 支持

0. 完成普通部署并成功访问。
1. 在 [upstash](https://upstash.com/) 注册账号并新建一个 Redis 实例，名称任意。
2. 复制新数据库的 **HTTPS ENDPOINT 和 TOKEN**
3. 返回你的 Netlify 项目，**Project Configuration → Environment variables** 新增环境变量 **UPSTASH_URL 和 UPSTASH_TOKEN**，值为第二步复制的 endpoint 和 token
4. 设置环境变量 NEXT_PUBLIC_STORAGE_TYPE，值为 **upstash**；设置 USERNAME 和 PASSWORD 作为站长账号
5. 重试部署

### Cloudflare 部署

**Cloudflare Pages 的环境变量尽量设置为密钥而非文本**

#### 普通部署（localstorage）

1. **Fork** 本仓库到你的 GitHub 账户。
2. 登陆 [Cloudflare](https://cloudflare.com)，点击 **计算（Workers）-> Workers 和 Pages**，点击创建
3. 选择 Pages，导入现有的 Git 存储库，选择 Fork 后的仓库
4. 构建命令填写 **pnpm run pages:build**，预设框架为无，**构建输出目录**为 `.vercel/output/static`
5. 保持默认设置完成首次部署。进入设置，将兼容性标志设置为 `nodejs_compat`，无需选择，直接粘贴
6. 首次部署完成后进入设置，新增 PASSWORD 密钥（变量和机密下），而后重试部署。
7. 如需自定义 `config.json`，请直接修改 Fork 后仓库中该文件。
8. 每次 Push 到 `main` 分支将自动触发重新构建。

#### D1 支持

0. 完成普通部署并成功访问
1. 点击 **存储和数据库 -> D1 SQL 数据库**，创建一个新的数据库，名称随意
2. 进入刚创建的数据库，点击左上角的 Explore Data，将[d1-init](d1-init.sql) 中的内容粘贴到 Query 窗口后点击 **Run All**，等待运行完成
3. 返回你的 pages 项目，进入 **设置 -> 绑定**，添加绑定 D1 数据库，选择你刚创建的数据库，变量名称填 **DB**
4. 设置环境变量 NEXT_PUBLIC_STORAGE_TYPE，值为 **d1**；设置 USERNAME 和 PASSWORD 作为站长账号
5. 重试部署

### Docker 部署

> 下列示例默认拉取上游发布的镜像 `ghcr.io/stardm0/moontv:latest`（镜像名保持原样，未随品牌更名而改动）。
> 若要运行本仓库的代码，请先自行构建镜像：
>
> ```bash
> docker build -t dreamtv:latest .
> docker run -d --name dreamtv -p 3000:3000 --env PASSWORD=your_password dreamtv:latest
> ```

#### 直接运行（最简单，localstorage）

```bash
# 拉取预构建镜像
# 或拉取最新版本
docker pull ghcr.io/stardm0/moontv:latest

# 运行容器
# -d: 后台运行  -p: 映射端口 3000 -> 3000
docker run -d --name dreamtv -p 3000:3000 --env PASSWORD=your_password ghcr.io/stardm0/moontv:latest
```

#### Docker Compose

##### local storage 存储

```yaml
services:
  dreamtv-core:
    image: ghcr.io/stardm0/moontv:latest
    container_name: dreamtv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - PASSWORD=password
```

##### Kvrocks 存储（推荐）

```yml
services:
  dreamtv-core:
    image: ghcr.io/stardm0/moontv:latest
    container_name: dreamtv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=kvrocks
      - KVROCKS_URL=redis://dreamtv-kvrocks:6666
    networks:
      - dreamtv-network
    depends_on:
      - dreamtv-kvrocks
  dreamtv-kvrocks:
    image: apache/kvrocks
    container_name: dreamtv-kvrocks
    restart: unless-stopped
    volumes:
      - kvrocks-data:/var/lib/kvrocks
    networks:
      - dreamtv-network
networks:
  dreamtv-network:
    driver: bridge
volumes:
  kvrocks-data:
```

##### Redis 存储（有一定的丢数据风险）

```yml
services:
  dreamtv-core:
    image: ghcr.io/stardm0/moontv:latest
    container_name: dreamtv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=redis
      - REDIS_URL=redis://dreamtv-redis:6379
    networks:
      - dreamtv-network
    depends_on:
      - dreamtv-redis
  dreamtv-redis:
    image: redis:alpine
    container_name: dreamtv-redis
    restart: unless-stopped
    networks:
      - dreamtv-network
    # 请开启持久化，否则升级/重启后数据丢失
    volumes:
      - ./data:/data
networks:
  dreamtv-network:
    driver: bridge
```

##### Upstash 存储

```yaml
services:
  dreamtv-core:
    image: ghcr.io/stardm0/moontv:latest
    container_name: dreamtv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=upstash
      - UPSTASH_URL= https 开头的 HTTPS ENDPOINT
      - UPSTASH_TOKEN= TOKEN
```

## 环境变量

| 变量                                | 说明                                         | 可选值                           | 默认值                                                                                                                     |
| ----------------------------------- | -------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| USERNAME                            | 非 localstorage 部署时的管理员账号           | 任意字符串                       | （空）                                                                                                                     |
| PASSWORD                            | 非 localstorage 部署时为管理员密码           | 任意字符串                       | （空）                                                                                                                     |
| NEXT_PUBLIC_SITE_NAME               | 站点名称                                     | 任意字符串                       | DreamTV                                                                                                                    |
| ANNOUNCEMENT                        | 站点公告                                     | 任意字符串                       | 本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。 |
| NEXT_PUBLIC_STORAGE_TYPE            | 播放记录/收藏的存储方式                      | localstorage、redis、d1、upstash | localstorage                                                                                                               |
| REDIS_URL                           | redis 连接 url                               | 连接 url                         | 空                                                                                                                         |
| UPSTASH_URL                         | upstash redis 连接 url                       | 连接 url                         | 空                                                                                                                         |
| UPSTASH_TOKEN                       | upstash redis 连接 token                     | 连接 token                       | 空                                                                                                                         |
| NEXT_PUBLIC_ENABLE_REGISTER         | 是否开放注册，仅在非 localstorage 部署时生效 | true / false                     | false                                                                                                                      |
| NEXT_PUBLIC_SEARCH_MAX_PAGE         | 搜索接口可拉取的最大页数                     | 1-50                             | 5                                                                                                                          |
| NEXT_PUBLIC_DOUBAN_PROXY_TYPE       | 豆瓣数据源请求方式                           | 见下方                           | direct                                                                                                                     |
| NEXT_PUBLIC_DOUBAN_PROXY            | 自定义豆瓣数据代理 URL                       | url prefix                       | (空)                                                                                                                       |
| NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE | 豆瓣图片代理类型                             | 见下方                           | direct                                                                                                                     |
| NEXT_PUBLIC_DOUBAN_IMAGE_PROXY      | 自定义豆瓣图片代理 URL                       | url prefix                       | (空)                                                                                                                       |
| NEXT_PUBLIC_DISABLE_YELLOW_FILTER   | 关闭色情内容过滤                             | true/false                       | false                                                                                                                      |
| NEXT_PUBLIC_DANMU_API_BASE_URL      | 弹幕接口地址                                 | 接口地址                         | (空)                                                                                                                       |

NEXT_PUBLIC_DOUBAN_PROXY_TYPE 选项解释：

- direct: 由服务器直接请求豆瓣源站
- cors-proxy-zwei: 浏览器向 cors proxy 请求豆瓣数据，该 cors proxy 由 [Zwei](https://github.com/bestzwei) 搭建
- cmliussss-cdn-tencent: 浏览器向豆瓣 CDN 请求数据，该 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，并由腾讯云 cdn 提供加速
- cmliussss-cdn-ali: 浏览器向豆瓣 CDN 请求数据，该 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，并由阿里云 cdn 提供加速

- custom: 用户自定义 proxy，由 NEXT_PUBLIC_DOUBAN_PROXY 定义

NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE 选项解释：

- direct：由浏览器直接请求豆瓣分配的默认图片域名
- server：由服务器代理请求豆瓣分配的默认图片域名
- img3：由浏览器请求豆瓣官方的精品 cdn（阿里云）
- cmliussss-cdn-tencent：由浏览器请求豆瓣 CDN，该 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，并由腾讯云 cdn 提供加速
- cmliussss-cdn-ali：由浏览器请求豆瓣 CDN，该 CDN 由 [CMLiussss](https://github.com/cmliu) 搭建，并由阿里云 cdn 提供加速
- custom: 用户自定义 proxy，由 NEXT_PUBLIC_DOUBAN_IMAGE_PROXY 定义

## 配置说明

如果为 localstorage 模式所有可自定义项集中在根目录的 `config.json` 中(localstorage 模式)
非 localstorage 可在部署好的网页中直接配置

```json
{
  "cache_time": 7200,
  "api_site": {
    "dyttzy": {
      "api": "http://caiji.dyttzyapi.com/api.php/provide/vod",
      "name": "电影天堂资源",
      "detail": "http://caiji.dyttzyapi.com"
    },
    "someav": {
      "api": "https://example.com/api.php/provide/vod",
      "name": "AV-某资源",
      "is_adult": true
    },
    "oldapi": {
      "api": "https://example.com/api.php/provide/vod",
      "name": "已停用的源",
      "detail": "",
      "is_adult": false,
      "disabled": true,
      "note": "源站已失效，停用但保留条目（2026-10-04 实测）"
    }
  },
  "custom_category": [
    {
      "name": "华语",
      "type": "movie",
      "query": "华语"
    }
  ]
}
```

- `cache_time`：接口缓存时间（秒）。
- `api_site`：你可以增删或替换任何资源站，字段说明：
  - `key`：唯一标识，保持小写字母/数字。
  - `api`：资源站提供的 `vod` JSON API 根地址。
  - `name`：在人机界面中展示的名称。
  - `detail`：（可选）部分无法通过 API 获取剧集详情的站点，需要提供网页详情根 URL，用于爬取。
  - `is_adult`：（可选）`true` 表示成人源。用户的「过滤 AV 资源」开关打开时，该源不会参与搜索、换源和搜索建议。缺省时回退到按 `name` 的 `AV-` 前缀判断，因此给成人源起 `AV-` 前缀也能被识别。这个字段只能在 `config.json` 里设置（后台的添加 / 编辑源表单没有它），后台新增的自建源只能靠 `AV-` 前缀识别。
  - `disabled`：（可选）`true` 表示停用该源，不参与搜索、换源与搜索建议。不写或写 `false` 都视为启用。用于「停用而不删除」：源站失效时保留条目与备注，等它恢复后改回 `false` 即可，不必重新找回 key / 名称 / 详情页地址。
  - `note`：（可选）纯备注，只留在 `config.json` 里给人看，**不参与任何运行时逻辑**。约定用来记录停用原因与实测时间，例如「源站返回 HTTP 403，2026-10-04 实测」。
- `custom_category`：自定义分类配置，用于在导航中添加个性化的影视分类。以 type + query 作为唯一标识。支持以下字段：
  - `name`：分类显示名称（可选，如不提供则使用 query 作为显示名）
  - `type`：分类类型，支持 `movie`（电影）或 `tv`（电视剧）
  - `query`：搜索关键词，用于在豆瓣 API 中搜索相关内容

custom_category 支持的自定义分类已知如下：

- movie：热门、最新、经典、豆瓣高分、冷门佳片、华语、欧美、韩国、日本、动作、喜剧、爱情、科幻、悬疑、恐怖、治愈
- tv：热门、美剧、英剧、韩剧、日剧、国产剧、港剧、日本动画、综艺、纪录片

也可输入如 "哈利波特" 效果等同于豆瓣搜索

DreamTV 支持标准的苹果 CMS V10 API 格式。

修改后 **无需重新构建**，服务会在启动时读取一次。

### 停用一个失效的源

公共 CMS 源会随时间失效（接口下线、被 Cloudflare 拦截、源站关闭搜索）。停用时
**不要删条目**——删掉就丢了 key / 名称 / 详情页地址，源站恢复后得重新找回。改成
停用并写清原因：

```json
"suoniapi": {
  "api": "https://suoniapi.com/api.php/provide/vod",
  "name": "TV-索尼资源",
  "detail": "",
  "is_adult": false,
  "disabled": true,
  "note": "搜索接口已被源站关闭：HTTP 200 + text/plain \"暂不支持搜索\"。需源站后台重新开启，暂不可用（2026-10-04 实测）"
}
```

`config.json` 是用 `JSON.parse` 解析的，**JSON 不支持注释**，所以「注释掉一个源」
必须用 `disabled` 字段，不能用 `//`。

两点需要注意：

- **停用标准**建议是连续两轮实测都同样失败再停，偶发失败（网络抖动）不要停。
- **`config.json` 优先于后台设置**：对于在 `config.json` 里写了 `disabled` 的源，
  在后台点「启用」是无效的——下一次配置重载时 `disabled: true` 会再次生效。
  恢复某个源只能改 `config.json`。反过来，`config.json` 里没写 `disabled` 的源，
  后台管理的启停完全不受配置重载影响。

当前停用了哪些源、失效分类与复测脚本见 [`docs/broken-sources.md`](docs/broken-sources.md)。

## 管理员配置

**该特性目前仅支持通过非 localstorage 存储的部署方式使用**

支持在运行时动态变更服务配置

设置环境变量 USERNAME 和 PASSWORD 即为站长用户，站长可设置用户为管理员

站长或管理员访问 `/admin` 即可进行管理员配置

## AndroidTV 使用

目前该项目可以配合 [OrionTV](https://github.com/zimplexing/OrionTV) 在 Android TV 上使用，可以直接作为 OrionTV 后端

## TVBox 对接

- 在首页右上角的“设置”中，开启“启用 TVBox 接口”。
- 可选择“随机”生成访问密码，或自定义后点击“保存”。
- 系统会生成可直接复制的接口地址，形式为：`https://你的域名/api/tvbox/config?pwd=你的口令`。
- 将该地址填入 TVBox 的订阅/配置接口即可使用。
- 如需关闭对接，关闭开关即可。

### 本地存储(localstorage)模式

- 开关由环境变量控制：`TVBOX_ENABLED=true|false`（默认 true，未设置即开启）
- 接口访问口令使用登录密码：`PASSWORD`
- 生成的订阅地址示例：`https://你的域名/api/tvbox/config?pwd=$PASSWORD`
- 设置面板中的开关与保存在本地模式下仅用于展示（被禁用），请通过环境变量控制。

## Selene 使用

该项目已兼容 [Selene](https://github.com/MoonTechLab/Selene) 在移动端上使用，可以直接作为 Selene 后端(本地存储不支持)

## 安全与隐私提醒

### 请设置密码保护并关闭公网注册

为了您的安全和避免潜在的法律风险，我们要求在部署时设置密码保护并**强烈建议关闭公网注册**：

- **避免公开访问**：不设置密码的实例任何人都可以访问，可能被恶意利用
- **防范版权风险**：公开的视频搜索服务可能面临版权方的投诉举报
- **保护个人隐私**：设置密码可以限制访问范围，保护您的使用记录

### 部署要求

1. **设置环境变量 `PASSWORD`**：为您的实例设置一个强密码
2. **仅供个人使用**：请勿将您的实例链接公开分享或传播
3. **遵守当地法律**：请确保您的使用行为符合当地法律法规

### 重要声明

- 本项目仅供学习和个人使用
- 请勿将部署的实例用于商业用途或公开服务
- 如因公开分享导致的任何法律问题，用户需自行承担责任
- 项目开发者不对用户的使用行为承担任何法律责任

## License

[MIT](LICENSE) © 2025 DreamTV & Contributors

## 致谢

- [Stardm0/MoonTV](https://github.com/Stardm0/MoonTV) — 本项目（DreamTV）的上游项目，提供本仓库的大部分代码基础。
- [MoonTechLab/LunaTV](https://github.com/MoonTechLab/LunaTV) — 更早的前身项目。
- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) — 项目最初基于该脚手架。
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 由此启发，站在巨人的肩膀上。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 早期版本使用的网页视频播放器。
- [HLS.js](https://github.com/video-dev/hls.js) — 实现 HLS 流媒体在浏览器中的播放支持。
- [Zwei](https://github.com/bestzwei) — 提供获取豆瓣数据的 cors proxy
- [CMLiussss](https://github.com/cmliu) — 提供豆瓣 CDN 服务
- 感谢所有提供免费影视接口的站点。

---

## ⭐ Star 趋势

[![Stargazers over time](https://starchart.cc/007jackying/MoonTV.svg?variant=adaptive)](https://starchart.cc/007jackying/MoonTV)
