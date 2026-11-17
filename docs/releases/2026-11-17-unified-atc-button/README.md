# 2026-11-17 · 统一加购按钮(KitBundle 部分)

**对比页**:同目录 `index.html`(改前 / 改后截图,1:1)。设计稿在 `docs/review/unified-atc-button/index.html`。

普通产品和 KitBundle 产品的加购按钮统一:黄底黑字、全大写、细体、无图标,hover 黑色从左划过字变白;左数量右按钮;按钮文字带总额并实时更新,有套装配件 / 加购配件 / 赠品时为「ADD N ITEMS TO CART - £总额」。

## KitBundle 改了什么
- `assets/addon-save.js`:总价框去掉、金额进按钮(`paintCta` / `ctaHead` / `fitCta`);数量框 + 按钮包成一行 `.cgp-buyrow`(脚本自己包,旧 block 也行);加购时转圈,加好直接回到实时文字(去掉「✓ Added to cart」);只读主题按钮的 `.product-form__submit-label`(主题按钮现在自带金额);autoAccent 不再抄字重 / 大小写 / 字距(按钮自带)
- `assets/addon-save.css`:文件末尾「UNIFIED ADD-TO-CART」一段
- `blocks/addon_save.liquid`:数量 + 按钮包进 `.cgp-buyrow`

件数 = 主产品或套装每一件 × 数量 + 加购配件 + 赠品;只有主产品 = ADD TO CART;预售 = PRE-ORDER NOW / PRE-ORDER N ITEMS;不能买 = 主题文字、不显示金额。有「No Bundle」卡片的产品数量在卡片上,按钮整行宽。

## 测试(测试主题 #186525057402,KitBundle 新代码以 `kbtest-addon-save.*` 临时资源换入页面)
- Smart Fusion:ADD TO CART - £65.00;选 + Motor(2 个赠品)→ ADD 3 ITEMS TO CART - £289.00;数量 2 → 6 items £578.00;No thanks → ADD TO CART - £289.00 ✅
- ColourFlex 选 Thunder 5 Kit → ADD 3 ITEMS TO CART - £49.19 ✅
- hover 划黑、加载转圈、手机两行(金额换行)、高度 47px 与主题一致 ✅
- 没在正式店真实加购(不动别人购物车);加购流程代码只改了按钮文字部分

## 上线
1. **先** KitBundle:`CI=1 shopify app deploy --allow-updates`(要用户确认)
2. **再** 主题:`buy-buttons.liquid` + `cgp-atc.css` + `cgp-atc.js` 推正式主题(主题仓库同名 release 文件夹)
   反过来的话中间旧 KitBundle 会把主题按钮的金额一起抄进去,显示成「ADD TO CART-£289.00」。

## 还原
- KitBundle:`npx shopify app release --version kitbundle-128`
- 主题:推主题仓库 `docs/releases/2026-11-17-unified-atc-button/before/snippets/buy-buttons.liquid`
- 测试主题上留着 `kbtest-addon-save.js/.css` 两个临时文件(没被引用,不影响),要删时再删
