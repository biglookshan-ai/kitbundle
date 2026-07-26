# 进度 · KitBundle

- **状态**: 公开分发(App Store)· **已部署到正式店铺 cinegearpro,真实测试中** · App Store 待提审
- **进度**: 88%
- **一句话**: Bundle & Add-on 的 **Function 版**,拆成可上架 Shopify App Store 的独立公开 app(公开分发用 Function 不要求商家 Plus)—— bundle / 配件加购 / 赠品 折扣 + Billing 订阅 + freemium gating。**已装上 cinegearpro 正式店铺开始实测。**
- **分类**: Shopify App

## 🔨 进行中
- **正式店铺(cinegearpro)真实测试** —— 收集反馈、修实际环境暴露的问题
- App 样式设置继续完善、与主题/其它插件的兼容打磨
- App Store 提审前收尾:Railway 设 `SHOPIFY_BILLING_TEST=false`、listing 图、演示店示例 bundle

## ⏭ 下一步
- 正式店铺测试通过 → 提交 App Store 审核 → 上架
- 上架后:真实商家安装/计费验证、性能与评价跟进

## 🏁 最近完成
- **2026-07-24 上线安装到 cinegearpro 正式店铺,开始真实测试**:
  - **兼容 Stock Availability 插件** —— 同步显示库存信息
  - 同步显示 **Pick-Up(自提)信息**
  - 更新**购物车按钮样式**
  - 新增 **App 样式设置**(初步:主题色、激活色等)
- **07-20 计费/修复**:Pro 计划改 **$29/月 + 7 天试用**(原 $9.99/14 天);修 discount 状态误显示 "Not active"
- **beta1**(07-17~07-20,48 提交):
  - Phase1:从 bundle-addon-app fork,独立 app + Function 扩展;**非 Plus dev store Function 折扣验证通过**(购物车三件全打折);合规 webhook
  - Phase2:afterAuth 自动激活 Function 折扣(ensureFunctionDiscount)、删原生折扣 accessories 系、品牌化标题、干净卸载、非 Dawn 主题购物车兜底
  - Phase3:Billing API(Pro $9.99/月 + 14 天试用)、freemium 服务端 gating(Free=1产品+1赠品)、隐私政策公开页、listing 文案初稿、FREE_SHOPS 白名单(自家店免费)
