# Included 产品页卡片显示开关

日期：2026-11-21。状态：本地开发和验证完成，尚未上线。

## 使用方式

Free gifts → 编辑活动 → Storefront → 选择 **Included with the product (like a bundle)**，
在下面打开 / 关闭 **Show Includes card on the product page**，再保存活动。

- 默认开启，现有活动继续显示 Includes 卡片。
- 关闭仅隐藏此活动的产品页卡片；自动带部件、按主品数量同步、主品删除联动、
  不单卖标记、结账规则和款式 / 优先级限制不变。
- 只在 Included 模式下显示开关；普通赠品仍保留选择和 No thanks。
- 复制活动保留开关选择，修改记录会记录显示 / 隐藏。

![后台开关（本地样例）](admin-switch.jpg)

## 实现范围

- `GiftCampaign.showIncludedCard`：数据库 Boolean，默认 true；新增迁移
  `20261121000000_included_card_visibility`。
- 活动读写、默认值、复制流程、修改历史与同步引擎贯通。
- 只在 Included 卡片关闭时向产品标记写入 `showIncludedCard:false`；
  原有未配置字段的标记继续显示，也避免默认情况下触发不必要的全店标记更新。
- 产品页先按原有有效期 / 款式 / 优先级规则计算活动，再过滤隐藏的 Includes 卡片。
  隐藏活动不从规则源中移除，因此不会放出被它排除的其它活动，也不会影响部件加入购物车。
- `cart-guard.js`、折扣和结账 Function、正式主题均未修改。

## 本地验证

- `node node_modules/vitest/vitest.mjs run --config vitest.config.mts`：25/25。
  覆盖保存 / 重新读取 / 开启恢复 / 复制草稿 / 旧数据默认值、产品标记同步以及修改历史。
- `node tests/cart-guard-gifts.sim.mjs`：14/14。
  包含隐藏卡片后仍自动带部件、部件不能独立删除、主品数量及删除同步。
- 本地 Chrome 使用真实 `addon-save.js` 和样例产品验证 6/6：
  旧标记显示、开关开启显示、关闭隐藏、关闭时普通赠品仍显示、隐藏独占活动仍抑制其它赠品、
  普通赠品忽略 Includes 显示字段。
- 真实后台组件预览：只在 Included 模式下出现开关，旧数据默认开启，可以关闭。
- `node --check extensions/addon-block/assets/addon-save.js`、Prisma validate / generate、
  `npm run build`、业务源文件 ESLint、`git diff --check` 通过。
  Prisma 校验和生成使用命令级的本地假数据库地址，没有连接正式数据库。
- 构建有既有 Polaris CSS 媒体查询警告；不影响构建结果。
- 测试文件的 ESLint 配置会按 Jest 加载 Vitest 文件并报找不到 Jest；单独关闭该检查后，
  既有 `engine.test.ts` / `history.test.ts` 还会触发原有 mock 后 import 的 `import/first`。
  本次未修改全局 lint 配置；新增测试文件调整为顶部 import 后单独检查通过。

## 待用户确认后的发布

本次没有执行 git push、app deploy / release、正式数据库写入或活动保存。

发布需要同时更新 Railway 后台（含上述新增字段的迁移）和 Shopify 前台扩展。
应先检查并完成数据库 / 后台更新，再发布前台扩展、核对静态资源加载，最后在活动编辑页验证
开关保存和产品页显示；不要仅发布后台便认为前台已生效。现有活动全部默认显示，无需批量改活动。

不需要推主题，也不需要改折扣 / gift-guard 的逻辑；此次不会替用户关闭截图中的正式活动。
如果上线后只需恢复卡片，在该活动打开开关并保存即可。
