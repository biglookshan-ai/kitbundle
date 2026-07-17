# KitBundle — App Store 版总计划

Function 版折扣 app,公开分发上架 Shopify App Store(公开分发的 app 在**任何套餐**都能用 Function,这是整个项目的前提)。

官方要求原文:https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements

## 现状(Phase 1 已完成)
- [x] 独立仓库 `~/kitbundle/`(从 bundle-addon-app 复制,含 Function 扩展 `extensions/addon-discount/` 和全部 UI)
- [x] 合规 webhook:`customers/data_request` / `customers/redact` / `shop/redact` → `app/routes/webhooks.compliance.tsx`
- [x] 新 `shopify.app.toml` 模板(待 `shopify app config link` 填 client_id)
- [x] 新 Shopify app KitBundle(client_id f7b9d6e2…,Public distribution 已设)
- [x] GitHub github.com/biglookshan-ai/kitbundle + Railway(addon-discount-production-bb4d.up.railway.app,Postgres)
- [x] dev store kitbundle-dev.myshopify.com(非Plus+测试数据)安装并验证:Function 折扣在购物车/checkout 生效 ✅(2026-07-17)

## Phase 2 — 功能迁移(把新 UI 接回 Function 引擎)
现在仓库里有两套系统:
- **Function 版**(要保留为核心):`extensions/addon-discount/`(Function)、`app.products.$id.tsx`(bundle/addon 编辑器)、`app.gifts.*`(赠品活动)、`addon_save.liquid`
- **原生折扣版**(cinegearpro 专用,这个仓库里要移除):`app.accessories.*`、`accessory-config*.ts`、`accessory_select.liquid`

任务(2026-07-17 完成一批):
- [x] 安装后自动激活 Function 折扣(afterAuth hook → ensureFunctionDiscount;Discount settings 变为状态/修复页;首页加"折扣丢失"警示横幅)
- [x] 前台购物车刷新主题无关兜底(非 Dawn 主题:广播 cart:refresh 事件 + 整页刷新)
- [x] 移除原生折扣版代码(accessories 路由/模型/前台块)
- [x] 移除 CGP 专属 promo:* 标签写入(公开 app 不该动商家产品 tag)
- [x] 品牌化:折扣节点标题 CGP-LO/CGP-GIFT → KitBundle offer/gift;主折扣 "KitBundle discount"(兼容旧标题);block 名 "Bundle & Add-ons";卸载/shop_redact 全量清库
- [ ] (可选)前台 cgp-* CSS 类名改名 —— 顾客不可见,暂不动
2. 把 accessories 版做的**前台美化**(卡片、bundle tiles、缩略图条、View more、You save)移植到 Function 版前台 `addon_save.liquid`/JS
3. 把 accessories 版的**编辑器改进**(变体限定、主品变体联动、副标题、多 bundle 各自折扣率)确认 Function 版编辑器都有(大部分本来就有)
4. 购物车折扣名用 bundle 名(Function 的 discount title 同样可自定义)
5. 数据模型口径统一:一个 metafield 一套 config,Function 读同一 config

## Phase 3 — App Store 硬性要求清单
按官方 requirements 逐条:

**安装与认证**
- [ ] OAuth 立即触发,无中间页(模板已符合)
- [ ] 嵌入式 + 最新 App Bridge + session token 认证(shopify-app-remix 已符合)
- [ ] 卸载后重装正常(webhook 清 session 已有)

**合规**
- [x] 三个隐私 webhook(HMAC 验证由 authenticate.webhook 处理)
- [ ] 隐私政策 URL(需要写一份,放官网或 GitHub Pages)
- [ ] 数据最小化说明:本 app 不存客户个人数据,只存店铺配置

**计费**(如收费)
- [ ] 用 Shopify Billing API(managed pricing 或 appSubscriptionCreate),禁止外部收费
- [ ] 免费试用建议 7–14 天
- [ ] 决定定价:建议 freemium(N 个 bundle 免费,更多收月费)

**功能与质量**
- [ ] app 必须"开箱有用":安装后有引导(empty state 已有,需加 onboarding 步骤说明)
- [ ] 不得要求商家手动改主题代码:theme app extension 已符合(app embed/block)
- [ ] Lighthouse 性能:app 不能明显拖慢店面(前台 JS 已是懒加载单文件,需测)
- [ ] 错误状态处理、Polaris UI 规范(已用 Polaris)

**Listing 素材**
- [ ] app 名称(不能含 "Shopify")、图标 1200x1200、截图 1600x900 ×3+
- [ ] 简介/详细描述/定价说明(英文为主)
- [ ] 支持邮箱、支持 URL、隐私政策 URL
- [ ] 演示店(建议用 dev store 配好示例 bundle)

**提审**
- [ ] 审核测试说明(怎么装、怎么配一个 bundle、去哪看折扣)
- [ ] 测试账号(如需要)
- [ ] 常见拒审点:装完无功能引导、性能、计费绕过、权限过宽(我们只要 3 个 scope,OK)

## Phase 4 — 上架后
- 版本迭代走 `shopify app deploy`(扩展)+ Railway(后端)
- 关注审核反馈周期(通常 5–10 个工作日/轮)

## 你现在要做的三件事(我做不了的)
1. **创建 app**:在 `~/kitbundle/` 跑 `shopify app config link` → "Create new app" → 名字 kitbundle → 组织选你的;然后 Dev Dashboard 里把 Distribution 设为 **Public**
2. **GitHub**:新建空仓库(如 biglookshan-ai/kitbundle),告诉我地址,我来推
3. **Railway**:新项目 + Postgres 插件 + 环境变量(SHOPIFY_API_KEY/SECRET、SHOPIFY_APP_URL、DATABASE_URL、SCOPES),连 GitHub 仓库自动部署
