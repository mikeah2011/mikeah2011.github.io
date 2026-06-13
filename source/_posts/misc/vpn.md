---

feature: true
keywords: [VPN, 机场笔记, 技术杂谈]
cover: https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/network-security.jpg
images:
  - https://cdn.jsdelivr.net/gh/mikeah2011/oss@main/uPic/network-security.jpg
title: VPN & 机场笔记
date: 2026-05-25 10:00:00
categories:
  - misc
tags:
- macOS
- VPN
- Proxy
- 科学上网
- 代理
- 机场
description: 全面的VPN科学上网与机场订阅指南，涵盖主流代理协议Shadowsocks、V2Ray、Trojan、WireGuard的性能与安全性对比，提供Clash、Shadowrocket、V2rayN等客户端的配置教程与macOS优化方案，附机场选购建议、连接故障排查踩坑案例及2026年最新机场推荐。
---




> 数据来源：[GitHub - mikeah2011/panda-vpn-pro](https://github.com/mikeah2011/panda-vpn-pro)（fork 自 [DiningFactory/panda-vpn-pro](https://github.com/DiningFactory/panda-vpn-pro)，upstream 10k+ ★）
>
> ⚠️ 永远不要年付！月付或不限时小包最安全。

## 我的订阅


| 机场                                                                      | 套餐  | 价格     | 流量    | 时长  | 状态   |
| ----------------------------------------------------------------------- | --- | ------ | ----- | --- | ---- |
| [魔戒](https://mojie.cyou/#/register?code=JpioTJTy)                       | 不限时 | ¥19.9  | 130GB | 不限时 | ✅ 在用 |
| [赔钱机场](https://xn--mes358aby2apfg.com/register?code=sH45wJ14&cover=sfw) | 不限时 | ¥18.90 | 1TB   | 不限时 | ✅ 在用 |
| [一分机场](https://xn--4gqx1hgtfdmt.com/#/register?code=L0GnsJbK)           | 不限时 | ¥11.88 | 100GB | 不限时 | ✅ 在用 |


## 可试用机场（先体验再决定）


| 机场 | 类型 | 试用内容 | 月付 | 不限时套餐 | 备注 |
| --- | --- | --- | --- | --- | --- |
| [FlyBit](https://flybit.vip/#/register?code=munD7XGx) `*A` | 中转 | 2GB 流量 | ¥15 / 128GB | ¥36 / 128GB | 按量试用 |
| [iNetS](https://inets.io/#/register?code=51JJlDFB) | 直连+ | 1天试用 | ¥6 / 50GB | - | 适合测试 |


## 低价机场推荐（2025-2026，按性价比排序）

### 直连机场（便宜、流量足、防失联强）


| 机场                                                                      | 类型  | 月付           | 不限时套餐          | 倍率       | 备注               |
| ----------------------------------------------------------------------- | --- | ------------ | -------------- | -------- | ---------------- |
| [赔钱机场](https://xn--mes358aby2apfg.com/register?code=sH45wJ14&cover=sfw) | 直连  | ¥1.5 / 100GB | ¥18.90 / 1TB   | 0.01 & 1 | 极低价，不限时1TB才18.9元 |
| [一分机场](https://xn--4gqx1hgtfdmt.com/#/register?code=L0GnsJbK)           | 直连  | ¥2 / 100GB   | ¥11.88 / 100GB | 0.1 & 1  | 最便宜月付            |
| [良心云](https://xn--9kqz23b19z.com/#/register?code=9xzIEsj3)              | 直连  | ¥2 / 100GB   | ¥21 / 1TB      | 1        | 性价比高             |


### 中转机场（体验更好、速度更稳）


| 机场                                                             | 类型  | 月付             | 不限时套餐       | 倍率      | 备注                           |
| -------------------------------------------------------------- | --- | -------------- | ----------- | ------- | ---------------------------- |
| [自由猫](https://us.freecat.cloud/register?code=***)              | 中转  | ¥9 / 100GB     | ¥50 / 500GB | 1       | 8折优惠码 `FREECAT`              |
| [次元雲](https://ciyy.one/#/register?code=tsL8Me6h) `A`           | 中转  | ¥10 / 128GB    | ¥99 / 520GB | 1       | 9折码 `ciyy-999`，8折码 `ciyy-80` |
| [壹速云](https://www.onesy1.cc/auth/register?code=***)            | 中转  | ¥10.90 / 150GB | ¥188 / 1TB  | 1       | 老牌，限新注册                      |
| [Doriya](https://rtx.al/#/register?code=hAlv337j) `A`          | 中转  | ¥8 / 100GB     | -           | 1       | -                            |
| [兔兔云](https://www.tutuyun.uk/auth/register?code=HAkrPBbs)      | 中转  | ¥11.88 / 140GB | ¥18 / 60GB  | 1       | -                            |
| [NyanSS](https://billing.nyanss001.top/register?code=***)      | 中转  | ¥7.50 / 50GB   | ¥25 / 100GB | 1       | -                            |
| [ofoNET](https://ofotw.org/#/register?code=q3kx6Xt9) `A`       | 中转  | ¥12.87 / 200GB | -           | 1       | -                            |
| [M78星云](https://m78star.cloud/#/register?code=7IWr2dOP) `A` 🔒 | 中转  | ¥12.80 / 150GB | ¥99 / 300GB | 1       | 需客户端                         |
| [蜂窝云](https://api.fwcloud.life/auth/register?code=***)         | 中转  | ¥20 / 200GB    | -           | 0.5 & 1 | 9折码 `FW9`，需客户端               |
| [农夫山泉](https://qqq.nfsqttt.com/#/register?code=HvoPMFli) 🔒    | 中转  | ¥15 / 200GB    | ¥45 / 200GB | 1       | 需客户端                         |
| [慈善机场](https://xn--30rs3bu7r87f.com/#/register?code=es7TrIbn)    | 中转  | ¥9.99 / 3000GB | ¥13.99 / 年  | 1       | 年付 13.99 每月 200GB            |


### 直连机场（便宜、流量足、防失联强）— 新增


| 机场 | 类型 | 月付 | 不限时套餐 | 倍率 | 备注 |
| --- | --- | --- | --- | --- | --- |
| [Danke](https://2iipd.dklineo.top/#/register?code=a0zksG3J) | 直连 | ¥3 / 88GB | 不限时 | 1 | 极低价入门 |
| [阿达西](https://adaxi.net/?r=68917) | 直连 | ¥3 / 20G | 不限时 | 1 | - |
| [SKYLUMO](https://s.y8o.de/skylumo) | 直连 | ¥3.99 / 月起 | - | 1 | 优惠券 `lN0cKN1L` |
| [koodog](https://zero.thisgourl.xyz/#/register?code=BSkBAzZz) | 直连 | ¥5 / 35G | - | 1 | - |
| [冲上云霄](https://cpdd.one/?r=32083) | 直连 | ¥5 / 80G | 不限时 | 1 | - |
| [唯兔云](https://s.y8o.de/wty) | 直连 | ¥6 / 45G | 不限时 | 1 | 优惠券 `rabbit` |
| [网际快车](https://b3.快车.com?c=CDSXDE) | 直连 | ¥6.8 / 20GB | 不限时 | 1 | 试用券 `vpsknow` |
| [CAC](https://www.cac.mom/#/register?code=kYL5chvN) | 直连 | ¥7.9 / 168G | - | 1 | 流量大 |
| [极连云](https://s.y8o.de/jly) | 直连 | ¥8 / 60G | 不限时 | 1 | 优惠券 `JLY888` |
| [XSUS](https://xsus.cloud/register?code=***) | 直连 | ¥8 / 168G | 不限时 | 1 | - |
| [光速云](https://s.y8o.de/lightspeed) | 直连 | ¥8.25 / 59G | 不限时 | 1 | - |
| [瞬云](https://s.y8o.de/sy) | 直连 | ¥8.25 / 59G | - | 1 | 优惠券 `20OFF` |
| [梦想云](https://gx.dreamcl.sbs/#/register?code=GFUAEweX) | 直连 | ¥8.8 / 300GB | - | 1 | 流量超大 |
| [69云](https://s.y8o.de/69yun) | 直连 | ¥9.6 / 月起 | - | 1 | 公网中转 |
| [xxyun](https://xxyun.at/?code=***) | 直连 | ¥9.99 / 100G | 不限时 | 1 | - |
| [灯塔cloud](https://www.dengta.cloud/#/register?code=n4jB4z5R) | 直连 | ¥10 / 100G | - | 1 | - |
| [随便云](https://wcnm.one/register?code=***) | 直连 | ¥10 / 68G | 不限时 | 1 | - |
| [加速啦](https://jiasu.la/?r=39116) | 直连 | ¥10 / 80G | 不限时 | 1 | - |
| [纵云梯](https://zongyunti.com/?r=60147) | 直连 | ¥10 / 60G | - | 1 | - |
| [TNT](https://ermaozi02.tntvipaff.cc/#/register?code=f1EyPwf3) | 直连 | ¥10 / 60G | - | 1 | 季付 |
| [奈云](https://v2ny788.top/?path=register&code=***) | 直连 | ¥10.6 / 168G | 不限时 | 1 | 年付 |
| [superbiu](https://biubiux.online/#/register?code=BasmsULb) | 直连 | ¥11 / 50G | 不限时 | 1 | - |
| [uuone](https://uuone.at/?code=***) | 直连 | ¥12 / 150G | 不限时 | 1 | - |
| [白羊星](https://baiyangxi.com/#/register?code=gelkjfjz) | 直连 | ¥12 / 100G | 不限时 | 1 | - |
| [好鸭云](https://vuser.niceduck.io/register?code=***) | 直连 | ¥12 / 100G | - | 1 | - |
| [99吧](https://99vpn.bar/#/register?code=qzpkbzHF) | 直连 | ¥12.9 / 99G | 不限时 | 1 | - |
| [龙猫云](https://ermaozi01.lmvipaff03.cc/register?aff=aOkm2wPW) | 直连 | ¥15 / 100G | - | 1 | - |
| [迅达](https://sulianproxy.com/register?code=***) | 直连 | ¥15 / 120G | - | 1 | - |
| [百变小樱](https://cn2.cardsakura.buzz/v2/register?code=***) | 直连 | ¥15 / 100G | - | 1 | - |
| [ssone](https://www.flybit6202.com/#/register?code=MmE2PsQJ) | 直连 | ¥15 / 60G | - | 1 | - |
| [ccyz](https://xxyun.at/?code=***) | 直连 | ¥15 / 150G | - | 1 | - |
| [二猫云](https://s.y8o.de/2maoyun) | 直连 | ¥16 / 100G | 不限时 | 1 | 优惠券 `ermao888` |
| [星岛梦](https://s.y8o.de/stardream) | 直连 | ¥16 / 100G | 不限时 | 1 | 优惠券 `XDM888` |
| [xxai](https://xx-ai.co/?invite_code=K2TpsDcg) | 直连 | ¥16.9 / 100G | 不限时 | 1 | - |
| [寰宇云](https://s.y8o.de/huanyuyunvip) | 直连 | ¥18 / 150GB | 不限时 | 1 | 优惠券 `KY78` |
| [CyberGuard](https://www.cyberguard.best/#/register?code=yoyUW3R9) | 直连 | ¥18 / 100G | 不限时 | 1 | - |
| [光年梯](https://s.y8o.de/lightyearti) | 直连 | ¥18 / 110G | 不限时 | 1 | 优惠券 `GNT70` |
| [掌中世界](https://qq.zjs2025.com/user/register?code=***) | 直连 | ¥18 / 100G | - | 1 | - |
| [大哥云](https://ermao.dgywzc.com/#/register?code=peAVAa8D) | 直连 | ¥19.9 / 100G | - | 1 | - |
| [u1s1](https://s.y8o.de/u1s1) | 直连 | ¥18.8 / 120G | 不限时 | 1 | 优惠券 `U1S1` |
| [sogo云](https://s.y8o.de/sogoyun) | 直连 | ¥15.9 / 150G | 不限时 | 1 | 优惠券 `SOGO28` |
| [全球云](https://s.y8o.de/globalyun) | 直连 | ¥20 / 120G | 不限时 | 1 | 优惠券 `vpsknow` |
| [闪狐云](https://erozi01.ffvipaff.cc/register?aff=NCO1w4Iv) | 直连 | ¥20 / 120G | - | 1 | - |
| [Fastlink](https://s.y8o.de/fastlink) | 直连 | ¥20 / 月起 | - | 1 | BGP/IPLC专线 |


### 中转机场（体验更好、速度更稳）— 新增


| 机场 | 类型 | 月付 | 不限时套餐 | 倍率 | 备注 |
| --- | --- | --- | --- | --- | --- |
| [Runway](https://s.y8o.de/runway) | 中转 | ¥9.9 / 100G | - | 1 | BGP专线，试用6GB |
| [cocoduck](https://www.cocoduck.live/auth/register?code=***) | 中转 | ¥15 / 150G | - | 1 | - |
| [山水云](https://s.y8o.de/shanshuiyun) | 中转 | ¥14.99 / 月起 | 年付¥88起 | 1 | Netflix/AI全解锁 |
| [秒秒云](https://s.y8o.de/miaomiaoyun) | 中转 | ¥14 / 月起 | 年付¥79起 | 1 | 不限时流量包 |
| [快狸](https://s.y8o.de/kuaili) | 中转 | ¥22 / 月起 | - | 1 | 优惠券 `KUALI996` |
| [Edge-X](https://edge-invite.com/#/register?code=LCH9laOs) | 中转 | ¥22.8 / 月起 | - | 1 | - |
| [老头vpn](https://www.chattous.net/register?code=***) | 中转 | ¥25 / 150G | - | 1 | - |
| [隐云](https://wkacc.xyz/?code=***) | 中转 | ¥25 / 150G | - | 1 | - |
| [宇宙云](https://s.y8o.de/yuzhoucloud) | 中转 | ¥25 / 月起 | 年付¥120起 | 1 | 优惠券 `YUZHOU553` |
| [一翻云](https://s.y8o.de/1flyun) | 中转 | ¥25 / 月起 | 年付¥100起 | 1 | 优惠券 `1FLYYUN` |
| [Aladdin](https://short.thisgourl.xyz/#/register?code=tvLw0oMj) | 中转 | ¥30 / 390G | - | 1 | 半年 |
| [okanc](https://www.okanc.com/#/register?code=spBqEcUn) | 中转 | ¥46 / 328G | - | 1 | - |


### 高端专线机场（IEPL/BGP/IPLC）— 新增


| 机场 | 类型 | 月付 | 不限时套餐 | 倍率 | 备注 |
| --- | --- | --- | --- | --- | --- |
| [Bitz Net](https://s.y8o.de/Bitz) | IEPL | 试用1天/5GB | - | 1 | 注册即用 |
| [MESL](https://s.y8o.de/mesl) | IEPL | ¥50 / 月起 | - | 1 | - |
| [Bywave](https://s.y8o.de/ByWave) | IEPL | ¥30 / 月起 | - | 1 | - |
| [FlowerCloud](https://s.y8o.de/flowercloud) | BGP/IEPL | ¥39 / 月起 | - | 1 | - |
| [ImmTelecom](https://s.y8o.de/immtele) | IEPL/IPLC | ¥72.45 / 月起 | - | 1 | - |
| [YToo](https://s.y8o.de/ytoo) | 多线加速 | ¥98 / 年起 | - | 1 | - |
| [SsrDog](https://s.y8o.de/ssrdog) | IPLC/IEPL | ¥45 / 月 | - | 1 | - |
| [TAG](https://s.y8o.de/tag) | IEPL | ¥109 / 月起 | - | 1 | - |
| [Nexitally](https://s.y8o.de/naiixi) | 高端专线 | ¥117 / 月起 | - | 1 | - |
| [Gatern](https://s.y8o.de/Gatern) | 混合 | 按量付费 | 不限时 | 1 | - |


## 协议说明

- `A` = 少量 AnyTLS 协议节点
- `*A` = 大部分 AnyTLS 协议节点
- `🔒` = 只能用官方客户端，不支持 Clash 订阅
- `🔥` = 阅后即焚订阅模式

## 选购建议

1. **低频用户**（月用 < 100GB）→ 买**一分机场**或**良心云**月付 2 元
2. **囤流量** → 买**赔钱机场**不限时 18.9 元/1TB
3. **要体验** → 买**自由猫** 9 元/100GB 中转
4. **组合推荐**：一个月付 + 一个不限时 = 最稳方案

## 客户端


| 平台      | 推荐                               |
| ------- | -------------------------------- |
| macOS   | Clash Verge Rev                  |
| iOS     | Shadowrocket                     |
| Android | NekoBox / Clash Meta for Android |
| Windows | Clash Verge Rev / V2rayN         |


---

## 主流 VPN 协议对比

选择合适的代理协议是科学上网的第一步。以下是 2026 年最主流的四种协议在**加密方式、抗封锁能力、性能表现、跨平台支持**四个维度的系统对比：

| 维度 | Shadowsocks (SS) | V2Ray (VMess/VLESS) | Trojan | WireGuard |
| --- | --- | --- | --- | --- |
| **加密方式** | AEAD (ChaCha20-Poly1305 / AES-256-GCM) | VMess: AES-128-GCM; VLESS: 无内置加密（依赖 TLS） | TLS 1.3（伪装为 HTTPS 流量） | ChaCha20-Poly1305 / Curve25519 |
| **流量特征** | 特征明显，易被 DPI 识别 | VMess 有特征；VLESS+XTLS 几乎无特征 | 与正常 HTTPS 网站流量完全一致 | 有独特握手特征，需搭配隧道 |
| **抗封锁能力** | ⭐⭐⭐ 中等（需配合插件 obfs） | ⭐⭐⭐⭐ 较强（VLESS+Reality 极强） | ⭐⭐⭐⭐⭐ 极强 | ⭐⭐⭐ 中等（裸连易被识别） |
| **速度表现** | ⭐⭐⭐⭐ 快（轻量级） | ⭐⭐⭐ 中等（VMess 开销较大） | ⭐⭐⭐⭐ 快（基于 TLS 直连） | ⭐⭐⭐⭐⭐ 极快（内核级实现） |
| **延迟表现** | 中等 | VMess 较高；VLESS 较低 | 低 | 极低（<50ms 常见） |
| **资源消耗** | 极低 | 较高（尤其 VMess） | 低 | 极低（内核模块） |
| **服务端部署** | 简单（单二进制） | 复杂（需 Xray-core 等） | 中等（需域名+证书） | 中等（需内核模块） |
| **跨平台支持** | 全平台 | 全平台 | 全平台 | Linux/macOS/Windows/iOS/Android |
| **机场支持率** | ⭐⭐⭐⭐⭐ 广泛 | ⭐⭐⭐⭐⭐ 广泛 | ⭐⭐⭐⭐ 较多 | ⭐⭐ 较少 |
| **推荐场景** | 日常翻墙、入门用户 | 追求安全性和灵活性 | 高度封锁地区首选 | 自建服务器、低延迟需求 |

### 协议选型建议

- **新手入门**：直接用机场提供的 **Trojan** 或 **VLESS+Reality** 节点，开箱即用
- **自建服务器**：推荐 **Xray-core + VLESS+Reality** 或 **WireGuard**，前者抗封锁，后者速度最快
- **极度封锁环境**：首选 **Trojan**，次选 **VLESS+Reality**
- **追求极致速度**：**WireGuard** > Shadowsocks > Trojan > VMess
- **机场用户**：不必纠结协议，选择节点覆盖广、延迟低的机场即可，客户端自动适配

### 协议安全漏洞与历史事件

| 协议 | 已知安全事件 | 影响 |
| --- | --- | --- |
| Shadowsocks | 2019 年被 GFW 利用重放攻击识别流量 | 已在 Shadowsocks 2022 补丁中修复（AEAD） |
| VMess | 2020 年被发现时间戳验证漏洞可被探测 | 升级 Xray-core 并开启 `alterId: 0` 可修复 |
| Trojan | 无重大安全事件 | 设计简洁，攻击面小 |
| WireGuard | 内核实现审计通过 | Cryptokey Routing 设计安全性高 |

---

## 常见客户端配置详解

### 1. Clash Verge Rev（macOS / Windows / Linux 推荐）

Clash Verge Rev 是目前最流行的跨平台 GUI 客户端，基于 Clash Meta 内核，支持多种协议：

**基础配置步骤：**

1. 下载安装：从 [GitHub Releases](https://github.com/clash-verge-rev/clash-verge-rev/releases) 下载对应平台安装包
2. 导入订阅：打开设置 → 订阅 → 粘贴机场提供的订阅链接 → 点击导入
3. 选择节点：在代理面板中选择延迟最低的节点
4. 启用系统代理：点击「系统代理」开关，即可全局代理

**config.yaml 核心配置示例：**

```yaml
# 基础端口配置
port: 7890
socks-port: 7891
mixed-port: 7892
allow-lan: false
mode: rule
log-level: info

# DNS 配置（推荐使用 fake-ip 模式提升速度）
dns:
  enable: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  fallback:
    - https://1.1.1.1/dns-query
    - https://dns.google/dns-query
  fallback-filter:
    geoip: true
    geoip-code: CN

# 规则模式推荐
mode: rule  # 规则模式（推荐），global（全局），direct（直连）
```

**进阶技巧：**

- **规则分流**：使用 ACL4SSR 等规则集实现国内直连、国外代理的智能分流
- **TUN 模式**：在设置中开启 TUN 模式可代理所有应用（包括终端命令行）
- **覆写脚本（Mixin）**：通过 JavaScript 覆写脚本自定义规则，无需手动编辑 YAML

### 2. Shadowrocket（iOS 推荐）

俗称「小火箭」，iOS 平台最经典的代理客户端，App Store 售价 $2.99：

**配置步骤：**

1. 在 App Store 购买并安装 Shadowrocket
2. 复制机场的订阅链接
3. 打开 Shadowrocket → 配置 → 粘贴订阅 URL → 下载配置
4. 返回首页选择节点 → 打开连接开关

**实用配置建议：**

- **全局路由**：选择「配置」模式（基于规则分流），避免国内流量走代理

### 3. V2rayN（Windows 推荐）

Windows 平台功能最全面的客户端，支持 VMess/VLESS/Trojan/SS 等多种协议：

**配置步骤：**

1. 从 [GitHub Releases](https://github.com/2dust/v2rayN/releases) 下载最新版
2. 解压运行 → 右键托盘图标 → 订阅设置 → 添加订阅链接
3. 更新订阅 → 选择节点 → 启用系统代理

**进阶设置：**

```text
核心设置：
  - 路由模式：绕过大陆（推荐）
  - DNS 模式：DoH（推荐使用阿里 DNS 或 Cloudflare）
  - Mux 多路复用：关闭（现代协议已内置多路复用）
  - 额外参数：--loglevel warning（减少日志输出）
```

---

## 连接失败排查指南

### 排查流程图

```text
连接失败
  ├── 1. 检查订阅是否过期？→ 更新订阅
  ├── 2. 检查节点是否存活？→ 切换节点测试
  ├── 3. 检查系统代理设置？→ 确认代理端口正确
  ├── 4. 检查防火墙/杀毒？→ 临时关闭测试
  ├── 5. 检查网络环境？→ 切换 WiFi/4G 测试
  └── 6. 检查客户端版本？→ 更新到最新版
```

### 常见问题与解决方案

#### 问题 1：订阅更新失败

**症状**：提示「无法解析订阅」或导入后无节点

**排查步骤：**

1. 确认订阅链接是否过期，登录机场面板重新获取
2. 尝试在浏览器中直接打开订阅链接，检查是否返回正常内容
3. 检查是否需要手动 URL 编码（部分机场链接含特殊字符）
4. 使用「导入」而非「更新」，清除旧订阅后重新导入

#### 问题 2：连接成功但无法访问 Google/YouTube

**症状**：代理已开启，国内网站正常，但 Google 等国外网站打不开

**排查步骤：**

1. 切换其他节点测试（当前节点可能被封 IP）
2. 检查 DNS 设置：尝试切换为 `8.8.8.8` 或 `1.1.1.1`
3. 关闭浏览器的 DNS 缓存（Chrome 地址栏输入 `chrome://net-internals/#dns` 清除）
4. 检查是否走了直连规则：在客户端日志中查看目标域名的匹配规则

#### 问题 3：速度极慢或频繁断连

**症状**：能连接但速度 <100KB/s，或每隔几分钟断开

**排查步骤：**

1. 测试节点延迟：在客户端中测试所有节点的延迟，选择 <200ms 的节点
2. 检查倍率是否正确：部分机场节点有倍率 >1，实际消耗流量更多
3. 切换协议：WireGuard > Trojan > SS > VMess（速度排序）
4. 尝试关闭「UDP 转发」功能（部分网络环境下会导致不稳定）
5. 联系机场客服：可能是高峰期限速或节点维护

#### 问题 4：macOS 上 Clash Verge Rev 无法启动

**症状**：双击图标无反应，或闪退

**排查步骤：**

1. 检查 macOS 安全设置：系统偏好设置 → 安全性与隐私 → 允许打开
2. 删除配置缓存：`rm -rf ~/.config/clash-verge-rev/*.yaml`
3. 检查端口占用：`lsof -i :7890` 确认端口未被其他程序占用
4. 更新到最新版本：旧版可能与新版 macOS 不兼容

#### 问题 5：手机端无法连接但电脑正常

**排查步骤：**

1. 确认手机和电脑在同一网络（部分公共 WiFi 会封锁代理端口）
2. 检查手机 VPN 权限：设置 → VPN → 确认已授权
3. Shadowrocket 用户：检查「全局路由」是否为「配置」模式
4. 尝试更换连接端口：443 > 80 > 8443

### 常见踩坑案例

**案例 1：Clash 与 Surge 同时运行冲突**

> 同时运行 Clash Verge Rev 和 Surge 会导致代理端口冲突（默认都是 7890），表现为浏览器无法上网。解决方法：修改其中一个客户端的端口号，或只保留一个运行。

**案例 2：公司网络封锁代理**

> 部分公司/学校网络会通过 DPI 深度包检测封锁代理流量。表现：机场节点全部超时，但手机 4G 正常。解决方法：选择 Trojan 协议节点，或使用 VLESS+Reality 节点（伪装为正常 HTTPS 流量）。

**案例 3：路由器代理后局域网设备无法直连**

> 在路由器层面配置代理后，局域网内的 AirDrop、打印机、智能家居设备可能无法发现。解决方法：在路由器的代理规则中添加局域网 IP 段 `192.168.0.0/16`、`10.0.0.0/8` 为直连规则。

---

## macOS 代理工具推荐配置

### 方案一：Clash Verge Rev（推荐，小白友好）

```text
推荐配置：
  - 端口：7890（HTTP）/ 7891（SOCKS5）/ 7892（Mixed）
  - 模式：Rule（规则分流）
  - TUN 模式：开启（可代理终端、Git 等命令行工具）
  - DNS：fake-ip 模式 + 阿里 DoH
  - 规则集：ACL4SSR（国内直连，国外代理）
```

**终端代理配置（配合 TUN 模式或手动设置）：**

```bash
# 在 ~/.zshrc 中添加
export http_proxy=http://127.0.0.1:7890
export https_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7891

# Git 代理配置
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
```

### 方案二：Surge（进阶用户，功能强大）

> Surge 是 macOS/iOS 上功能最强大的网络调试和代理工具，适合开发者和进阶用户。价格较高（$49.99 起），但功能远超 Clash。

**Surge 核心优势：**

- 原生支持 HTTP 抓包和请求重写
- 支持增强模式（Enhanced Mode）代理所有应用
- 低内存占用，稳定性极佳
- 支持 iCloud 同步配置

### 方案三：Proxifier（仅代理特定应用）

> 如果你只想让特定应用走代理（如只让浏览器翻墙，其他应用直连），Proxifier 是最佳选择。支持按进程名、按 IP 段设置不同的代理规则。

### 方案对比

| 特性 | Clash Verge Rev | Surge | Proxifier |
| --- | --- | --- | --- |
| 价格 | 免费开源 | $49.99+ | $39.95 |
| 协议支持 | SS/VMess/VLESS/Trojan/WG 等 | SS/Trojan/WG 等 | 需配合其他客户端 |
| 抓包能力 | 无 | 内置 | 无 |
| TUN 模式 | ✅ | ✅ | ✅ |
| 规则灵活性 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| 上手难度 | 简单 | 中等 | 中等 |
| 推荐人群 | 普通用户、开发者 | 开发者、网络调试 | 特定应用代理需求 |

### macOS 系统代理设置

```bash
# 命令行设置 HTTP 代理
networksetup -setwebproxy "Wi-Fi" 127.0.0.1 7890
networksetup -setsecurewebproxy "Wi-Fi" 127.0.0.1 7890
networksetup -setsocksfirewallproxy "Wi-Fi" 127.0.0.1 7891

# 关闭代理
networksetup -setwebproxystate "Wi-Fi" off
networksetup -setsecurewebproxystate "Wi-Fi" off
networksetup -setsocksfirewallproxystate "Wi-Fi" off
```

> 💡 **提示**：如果你使用 Clash Verge Rev 并开启了系统代理，以上命令会自动设置。只有在排查问题时才需要手动调整。

---

## 机场选购深度指南

### 直连 vs 中转 vs 专线 区别

| 类型 | 原理 | 速度 | 稳定性 | 价格 | 适合人群 |
| --- | --- | --- | --- | --- | --- |
| **直连** | 客户端直接连接境外节点 | 受国际带宽影响 | 一般 | 低 | 预算有限、轻度使用 |
| **中转** | 经过国内中转服务器再出境 | 较快（中转优化路由） | 较好 | 中 | 日常使用、追求体验 |
| **专线 (IEPL/IPLC)** | 企业级专线通道 | 极快且稳定 | 极好 | 高 | 重度用户、开发者、对稳定性要求高 |

### 机场评分维度

选择机场时，建议从以下维度综合评估：

1. **节点覆盖**：支持多少个国家/地区？是否有常用节点（日本、新加坡、美国、香港）
2. **协议支持**：是否支持 Trojan/VLESS 等新协议？（老旧 SS 可能被封）
3. **流媒体解锁**：是否支持 Netflix、Disney+、ChatGPT 等？
4. **倍率说明**：部分节点倍率 >1，实际消耗流量更多，需注意
5. **在线客服**：是否有工单系统或 Telegram 群组？
6. **退款政策**：是否支持不满意退款？（至少支持 24 小时内退款）
7. **历史口碑**：查看是否有跑路风险，选择运营 1 年以上的老机场

### 2026 年值得关注的趋势

- **VLESS+Reality** 正在取代 VMess，成为新标准
- **AnyTLS** 协议开始出现，部分机场开始支持
- **AI 用途**推动高端专线需求增长（ChatGPT/Claude 对 IP 质量要求高）
- **跑路风险**：年付机场跑路事件频发，强烈建议月付或不限时小包

---

## 历史收藏（早期整理）

> 注：以下机场信息整理于 2022 年，部分可能已过期或跑路，请以实际为准。

| 机场 | 类型 | 月付 | 流量 | 时长 | 备注 |
| --- | --- | --- | --- | --- | --- |
| [QuickQ](https://www.quickq.io/apps?code=***) | 中转 | $15 | - | 30天 | ⭐️ |
| [Veee](https://veee401.vip/register) | 中转 | $12.99 | - | 90天 | ⭐️ |
| [追風島](https://zfd.ink/auth/register?code=***) | 中转 | ¥19 | 1000GB | 30天 | ⭐️⭐️ |
| [CGRAY](https://portal.cgray.net/#/auth/register?code=MNs0IMkE&intro=) | 中转 | ¥16 | 80GB | 30天 | ⭐️⭐️ |
| [AgentNEO](https://agneo.co/?rc=w5d9uyle) | 中转 | ¥18 | 20GB | 30天 | ⭐️⭐️ |
| [RABBITPRO](https://rabbitpro.net/) | 中转 | ¥29 | 200GB | 30天 | ⭐️⭐️ |
| [Conyss](https://conyss.com/#/register?code=93OpmlRN) | 中转 | ¥30 | 20GB | 30天 | ⭐️⭐️ |
| [超跑](https://paoche.info/#/register?code=7xRwd9ZX) | 中转 | ¥9.9 | 30GB | 30天 | ⭐️⭐️⭐️ |
| [Hutao](https://hutao.cloud/auth/register?code=***) | 中转 | ¥9 | 50GB | 31天 | ⭐️⭐️⭐️ |
| [魔戒](https://mojie.cyou/#/register?code=JpioTJTy) | - | ¥1 | 1GB | 不限时 | ⭐️⭐️⭐️⭐️⭐️ |

---

## 相关阅读

- [2026 科学上网机场推荐大全](/categories/Misc/airport/) — 60+ 机场分类评测，涵盖免费试用、低价入门、性价比均衡、高端专线四大类
- [JetBrains系列产品激活方法](/categories/Misc/jetbrains/) — PhpStorm、WebStorm、GoLand 等 JetBrains 全家桶激活配置指南
