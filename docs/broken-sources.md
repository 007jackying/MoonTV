# 已停用的采集源

`config.json` 里有 41 个采集源在实测中连续两轮完全失败，先用 `disabled: true`
停用、并在条目上写 `note` 记录原因，**条目一律保留**。源站恢复后把 `disabled`
改回 `false`（或删掉该字段）即可恢复，不需要重新找回 key / 名称 / 详情页地址。

实测时间：**2026-10-04**，查询词「流浪地球」。探测时 `config.json` 里是 94 个源，
其中 52 个正常、41 个连续两轮同样失败、1 个偶发失败。

停用后启用的源为 **54** 个（94 − 41 + 本 PR 新增的 `lzcaiji`），两轮复测全通过。

> 本文只是记录。真正的开关在 `config.json` 每个源上的 `disabled` 字段，
> 本文与 `note` 都不参与运行时逻辑。

## 为什么会这样

`config.json` 由 `JSON.parse` 解析（`scripts/generate-runtime.js` 与
`src/lib/config.ts`），**JSON 不支持注释**，所以「注释掉一个源」没法用 `//`
实现。这里的做法是新增两个字段：

| 字段 | 作用 |
| --- | --- |
| `disabled` | `true` = 停用。不写或写 `false` = 启用 |
| `note` | 纯备注，给人看，不参与任何逻辑 |

`src/lib/config.ts` 里所有从 `config.json` 构造 `SourceConfig` 的路径都改成读
`site.disabled`。原先这些路径写死 `disabled: false`，也就是说 `config.json`
里写什么都不影响启停——这也是为什么需要改代码。

**优先级**：已有条目走 `existingSource` 分支时，只有 `config.json` 显式写了
`disabled` 才覆盖存储里的值（与既有的 `is_adult` 处理一致）。也就是说
`config.json` 里钉死的 `disabled: true` 优先于后台管理里手动切换的状态；
反过来，不写 `disabled` 就完全不影响后台的管理状态。

> **后台管理里的一个坑**：对于本文列出的源，在后台点「启用」是**无效**的——
> 下一次配置重载时 `config.json` 的 `disabled: true` 会再次生效，看起来像
> 启用了但实际仍被停用。要恢复某个源，只能改 `config.json`。这是有意为之：
> `config.json` 才是唯一事实来源。

## 失效分类

`SEARCH_DISABLED`（6 个）值得单独说：这些源**返回 HTTP 200**，但 body 是
`text/plain` 的「暂不支持搜索」。也就是说源站自己在后台关掉了搜索接口，
**换 URL 修不好**，只能等站方重新开启。上游 `Stardm0/MoonTV` 用的是完全相同的
地址，同样失效。

| key | 名称 |
| --- | --- |
| `yayazy` | TV-丫丫点播 |
| `tyyszy` | TV-天涯资源 |
| `niuniuzy` | TV-牛牛点播 |
| `suoniapi` | TV-索尼资源 |
| `sdzyapi` | TV-闪电资源 |
| `xsd_sdzyapi` | 索尼-闪电资源 |

`HTML`（9 个）：源站返回 HTML 而非 JSON，通常是接口下线或被 Cloudflare 拦截。

| key | 名称 |
| --- | --- |
| `wolongzyw` | TV-卧龙点播 |
| `wolongzyw_com` | TV-卧龙资源 |
| `wwzy` | TV-旺旺短剧 |
| `wwzy_api` | TV-旺旺资源 |
| `heimuer` | TV-黑木耳 |
| `heimuer02` | TV-黑木耳点播 |
| `aosikazy` | AV-奥斯卡资源 |
| `dadiapi` | 大地资源网络 |
| `yzzy_api` | 优质资源库1080zyk6.com高清 |

`NETWORK`（15 个）：DNS / 连接失败（`fetch failed`），主机疑似已停止解析。

| key | 名称 |
| --- | --- |
| `wolongzy_cc` | TV-卧龙资源 |
| `xiaomaomi` | TV-小猫咪资源 |
| `bwzyz` | AV-百万资源 |
| `dbzy_caiji` | TV-豆瓣资源 |
| `dbzy` | TV-豆瓣资源 |
| `mozhuazy` | TV-魔爪资源 |
| `sexnguon` | AV-色嗨国 |
| `gayapi` | 快播资源网站 |
| `aiduanju` | 爱短剧.cc |
| `huawei8` | 华为吧资源 |
| `taopianapi` | 淘片资源 |
| `fczy888` | 蜂巢片库 |
| `jmzy` | 金马资源网 |
| `xxibaozyw` | 细胞采集黄色 |
| `qiqidys` | 七七影视 |

`HTTP_403`（6 个）：源站返回 403，疑似 UA 或地域封锁。

| key | 名称 |
| --- | --- |
| `wujinapi_cc` | TV-wujinapi无尽 |
| `wujinapi_me` | TV-无尽资源 |
| `wujinapi_net` | TV-无尽资源 |
| `apiyhzy` | TV-樱花资源 |
| `yparse` | TV-步步高资源 |
| `p2100` | TV-飘零资源 |

其余零散几类：

| key | 名称 | 现象 |
| --- | --- | --- |
| `lbapiby` | AV-AIvin | HTTP 502 |
| `maozyapi` | AV-色猫资源 | HTTP 521 |
| `maotaizy` | TV-茅台资源 | 返回 JSON 但缺 `list` 字段 |
| `kuaichezy` | 快车资源阿 | 空响应体 |
| `apilj_provide` | 辣椒资源黄黄 | 空响应体 |

## 故意没有停用的源

- **`shayuapi`（AV-鲨鱼资源）** —— 第一轮 `NETWORK`、第二轮 `OK`，属于偶发失败。
  单次失败不足以判定源已死，所以保留启用。

停用标准是**连续两轮同样失败**，偶发失败一律保留。

## 怎么复测

只测 `disabled` 不为真的源。停用生效的标志是：跑完两轮，启用的源全部 `OK`。

```bash
node -e '
const s = require("./config.json").api_site;
const H = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const one = async ([k, v]) => {
  if (v.disabled) return null;
  try {
    const r = await fetch(v.api + "?ac=videolist&wd=" + encodeURIComponent("流浪地球"), { headers: H });
    const t = await r.text();
    if (!r.ok) return k + " HTTP_" + r.status;
    if (!t.trim()) return k + " EMPTY";
    if (t.includes("暂不支持搜索")) return k + " SEARCH_DISABLED";
    try { return JSON.parse(t).list ? k + " OK" : k + " BAD_SHAPE"; }
    catch { return k + " HTML"; }
  } catch { return k + " NETWORK"; }
};
(async () => {
  for (const r of [1, 2]) {
    const out = [];
    const e = Object.entries(s);
    for (let i = 0; i < e.length; i += 8) out.push(...await Promise.all(e.slice(i, i + 8).map(one)));
    const bad = out.filter(x => x && !x.endsWith("OK"));
    console.log("--- round", r, "--- enabled:", e.filter(([,v])=>!v.disabled).length, "| failing:", bad.length);
    console.log(bad.join("\n") || "(all OK)");
  }
})();
'
```

预期输出（2026-10-04 停用后实测，启用的 54 个源两轮全 OK）：

```
--- round 1 --- enabled: 54 | failing: 0
(all OK)
--- round 2 --- enabled: 54 | failing: 0
(all OK)
```

某个源恢复后，先在上面的脚本里确认它变 `OK`，再把 `config.json` 里对应的
`disabled` / `note` 删掉，并从本文里移除该行——两边保持一致。