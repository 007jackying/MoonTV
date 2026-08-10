# DreamTV(Branch)

原项目地址https://github.com/MoonTechLab/LunaTV

<div align="center">
  <img src="public/logo.png" alt="LibreTV Logo" width="120">
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
- 📄 **丰富详情页**：支持剧集列表、演员、年份、简介等完整信息展示。
- ▶️ **流畅在线播放**：集成 HLS.js & ArtPlayer。
- 📥 **视频下载**：支持 M3U8 视频下载，多线程并发加速，边下边存功能（Chrome/Edge）。
- ❤️ **收藏 + 继续观看**：支持 Redis/Upstash 存储，多端同步进度。
- 📱 **PWA**：离线缓存、安装到桌面/主屏，移动端原生体验。
- 🌗 **响应式布局**：桌面侧边栏 + 移动底部导航，自适应各种屏幕尺寸。
- 📺 **Android TV 客户端**：仓库自带（`android/`），遥控器方向键导航、免登录、播放器菜单、
  失效自动换源，详见 [Android TV / Google TV](#android-tv--google-tv)。
- 🚀 **极简部署**：一条 Docker 命令即可将完整服务跑起来，或免费部署到 Vercel、Netlify、cloudflare。
- 👿 **智能去广告**：自动跳过视频中的切片广告（实验性）
- 💬 **弹幕支持**：以[danmu_api](https://github.com/huangxd-/danmu_api)为后端, 需自行部署

### 注意：部署后项目为空壳项目，无内置播放源，需要自行收集，需要弹幕请自行部署后端

<details>
  <summary>点击查看项目截图</summary>
  <img src="public/screenshot1.png" alt="项目截图" style="max-width:600px">
</details>

## 🗺 目录

- [DreamTV(Branch)](#dreamtvbranch)
  - [✨ 功能特性](#-功能特性)
    - [注意：部署后项目为空壳项目，无内置播放源，需要自行收集，需要弹幕请自行部署后端](#注意部署后项目为空壳项目无内置播放源需要自行收集需要弹幕请自行部署后端)
  - [🗺 目录](#-目录)
  - [技术栈](#技术栈)
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
  - [Android TV / Google TV](#android-tv--google-tv)
    - [安装](#安装)
    - [首次启动](#首次启动)
    - [遥控器操作](#遥控器操作)
    - [常见问题](#常见问题)
    - [其他 TV 方案](#其他-tv-方案)
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
| UI & 样式 | [Tailwind&nbsp;CSS 3](https://tailwindcss.com/)                                                       |
| 语言      | TypeScript 4                                                                                          |
| 播放器    | [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) · [HLS.js](https://github.com/video-dev/hls.js/) |
| 代码质量  | ESLint · Prettier · Jest                                                                              |
| 部署      | Docker · Vercel · pages                                                                               |

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

#### 直接运行（最简单，localstorage）

```bash
# 拉取预构建镜像
# 或拉取最新版本
docker pull ghcr.io/stardm0/moontv:latest

# 运行容器
# -d: 后台运行  -p: 映射端口 3000 -> 3000
docker run -d --name moontv -p 3000:3000 --env PASSWORD=your_password ghcr.io/stardm0/moontv:latest
```

#### Docker Compose

##### local storage 存储

```yaml
services:
  startv-core:
    image: ghcr.io/stardm0/moontv:latest
    container_name: startv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - PASSWORD=password
```

##### Kvrocks 存储（推荐）

```yml
services:
  moontv-core:
    image: ghcr.io/stardm0/moontv:latest
    container_name: moontv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=kvrocks
      - KVROCKS_URL=redis://moontv-kvrocks:6666
    networks:
      - moontv-network
    depends_on:
      - moontv-kvrocks
  moontv-kvrocks:
    image: apache/kvrocks
    container_name: moontv-kvrocks
    restart: unless-stopped
    volumes:
      - kvrocks-data:/var/lib/kvrocks
    networks:
      - moontv-network
networks:
  moontv-network:
    driver: bridge
volumes:
  kvrocks-data:
```

##### Redis 存储（有一定的丢数据风险）

```yml
services:
  moontv-core:
    image: ghcr.io/stardm0/moontv:latest
    container_name: moontv-core
    restart: on-failure
    ports:
      - '3000:3000'
    environment:
      - USERNAME=admin
      - PASSWORD=admin_password
      - NEXT_PUBLIC_STORAGE_TYPE=redis
      - REDIS_URL=redis://moontv-redis:6379
    networks:
      - moontv-network
    depends_on:
      - moontv-redis
  moontv-redis:
    image: redis:alpine
    container_name: moontv-redis
    restart: unless-stopped
    networks:
      - moontv-network
    # 请开启持久化，否则升级/重启后数据丢失
    volumes:
      - ./data:/data
networks:
  moontv-network:
    driver: bridge
```

##### Upstash 存储

```yaml
services:
  startv-core:
    image: ghcr.io/stardm0/moontv:latest
    container_name: startv-core
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
    }
    // ...更多站点
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

## 管理员配置

**该特性目前仅支持通过非 localstorage 存储的部署方式使用**

支持在运行时动态变更服务配置

设置环境变量 USERNAME 和 PASSWORD 即为站长用户，站长可设置用户为管理员

站长或管理员访问 `/admin` 即可进行管理员配置

## Android TV / Google TV

本仓库自带一个 Android TV 客户端（`android/` 目录）：一个指向你自己 DreamTV 实例的 WebView 壳子。
所有逻辑仍在网页端，装了它只是为了在电视桌面上有个图标、记住登录状态、让遥控器能用。

网页端会通过 UA 里的 `MoonTV-TV` 标记自动切换到电视布局：顶部导航、一行 6 张海报卡、
月光配色、方向键空间导航、播放页只留画面。手机和桌面完全不受影响。

### 安装

APK 需要自己构建（仓库不提供预编译包）。构建需要 **JDK 17**（JDK 23 会被 AGP 拒绝）
和 Android SDK：

```sh
cd android
JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew assembleRelease
# 产物：android/app/build/outputs/apk/release/app-release.apk
```

然后选一种方式装到电视上：

**方式一：adb 局域网安装（自己用，最快）**

先在电视上打开开发者选项：设置 → 系统 → 关于 → 连点「版本号」7 次，
然后在 设置 → 系统 → 开发者选项 里打开「USB 调试 / 网络调试」，并记下电视的 IP。

```sh
adb connect <电视IP>:5555
adb install -r app-release.apk
```

**方式二：Downloader 侧载（给朋友装）**

把 APK 放到任意可下载的地址，电视上装 **Downloader** 应用，输入该地址下载后安装。
需要先在 设置 → 系统 → 开发者选项 里，允许 Downloader 安装未知来源应用。

**方式三：U 盘**

把 APK 拷到 U 盘，插到电视上，用任意文件管理器打开安装。

> 签名用的 `android/moontv-tv.keystore` 已被 gitignore，**请务必自行备份**。
> 丢了这个文件之后构建出来的包签名不同，无法覆盖安装，朋友必须先卸载旧版才能更新。

### 首次启动

第一次打开会要求填两项：

| 字段       | 说明                                                                                  |
| ---------- | ------------------------------------------------------------------------------------- |
| 服务器地址 | 你的 DreamTV 地址，例如 `https://dreamtv.example.com`。不写协议默认按 `https://` 处理 |
| 站点密码   | 即环境变量 `PASSWORD`。填了之后电视端不再出现登录页                                   |

密码保存在电视本机（SharedPreferences），应用会在遇到登录页时自动调用 `/api/login` 完成登录，
**服务端的密码保护不受任何影响** —— 只是这台电视记住了密码，公网访问仍然需要登录。
电视端也不会再弹免责声明。

之后随时按遥控器 **MENU** 键可以改这两项；地址填错导致加载失败时，也会退回这个界面。

### 遥控器操作

| 按键   | 列表页                               | 播放页                                    |
| ------ | ------------------------------------ | ----------------------------------------- |
| 方向键 | 移动焦点，内容跟着滚动               | ◀ ▶ 快退 / 快进 10 秒；▲ ▼ 打开播放器菜单 |
| 确认键 | 打开当前项                           | 播放 / 暂停                               |
| 返回键 | 焦点回到顶部导航；焦点已在导航时退出 | 关闭已打开的菜单或面板；否则返回上一页    |
| MENU   | 修改服务器地址和密码                 | 同左                                      |

播放器菜单里有：播放/暂停、上一集、下一集、选集、换源、返回首页。
播放中不显示任何常驻控件，菜单选完即消失。

播放源失效时会自动换到下一个源（每个源只自动试一次），一轮都失败才会弹出选源列表。

### 常见问题

- **文字在我的电视上太小/太大**：改 `android/app/src/main/java/com/moontv/tv/MainActivity.kt`
  里的 `TEXT_ZOOM`（默认 130），重新构建即可，不需要动网页端 CSS。
- **一直卡在「视频加载中」**：多半是该源没有 CORS 头。项目已内置 `/api/hls` 代理，
  直连失败会自动转代理；仍然不行就换源。注意走代理时视频流量会经过你的服务器。
- **HTTP（非 HTTPS）地址能用吗**：可以，manifest 已开启 `usesCleartextTraffic`。

### 其他 TV 方案

本项目也可以配合 [OrionTV](https://github.com/zimplexing/OrionTV) 使用，直接作为 OrionTV 后端。

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

- [ts-nextjs-tailwind-starter](https://github.com/theodorusclarence/ts-nextjs-tailwind-starter) — 项目最初基于该脚手架。
- [LibreTV](https://github.com/LibreSpark/LibreTV) — 由此启发，站在巨人的肩膀上。
- [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) — 提供强大的网页视频播放器。
- [HLS.js](https://github.com/video-dev/hls.js) — 实现 HLS 流媒体在浏览器中的播放支持。
- [Zwei](https://github.com/bestzwei) — 提供获取豆瓣数据的 cors proxy
- [CMLiussss](https://github.com/cmliu) — 提供豆瓣 CDN 服务
- 感谢所有提供免费影视接口的站点。

---

## ⭐ Star 趋势

[![Stargazers over time](https://starchart.cc/stardm0/MoonTV.svg?variant=adaptive)](https://starchart.cc/stardm0/MoonTV)
