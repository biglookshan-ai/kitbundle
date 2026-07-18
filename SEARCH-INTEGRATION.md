# KitBundle — Search Engine Integration (bundles as searchable results)

Bundles are NOT Shopify variants, so they won't appear in native/variant search.
But every bundle is fully described in a product metafield, and the storefront
supports a deep-link that pre-selects a bundle. That's enough for a custom search
engine to (1) index each bundle and (2) link a result straight to the selected
bundle on the product page.

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
      "code": "BDL-7QK2",          // stable, human-facing bundle code
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

Example: `/products/cinema-camera-x1?kb_bundle=BDL-7QK2`

When the product page loads, KitBundle's storefront script reads `kb_bundle`,
**auto-selects that bundle**, scrolls to it and flashes it — so the shopper lands
exactly on the kit they searched for.

The exact deep-link is also shown in the app: Product editor → a bundle card →
“Search deep-link”.

## Notes
- The `code` is stable across edits; prefer it over `id` in result URLs.
- A sale bundle (`limited.enabled` + within window) is deeper than the standing
  `discountPercent`; show the deeper price while `startsAt ≤ now < endsAt`.
- `limited.mode === "end"` means the bundle disappears after `endsAt` — you may
  want to drop it from the index at that point.
