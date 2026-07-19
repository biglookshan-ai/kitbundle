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

## App details (main description — ~500–700 chars, benefit-first)
```
KitBundle turns any product page into a kit builder. Group products into a bundle sold together at one discount, offer optional add-ons that each carry their own price, and reward shoppers with a free gift when they buy.

Discounts are applied automatically at checkout by Shopify Functions — no discount codes for customers to enter, and no theme coding for you. Add the KitBundle block to your product template and you’re live.

Run limited-time bundles with a countdown that automatically revert to the normal price (or hide) when they end. Give every bundle a searchable code, show whole-kit stock, and hide offers when items sell out. Free gifts can be auto-added or picked by the shopper, who can also decline.
```

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

## Screenshots to capture (min 3, desktop 1600×900; a few mobile optional)
Take these in the admin and on the demo storefront:

1. **Storefront — Bundle & Save card** on the product page (kit price, “X% off”,
   countdown if limited, stock badge). *Most important — lead image.*
2. **Storefront — Free gift picker** (gift options with struck price + FREE, and
   the “No thanks” opt-out).
3. **Cart** with the bundle applied (line discounts “Bundle · CODE · % off”, free
   gift at $0).
4. **Admin — product editor** showing a configured bundle (code, accessories,
   the bundle price calculator).
5. **Admin — Dashboard or Bundles list** (offers grouped by type with codes).
6. *(optional)* **Admin — Free gifts campaign** (Buy any of → Get free).

Tip: use a product with a real image (the demo monitor works). Crop to 1600×900,
no personal data visible.

---

## Notes
- “Protected customer data”: NOT required — the app stores only shop-level offer
  config + its own discount node ids (already declared “Doesn’t need access to
  protected customer data” in the dashboard).
- Mandatory compliance webhooks are implemented and return 401 on bad HMAC.
- App is free; no billing enabled, so no pricing details/CTA beyond the single
  Free plan.
