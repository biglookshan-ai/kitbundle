# KitBundle — App Store listing content

Copy-paste into the Dev Dashboard → “Create your listing content (English)”.
Character limits noted per field (Shopify’s current limits). Avoids superlatives
(“best”, “#1”), competitor names, and starting with the app name — per Shopify
content rules.

---

## App name (max 30)
```
KitBundle
```

## App icon
Use the yellow box icon (1200×1200 PNG, already made).

## App introduction (max 100 — one sentence, the core benefit)
```
Sell product bundles, add-ons and free gifts with automatic checkout discounts — no code.
```
(89 chars)

## App card subtitle (max 62 — shown under the name in search)
```
Bundles, add-ons and free gifts with automatic discounts
```
(55 chars)

## App details (MAX 500 chars; no "free"/"offer"/"price" as pricing refs)
```
KitBundle turns any product page into a kit builder. Group products into a bundle at one discount, add optional accessories with their own discounts, and reward shoppers with a gift.

Discounts apply automatically at checkout via Shopify Functions — no codes for customers, no theme coding. Add the KitBundle block to your product template and you're live.

Run limited-time bundles with a countdown that revert or hide when they end. Give each bundle a searchable code and show whole-kit stock.
```
(495 chars. "free gift" → "gift", "price" → "discounts", "offer" → "add" to
pass the review tip; the free-gift benefit is carried by the category tag +
feature list instead.)

## Key features (3–5; each title ≤ 80 chars, no ending period)
```
1. Bundle products into a kit with one automatic discount on the whole set
2. Product-page add-ons, each at its own discount — or free
3. Free gift with purchase: auto-added or shopper’s choice, with an opt-out
4. Limited-time bundles with a countdown that revert or hide when they end
5. Searchable bundle codes and stock-aware hiding when items sell out
```

## Pricing
```
Free
```
(Single free plan. No charges.)

## Primary category
```
Discounts
```
## Secondary category
```
Merchandising
```

## Search terms (up to 5, ≤ 20 chars each)
```
bundle
product bundles
add-ons
free gift
volume discount
```

## Languages
```
English
```

## Privacy policy URL
```
https://addon-discount-production-bb4d.up.railway.app/privacy
```

## Support email
```
biglookshan@gmail.com
```

## Install requirements (what the merchant needs)
```
- An Online Store 2.0 theme (to add the app block to the product template).
- No account or setup fees. No Shopify Plus required.
```

## Works with
```
Online Store
```

## Pricing plans (freemium — add BOTH public plans in the dashboard)
Free plan
- Name: `Free`  ·  Price: `$0`
- Features:
```
1 product with bundles & add-ons
1 free-gift campaign
Automatic discounts at checkout (no codes)
```
Pro plan
- Name: `Pro`  ·  Price: `$29` / month  ·  Free trial: `7 days`
- Features:
```
Unlimited products with bundles & add-ons
Unlimited free-gift campaigns
Limited-time offers with countdown
Works on any Shopify plan
```
(The developer's own store, cinegearpro, is comped to full access for free via
FREE_SHOPS — never charged. Billing goes through the Shopify Billing API only;
do NOT check "approval to charge outside the Billing API".)

## Optional fields — SKIP these (not required)
- Demo/screencast video → skip (screenshots are enough)
- FAQ → skip
- Tutorials / additional resources → skip
- Tracking information (UTM / install analytics) → skip
- Secondary languages → English only

---

## Demo store (for reviewers)
- Store URL: `https://kitbundle-dev.myshopify.com`
- Storefront password: `111`
- A product is already configured (5-inch On-Camera Monitor) with bundles,
  add-ons and a free-gift campaign, and the KitBundle block is added to the
  product template.

## Testing instructions for the reviewer (paste into the review notes)
```
KitBundle adds bundles, add-ons and free gifts to the product page, discounted
automatically at checkout via Shopify Functions (no codes).

Setup (already done on the demo store; steps for a fresh install):
1. Install the app. It auto-creates its automatic discount (afterAuth).
2. In the admin, open KitBundle → Products → configure a product:
   - Bundle tab: add accessories, set a discount, give it a code.
   - Add-on tab: add optional extras, each with its own discount.
   - Free gifts: create a campaign (trigger product → gift product(s)).
3. In the theme editor, add the “Bundle & Add-ons” app block to the product
   template (Online Store → Themes → Customize → product template).

To verify on the storefront (demo password: 111):
1. Open the configured product (5-inch On-Camera Monitor).
2. Select a bundle → Add to cart → the whole kit is discounted at checkout.
3. Add-ons show under the bundle, each with its own price.
4. The free-gift picker lets the shopper choose a gift or decline (“No thanks”).
5. Cart line discounts read e.g. “Bundle1 · CODE · 45% off”.
```

---

## Screenshots (min 3; each must be 1600×900 landscape)
Captured. Upload in this order (crop each to 1600×900 landscape — the full-page
captures are too tall; frame the KitBundle content):

1. Storefront — free-gift picker + Bundle card (struck prices, FREE, No thanks,
   45% OFF, countdown, stock). *Lead image.*
2. Storefront — Bundle expanded + Add-ons (component prices, add-on discounts).
3. Admin — product editor / Bundle tab (code, accessories, price calculator,
   limited-time 45%).
4. Admin — Free gifts campaign (Buy any of → Get free, picker prompt).
5. *(optional)* Admin — Add-on tab (per-item discounts, variants).

Cropping: each source shot is portrait/tall. Draw a 16:9 (1600×900) box over the
most important area and export. No personal data visible (demo store is fine).

---

## Notes
- “Protected customer data”: NOT required — the app stores only shop-level offer
  config + its own discount node ids (already declared “Doesn’t need access to
  protected customer data” in the dashboard).
- Mandatory compliance webhooks are implemented and return 401 on bad HMAC.
- App is free; no billing enabled, so no pricing details/CTA beyond the single
  Free plan.
