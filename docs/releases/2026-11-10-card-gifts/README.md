# 2026-11-10 卡片 / 搜索加购自动带默认赠品(kitbundle-127,已上线)

> 用户 11/10 选「自动带上默认赠品」。代码提交 `a0f3714`,只改 `extensions/addon-block/assets/cart-guard.js`(全站购物车守卫)。

## 改了什么

主产品**不是在它自己的产品页**加进购物车时(合集卡片、搜索卡片、推荐、快速加购、别的 app),守卫把产品页默认勾选的赠品一起加上:

- 「全部送」活动:全部赠品;「选 N 个」活动:按顺序前 N 个有货的
- 用活动允许的款式、有货的款式;没货的赠品跳过
- 每买 1 件主产品送 1 套(按每个赠品的数量);同一个主产品再从卡片加一件 → 已有的赠品各加一套,不超过上限
- 行属性和产品页加的一样(`_cgp_gift` / `_cgp_main` / `_cgp_per` / `Free gift: with …` / 限时的 `Free until`),折扣程序照常算免费
- 客人在购物车删掉某个活动的赠品 → 本次浏览不再自动加这个活动的赠品(记在浏览器 sessionStorage `kbdecl:活动|主产品款式`)
- 产品自己的页面(有 KitBundle 区块)不管:那里由赠品选择器决定(包括 No thanks)

不改:折扣程序、结算拦截、后台、数据库、产品数据。

## 上线前

- 本地模拟 `node tests/cart-guard-gifts.sim.mjs`(假购物车 + 真守卫代码):11 个场景全过 —— 卡片加购带两个赠品且用允许的款式、第二次加购各加一套、表单式加购数量 2、删赠品后不再加回、不触发的款式不送、选 1 个时第一个没货改送第二个、没活动不加、自己产品页不加、产品页自带赠品不重复、删主产品赠品跟着删、包含配件照旧
- 折扣程序测试 44 个通过(没改)
- 上线前正式版本:**kitbundle-126**

## 无损复位(1 分钟)

```bash
cd "~/Vibe Coding Dev/Shopify App/kitbundle"
npx shopify app release --version kitbundle-126
```

只换回上一版守卫脚本;购物车里已经自动加上的赠品还在(它们和产品页加的赠品一样,折扣程序照常判断),不影响任何数据。

## 上线后实测(正式店,kitbundle-127)

- 前台加载的是 `kitbundle-127/assets/cart-guard.js`
- PDMOVIE 合集页 Smart Fusion 卡片选「Smart Fusion + Motor」点加购 → 自动加上 Rod Ring(PD-RA-RG82,活动指定款式)+ Gear Ring,都是 £22.31 / £3.13 → £0,行属性 `_cgp_gift: camp_dieju9hy`、`_cgp_main: 57102666269050`、`Free gift: with PDMOVIE SMART FUSION … (Smart Fusion + Motor)`;侧边购物车里赠品排在主产品下面
- 删主产品 → 两个赠品一起删;购物车回到测试前一模一样(用户原有 7 件没动);删主产品不会记成「客人不要赠品」
