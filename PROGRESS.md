# 进度 · KitBundle

- **状态**: 公开分发(App Store)· beta1(功能完成,待提审)
- **进度**: 85%
- **一句话**: Bundle & Add-on 的 **Function 版**,拆成可上架 Shopify App Store 的独立公开 app(公开分发用 Function 不要求商家 Plus)—— bundle / 配件加购 / 赠品 折扣 + Billing 订阅 + freemium gating。
- **分类**: Shopify App

## 🔨 进行中
- App Store 提审前收尾:Railway 设 `SHOPIFY_BILLING_TEST=false`、做 listing 图(图标 1200²/feature 1600×900/截图×3)、演示店配示例 bundle

## ⏭ 下一步
- 提交 App Store 审核 → 上架
- 上架后:真实商家安装/计费验证、性能与评价跟进

## 🏁 最近完成
- **beta1**(07-17~07-20,48 提交):
  - Phase1:从 bundle-addon-app fork,独立 app + Function 扩展;**非 Plus dev store Function 折扣验证通过**(购物车三件全打折);合规 webhook
  - Phase2:afterAuth 自动激活 Function 折扣(ensureFunctionDiscount)、删原生折扣 accessories 系、品牌化标题、干净卸载、非 Dawn 主题购物车兜底
  - Phase3:Billing API(Pro $9.99/月 + 14 天试用)、freemium 服务端 gating(Free=1产品+1赠品)、隐私政策公开页、listing 文案初稿、FREE_SHOPS 白名单(自家店免费)
