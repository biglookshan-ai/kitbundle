# KitBundle — Search Engine Integration (bundles as searchable results)

Bundles are NOT Shopify variants, so they won't appear in native/variant search.
KitBundle makes them findable in two complementary ways:

1. **Native / third-party search works out of the box.** Every live bundle's
   **code** is written to the owning product as a **product tag** on save. Native
   Shopify search (and most search apps) index tags, so a shopper who searches the
   code finds the product — no search-engine changes required.
2. **A custom search engine can index bundles as first-class results** by reading
   the `custom.addon_config` metafield (below) and linking with the deep-link.

Bundle codes are **merchant-defined and required** (no more random codes) and are
uppercase A–Z / 0–9 / dashes. The same code appears:

- on the storefront bundle card (a small chip);
- as a **product tag** (so search finds it);
- in the **discount message** on the cart line and the order, e.g.
  `Bundle1 · KUEAJC · limited 45% off` — this rides in the Function's discount, so
  the name + code show only while the kit is complete and vanish the instant a
  bundle item is removed (no stale label on a broken kit);
- as the `?kb_bundle=` deep-link value.

(There is deliberately **no** static line-item property for the code: a fixed
property would linger after the kit breaks. Everything customer-facing is tied to
the live discount instead.)

## 1. Where the bundle data lives

Each configured product carries the JSON metafield:

- **namespace:** `custom`
- **key:** `addon_config`
- **type:** `json`

Shape (only the bundle-relevant fields shown):

```json
{
  "groups": [
    {
      "id": "g_ab12cd",
      "code": "CREATOR-KIT",        // merchant-defined, required, also a product tag
      "title": "Creator Kit",       // bundle name (show in results)
      "type": "bundle",             // index only type === "bundle"
      "discountPercent": 20,        // standing % off the kit
      "archived": false,            // skip if true
      "accessories": [              // the kit's components
        { "productId": "gid://shopify/Product/123", "handle": "cine-lens-50", "title": "..." }
      ],
      "limited": {                  // optional running sale (may be absent)
        "enabled": true,
        "discountPercent": 45,
        "startsAt": "2026-07-18T00:00:00Z",
        "endsAt": "2026-07-25T00:00:00Z",
        "mode": "revert"           // "revert" | "end"
      }
    }
  ]
}
```

Index a group as a bundle result when `type === "bundle"` and `archived !== true`.
Useful fields per result: `title`, `code`, the owning product (handle + title),
`discountPercent` (or `limited.discountPercent` while the sale window is live),
and the component product ids/handles.

### How to read it across the catalog
Storefront/Admin GraphQL, per product:

```graphql
product(id: $id) {
  handle
  title
  metafield(namespace: "custom", key: "addon_config") { value }
}
```

Parse `value` (JSON string) → iterate `groups`. To enumerate every product that
has bundles, query products with that metafield (Admin `products` + metafield, or
a bulk operation).

## 2. Linking a result to the selected bundle (deep link)

Link each bundle result to its product page with the `kb_bundle` query param set
to the bundle **code** (or its `id`):

```
/products/<product-handle>?kb_bundle=<code>
```

Example: `/products/cinema-camera-x1?kb_bundle=CREATOR-KIT`

When the product page loads, KitBundle's storefront script reads `kb_bundle`,
**auto-selects that bundle**, scrolls to it and flashes it — so the shopper lands
exactly on the kit they searched for.

The exact deep-link is also shown in the app: Product editor → a bundle card →
“Search deep-link”.

## Notes
- The `code` is merchant-defined and required; prefer it over `id` in result URLs.
  It's also a product tag, so plain storefront search finds it with no extra work.
- A sale bundle (`limited.enabled` + within window) is deeper than the standing
  `discountPercent`; show the deeper price while `startsAt ≤ now < endsAt`.
- `limited.mode === "end"` means the bundle disappears after `endsAt` — you may
  want to drop it from the index at that point.
