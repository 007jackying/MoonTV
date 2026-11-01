# 已停用的采集源

`config.json` 里有 41 个采集源在实测中连续两轮完全失败，先用 `disabled: true`
停用、并在条目上写 `note` 记录原因，**条目一律保留**。源站恢复后把 `disabled`
改回 `false` 即可恢复，不需要重新找回 key / 名称 / 详情页地址。不要直接删掉
`disabled` 字段：数据库存储的部署会沿用已保存的停用状态（见下文「优先级」）。

实测时间：**2026-10-04**，查询词「流浪地球」。探测时 `config.json` 里是 94 个源，
其中 52 个正常、41 个连续两轮同样失败、1 个偶发失败。

停用后启用的源为 **54** 个（94 − 41 + 同批新增的 `lzcaiji`），两轮复测全通过。

字段含义与用法见 README 的[「停用一个失效的源」](../README.md#停用一个失效的源)。

> 本文只是记录。真正的开关在配置文件每个源上的 `disabled` 字段，本文与 `note`
> 都不参与运行时逻辑。「配置文件」在本地存储模式下就是部署时的 `config.json`；
> 数据库存储（redis / upstash / kvrocks / d1）下是后台「配置文件」页里保存的内容，
> 仓库里的 `config.json` 只在数据库还没有配置时用来初始化。所以在数据库存储的
> 部署上，合入这些改动后还要把新的 `config.json` 粘贴进后台「配置文件」并保存，
> 停用才会生效。

## 为什么会这样

`config.json` 由 `JSON.parse` 解析（`scripts/generate-runtime.js` 与
`src/lib/config.ts`），**JSON 不支持注释**，所以「注释掉一个源」没法用 `//`
实现。这里的做法是新增两个字段：

| 字段       | 作用                                   |
| ---------- | -------------------------------------- |
| `disabled` | `true` = 停用。不写或写 `false` = 启用 |
| `note`     | 纯备注，给人看，不参与任何逻辑         |

`src/lib/config.ts` 里所有从 `config.json` 构造 `SourceConfig` 的路径都改成读
`site.disabled`。原先这些路径写死 `disabled: false`，也就是说 `config.json`
里写什么都不影响启停——这也是为什么需要改代码。

**优先级**：已有条目走 `existingSource` 分支时，只有配置文件显式写了
`disabled` 才覆盖存储里的值（与既有的 `is_adult` 处理一致）。也就是说
配置里钉死的 `disabled: true` 优先于后台管理里手动切换的状态；
反过来，不写 `disabled` 就完全不影响后台的管理状态。

这条规则的另一面：**删掉 `disabled` 字段不会重新启用一个源**。数据库存储会保存
每个源的启停状态，配置里没写 `disabled` 时沿用已保存的 `true`。恢复时请写
`disabled: false`，等所有部署都生效后再删字段。（本地存储模式每次都从
`config.json` 重建，删字段也能恢复，但写 `false` 两种模式都对。）

> **后台管理里的一个坑**：对于本文列出的源，在后台点「启用」是**无效**的——
> 每次读取配置时配置文件里的 `disabled: true` 都会重新覆盖，看起来像启用了，
> 实际仍被停用。要恢复某个源，只能改配置文件（数据库存储时是后台「配置文件」页）。
> 这是有意为之：配置文件才是唯一事实来源。

## 失效分类

`SEARCH_DISABLED`（6 个）值得单独说：这些源**返回 HTTP 200**，但 body 是
`text/plain` 的「暂不支持搜索」。也就是说源站自己在后台关掉了搜索接口，
**换 URL 修不好**，只能等站方重新开启。上游 `Stardm0/MoonTV` 用的是完全相同的
地址，同样失效。

| key           | 名称          |
| ------------- | ------------- |
| `yayazy`      | TV-丫丫点播   |
| `tyyszy`      | TV-天涯资源   |
| `niuniuzy`    | TV-牛牛点播   |
| `suoniapi`    | TV-索尼资源   |
| `sdzyapi`     | TV-闪电资源   |
| `xsd_sdzyapi` | 索尼-闪电资源 |

`HTML`（9 个）：源站返回 HTML 而非 JSON，通常是接口下线或被 Cloudflare 拦截。

| key             | 名称                         |
| --------------- | ---------------------------- |
| `wolongzyw`     | TV-卧龙点播                  |
| `wolongzyw_com` | TV-卧龙资源                  |
| `wwzy`          | TV-旺旺短剧                  |
| `wwzy_api`      | TV-旺旺资源                  |
| `heimuer`       | TV-黑木耳                    |
| `heimuer02`     | TV-黑木耳点播                |
| `aosikazy`      | AV-奥斯卡资源                |
| `dadiapi`       | 大地资源网络                 |
| `yzzy_api`      | 优质资源库 1080zyk6.com 高清 |

`NETWORK`（15 个）：DNS / 连接失败（`fetch failed`），主机疑似已停止解析。

| key           | 名称          |
| ------------- | ------------- |
| `wolongzy_cc` | TV-卧龙资源   |
| `xiaomaomi`   | TV-小猫咪资源 |
| `bwzyz`       | AV-百万资源   |
| `dbzy_caiji`  | TV-豆瓣资源   |
| `dbzy`        | TV-豆瓣资源   |
| `mozhuazy`    | TV-魔爪资源   |
| `sexnguon`    | AV-色嗨国     |
| `gayapi`      | 快播资源网站  |
| `aiduanju`    | 爱短剧.cc     |
| `huawei8`     | 华为吧资源    |
| `taopianapi`  | 淘片资源      |
| `fczy888`     | 蜂巢片库      |
| `jmzy`        | 金马资源网    |
| `xxibaozyw`   | 细胞采集黄色  |
| `qiqidys`     | 七七影视      |

`HTTP_403`（6 个）：源站返回 403，疑似 UA 或地域封锁。

| key            | 名称             |
| -------------- | ---------------- |
| `wujinapi_cc`  | TV-wujinapi 无尽 |
| `wujinapi_me`  | TV-无尽资源      |
| `wujinapi_net` | TV-无尽资源      |
| `apiyhzy`      | TV-樱花资源      |
| `yparse`       | TV-步步高资源    |
| `p2100`        | TV-飘零资源      |

其余零散几类：

| key             | 名称         | 现象                       |
| --------------- | ------------ | -------------------------- |
| `lbapiby`       | AV-AIvin     | HTTP 502                   |
| `maozyapi`      | AV-色猫资源  | HTTP 521                   |
| `maotaizy`      | TV-茅台资源  | 返回 JSON 但缺 `list` 字段 |
| `kuaichezy`     | 快车资源阿   | 空响应体                   |
| `apilj_provide` | 辣椒资源黄黄 | 空响应体                   |

## 故意没有停用的源

- **`shayuapi`（AV-鲨鱼资源）** —— 第一轮 `NETWORK`、第二轮 `OK`，属于偶发失败。
  单次失败不足以判定源已死，所以保留启用。

停用标准是**连续两轮同样失败**，偶发失败一律保留。

## 怎么复测

用 `scripts/check-sources.mjs`（`pnpm check:sources`）。它发送的请求头与应用自己的
搜索请求相同（`src/lib/config.ts` 的 `API_CONFIG.search.headers`）——被 UA 拦截的源
只有用同样的 UA 测才有意义；失败原因按本文的分类输出，日期也一并带上，可以直接抄进
`note`。另外，搜索是在**服务端**发起的，地域封锁看的是部署所在地区，而不是跑脚本的机器。

```bash
pnpm check:sources --enabled            # 只测启用的源；停用生效的标志是两轮全部 OK
pnpm check:sources --disabled           # 只测已停用的源，看有没有恢复
pnpm check:sources --enabled --play     # 端到端：搜索 → 解析 .m3u8 分集 → 请求播放列表
pnpm check:sources kuaikan yhdm         # 只测指定 key
```

停用标准是两轮都失败，所以 `--enabled` 要跑两次；任何源失败时脚本退出码为 1。
`--play` 比单纯的搜索检查更严格：能搜但解析不出 `.m3u8` 分集、或播放列表打不开的源
在站内一样放不了。

2026-10-04 停用时，启用的 54 个源两轮全部 OK（当时用的是本文旧版里的内联 `node -e`
脚本，检查项与 `pnpm check:sources --enabled` 相同）。

某个源恢复后，先用 `pnpm check:sources --disabled`（或直接写它的 key）确认它变 `OK`，再把 `config.json` 里
对应的 `disabled` 改成 `false`、删掉 `note`，并从本文里移除该行——两边保持一致。
数据库存储的部署还要把新配置保存进后台「配置文件」。所有部署都生效后，才可以把
`disabled: false` 也删掉。

## 仍待确认

以下两点在停用时没有核实，再动这些源之前值得先测一次：

- **6 个 `HTTP_403` 源当时是用 `User-Agent: Mozilla/5.0` 测的**，而应用发送的是
  完整的 Chrome UA（上面的脚本已改成同样的请求头）。如果它们只是拦截了短 UA，
  用 `pnpm check:sources --disabled` 复测会变 `OK`，应该重新启用。
- **6 个 `SEARCH_DISABLED` 源只证明了搜索关闭，没证明详情接口也关了**。`disabled`
  会让 `/api/detail` 也拒绝这个源，用户收藏或播放记录里这些源的影片就打不开（播放页
  会退回搜索其它源）。可以用 `?ac=videolist&ids=<已知 id>` 测一下详情接口：如果仍然
  可用，更合适的做法是只把它们排除在搜索之外，而不是整体停用。
