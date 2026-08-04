/* Add On & Save — storefront behaviour (Moment-style staged selection).
 *
 * The customer SELECTS extras (they don't add to cart immediately), and a single
 * aggregate CTA adds the main product + everything selected in one go:
 *   - "addon"  group -> one toggleable card per accessory.
 *   - "bundle" group -> ONE named, expandable card whose products are added together.
 *
 * The CTA shows the discounted total ("what you'll pay"); the real discount is
 * applied at checkout by the product-discount Function. After adding, the
 * selection is cleared and the cart drawer opens. */
(function () {
  "use strict";

  var cache = {};

  function fetchProduct(handle) {
    if (cache[handle]) return cache[handle];
    cache[handle] = fetch("/products/" + handle + ".js", {
      headers: { Accept: "application/json" },
    })
      .then(function (r) {
        if (!r.ok) throw 0;
        return r.json();
      })
      .catch(function () {
        return null;
      });
    return cache[handle];
  }

  function money(cents, currency) {
    var amount = (cents || 0) / 100;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
      }).format(amount);
    } catch (e) {
      return "$" + amount.toFixed(2);
    }
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function discounted(cents, percent) {
    var p = Math.min(100, Math.max(0, Number(percent) || 0));
    return Math.round(cents * (1 - p / 100));
  }

  // A storefront product's id is numeric; config accessory ids are gids.
  function gidTail(id) {
    return String(id).split("/").pop();
  }

  function firstAvailableIn(list) {
    return (
      list.filter(function (v) {
        return v.available;
      })[0] || list[0]
    );
  }

  // Which variants this accessory offers the customer. Empty config = all.
  function offeredVariants(group, data) {
    var accs = (group && group.accessories) || [];
    var want = String(data.id);
    var cfg = null;
    for (var i = 0; i < accs.length; i++) {
      if (gidTail(accs[i].productId) === want) {
        cfg = accs[i];
        break;
      }
    }
    var all = data.variants || [];
    if (cfg && Array.isArray(cfg.variantIds) && cfg.variantIds.length) {
      var allow = {};
      cfg.variantIds.forEach(function (g) {
        allow[gidTail(g)] = true;
      });
      var filtered = all.filter(function (v) {
        return allow[String(v.id)];
      });
      if (filtered.length) return filtered;
    }
    return all;
  }

  // Stock helpers for the "hide when sold out" option (add-on / free groups).
  function accInStock(group, data) {
    return offeredVariants(group, data).some(function (v) {
      return v.available;
    });
  }
  function groupInStock(group) {
    return Promise.all(
      (group.accessories || []).map(function (a) {
        return fetchProduct(a.handle);
      }),
    ).then(function (datas) {
      return datas.some(function (d) {
        return d && accInStock(group, d);
      });
    });
  }

  // Effective % for one accessory in a group: its own override, else the group.
  function accPercentFor(group, productId) {
    var accs = (group && group.accessories) || [];
    var want = String(productId);
    for (var i = 0; i < accs.length; i++) {
      if (gidTail(accs[i].productId) === want) {
        var v = accs[i].discountPercent;
        return typeof v === "number" ? v : Number(group.discountPercent) || 0;
      }
    }
    return Number(group.discountPercent) || 0;
  }

  // /products/x.js returns `options` as strings (older) or {name,values} (current).
  function optionName(opt) {
    return typeof opt === "string" ? opt : (opt && opt.name) || "";
  }

  function hasVariants(data) {
    if (!data || !data.variants) return false;
    if (data.variants.length > 1) return true;
    var name = optionName((data.options || [])[0]);
    return name && name !== "Title";
  }

  function firstAvailable(data) {
    return (
      data.variants.filter(function (v) {
        return v.available;
      })[0] || data.variants[0]
    );
  }

  function optionValues(data, idx) {
    var seen = {},
      out = [];
    data.variants.forEach(function (v) {
      var val = v.options[idx];
      if (val != null && !seen[val]) {
        seen[val] = true;
        out.push(val);
      }
    });
    return out;
  }

  function readMainVariantId() {
    var input = document.querySelector(
      'form[action*="/cart/add"] [name="id"]:not([disabled])',
    );
    if (input && input.value) return input.value;
    var url = new URL(window.location.href);
    if (url.searchParams.get("variant")) return url.searchParams.get("variant");
    try {
      return (
        window.ShopifyAnalytics.meta.selectedVariantId ||
        window.ShopifyAnalytics.meta.product.variants[0].id
      );
    } catch (e) {
      return null;
    }
  }

  // Match the widget accent to the store's own add-to-cart button (spec: the
  // accent is dynamic — read from the theme button so selected states blend in).
  // Falls back to the block's accent setting when no button colour is found.
  function autoAccent(root) {
    try {
      var sels = [
        'form[action*="/cart/add"] [type="submit"]',
        ".product-form__submit",
        'button[name="add"]',
        "product-form button:not([disabled])",
      ];
      for (var i = 0; i < sels.length; i++) {
        var btn = document.querySelector(sels[i]);
        if (!btn) continue;
        var bg = getComputedStyle(btn).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
          root.style.setProperty("--cgp-accent", bg);
          return;
        }
      }
    } catch (e) {}
  }

  function init(root) {
    if (root.__cgpInit) return;
    root.__cgpInit = true;
    autoAccent(root);

    // Gift campaigns run independently of the per-product add-on config — a pure
    // trigger product has gifts but no addon_config.
    bootGifts(root);

    var node = root.querySelector("[data-cgp-config]");
    if (!node) return;
    var config;
    try {
      config = JSON.parse(node.textContent);
    } catch (e) {
      return;
    }
    var groups = (config && config.groups) || [];

    // Inventory map (handle -> total available, null = untracked). Emitted by
    // Liquid because the AJAX product JSON omits inventory_quantity.
    var inventory = {};
    var invNode = root.querySelector("[data-cgp-inventory]");
    if (invNode) {
      try {
        inventory = JSON.parse(invNode.textContent) || {};
      } catch (e) {
        inventory = {};
      }
    }

    var ctx = {
      root: root,
      inventory: inventory,
      currency: root.getAttribute("data-currency") || "USD",
      mainHandle: root.getAttribute("data-product-handle") || "",
      mainProductId: (root.getAttribute("data-product-id") || "").split("/").pop(),
      showStrike: root.getAttribute("data-show-strikethrough") !== "false",
      vatRate: parseFloat(root.getAttribute("data-vat-rate")) || 0,
      bundleLayout:
        root.getAttribute("data-bundle-layout") === "card" ? "card" : "list",
      showDefaultCard: root.getAttribute("data-default-card") !== "false",
      defaultLabel:
        root.getAttribute("data-default-label") || "Just the product",
      hasDefaultCard: false,
      modal: document.querySelector("[data-cgp-modal]"),
      cta: root.querySelector("[data-cgp-cta]"),
      summaryEl: root.querySelector("[data-cgp-summary]"),
      counterEl: root.querySelector("[data-cgp-counter]"),
      bundleCounterEl: root.querySelector("[data-cgp-bundle-counter]"),
      extras: new Map(), // key -> { kind, percent, items: [{id, price}] }
      freeItems: [], // { productId, title, current() } auto-added free gifts
      resetFns: [], // visual de-selectors, run after a successful add
      bundlePaints: [], // re-render hooks, run once the main product loads
      mainVarSync: [], // bundles re-sync their main variant on a page variant change
      bundleDeselectors: [], // per-bundle deselect fns (No Bundle ↔ bundle exclusivity)
      deselectDefaultCard: null, // set by the "No bundle" card to deselect itself
      mainData: null,
      mainInCart: false, // whether the main product is already in the cart
    };
    ctx.onChange = function () {
      updateCTA(ctx);
      updateCounter(ctx);
    };

    // Load the main product so bundles can show its thumbnail + total price.
    fetchProduct(ctx.mainHandle).then(function (d) {
      ctx.mainData = d;
      ctx.bundlePaints.forEach(function (fn) {
        try {
          fn();
        } catch (e) {}
      });
      updateCTA(ctx);
    });
    // Know whether the main is already in the cart, so the CTA counts honestly.
    refreshMainInCart(ctx);

    // Archived groups are soft-deleted: never render or discount them.
    var live = groups.filter(function (g) {
      return g && !g.archived;
    });
    var bundleGroups = live.filter(function (g) {
      return g.type === "bundle";
    });
    var freeGroups = live.filter(function (g) {
      return g.type === "free";
    });
    var addonGroups = live.filter(function (g) {
      return g.type !== "bundle" && g.type !== "free";
    });

    // Reset this main's free-gift requirements (used by the locked-restore).
    freeReqs = freeReqs.filter(function (r) {
      return r.mainId !== ctx.mainProductId;
    });

    renderBundles(ctx, bundleGroups, root);
    renderFree(ctx, freeGroups, root);
    renderAddons(ctx, addonGroups, root);
    setupModal(ctx.modal);
    setupCTA(ctx);
    updateCTA(ctx);

    // When the customer changes the main product variant on the page, let
    // bundles re-sync their main-variant picker/price.
    document.addEventListener(
      "change",
      function (e) {
        var t = e.target;
        if (
          t &&
          t.closest &&
          t.closest(
            'variant-selects, variant-radios, .product-form__input, form[action*="/cart/add"]',
          )
        ) {
          holdScroll(600); // theme re-renders media async on variant change
          setTimeout(function () {
            ctx.mainVarSync.forEach(function (fn) {
              try {
                fn();
              } catch (e) {}
            });
          }, 50);
        }
      },
      true,
    );

    var loading = root.querySelector("[data-cgp-loading]");
    if (loading) loading.style.display = "none";
  }

  /* ---------- Selection totals + CTA ---------- */

  function mainVariant(ctx) {
    var id = readMainVariantId();
    var d = ctx.mainData;
    if (d && d.variants) {
      var v =
        d.variants.filter(function (x) {
          return String(x.id) === String(id);
        })[0] || d.variants[0];
      return { id: v ? v.id : id, price: v ? v.price : d.price || 0 };
    }
    return { id: id, price: 0 };
  }

  function mainVariantObj(ctx, vid) {
    var d = ctx.mainData;
    if (!d || !d.variants) return null;
    return (
      d.variants.filter(function (x) {
        return String(x.id) === String(vid);
      })[0] || null
    );
  }

  // The main variant a bundle uses: the currently-selected one when it's allowed
  // (or the bundle has no restriction), otherwise the first allowed variant.
  function bundleMainVar(ctx, group) {
    var cur = mainVariant(ctx); // { id, price }
    var ids = group && group.mainVariantIds;
    if (!ids || !ids.length) return cur;
    var allow = ids.map(gidTail);
    if (allow.indexOf(String(cur.id)) >= 0) return cur;
    var v = mainVariantObj(ctx, allow[0]);
    return v ? { id: v.id, price: v.price } : cur;
  }

  // Switch the product page's main variant (image + price + picker) — used when a
  // bundle tied to a specific main variant is selected. Best-effort, Dawn-style.
  function selectMainVariant(ctx, vid) {
    var v = mainVariantObj(ctx, vid);
    if (!v) return;
    // 1. Drive the theme's own variant picker so it updates price + image itself.
    try {
      var opts = v.options || [];
      var groups = document.querySelectorAll(
        "variant-selects fieldset, variant-radios fieldset, .product-form__input",
      );
      opts.forEach(function (val, i) {
        var fs = groups[i];
        if (!fs) return;
        var radio = fs.querySelector('input[type="radio"][value="' + cssEsc(val) + '"]');
        if (radio && !radio.checked) {
          radio.checked = true;
          radio.dispatchEvent(new Event("change", { bubbles: true }));
        }
        var sel = fs.querySelector("select");
        if (sel && sel.value !== val) {
          sel.value = val;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    } catch (e) {}
    // 2. Hidden form id + URL (so add-to-cart / sharing reflect the variant).
    try {
      document
        .querySelectorAll('form[action*="/cart/add"] [name="id"]')
        .forEach(function (inp) {
          inp.value = v.id;
        });
      var url = new URL(window.location.href);
      url.searchParams.set("variant", v.id);
      window.history.replaceState({}, "", url);
    } catch (e) {}
    // 3. Fallback: swap the main gallery image directly.
    var img = v.featured_image && (v.featured_image.src || v.featured_image);
    if (img) {
      var main = document.querySelector(
        ".product__media-wrapper img, media-gallery img, .product__media img, .product-media img",
      );
      if (main) {
        main.src = img;
        main.removeAttribute("srcset");
      }
    }
  }

  function cssEsc(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, "\\$&");
  }

  // Pin the page scroll to its current Y for a short window. Driving the
  // theme's variant picker makes Dawn re-render the media/info section
  // asynchronously, which nudges the page down; a one-frame restore isn't
  // enough, so we re-pin every frame until the re-render settles.
  function holdScroll(ms) {
    var y = window.pageYOffset;
    var until = Date.now() + (ms || 500);
    (function loop() {
      if (window.pageYOffset !== y) window.scrollTo(0, y);
      if (Date.now() < until) requestAnimationFrame(loop);
    })();
  }

  function extrasCount(ctx) {
    var n = 0;
    ctx.extras.forEach(function (e) {
      n += e.items.length;
    });
    return n;
  }

  function itemPct(e, it) {
    return it.percent != null ? it.percent : e.percent;
  }

  function extrasTotal(ctx) {
    var t = 0;
    ctx.extras.forEach(function (e) {
      e.items.forEach(function (it) {
        t += discounted(it.price, itemPct(e, it));
      });
    });
    return t;
  }

  // Decide how many MAIN products and which accessory items an add should
  // include, given whether a main is already in the cart:
  //   - each BUNDLE is a complete kit and always brings its own main;
  //   - ADD-ONS share a single main (added only if none is present/added).
  function buildPlan(ctx, mainInCart) {
    // A bundle carries `offerId` only when its limited offer is live, so commit
    // tags it `_cgp_lo` and the time-gated node governs its deep price.
    var bundles = []; // [{ name, percent, offerId, items: [{id, price}] }]
    var addonItems = [];
    ctx.extras.forEach(function (e) {
      if (e.kind === "bundle") {
        bundles.push({
          name: e.title || "Bundle",
          code: e.code || "",
          percent: e.percent,
          qty: e.qty || 1,
          offerId: e.offerId || null,
          bid: e.bid || null,
          mainVariantId: e.mainVariantId || null,
          mainPrice: e.mainPrice || 0,
          mainPercent: e.mainPercent || 0,
          items: e.items.map(function (it) {
            return { id: it.id, price: it.price, percent: itemPct(e, it) };
          }),
        });
      } else if (e.kind === "main") {
        // The "just the product" default card — handled via mainsForAddons below.
      } else {
        var aq = e.qty || 1;
        e.items.forEach(function (it) {
          addonItems.push({
            id: it.id,
            price: it.price,
            percent: itemPct(e, it),
            qty: aq,
          });
        });
      }
    });
    // Every add-to-cart is a COMPLETE unit: it always brings a main product.
    //  - With the "just the product" default card: its selection drives how many
    //    plain mains to add (it also serves as the shared main for add-ons). When
    //    deselected, a main is only added if add-ons need one.
    //  - Without the default card (legacy): one shared main unless a bundle (which
    //    brings its own main) is the only thing selected.
    var mainSel = ctx.extras.get("main");
    var mainsForAddons;
    if (ctx.hasDefaultCard) {
      mainsForAddons = mainSel ? mainSel.qty || 1 : addonItems.length > 0 ? 1 : 0;
    } else {
      mainsForAddons = bundles.length === 0 ? 1 : 0;
    }
    return {
      bundles: bundles,
      addonItems: addonItems,
      mainsForAddons: mainsForAddons,
    };
  }

  function updateCTA(ctx) {
    var cta = ctx.cta;
    if (!cta) return;
    cta.hidden = false;
    var mv = mainVariant(ctx);
    var plan = buildPlan(ctx, ctx.mainInCart);
    var count = plan.mainsForAddons;
    var total = plan.mainsForAddons * (mv.price || 0);
    plan.addonItems.forEach(function (it) {
      var q = it.qty || 1;
      count += q;
      total += q * discounted(it.price, it.percent);
    });
    plan.bundles.forEach(function (b) {
      var q = b.qty || 1;
      // bundle's own main ×q (discounted only if the bundle opts in) + accessories
      count += q;
      total += q * discounted(b.mainPrice || mv.price || 0, b.mainPercent || 0);
      b.items.forEach(function (it) {
        count += q;
        total += q * discounted(it.price, it.percent);
      });
    });
    // Free gifts always ride along (count them, $0 to the total).
    count += ctx.freeItems.length;

    // Total summary lives ABOVE the button; the button label stays static so it
    // can carry Pre-Order / Sold-out states without us overwriting it.
    if (ctx.summaryEl) {
      ctx.summaryEl.innerHTML = "";
      if (count > 0) {
        ctx.summaryEl.hidden = false;
        ctx.summaryEl.appendChild(
          el(
            "span",
            "cgp-total__count",
            count + (count > 1 ? " items" : " item"),
          ),
        );
        ctx.summaryEl.appendChild(
          el("span", "cgp-total__price", money(total, ctx.currency)),
        );
      } else {
        ctx.summaryEl.hidden = true;
      }
    }
    if (!cta.classList.contains("is-done") && !cta.classList.contains("is-loading")) {
      cta.textContent = "Add to cart";
    }
  }

  function refreshMainInCart(ctx) {
    return fetch("/cart.js", { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (cart) {
        ctx.mainInCart = (cart.items || []).some(function (it) {
          return String(it.product_id) === ctx.mainProductId;
        });
        updateCTA(ctx);
      })
      .catch(function () {});
  }

  function updateCounter(ctx) {
    if (ctx.counterEl) {
      var n = 0,
        total = 0;
      ctx.extras.forEach(function (e) {
        if (e.kind !== "addon") return;
        var q = e.qty || 1;
        e.items.forEach(function (it) {
          n += q;
          total += q * discounted(it.price, itemPct(e, it));
        });
      });
      ctx.counterEl.innerHTML = "";
      if (n > 0) {
        ctx.counterEl.appendChild(
          el(
            "span",
            "cgp-addon__counter-n",
            "+" + n + " ADD-ON" + (n > 1 ? "S" : ""),
          ),
        );
        ctx.counterEl.appendChild(
          el("span", "cgp-addon__counter-price", money(total, ctx.currency)),
        );
      }
    }
    // Bundle counter mirrors the add-on one: count of selected bundles + their
    // whole total (main full price + discounted accessories).
    if (ctx.bundleCounterEl) {
      var bn = 0,
        btotal = 0;
      ctx.extras.forEach(function (e) {
        if (e.kind !== "bundle") return;
        var q = e.qty || 1;
        bn += q;
        btotal += q * discounted(e.mainPrice || 0, e.mainPercent || 0);
        e.items.forEach(function (it) {
          btotal += q * discounted(it.price, it.percent || 0);
        });
      });
      ctx.bundleCounterEl.innerHTML = "";
      if (bn > 0) {
        ctx.bundleCounterEl.appendChild(
          el(
            "span",
            "cgp-addon__counter-n",
            "+" + bn + " BUNDLE" + (bn > 1 ? "S" : ""),
          ),
        );
        ctx.bundleCounterEl.appendChild(
          el("span", "cgp-addon__counter-price", money(btotal, ctx.currency)),
        );
      }
    }
  }

  /* ---------- ADD-ON groups: tabbed grid of toggle cards ---------- */

  // An add-on group shows only when the current main variant is allowed (or the
  // group has no main-variant restriction).
  function addonGroupVisible(ctx, group) {
    var ids = group.mainVariantIds;
    if (!ids || !ids.length) return true;
    var cur = String(readMainVariantId());
    return (
      ids
        .map(gidTail)
        .indexOf(cur) >= 0
    );
  }

  function renderAddons(ctx, groups, root) {
    var wrap = root.querySelector("[data-cgp-addons]");
    if (!wrap || !groups.length) {
      if (wrap) wrap.hidden = true;
      return;
    }
    var tabsEl = wrap.querySelector("[data-cgp-tabs]");
    var gridEl = wrap.querySelector("[data-cgp-grid]");
    ctx.gridEl = gridEl;

    function paintAddons() {
      // Candidates = groups allowed for the current main variant. Then resolve
      // each group's stock (async, cached) so a fully sold-out "hide when sold
      // out" group drops out of the tabs entirely.
      var byMain = groups.filter(function (g) {
        return addonGroupVisible(ctx, g);
      });
      Promise.all(
        byMain.map(function (g) {
          return g.hideWhenSoldOut ? groupInStock(g) : Promise.resolve(true);
        }),
      ).then(function (stocks) {
        var visible = byMain.filter(function (_g, i) {
          return stocks[i];
        });
        // Drop selections from groups no longer shown (hidden or sold out).
        groups.forEach(function (g) {
          if (visible.indexOf(g) >= 0) return;
          (g.accessories || []).forEach(function (a) {
            ctx.extras.delete("addon:" + gidTail(a.productId));
          });
        });
        paintVisible(visible);
      });
    }

    function paintVisible(visible) {
      if (!visible.length) {
        wrap.hidden = true;
        tabsEl.innerHTML = "";
        gridEl.innerHTML = "";
        ctx.onChange();
        return;
      }
      wrap.hidden = false;
      tabsEl.innerHTML = "";
      if (visible.length > 1) {
        tabsEl.style.display = "";
        visible.forEach(function (group, i) {
          var tab = el("button", "cgp-tab", group.title || "Add-ons");
          tab.type = "button";
          if (i === 0) tab.classList.add("is-active");
          tab.addEventListener("click", function () {
            tabsEl.querySelectorAll(".cgp-tab").forEach(function (t) {
              t.classList.remove("is-active");
            });
            tab.classList.add("is-active");
            renderGroup(ctx, group);
          });
          tabsEl.appendChild(tab);
        });
      } else {
        tabsEl.style.display = "none";
      }
      renderGroup(ctx, visible[0]);
      ctx.onChange();
    }

    paintAddons();
    // Re-evaluate which add-on groups show when the page main variant changes.
    ctx.mainVarSync.push(paintAddons);
  }

  function renderGroup(ctx, group) {
    var grid = ctx.gridEl;
    grid.innerHTML = "";
    // Same card slider as the Bundle module (reuses its classes/styles).
    var slider = el(
      "div",
      "cgp-addon__bundle-list cgp-addon__bundle-list--cards",
    );
    grid.appendChild(slider);

    Promise.all(
      (group.accessories || []).map(function (a) {
        return fetchProduct(a.handle);
      }),
    ).then(function (datas) {
      datas.forEach(function (data) {
        if (!data) return;
        // "Hide when sold out": drop accessories with no available variant.
        if (group.hideWhenSoldOut && !accInStock(group, data)) return;
        slider.appendChild(renderAddonCard(ctx, group, data));
      });
      setupBundleSlider(slider); // 3 per view, scroll for more, nav buttons
    });
  }

  // Per-location stock for an add-on card (same source/statuses as bundles).
  function refreshAddonStock(card, handle, variantId) {
    fetchLocStock(handle).then(function (m) {
      if (!m || !m.variants || !Object.keys(m.variants).length) return;
      var vv = m.variants[String(variantId)];
      if (!vv) return;
      applyStockTo(
        card,
        stkStatusFrom(
          toInt(vv.uk_inv),
          toInt(vv.es_inv),
          toInt(vv.uk_inc),
          vv.policy === "continue" ? "continue" : "deny",
        ),
      );
    });
  }

  // One add-on as a CARD — same anatomy/style as a bundle card (badges, media,
  // name, price, quantity stepper + select circle). Single product, toggle
  // select; a multi-variant accessory needs a variant chosen before it adds.
  function renderAddonCard(ctx, group, data) {
    var percent = accPercentFor(group, data.id);
    var offered = offeredVariants(group, data);
    var multi = offered.length > 1;
    var key = "addon:" + data.id;
    var selected = false;
    var chosen = multi ? null : firstAvailableIn(offered);
    var qty = 1;

    var existing = ctx.extras.get(key);
    if (existing && existing.items && existing.items[0]) {
      var ev = offered.filter(function (v) {
        return String(v.id) === String(existing.items[0].id);
      })[0];
      if (ev) {
        chosen = ev;
        selected = true;
        qty = existing.qty || 1;
      }
    }

    var card = el(
      "div",
      "cgp-bundle cgp-bundle--card" + (selected ? " is-selected" : ""),
    );

    function store() {
      var v = chosen || (!multi ? offered[0] : null);
      if (!v) return;
      ctx.extras.set(key, {
        kind: "addon",
        percent: percent,
        qty: qty,
        items: [{ id: v.id, price: v.price }],
      });
    }
    function setSelected(on) {
      selected = on;
      card.classList.toggle("is-selected", on);
      var chk = card.querySelector(".cgp-check");
      if (chk) chk.classList.toggle("is-on", on);
      if (on) store();
      else ctx.extras.delete(key);
      ctx.onChange();
    }
    ctx.resetFns.push(function () {
      selected = false;
      qty = 1;
      card.classList.remove("is-selected");
      var chk = card.querySelector(".cgp-check");
      if (chk) chk.classList.remove("is-on");
    });
    function toggle() {
      if (selected) {
        setSelected(false);
        return;
      }
      if (multi && !chosen) {
        var s = card.querySelector(".cgp-bundle__variant");
        if (s) {
          s.classList.add("cgp-needs-choice");
          try {
            s.focus();
          } catch (e) {}
        }
        return;
      }
      setSelected(true);
    }

    function paint() {
      card.innerHTML = "";
      card.classList.toggle("is-selected", selected);
      var base = (chosen || offered[0] || data).price || 0;
      var now = discounted(base, percent);
      var saved = base - now;
      var offPct = percent > 0 ? Math.round(percent) : 0;
      var avail = offered.some(function (v) {
        return v && v.available;
      });

      var head = el("div", "cgp-bundle__head");
      var brow = el("div", "cgp-bundle__brow");
      brow.appendChild(
        offPct > 0
          ? el("span", "cgp-bundle__bdg cgp-bundle__bdg--off", offPct + "% OFF")
          : el("span"),
      );
      var sb = el(
        "span",
        "cgp-bundle__bdg cgp-stk--" + (avail ? "green" : "red"),
        avail ? "In Stock" : "Out of Stock",
      );
      sb.setAttribute("data-cgp-stock", "1");
      sb.setAttribute("data-cgp-base", "cgp-bundle__bdg");
      brow.appendChild(sb);
      head.appendChild(brow);

      var mediaEl = el("div", "cgp-bundle__media");
      var img =
        (chosen &&
          chosen.featured_image &&
          (chosen.featured_image.src || chosen.featured_image)) ||
        data.featured_image ||
        (data.images && data.images[0]);
      if (img) {
        var im = el("img", "cgp-bundle__media-single");
        im.src = img;
        im.alt = data.title;
        im.loading = "lazy";
        mediaEl.appendChild(im);
      }
      head.appendChild(mediaEl);

      var body = el("div", "cgp-bundle__body");
      var nameLine = el("div", "cgp-bundle__nameline");
      nameLine.appendChild(el("span", "cgp-bundle__name", data.title));
      body.appendChild(nameLine);

      var pr = el("div", "cgp-bundle__price");
      var nowS = el("span", "cgp-bundle__now");
      nowS.appendChild(document.createTextNode(money(now, ctx.currency)));
      if (ctx.vatRate > 0) nowS.appendChild(el("span", "cgp-bundle__vat", " ex VAT"));
      pr.appendChild(nowS);
      if (saved > 0 && ctx.showStrike) {
        var wasS = el("span", "cgp-bundle__was");
        wasS.appendChild(document.createTextNode(money(base, ctx.currency)));
        if (ctx.vatRate > 0) wasS.appendChild(el("span", "cgp-bundle__vat", " ex VAT"));
        pr.appendChild(wasS);
      }
      if (saved > 0) {
        var savedShown = ctx.vatRate > 0 ? saved * (1 + ctx.vatRate / 100) : saved;
        var saveSpan = el("span", "cgp-bundle__save");
        saveSpan.appendChild(
          document.createTextNode("Save " + money(savedShown, ctx.currency)),
        );
        if (ctx.vatRate > 0) saveSpan.appendChild(el("span", "cgp-bundle__vat", " inc VAT"));
        pr.appendChild(saveSpan);
      }
      body.appendChild(pr);

      // Variant picker (only if the accessory offers a choice).
      if (multi) {
        var selEl = el("select", "cgp-bundle__variant");
        var ph = el("option", null, "Choose an option…");
        ph.value = "";
        selEl.appendChild(ph);
        offered.forEach(function (v) {
          var o = el("option", null, v.title + (v.available ? "" : " — sold out"));
          o.value = v.id;
          if (!v.available) o.disabled = true;
          selEl.appendChild(o);
        });
        selEl.value = chosen ? String(chosen.id) : "";
        selEl.addEventListener("click", function (e) {
          e.stopPropagation();
        });
        selEl.addEventListener("change", function (e) {
          e.stopPropagation();
          chosen =
            offered.filter(function (x) {
              return String(x.id) === selEl.value;
            })[0] || null;
          if (selected) {
            if (chosen) store();
            else setSelected(false);
          }
          paint();
          ctx.onChange();
        });
        body.appendChild(selEl);
      }

      // Foot: quantity stepper (left) + select circle (right).
      var qtyWrap = el("div", "cgp-bundle__qty");
      var qMinus = el("button", "cgp-bundle__qtybtn", "−");
      qMinus.type = "button";
      var qNum = el("span", "cgp-bundle__qtyn", String(qty));
      var qPlus = el("button", "cgp-bundle__qtybtn", "+");
      qPlus.type = "button";
      qtyWrap.appendChild(qMinus);
      qtyWrap.appendChild(qNum);
      qtyWrap.appendChild(qPlus);
      function setQty(n) {
        qty = Math.max(1, n | 0);
        qNum.textContent = String(qty);
        if (selected) {
          store();
          ctx.onChange();
        }
      }
      qMinus.addEventListener("click", function (e) {
        e.stopPropagation();
        setQty(qty - 1);
      });
      qPlus.addEventListener("click", function (e) {
        e.stopPropagation();
        setQty(qty + 1);
      });

      var aside = el("div", "cgp-bundle__aside");
      aside.appendChild(el("span", "cgp-check" + (selected ? " is-on" : "")));
      var foot = el("div", "cgp-bundle__foot");
      foot.appendChild(qtyWrap);
      foot.appendChild(aside);
      body.appendChild(foot);

      head.appendChild(body);
      card.appendChild(head);

      aside.addEventListener("click", function (e) {
        e.stopPropagation();
        toggle();
      });
      head.addEventListener("click", function () {
        toggle();
      });

      refreshAddonStock(card, data.handle, (chosen || offered[0] || {}).id);
    }

    paint();
    return card;
  }

  function variantLabel(data, variant) {
    if (!variant) return "";
    var t = variant.title || "";
    return t === "Default Title" ? "" : t;
  }

  /* ---------- Variant-picker modal (returns a variant via onChoose) ---------- */

  // Remove the bundle-only header + footer so a later add-on modal is clean.
  function cleanModalChrome(dialog) {
    if (!dialog) return;
    ["header", "selectbtn", "foot"].forEach(function (k) {
      var n = dialog.querySelector(".cgp-modal__" + k);
      if (n) n.remove();
    });
  }

  function setupModal(modal) {
    if (!modal || modal.__cgpReady) return;
    modal.__cgpReady = true;
    function closeIt() {
      modal.hidden = true;
      cleanModalChrome(modal.querySelector(".cgp-modal__dialog"));
    }
    modal.querySelectorAll("[data-cgp-modal-close]").forEach(function (n) {
      n.addEventListener("click", closeIt);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeIt();
    });
  }

  // Copy the merchant's theme/accent CSS vars onto the modal so they still
  // resolve after it's portaled to <body> (outside .cgp-addon). Also portal it
  // there so position:fixed isn't broken by a transformed theme ancestor.
  function themeModal(ctx) {
    var modal = ctx.modal;
    if (!modal) return;
    if (ctx.root) {
      var cs = getComputedStyle(ctx.root);
      [
        "--cgp-cta-bg",
        "--cgp-cta-text",
        "--cgp-cta-radius",
        "--cgp-accent",
        "--cgp-border",
        "--cgp-muted",
        "--cgp-radius",
      ].forEach(function (v) {
        var val = cs.getPropertyValue(v);
        if (val && val.trim()) modal.style.setProperty(v, val.trim());
      });
    }
    if (modal.parentNode !== document.body) document.body.appendChild(modal);
  }

  function openModal(ctx, data, percent, onChoose) {
    var modal = ctx.modal;
    if (!modal) return;
    setupModal(modal);
    themeModal(ctx); // theme vars + portal (shared with the bundle info modal)
    cleanModalChrome(modal.querySelector(".cgp-modal__dialog")); // no bundle chrome here
    var body = modal.querySelector("[data-cgp-modal-body]");
    body.innerHTML = "";
    body.appendChild(el("div", "cgp-modal__title", data.title));

    var rows = [];
    (data.options || []).forEach(function (opt, idx) {
      var field = el("div", "cgp-modal__option");
      field.appendChild(el("div", "cgp-modal__option-label", optionName(opt)));
      var row = el("div", "cgp-modal__values");
      optionValues(data, idx).forEach(function (value, vi) {
        var b = el("button", "cgp-chip", value);
        b.type = "button";
        if (vi === 0) b.classList.add("is-active");
        b.addEventListener("click", function () {
          row.querySelectorAll(".cgp-chip").forEach(function (c) {
            c.classList.remove("is-active");
          });
          b.classList.add("is-active");
          updatePrice();
        });
        row.appendChild(b);
      });
      field.appendChild(row);
      body.appendChild(field);
      rows.push(row);
    });

    var priceLine = el("div", "cgp-modal__price");
    body.appendChild(priceLine);
    var confirm = el("button", "cgp-modal__confirm", "Add to selection");
    confirm.type = "button";
    body.appendChild(confirm);

    function selected() {
      var chosen = rows.map(function (row) {
        var a = row.querySelector(".cgp-chip.is-active");
        return a ? a.textContent : null;
      });
      return data.variants.filter(function (v) {
        return chosen.every(function (val, i) {
          return val == null || v.options[i] === val;
        });
      })[0];
    }

    function updatePrice() {
      var v = selected();
      var cents = v ? v.price : data.price;
      priceLine.innerHTML = "";
      priceLine.appendChild(
        el(
          "span",
          "cgp-modal__now",
          money(discounted(cents, percent), ctx.currency),
        ),
      );
      if (percent > 0 && ctx.showStrike) {
        priceLine.appendChild(
          el("span", "cgp-modal__was", money(cents, ctx.currency)),
        );
      }
      confirm.disabled = !v || !v.available;
      confirm.textContent = v && !v.available ? "Sold out" : "Add to selection";
    }

    confirm.addEventListener("click", function () {
      var v = selected();
      if (!v) return;
      modal.hidden = true;
      onChoose(v);
    });

    updatePrice();
    modal.hidden = false;
  }

  /* ---------- Per-location stock (links to the Stock Availability section) ----------
     Reads the `VariantData-*` JSON that the theme's Stock Availability section
     renders on every product page (per-variant uk_inventory / es_inventory /
     uk_incoming), so a kit's badge matches that section exactly. Degrades to the
     generic In stock / Out of stock when a store has no such section. */
  var locStockCache = {};
  function fetchLocStock(handle) {
    if (locStockCache[handle]) return locStockCache[handle];
    var p = fetch("/products/" + encodeURIComponent(handle), {
      headers: { Accept: "text/html" },
    })
      .then(function (r) {
        return r.text();
      })
      .then(function (html) {
        var variants = {};
        var mi = html.indexOf('id="VariantData-');
        if (mi !== -1) {
          var gt = html.indexOf(">", mi);
          var end = html.indexOf("</" + "script>", gt);
          if (gt !== -1 && end !== -1) {
            try {
              variants = JSON.parse(html.slice(gt + 1, end).trim());
            } catch (e) {
              variants = {};
            }
          }
        }
        return { variants: variants };
      })
      .catch(function () {
        return { variants: {} };
      });
    locStockCache[handle] = p;
    return p;
  }
  var toInt = function (x) {
    return parseInt(x, 10) || 0;
  };
  // Same mapping as the section's getBadge, but UK-first then EW, and no quantity.
  function stkStatusFrom(uk, es, inc, policy) {
    var qty, transit;
    if (uk > 0) {
      qty = uk;
      transit = inc;
    } else if (es > 0) {
      qty = es;
      transit = 0;
    } else {
      qty = 0;
      transit = inc;
    }
    if (qty >= 5) return { label: "In Stock", cls: "green" };
    if (qty >= 1) return { label: "Low Stock", cls: "yellow" };
    if (transit > 0) return { label: "In Transit", cls: "blue" };
    return policy === "continue"
      ? { label: "Out of Stock", cls: "red" }
      : { label: "Unavailable", cls: "grey" };
  }

  // Push a computed stock status onto every [data-cgp-stock] badge inside a card.
  function applyStockTo(card, st) {
    card.querySelectorAll("[data-cgp-stock]").forEach(function (b) {
      b.textContent = st.label;
      b.className = b.getAttribute("data-cgp-base") + " cgp-stk--" + st.cls;
    });
  }
  // Set the "just the product" card's badge to the Stock Availability section's
  // exact status for the current main variant (falls back to the generic badge).
  function refreshMainStock(card, ctx) {
    fetchLocStock(ctx.mainHandle).then(function (m) {
      if (!m || !m.variants || !Object.keys(m.variants).length) return;
      var vv = m.variants[String(readMainVariantId())];
      if (!vv) return;
      applyStockTo(
        card,
        stkStatusFrom(
          toInt(vv.uk_inv),
          toInt(vv.es_inv),
          toInt(vv.uk_inc),
          vv.policy === "continue" ? "continue" : "deny",
        ),
      );
    });
  }

  // The "just the product" default card: buy the main product on its own (no
  // bundle), selected by default so customers know a bundle is optional. It's a
  // normal multi-select card with a quantity stepper; its variant/price/stock
  // follow the product page's own variant picker.
  function renderDefaultCard(ctx, list) {
    var cardMode = ctx.bundleLayout === "card";
    var card = el(
      "div",
      "cgp-bundle cgp-bundle--default" + (cardMode ? " cgp-bundle--card" : ""),
    );
    list.appendChild(card);
    var selected = true; // baseline: "just the product" is pre-selected
    var qty = 1;
    var KEY = "main";

    function curVar() {
      var vs = (ctx.mainData && ctx.mainData.variants) || [];
      if (!vs.length) return null;
      var cur = readMainVariantId();
      return (
        vs.filter(function (v) {
          return String(v.id) === String(cur);
        })[0] ||
        firstAvailableIn(vs) ||
        vs[0]
      );
    }
    function store() {
      ctx.extras.set(KEY, { kind: "main", qty: qty });
    }
    function setSel(on) {
      selected = on;
      card.classList.toggle("is-selected", on);
      var c = card.querySelector(".cgp-check");
      if (c) c.classList.toggle("is-on", on);
      if (on) {
        // "No Bundle" is exclusive with bundles — clear any selected bundles.
        ctx.bundleDeselectors.forEach(function (f) {
          try {
            f();
          } catch (e) {}
        });
        store();
      } else ctx.extras.delete(KEY);
      ctx.onChange();
    }
    ctx.deselectDefaultCard = function () {
      if (selected) setSel(false);
    };
    ctx.resetFns.push(function () {
      // After an add, return to the pre-selected baseline (qty 1).
      selected = true;
      qty = 1;
      store();
      paint();
    });

    function mainStockBadge(baseClass) {
      var vs = (ctx.mainData && ctx.mainData.variants) || [];
      var avail = vs.some(function (v) {
        return v && v.available;
      });
      var b = el(
        "span",
        baseClass + " cgp-stk--" + (avail ? "green" : "red"),
        avail ? "In Stock" : "Out of Stock",
      );
      b.setAttribute("data-cgp-stock", "1");
      b.setAttribute("data-cgp-base", baseClass);
      return b;
    }

    function paint() {
      var d = ctx.mainData;
      if (!d) {
        card.innerHTML = "";
        card.appendChild(el("div", "cgp-bundle__skeleton"));
        return;
      }
      card.innerHTML = "";
      card.classList.toggle("is-selected", selected); // reflect state on repaint
      var v = curVar();
      var price = v ? v.price : d.price;
      var wasP =
        v && v.compare_at_price && v.compare_at_price > price
          ? v.compare_at_price
          : 0;
      var savedD = wasP ? wasP - price : 0;
      var offPctD = wasP ? Math.round((savedD / wasP) * 100) : 0;
      var head = el("div", "cgp-bundle__head");
      if (cardMode) {
        var brow = el("div", "cgp-bundle__brow");
        // Same as bundle cards: discount %OFF top-left (empty span when none).
        brow.appendChild(
          offPctD > 0
            ? el("span", "cgp-bundle__bdg cgp-bundle__bdg--off", offPctD + "% OFF")
            : el("span"),
        );
        brow.appendChild(mainStockBadge("cgp-bundle__bdg"));
        head.appendChild(brow);
      }
      var mediaEl = el("div", "cgp-bundle__media");
      var img =
        (v && v.featured_image && (v.featured_image.src || v.featured_image)) ||
        d.featured_image ||
        (d.images && d.images[0]);
      if (img) {
        var im = el("img", "cgp-bundle__media-single");
        im.src = img;
        im.alt = d.title;
        im.loading = "lazy";
        mediaEl.appendChild(im);
      }
      head.appendChild(mediaEl);
      var body = el("div", "cgp-bundle__body");
      var nameLine = el("div", "cgp-bundle__nameline");
      // "No Bundle" sits in the KIT-NAME slot (this default = no bundle chosen).
      nameLine.appendChild(
        el("span", "cgp-bundle__name", ctx.defaultLabel || "No Bundle"),
      );
      body.appendChild(nameLine);
      // Product name in the code/meta slot, directly under the name.
      var meta = el("div", "cgp-bundle__meta");
      meta.appendChild(el("span", "cgp-bundle__code", d.title));
      body.appendChild(meta);
      var pr = el("div", "cgp-bundle__price");
      var nowS = el("span", "cgp-bundle__now");
      nowS.appendChild(document.createTextNode(money(price, ctx.currency)));
      if (ctx.vatRate > 0) nowS.appendChild(el("span", "cgp-bundle__vat", " ex VAT"));
      pr.appendChild(nowS);
      if (wasP && ctx.showStrike) {
        var wasS = el("span", "cgp-bundle__was");
        wasS.appendChild(document.createTextNode(money(wasP, ctx.currency)));
        if (ctx.vatRate > 0) wasS.appendChild(el("span", "cgp-bundle__vat", " ex VAT"));
        pr.appendChild(wasS);
      }
      if (savedD > 0) {
        // List mode shows %OFF inline (card mode shows it top-left, like bundles).
        if (!cardMode && offPctD > 0) {
          pr.appendChild(el("span", "cgp-bundle__off", offPctD + "% OFF"));
        }
        var savedShown = ctx.vatRate > 0 ? savedD * (1 + ctx.vatRate / 100) : savedD;
        var saveSpan = el("span", "cgp-bundle__save");
        saveSpan.appendChild(
          document.createTextNode("Save " + money(savedShown, ctx.currency)),
        );
        if (ctx.vatRate > 0) saveSpan.appendChild(el("span", "cgp-bundle__vat", " inc VAT"));
        pr.appendChild(saveSpan);
      }
      body.appendChild(pr);
      if (!cardMode) body.appendChild(mainStockBadge("cgp-bundle__stocktag"));
      // Quantity stepper (shown when selected, via CSS).
      var qw = el("div", "cgp-bundle__qty");
      var mn = el("button", "cgp-bundle__qtybtn", "−");
      mn.type = "button";
      var qnum = el("span", "cgp-bundle__qtyn", String(qty));
      var pl = el("button", "cgp-bundle__qtybtn", "+");
      pl.type = "button";
      qw.appendChild(mn);
      qw.appendChild(qnum);
      qw.appendChild(pl);
      function setQ(n) {
        qty = Math.max(1, n | 0);
        qnum.textContent = String(qty);
        if (selected) {
          store();
          ctx.onChange();
        }
      }
      mn.addEventListener("click", function (e) {
        e.stopPropagation();
        setQ(qty - 1);
      });
      pl.addEventListener("click", function (e) {
        e.stopPropagation();
        setQ(qty + 1);
      });
      var aside = el("div", "cgp-bundle__aside");
      aside.appendChild(el("span", "cgp-check" + (selected ? " is-on" : "")));
      if (cardMode) {
        // Foot row: quantity stepper (left) + select circle (right), like Setup Kit.
        var foot = el("div", "cgp-bundle__foot");
        foot.appendChild(qw);
        foot.appendChild(aside);
        body.appendChild(foot);
        head.appendChild(body);
      } else {
        body.appendChild(qw);
        head.appendChild(body);
        head.appendChild(aside);
      }
      card.appendChild(head);
      aside.addEventListener("click", function (e) {
        e.stopPropagation();
        setSel(!selected);
      });
      head.addEventListener("click", function () {
        setSel(!selected);
      });
      refreshMainStock(card, ctx);
    }

    store(); // baseline selection present immediately
    paint();
    ctx.bundlePaints.push(paint); // repaint once the main product loads
    ctx.mainVarSync.push(paint); // repaint on page variant change
    return card;
  }

  function renderBundles(ctx, groups, root) {
    var wrap = root.querySelector("[data-cgp-bundles]");
    var list = root.querySelector("[data-cgp-bundle-list]");
    if (!wrap || !list || !groups.length) return;
    wrap.hidden = false;
    var cardMode = ctx.bundleLayout === "card";
    if (cardMode) list.classList.add("cgp-addon__bundle-list--cards");
    // The "just the product" default card goes first and stays out of paging.
    if (ctx.showDefaultCard) {
      renderDefaultCard(ctx, list);
      ctx.hasDefaultCard = true;
    }
    var cards = [];
    groups.forEach(function (group) {
      var card = el("div", "cgp-bundle" + (cardMode ? " cgp-bundle--card" : ""));
      card.appendChild(el("div", "cgp-bundle__skeleton"));
      list.appendChild(card);
      cards.push(card);
      renderBundle(ctx, card, group);
    });
    // Card mode = horizontal slider (3 in view, scroll for more). List mode =
    // stacked rows paged at 4.
    if (cardMode) setupBundleSlider(list);
    else setupBundlePaging(list, cards, 4);
  }

  // Simple pager over the bundle cards. Uses a class (not inline display) so it
  // never fights the sold-out hide (which uses its own class).
  function setupBundlePaging(list, cards, perPage) {
    if (cards.length <= perPage) return;
    var pages = Math.ceil(cards.length / perPage);
    var page = 0;
    var pager = el("div", "cgp-bundle-pager");
    var prev = el("button", "cgp-bundle-pager__btn cgp-bundle-pager__btn--prev");
    prev.type = "button";
    var label = el("span", "cgp-bundle-pager__label", "");
    var next = el("button", "cgp-bundle-pager__btn cgp-bundle-pager__btn--next");
    next.type = "button";
    pager.appendChild(prev);
    pager.appendChild(label);
    pager.appendChild(next);
    if (list.parentNode) list.parentNode.insertBefore(pager, list.nextSibling);

    function show() {
      cards.forEach(function (c, i) {
        var onPage = Math.floor(i / perPage) === page;
        c.classList.toggle("cgp-bundle--pg-hidden", !onPage);
      });
      label.textContent = page + 1 + " / " + pages;
      prev.disabled = page === 0;
      next.disabled = page === pages - 1;
    }
    prev.addEventListener("click", function (e) {
      e.stopPropagation();
      if (page > 0) {
        page--;
        show();
      }
    });
    next.addEventListener("click", function (e) {
      e.stopPropagation();
      if (page < pages - 1) {
        page++;
        show();
      }
    });
    show();
  }

  // Card mode = a horizontal slider: ~3 cards per view, scroll for more, with
  // prev/next nav buttons below. All cards live in one scroll track (default +
  // bundles); the buttons scroll it by one full view and disable at the ends.
  function setupBundleSlider(list) {
    var pager = el("div", "cgp-bundle-pager");
    var prev = el("button", "cgp-bundle-pager__btn cgp-bundle-pager__btn--prev");
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous");
    var next = el("button", "cgp-bundle-pager__btn cgp-bundle-pager__btn--next");
    next.type = "button";
    next.setAttribute("aria-label", "Next");
    pager.appendChild(prev);
    pager.appendChild(next);
    // Place the nav in the section header (top-right), like the theme carousels.
    // Re-inserting per add-on tab switch: drop any existing pager first.
    var section = list.closest("[data-cgp-bundles], [data-cgp-addons]");
    var secHead = section && section.querySelector(".cgp-addon__sec-head");
    if (secHead) {
      var oldPager = secHead.querySelector(".cgp-bundle-pager");
      if (oldPager) oldPager.remove();
      secHead.appendChild(pager);
    } else if (list.parentNode) {
      list.parentNode.insertBefore(pager, list.nextSibling);
    }

    // One "page" = the number of whole cards currently in view.
    function step() {
      var first = list.querySelector(".cgp-bundle");
      if (!first) return list.clientWidth;
      var cs = getComputedStyle(list);
      var gap = parseFloat(cs.columnGap || cs.gap) || 10;
      var cw = first.getBoundingClientRect().width + gap;
      var vis = Math.max(1, Math.round(list.clientWidth / cw));
      return cw * vis;
    }
    // scroll-snap + the panel's left padding make the "start" settle at
    // scrollLeft ≈ padding (not 0), so the edge threshold must allow for it.
    function update() {
      var pad = (parseFloat(getComputedStyle(list).paddingLeft) || 0) + 6;
      var maxScroll = list.scrollWidth - list.clientWidth;
      pager.style.display = maxScroll <= pad ? "none" : "";
      prev.disabled = list.scrollLeft <= pad;
      next.disabled = list.scrollLeft >= maxScroll - 6;
    }
    prev.addEventListener("click", function (e) {
      e.stopPropagation();
      list.scrollBy({ left: -step(), behavior: "smooth" });
    });
    next.addEventListener("click", function (e) {
      e.stopPropagation();
      list.scrollBy({ left: step(), behavior: "smooth" });
    });
    prev.disabled = true; // a slider always starts at the left edge
    list.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // Re-check once the slider has its real width / cards have laid out.
    if (window.ResizeObserver) {
      try {
        new ResizeObserver(update).observe(list);
      } catch (e) {}
    }
    requestAnimationFrame(update);
    setTimeout(update, 150);
    setTimeout(update, 800);
  }

  function renderBundle(ctx, card, group) {
    var key = "bundle:" + (group.id || group.title);
    var hasLimited = !!(group.limited && group.limited.enabled);

    Promise.all(
      (group.accessories || []).map(function (a) {
        return fetchProduct(a.handle);
      }),
    ).then(function (products) {
      products = products.filter(Boolean);
      if (!products.length) return card.remove();

      var selected = false;
      var timer = null;
      var expanded = false; // View-more open state (persists across re-renders)
      var chosenQty = 1; // how many of THIS kit to buy (buy multiples of one bundle)
      // Customer's chosen variant per accessory (numeric product id -> variant).
      var chosenVars = {};
      // Customer's chosen MAIN-product variant for this bundle.
      var chosenMainVar = null;

      function offeredFor(p) {
        return offeredVariants(group, p);
      }
      function chosenVarFor(p) {
        var off = offeredFor(p);
        if (off.length <= 1) return off[0];
        // Default to the first in-stock variant so the kit is ready right away.
        return chosenVars[gidTail(p.id)] || firstAvailableIn(off) || off[0] || null;
      }

      // Which MAIN-product variants this bundle offers (mainVariantIds, else all).
      function offeredMainVar() {
        var all = (ctx.mainData && ctx.mainData.variants) || [];
        var ids = group.mainVariantIds;
        if (!ids || !ids.length) return all;
        var allow = {};
        ids.forEach(function (g) {
          allow[gidTail(g)] = true;
        });
        var f = all.filter(function (v) {
          return allow[String(v.id)];
        });
        return f.length ? f : all;
      }
      // Resolved main variant: chosen, or the only one offered, else null (pick).
      function curMainVar() {
        if (chosenMainVar) return chosenMainVar;
        var om = offeredMainVar();
        if (!om.length) return null;
        if (om.length === 1) return om[0];
        // Default to the page's current variant if this bundle offers it, else the
        // first in-stock one — so the kit is ready without picking anything.
        var cur = readMainVariantId();
        return (
          om.filter(function (v) {
            return String(v.id) === String(cur);
          })[0] ||
          firstAvailableIn(om) ||
          om[0] ||
          null
        );
      }
      function mainPriceVal() {
        var v = curMainVar();
        if (v) return v.price || 0;
        var om = offeredMainVar();
        return (om[0] && om[0].price) || mainVariant(ctx).price || 0;
      }
      // A bundle is ONE discount on the whole kit: the main gets the SAME % as
      // the accessories, including the deep limited price while an offer runs.
      function mainPercentOf(state) {
        if (hasLimited && (state === "active" || state === "upcoming")) {
          return Number(group.limited.discountPercent) || 0;
        }
        if (hasLimited && state === "ended" && group.limited.mode !== "revert") {
          return 0;
        }
        return Math.max(0, Math.min(100, Number(group.discountPercent) || 0));
      }
      // Main thumbnail/row image — the chosen variant's own image when it has
      // one, so switching the bundle's main variant updates the small picture.
      function mainImg() {
        var v = curMainVar();
        if (v && v.featured_image) return v.featured_image.src || v.featured_image;
        return (
          (ctx.mainData &&
            (ctx.mainData.featured_image ||
              (ctx.mainData.images && ctx.mainData.images[0]))) ||
          null
        );
      }
      // Accessory thumbnail — chosen variant's own image when it has one, so
      // switching an accessory variant updates its small picture too.
      function accImg(p) {
        var v = chosenVarFor(p);
        if (v && v.featured_image) return v.featured_image.src || v.featured_image;
        return p.featured_image || (p.images && p.images[0]);
      }
      // Accessory price for the chosen variant (else first available), so the
      // displayed unit/total prices match exactly what gets added to the cart.
      function accPriceVal(p) {
        var v = chosenVarFor(p) || firstAvailableIn(offeredFor(p));
        return v && v.price != null ? v.price : p.price;
      }
      // The TRUE original (RRP) of a variant = its compare-at when on sale, else
      // its price. The bundle % stacks on the CURRENT (already-discounted) price,
      // but the struck "was" shows this real original so the displayed saving
      // reflects the sale + the bundle discount combined (never looks worse than
      // buying the item on its own). A bundle is therefore always ≤ buying apart.
      function origOf(v) {
        if (!v) return 0;
        var pr = v.price || 0;
        var ca = v.compare_at_price || 0;
        return ca > pr ? ca : pr;
      }
      function mainOrigVal() {
        var v = curMainVar();
        if (v) return origOf(v);
        var om = offeredMainVar();
        return origOf(om[0]) || mainVariant(ctx).price || 0;
      }
      function accOrigVal(p) {
        return origOf(chosenVarFor(p) || firstAvailableIn(offeredFor(p)));
      }

      function bundleReady() {
        if (!curMainVar()) return false;
        return products.every(function (p) {
          return !!chosenVarFor(p);
        });
      }

      // Stock for one component. Uses the Liquid inventory map (handle -> total,
      // null = untracked). Untracked but available -> Infinity; nothing available
      // -> 0; tracked -> the number.
      function componentStock(handle, vars) {
        var inv = ctx.inventory ? ctx.inventory[handle] : undefined;
        if (typeof inv === "number") return Math.max(0, inv);
        return (vars || []).some(function (v) {
          return v && v.available;
        })
          ? Infinity
          : 0;
      }

      // The bundle's stock = the FEWEST complete kits its parts allow (a kit needs
      // one of each). Infinity = effectively unlimited; 0 = can't be built.
      function bundleStock() {
        var m = componentStock(ctx.mainHandle, offeredMainVar());
        products.forEach(function (p) {
          m = Math.min(m, componentStock(p.handle, offeredFor(p)));
        });
        return m;
      }

      // Each component + the variant currently chosen inside this bundle. A theme
      // section can look up that exact variant's per-location stock (no all_products
      // 20-cap) and compute the true "how many complete kits" number itself.
      function bundleComponents() {
        var mv = curMainVar() || offeredMainVar()[0] || mainVariant(ctx);
        var list = [{ handle: ctx.mainHandle, variantId: mv ? mv.id : null }];
        products.forEach(function (p) {
          var v = chosenVarFor(p) || firstAvailableIn(offeredFor(p));
          list.push({ handle: p.handle, variantId: v ? v.id : null });
        });
        return list;
      }
      // Apply a computed stock status to this card's badges + (if open) its popup.
      function applyStock(st) {
        card.querySelectorAll("[data-cgp-stock]").forEach(function (b) {
          b.textContent = st.label;
          b.className = b.getAttribute("data-cgp-base") + " cgp-stk--" + st.cls;
        });
        var modal = ctx.modal;
        if (modal && !modal.hidden) {
          var ms = modal.querySelector("[data-cgp-modal-stock]");
          if (
            ms &&
            ms.getAttribute("data-cgp-forcode") === String(group.code || group.id)
          ) {
            ms.textContent = st.label;
            ms.className = ms.getAttribute("data-cgp-base") + " cgp-stk--" + st.cls;
          }
        }
      }
      // Compute the kit's combined per-location stock (min across chosen variants)
      // and set the badge to the Stock Availability section's exact status.
      function refreshKitStock() {
        var comps = bundleComponents();
        Promise.all(
          comps.map(function (c) {
            return fetchLocStock(c.handle).then(function (m) {
              return { c: c, m: m };
            });
          }),
        ).then(function (res) {
          var minUk = Infinity,
            minEs = Infinity,
            minInc = Infinity,
            anyDeny = false,
            gotData = false,
            gotAny = false;
          res.forEach(function (r) {
            if (!r.m || !r.m.variants || !Object.keys(r.m.variants).length) return;
            gotData = true;
            var vv = r.m.variants[String(r.c.variantId)];
            if (!vv) return;
            gotAny = true;
            minUk = Math.min(minUk, toInt(vv.uk_inv));
            minEs = Math.min(minEs, toInt(vv.es_inv));
            minInc = Math.min(minInc, toInt(vv.uk_inc));
            if (vv.policy !== "continue") anyDeny = true;
          });
          if (!gotData) return; // no section data on this store — keep generic badge
          if (!gotAny) {
            minUk = 0;
            minEs = 0;
            minInc = 0;
          }
          applyStock(
            stkStatusFrom(
              minUk === Infinity ? 0 : minUk,
              minEs === Infinity ? 0 : minEs,
              minInc === Infinity ? 0 : minInc,
              anyDeny ? "deny" : "continue",
            ),
          );
        });
      }
      // Fire the public integration event. `on` selected -> carries the chosen
      // variant of every component so a theme can compute real combinable stock.
      function dispatchBundle(on) {
        try {
          var handles = [ctx.mainHandle].concat(
            (group.accessories || []).map(function (a) {
              return a.handle;
            }),
          );
          document.dispatchEvent(
            new CustomEvent(on ? "cgp:bundle-selected" : "cgp:bundle-cleared", {
              detail: {
                code: group.code || "",
                id: group.id || "",
                title: group.title || "",
                handles: handles,
                components: on ? bundleComponents() : [],
                stock: bundleStock(),
              },
            }),
          );
        } catch (e) {}
      }

      // Re-sync the chosen main variant when the page variant changes (one-way:
      // page -> bundle). Registered globally; fired on a product-form change.
      function syncMain() {
        var om = offeredMainVar();
        if (om.length <= 1) return;
        var cur = readMainVariantId();
        var match = om.filter(function (v) {
          return String(v.id) === String(cur);
        })[0];
        if (
          match &&
          (!chosenMainVar || String(chosenMainVar.id) !== String(match.id))
        ) {
          chosenMainVar = match;
          paint();
        }
      }
      ctx.mainVarSync.push(syncMain);

      // Per-item percent for the current state:
      //  - limited active/upcoming -> uniform deep limited.discountPercent
      //  - limited ended + "end"   -> 0 (card is hidden anyway)
      //  - otherwise (normal / revert) -> each accessory's own % (else group %)
      function itemPercentFor(p, state) {
        if (hasLimited && (state === "active" || state === "upcoming")) {
          return Number(group.limited.discountPercent) || 0;
        }
        if (hasLimited && state === "ended" && group.limited.mode !== "revert") {
          return 0;
        }
        // A bundle is ONE discount on the whole kit — the group %, same as the
        // main. Per-accessory overrides are an add-on-only concept; ignore any
        // stale ones so the cart/Function match this card exactly.
        return Math.max(0, Math.min(100, Number(group.discountPercent) || 0));
      }
      // Always tag `_cgp_lo` when the bundle HAS a limited offer configured, and
      // let the time-gated discount node decide whether the deep price applies
      // (it only fires inside its Shopify startsAt/endsAt window). Relying on a
      // client-side "is it live now?" check was unreliable — the very first add
      // could tag nothing and show the normal price. The node is authoritative.
      function offerIdFor(state) {
        return hasLimited ? group.offerId || null : null;
      }

      function storeSelection(state, offerId) {
        var mv = curMainVar() || offeredMainVar()[0] || mainVariant(ctx);
        ctx.extras.set(key, {
          kind: "bundle",
          percent: 0, // each item carries its own percent
          qty: chosenQty, // buy N of this kit (Function discounts all N)
          offerId: offerId || null,
          bid: group.id || null, // which bundle group (for main-line discount)
          title: group.title || "Bundle",
          code: group.code || "",
          mainVariantId: mv ? mv.id : null,
          mainPrice: (mv && mv.price) || 0,
          mainPercent: mainPercentOf(state), // whole-kit %, deep while offer runs
          items: products.map(function (p) {
            var v = chosenVarFor(p) || firstAvailableIn(offeredFor(p));
            return {
              id: v.id,
              price: v.price,
              percent: itemPercentFor(p, state),
            };
          }),
        });
        // Selected (and re-fired on every variant change) so a theme section can
        // recompute real combinable stock from the chosen variants, live.
        dispatchBundle(true);
      }

      function setSelected(on, state, offerId) {
        selected = on;
        card.classList.toggle("is-selected", on);
        var check = card.querySelector(".cgp-check");
        if (check) {
          check.classList.toggle("is-on", on);
        }
        if (on) {
          // Selecting a bundle clears the "No Bundle" default (they're exclusive).
          if (ctx.deselectDefaultCard) ctx.deselectDefaultCard();
          storeSelection(state, offerId); // fires cgp:bundle-selected
        } else {
          ctx.extras.delete(key);
          dispatchBundle(false); // cgp:bundle-cleared
        }
        ctx.onChange();
      }

      ctx.resetFns.push(function () {
        selected = false;
        chosenQty = 1;
        card.classList.remove("is-selected");
        var check = card.querySelector(".cgp-check");
        if (check) {
          check.classList.remove("is-on");
        }
      });
      // Registered so the "No Bundle" card can clear every bundle when picked.
      ctx.bundleDeselectors.push(function () {
        if (selected) setSelected(false);
      });

      // Rebuilding the card (innerHTML reset) can nudge the page scroll —
      // switching a variant repeatedly would creep it downward. Pin scrollY
      // around the rebuild so the bundle stays put.
      function paint() {
        var sy = window.pageYOffset;
        paintBody();
        if (window.pageYOffset !== sy) window.scrollTo(0, sy);
        requestAnimationFrame(function () {
          if (window.pageYOffset !== sy) window.scrollTo(0, sy);
        });
      }

      function paintBody() {
        var state = hasLimited ? offerState(group) : "active";
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        // A finished "end"-mode offer is over: drop the bundle entirely.
        if (hasLimited && state === "ended" && group.limited.mode !== "revert") {
          if (selected) setSelected(false);
          card.remove();
          return;
        }
        // Whole-bundle stock = fewest complete kits its parts allow. Optionally
        // hide the bundle when it can't be built at all.
        var stock = bundleStock();
        if (group.hideWhenSoldOut && stock <= 0) {
          if (selected) setSelected(false);
          card.classList.add("cgp-bundle--oos-hidden");
          return;
        }
        card.classList.remove("cgp-bundle--oos-hidden");

        var live = hasLimited && (state === "active" || state === "upcoming");
        card.classList.toggle("cgp-limited", live);
        card.innerHTML = "";

        // Default the main variant to the page's current one (if it's offered).
        if (!chosenMainVar) {
          var om0 = offeredMainVar();
          if (om0.length <= 1) chosenMainVar = om0[0] || null;
          else {
            var cur0 = readMainVariantId();
            var m0 = om0.filter(function (v) {
              return String(v.id) === String(cur0);
            })[0];
            if (m0) chosenMainVar = m0;
          }
        }

        // "now" = bundle % stacked on the CURRENT price; "was" = the TRUE original
        // (compare-at), so the saving reflects the sale + the bundle combined.
        var accNow = 0,
          accWas = 0;
        products.forEach(function (p) {
          accNow += discounted(accPriceVal(p), itemPercentFor(p, state));
          accWas += accOrigVal(p);
        });
        var mainPct = mainPercentOf(state);
        var mainNow = discounted(mainPriceVal(), mainPct);
        var mainWas = mainOrigVal();
        var totalNow = mainNow + accNow;
        var totalWas = mainWas + accWas;
        var saved = totalWas - totalNow;
        var hasSaving = saved > 0;

        // Media (left): a cover image, else a grid of the component images
        // (2×2 for ≤4, 3×3 for 5–9; >9 → one representative image).
        function buildMedia(container) {
          container.className = "cgp-bundle__media";
          container.innerHTML = "";
          if (group.coverImage) {
            var imc = el("img", "cgp-bundle__media-single");
            imc.src = group.coverImage;
            imc.alt = group.title || "Bundle";
            imc.loading = "lazy";
            container.appendChild(imc);
            return;
          }
          var imgs = [];
          var mi = mainImg();
          if (mi) imgs.push(mi);
          products.forEach(function (p) {
            var a = accImg(p);
            if (a) imgs.push(a);
          });
          var n = imgs.length;
          if (n === 0) return;
          if (n === 1 || n > 9) {
            var im1 = el("img", "cgp-bundle__media-single");
            im1.src = imgs[0];
            im1.alt = group.title || "";
            im1.loading = "lazy";
            container.appendChild(im1);
            return;
          }
          // Flex montage: images shown WHOLE (contain), centred; a partial last
          // row is centred too. 2–4 → 2 per row, 5–9 → 3 per row.
          var perRow = n <= 4 ? 2 : 3;
          container.className = "cgp-bundle__media cgp-bundle__media--grid";
          var grid = el("div", "cgp-bundle__grid");
          grid.style.setProperty("--cgp-cols", perRow);
          imgs.slice(0, perRow * perRow).forEach(function (src) {
            var cell = el("div", "cgp-bundle__grid-cell");
            var im = el("img");
            im.src = src;
            im.loading = "lazy";
            cell.appendChild(im);
            grid.appendChild(cell);
          });
          container.appendChild(grid);
        }
        // A price value + an optional small "ex/inc VAT" suffix.
        function priceEl(cls, cents, vatLabel) {
          var s = el("span", cls);
          s.appendChild(document.createTextNode(money(cents, ctx.currency)));
          if (ctx.vatRate > 0 && vatLabel) {
            s.appendChild(el("span", "cgp-bundle__vat", " " + vatLabel));
          }
          return s;
        }

        // Component availability + discount %, used by the stock tag, the save
        // line, and (card mode) the image overlays.
        var compAvail = function (vars) {
          return (vars || []).some(function (v) {
            return v && v.available;
          });
        };
        var allAvail =
          compAvail(offeredMainVar()) &&
          products.every(function (p) {
            return compAvail(offeredFor(p));
          });
        var offPct =
          hasSaving && totalWas > 0 ? Math.round((saved / totalWas) * 100) : 0;

        // A stock badge with a generic initial state; refreshKitStock() upgrades it
        // to the Stock Availability section's exact status/colour once fetched.
        function makeStockBadge(baseClass) {
          var b = el(
            "span",
            baseClass + " cgp-stk--" + (allAvail ? "green" : "red"),
            allAvail ? "In Stock" : "Out of Stock",
          );
          b.setAttribute("data-cgp-stock", "1");
          b.setAttribute("data-cgp-base", baseClass);
          return b;
        }

        var cardMode = ctx.bundleLayout === "card";

        // HEAD: media (left) + body (right); selector top-right, expand bottom-right.
        var head = el("div", "cgp-bundle__head");

        // Card mode: a badge row ABOVE the image (discount left, stock right) —
        // same size/type, only the colour differs; never covering the image.
        if (cardMode) {
          var brow = el("div", "cgp-bundle__brow");
          brow.appendChild(
            offPct > 0
              ? el("span", "cgp-bundle__bdg cgp-bundle__bdg--off", offPct + "% OFF")
              : el("span"),
          );
          brow.appendChild(makeStockBadge("cgp-bundle__bdg"));
          head.appendChild(brow);
        }

        var mediaEl = el("div", "cgp-bundle__media");
        buildMedia(mediaEl);
        // Image opens the detail popup (card) / expands the detail (list).
        mediaEl.addEventListener("click", function (e) {
          e.stopPropagation();
          if (cardMode) openBundleInfo();
          else setExpanded(!expanded);
        });
        head.appendChild(mediaEl);

        var body = el("div", "cgp-bundle__body");

        var nameLine = el("div", "cgp-bundle__nameline");
        nameLine.appendChild(
          el("span", "cgp-bundle__name", group.title || "Bundle"),
        );
        // Inline countdown badge next to the name.
        var cdSpan = null;
        var cdTarget = null;
        if (live && state === "active" && group.limited.endsAt) {
          var bd = el("span", "cgp-bundle__timerbadge");
          bd.appendChild(el("span", "cgp-bundle__timericon", "Ends in"));
          cdSpan = el("span", "cgp-bundle__timerclock", "");
          bd.appendChild(cdSpan);
          nameLine.appendChild(bd);
          cdTarget = group.limited.endsAt;
        } else if (live && state === "upcoming" && group.limited.startsAt) {
          var bd2 = el(
            "span",
            "cgp-bundle__timerbadge cgp-bundle__timerbadge--soon",
          );
          bd2.appendChild(el("span", "cgp-bundle__timericon", "Starts in"));
          cdSpan = el("span", "cgp-bundle__timerclock", "");
          bd2.appendChild(cdSpan);
          nameLine.appendChild(bd2);
          cdTarget = group.limited.startsAt;
        }
        body.appendChild(nameLine);
        if (cdSpan) timer = startCountdown(cdSpan, Date.parse(cdTarget), paint);

        // Code sits directly under the name (above the price).
        if (group.code) {
          var metaLine = el("div", "cgp-bundle__meta");
          metaLine.appendChild(el("span", "cgp-bundle__code", group.code));
          body.appendChild(metaLine);
        }

        // Price: current price, struck original, and "Save £X" — card mode puts the
        // current price on its own line and the struck + save on the next line; the
        // % OFF pill is inline in list mode (on the image badge in card mode).
        var itemCount = products.length + (ctx.mainData ? 1 : 0);
        var pr = el("div", "cgp-bundle__price");
        pr.appendChild(priceEl("cgp-bundle__now", totalNow, "ex VAT"));
        if (hasSaving && ctx.showStrike) {
          pr.appendChild(priceEl("cgp-bundle__was", totalWas, "ex VAT"));
        }
        if (hasSaving) {
          if (!cardMode && offPct > 0) {
            pr.appendChild(el("span", "cgp-bundle__off", offPct + "% OFF"));
          }
          var savedShown =
            ctx.vatRate > 0 ? saved * (1 + ctx.vatRate / 100) : saved;
          var saveSpan = el("span", "cgp-bundle__save");
          saveSpan.appendChild(
            document.createTextNode("Save " + money(savedShown, ctx.currency)),
          );
          if (ctx.vatRate > 0) {
            saveSpan.appendChild(el("span", "cgp-bundle__vat", " inc VAT"));
          }
          pr.appendChild(saveSpan);
        }
        body.appendChild(pr);

        // Stock tag — list mode only (card mode shows it in the badge row above).
        if (!cardMode) {
          body.appendChild(makeStockBadge("cgp-bundle__stocktag"));
        }

        // Quantity stepper — buy several of THIS kit. CSS shows it only when the
        // card is selected (foot-left, per the Setup Kit spec §5.6).
        var qtyWrap = el("div", "cgp-bundle__qty");
        var qMinus = el("button", "cgp-bundle__qtybtn", "−");
        qMinus.type = "button";
        qMinus.setAttribute("aria-label", "Decrease quantity");
        var qNum = el("span", "cgp-bundle__qtyn", String(chosenQty));
        var qPlus = el("button", "cgp-bundle__qtybtn", "+");
        qPlus.type = "button";
        qPlus.setAttribute("aria-label", "Increase quantity");
        qtyWrap.appendChild(qMinus);
        qtyWrap.appendChild(qNum);
        qtyWrap.appendChild(qPlus);
        function setQty(n) {
          chosenQty = Math.max(1, n | 0);
          qNum.textContent = String(chosenQty);
          if (selected) {
            storeSelection(state, offerIdFor(state)); // re-store with new qty
            ctx.onChange(); // refresh totals + counter
          }
        }
        qMinus.addEventListener("click", function (e) {
          e.stopPropagation();
          setQty(chosenQty - 1);
        });
        qPlus.addEventListener("click", function (e) {
          e.stopPropagation();
          setQty(chosenQty + 1);
        });
        // Selector: a "+" that becomes a tick when selected.
        var aside = el("div", "cgp-bundle__aside");
        aside.appendChild(el("span", "cgp-check" + (selected ? " is-on" : "")));

        // Detail toggle: "View more" (list) / "View N items" (card).
        var toggleLine = el("button", "cgp-bundle__expand", "View more ▾");
        toggleLine.type = "button";

        if (cardMode) {
          // Card: "View N items" link in the body, then a foot row pairing the
          // quantity stepper (left) with the select circle (right) — like Setup Kit.
          body.appendChild(toggleLine);
          var foot = el("div", "cgp-bundle__foot");
          foot.appendChild(qtyWrap);
          foot.appendChild(aside);
          body.appendChild(foot);
          head.appendChild(body);
        } else {
          // List: stepper in the body flow; selector + toggle pinned (absolute).
          body.appendChild(qtyWrap);
          head.appendChild(body);
          head.appendChild(aside);
          head.appendChild(toggleLine);
        }

        card.appendChild(head);

        var listEl = el("div", "cgp-bundle__contents");
        card.appendChild(listEl);

        function variantSelect(offered, currentId, onPick) {
          var s = el("select", "cgp-bundle__variant");
          offered.forEach(function (v) {
            var o = el("option", null, v.title + (v.available ? "" : " — sold out"));
            o.value = v.id;
            if (!v.available) o.disabled = true;
            s.appendChild(o);
          });
          // No "Choose an option…" — default to the current/first in-stock variant.
          var def =
            currentId || (firstAvailableIn(offered) || offered[0] || {}).id;
          s.value = def ? String(def) : "";
          s.addEventListener("change", function () {
            s.classList.remove("cgp-needs-choice");
            onPick(
              offered.filter(function (x) {
                return String(x.id) === s.value;
              })[0] || null,
            );
          });
          return s;
        }

        // Detail list: the MAIN product (with its own variant picker, like the
        // accessories) first, then each accessory.
        function buildContents(target) {
          target = target || listEl;
          target.innerHTML = "";
          if (ctx.mainData) {
            var om = offeredMainVar();
            var mainSel =
              om.length > 1
                ? variantSelect(om, (curMainVar() || {}).id, function (v) {
                    holdScroll(600); // Dawn re-renders media async; keep page put
                    chosenMainVar = v;
                    if (v) selectMainVariant(ctx, v.id); // sync to the page picker
                    if (selected) {
                      // Keep the cart selection in sync with the new variant.
                      if (bundleReady()) storeSelection(state, offerIdFor(state));
                      else setSelected(false, state, offerIdFor(state));
                    }
                    paint();
                    ctx.onChange(); // refresh totals above the Add-to-cart button
                    armedAutoSelect(state); // deep-linked kit: select once complete
                  })
                : null;
            target.appendChild(
              contentRow(
                ctx,
                ctx.mainData,
                mainPercentOf(state),
                "Current product",
                true,
                mainSel,
                mainImg(),
                mainPriceVal(),
                mainOrigVal(),
              ),
            );
          }
          products.forEach(function (p) {
            var off = offeredFor(p);
            var sel =
              off.length > 1
                ? variantSelect(off, (chosenVarFor(p) || {}).id, function (v) {
                    chosenVars[gidTail(p.id)] = v;
                    if (selected) {
                      if (bundleReady()) storeSelection(state, offerIdFor(state));
                      else setSelected(false, state, offerIdFor(state));
                    }
                    paint(); // refresh this accessory's thumbnail + price
                    ctx.onChange(); // refresh totals above the Add-to-cart button
                    armedAutoSelect(state); // deep-linked kit: select once complete
                  })
                : null;
            target.appendChild(
              contentRow(ctx, p, itemPercentFor(p, state), null, false, sel, accImg(p), accPriceVal(p), accOrigVal(p)),
            );
          });
        }
        // One component row for the Info popup: image + title / price / variant,
        // each on its own line (cleaner than the compact inline detail rows).
        function modalRow(data, percent, tag, sel, img, basePrice, link, origPrice) {
          var row = el("div", "cgp-modal__crow");
          var thumb = el(link ? "a" : "div", "cgp-modal__cthumb");
          if (link) {
            thumb.href = link;
            thumb.target = "_blank";
            thumb.rel = "noopener";
          }
          if (img) {
            var im = el("img");
            im.src = img;
            im.loading = "lazy";
            thumb.appendChild(im);
          }
          row.appendChild(thumb);
          var info = el("div", "cgp-modal__cinfo");
          var nameEl = el(link ? "a" : "div", "cgp-modal__cname", data.title);
          if (link) {
            nameEl.href = link;
            nameEl.target = "_blank";
            nameEl.rel = "noopener";
          }
          info.appendChild(nameEl);
          if (tag) info.appendChild(el("span", "cgp-modal__ctag", tag));
          var pl = el("div", "cgp-modal__cprice");
          var rowNow = discounted(basePrice, percent);
          var rowWas = origPrice != null ? origPrice : basePrice;
          var nowS = el("span", "cgp-modal__cnow");
          nowS.appendChild(document.createTextNode(money(rowNow, ctx.currency)));
          if (ctx.vatRate > 0) nowS.appendChild(el("span", "cgp-bundle__vat", " ex VAT"));
          pl.appendChild(nowS);
          if (rowWas > rowNow && ctx.showStrike) {
            var wasS = el("span", "cgp-modal__cwas");
            wasS.appendChild(document.createTextNode(money(rowWas, ctx.currency)));
            if (ctx.vatRate > 0) wasS.appendChild(el("span", "cgp-bundle__vat", " ex VAT"));
            pl.appendChild(wasS);
          }
          info.appendChild(pl);
          if (sel) info.appendChild(sel);
          row.appendChild(info);
          // External-link icon → opens the product page in a new tab.
          if (link) {
            var ext = el("a", "cgp-modal__ext");
            ext.href = link;
            ext.target = "_blank";
            ext.rel = "noopener";
            ext.setAttribute("aria-label", "Open " + data.title + " in a new tab");
            ext.innerHTML =
              "<svg viewBox='0 0 24 24' width='16' height='16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M14 4h6v6'/><path d='M20 4l-8.5 8.5'/><path d='M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6'/></svg>";
            ext.addEventListener("click", function (e) {
              e.stopPropagation();
            });
            row.appendChild(ext);
          }
          return row;
        }

        // Card mode: the "Info" button opens the bundle detail in the modal, with a
        // fixed header (title + stock), a scrolling component list (images update
        // with the chosen variant), and a "Select this bundle" footer that syncs
        // the card's selected state.
        function openBundleInfo() {
          var modal = ctx.modal;
          if (!modal) return;
          setupModal(modal);
          var dialog = modal.querySelector(".cgp-modal__dialog");
          var mbody = modal.querySelector("[data-cgp-modal-body]");
          if (!dialog || !mbody) return;
          cleanModalChrome(dialog); // drop any header/footer from a previous open

          // Fixed header: name (+ code) on line 1, stock on line 2 (left). The X
          // badge is the liquid button (top-right).
          var header = el("div", "cgp-modal__header");
          var titleEl = el("div", "cgp-modal__title");
          titleEl.appendChild(
            el("span", "cgp-modal__title-name", group.title || "Bundle"),
          );
          if (group.code) {
            titleEl.appendChild(el("span", "cgp-modal__title-code", group.code));
          }
          header.appendChild(titleEl);
          var pstock = el(
            "span",
            "cgp-modal__stock cgp-stk--" + (allAvail ? "green" : "red"),
            allAvail ? "In Stock" : "Out of Stock",
          );
          pstock.setAttribute("data-cgp-modal-stock", "1");
          pstock.setAttribute("data-cgp-base", "cgp-modal__stock");
          pstock.setAttribute("data-cgp-forcode", String(group.code || group.id));
          header.appendChild(pstock);
          dialog.insertBefore(header, mbody);

          mbody.innerHTML = "";
          var clist = el("div", "cgp-modal__clist");
          mbody.appendChild(clist);

          // Footer: total price (left) + Select button (right). Clicking Select
          // toggles the selection AND closes the popup.
          var footer = el("div", "cgp-modal__foot");
          var footPrice = el("div", "cgp-modal__foot-price");
          var selBtn = el("button", "cgp-modal__selectbtn", "");
          selBtn.type = "button";
          footer.appendChild(footPrice);
          footer.appendChild(selBtn);

          function computeTotals() {
            var accNow = 0,
              accWas = 0;
            products.forEach(function (p) {
              accNow += discounted(accPriceVal(p), itemPercentFor(p, state));
              accWas += accOrigVal(p);
            });
            var mNow = discounted(mainPriceVal(), mainPercentOf(state));
            var mWas = mainOrigVal();
            return { now: mNow + accNow, was: mWas + accWas };
          }
          function syncSelectBtn() {
            selBtn.textContent = selected ? "✓ Selected" : "Select this bundle";
            selBtn.classList.toggle("is-selected", selected);
            // Total price (recomputes when a variant changes).
            var tp = computeTotals();
            var saved = tp.was - tp.now;
            var offPct = saved > 0 && tp.was > 0 ? Math.round((saved / tp.was) * 100) : 0;
            footPrice.innerHTML = "";
            var nowRow = el("div", "cgp-modal__foot-nowrow");
            var nowS = el("span", "cgp-modal__foot-now");
            nowS.appendChild(document.createTextNode(money(tp.now, ctx.currency)));
            if (ctx.vatRate > 0) nowS.appendChild(el("span", "cgp-bundle__vat", " ex VAT"));
            nowRow.appendChild(nowS);
            if (offPct > 0) {
              nowRow.appendChild(el("span", "cgp-bundle__off", offPct + "% OFF"));
            }
            footPrice.appendChild(nowRow);
            if (saved > 0 && ctx.showStrike) {
              var wasS = el("span", "cgp-modal__foot-was");
              wasS.appendChild(document.createTextNode(money(tp.was, ctx.currency)));
              footPrice.appendChild(wasS);
            }
            if (saved > 0) {
              var savedShown =
                ctx.vatRate > 0 ? saved * (1 + ctx.vatRate / 100) : saved;
              var saveS = el("span", "cgp-modal__foot-save");
              saveS.appendChild(
                document.createTextNode("Save " + money(savedShown, ctx.currency)),
              );
              if (ctx.vatRate > 0) saveS.appendChild(el("span", "cgp-bundle__vat", " inc VAT"));
              footPrice.appendChild(saveS);
            }
          }
          selBtn.addEventListener("click", function () {
            setSelected(!selected, state, offerIdFor(state));
            modal.hidden = true; // auto-close on select
            cleanModalChrome(dialog);
          });

          // Rebuild the list on every variant change so each component's image +
          // price track the chosen variant.
          function renderModalList() {
            clist.innerHTML = "";
            if (ctx.mainData) {
              var om = offeredMainVar();
              var mainSel =
                om.length > 1
                  ? variantSelect(om, (curMainVar() || {}).id, function (v) {
                      holdScroll(600);
                      chosenMainVar = v;
                      if (v) selectMainVariant(ctx, v.id);
                      if (selected) {
                        if (bundleReady()) storeSelection(state, offerIdFor(state));
                        else setSelected(false, state, offerIdFor(state));
                      }
                      paint();
                      ctx.onChange();
                      armedAutoSelect(state);
                      renderModalList();
                      syncSelectBtn();
                    })
                  : null;
              clist.appendChild(
                modalRow(
                  ctx.mainData,
                  mainPercentOf(state),
                  "Main",
                  mainSel,
                  mainImg(),
                  mainPriceVal(),
                  ctx.mainHandle ? "/products/" + ctx.mainHandle : null,
                  mainOrigVal(),
                ),
              );
            }
            products.forEach(function (p) {
              var off = offeredFor(p);
              var sel =
                off.length > 1
                  ? variantSelect(off, (chosenVarFor(p) || {}).id, function (v) {
                      chosenVars[gidTail(p.id)] = v;
                      if (selected) {
                        if (bundleReady()) storeSelection(state, offerIdFor(state));
                        else setSelected(false, state, offerIdFor(state));
                      }
                      paint();
                      ctx.onChange();
                      armedAutoSelect(state);
                      renderModalList();
                      syncSelectBtn();
                    })
                  : null;
              clist.appendChild(
                modalRow(
                  p,
                  itemPercentFor(p, state),
                  null,
                  sel,
                  accImg(p),
                  accPriceVal(p),
                  p.handle ? "/products/" + p.handle : null,
                  accOrigVal(p),
                ),
              );
            });
          }
          renderModalList();

          syncSelectBtn();
          dialog.appendChild(footer);

          themeModal(ctx); // copy theme vars + portal to <body>
          modal.hidden = false;
          refreshKitStock(); // set the popup's stock badge to the section's status
        }

        function setExpanded(open) {
          expanded = open;
          listEl.hidden = !open;
          if (open && !listEl.childNodes.length) buildContents(listEl);
          toggleLine.textContent = open ? "Hide ▴" : "View more ▾";
        }
        if (cardMode) {
          // Card mode: no inline detail; "View N items" opens the modal.
          listEl.hidden = true;
          toggleLine.textContent =
            "View " + itemCount + " item" + (itemCount === 1 ? "" : "s");
          toggleLine.classList.add("cgp-bundle__expand--info");
          toggleLine.addEventListener("click", function (e) {
            e.stopPropagation();
            openBundleInfo();
          });
        } else {
          setExpanded(expanded); // restore open state across re-renders
          toggleLine.addEventListener("click", function (e) {
            e.stopPropagation();
            setExpanded(!expanded);
          });
        }

        if (state === "upcoming") {
          // Not buyable yet — the deep price only applies once it starts.
          card.classList.add("is-disabled");
          if (selected) setSelected(false);
        } else {
          card.classList.remove("is-disabled");
          function toggleSelect() {
            if (selected) {
              setSelected(false, state, offerIdFor(state));
              return;
            }
            if (!bundleReady()) {
              // Need a choice: card opens the popup, list expands the detail.
              if (cardMode) openBundleInfo();
              else setExpanded(true);
              listEl.querySelectorAll("select").forEach(function (s) {
                if (!s.value) s.classList.add("cgp-needs-choice");
              });
              return;
            }
            setSelected(true, state, offerIdFor(state));
          }
          // Card mode: clicking the middle/blank of the card SELECTS it (the image
          // and "View N items" open the popup — they stopPropagation). List mode:
          // the head toggles the inline detail.
          head.addEventListener("click", function () {
            if (cardMode) toggleSelect();
            else setExpanded(!expanded);
          });
          aside.addEventListener("click", function (e) {
            e.stopPropagation();
            toggleSelect();
          });
          // Keep a live selection's price/offer in sync across a transition.
          if (selected) storeSelection(state, offerIdFor(state));
        }

        // Deep-link landing (⑤): on the first matching paint, scroll to + expand +
        // select this kit. Runs HERE (inside paint) so setExpanded/listEl are in
        // scope. Guarded globally so it fires once. If the kit isn't ready yet
        // (data still loading) it stays armed and selects on the next paint / once
        // every option is chosen.
        if (
          !window.__cgpDeepDone &&
          state !== "upcoming" &&
          state !== "ended"
        ) {
          var dlWant = deepLinkBundle();
          if (
            dlWant &&
            (String(group.code || "").toLowerCase() === dlWant.toLowerCase() ||
              String(group.id) === dlWant)
          ) {
            deepArmed = true;
            scrollToDeepCard();
            if (ctx.bundleLayout !== "card") setExpanded(true);
            if (bundleReady()) {
              deepArmed = false;
              window.__cgpDeepDone = true;
              setSelected(true, state, offerIdFor(state));
            }
          }
        }
        refreshKitStock(); // upgrade the badge to the section's exact status
        ctx.onChange();
      }

      // Set by the deep-link block inside paint(); read by armedAutoSelect. Declared
      // BEFORE the first paint() so that first paint's assignment isn't clobbered.
      var deepArmed = false;
      paint();
      // Re-render once the main product loads (for its thumbnail + total price).
      ctx.bundlePaints.push(paint);

      // Deep-link helpers (the actual expand+select is at the END of paint(), where
      // setExpanded/listEl are in scope). These just scroll to the kit and, as a
      // fallback, select it once every option is chosen. Function declarations are
      // hoisted, so paint() can call them even though they're defined here.
      function scrollToDeepCard() {
        if (window.__cgpDeepFlashed) return;
        window.__cgpDeepFlashed = true;
        setTimeout(function () {
          try {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
          } catch (e) {}
        }, 350);
      }
      function armedAutoSelect(state) {
        if (deepArmed && !selected && bundleReady()) {
          deepArmed = false;
          setSelected(true, state, offerIdFor(state));
        }
      }
    });
  }

  // The `kb_bundle` deep-link value (bundle code or id), or null.
  function deepLinkBundle() {
    try {
      var m = window.location.search.match(/[?&]kb_bundle=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) {
      return null;
    }
  }

  function contentRow(ctx, data, percent, tag, isMain, sel, imgOverride, priceOverride, origOverride) {
    var basePrice = priceOverride != null ? priceOverride : data.price;
    var row = el("div", "cgp-bundle__content-row");
    var link = !isMain && data.handle ? "/products/" + data.handle : null;
    var thumb = el(link ? "a" : "div", "cgp-bundle__content-thumb");
    if (link) thumb.href = link;
    var img = imgOverride || data.featured_image || (data.images && data.images[0]);
    if (img) {
      var im = el("img");
      im.src = img;
      im.alt = data.title;
      im.loading = "lazy";
      thumb.appendChild(im);
    }
    row.appendChild(thumb);
    var info = el("div", "cgp-bundle__content-info");
    var nameLine = el("div", "cgp-bundle__content-nameline");
    var nameEl = el(link ? "a" : "div", "cgp-bundle__content-name", data.title);
    if (link) nameEl.href = link;
    nameLine.appendChild(nameEl);
    if (tag) nameLine.appendChild(el("span", "cgp-bundle__content-tag", tag));
    info.appendChild(nameLine);
    if (sel) info.appendChild(sel); // variant picker
    row.appendChild(info);
    var p = el("div", "cgp-bundle__content-price");
    var rNow = discounted(basePrice, percent);
    var rWas = origOverride != null ? origOverride : basePrice;
    var nowS = el("span", "cgp-bundle__now");
    nowS.appendChild(document.createTextNode(money(rNow, ctx.currency)));
    if (ctx.vatRate > 0) nowS.appendChild(el("span", "cgp-bundle__vat", " ex VAT"));
    p.appendChild(nowS);
    if (rWas > rNow && ctx.showStrike) {
      var wasS = el("span", "cgp-bundle__was");
      wasS.appendChild(document.createTextNode(money(rWas, ctx.currency)));
      if (ctx.vatRate > 0) wasS.appendChild(el("span", "cgp-bundle__vat", " ex VAT"));
      p.appendChild(wasS);
    }
    row.appendChild(p);
    return row;
  }

  /* ---------- Limited-offer helpers (countdown; bundles only) ---------- */

  // Authoritative time gate lives on the discount node; this is display only.
  function offerState(group) {
    var lim = group.limited || {};
    var now = Date.now();
    var s = lim.startsAt ? Date.parse(lim.startsAt) : NaN;
    var e = lim.endsAt ? Date.parse(lim.endsAt) : NaN;
    if (!isNaN(e) && now >= e) return "ended";
    if (!isNaN(s) && now < s) return "upcoming";
    return "active";
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function fmtRemaining(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400);
    s -= d * 86400;
    var h = Math.floor(s / 3600);
    s -= h * 3600;
    var m = Math.floor(s / 60);
    s -= m * 60;
    return (d > 0 ? d + "d " : "") + pad2(h) + ":" + pad2(m) + ":" + pad2(s);
  }

  function startCountdown(node, target, onExpire) {
    var timer;
    function tick() {
      var rem = target - Date.now();
      node.textContent = fmtRemaining(rem);
      if (rem <= 0) {
        clearInterval(timer);
        if (onExpire) onExpire();
      }
    }
    tick();
    timer = setInterval(tick, 1000);
    return timer;
  }

  /* ---------- FREE gift: auto-added, locked, 100% off ---------- */

  // Requirements used by the locked-restore in reconcile: each entry knows the
  // main it belongs to and the gift's current variant.
  var freeReqs = [];

  // Product-level FREE gift: each free group = "choose ONE free gift". The
  // customer picks one option (radio); it's added free alongside the main. Each
  // group contributes its chosen gift to ctx.freeItems / freeReqs, rebuilt on
  // every change so commit + reconcile always see the current pick.
  function renderFree(ctx, groups, root) {
    var wrap = root.querySelector("[data-cgp-free]");
    if (!wrap || !groups.length) return;
    var chosenByGroup = {}; // groupKey -> { productId, current }

    function rebuild() {
      ctx.freeItems = [];
      freeReqs = freeReqs.filter(function (r) {
        return r.mainId !== ctx.mainProductId;
      });
      Object.keys(chosenByGroup).forEach(function (k) {
        var c = chosenByGroup[k];
        if (!c) return;
        ctx.freeItems.push({ productId: c.productId, current: c.current });
        freeReqs.push({
          mainId: ctx.mainProductId,
          mainHandle: ctx.mainHandle,
          giftProductId: c.productId,
          current: c.current,
        });
      });
      ctx.onChange();
    }

    groups.forEach(function (group, gi) {
      Promise.all(
        (group.accessories || []).map(function (a) {
          return fetchProduct(a.handle);
        }),
      ).then(function (datas) {
        var items = datas.filter(function (d) {
          if (!d) return false;
          if (group.hideWhenSoldOut && !accInStock(group, d)) return false;
          return true;
        });
        if (!items.length) return;
        wrap.hidden = false;
        var section = el("div", "cgp-free");
        section.appendChild(
          el("div", "cgp-free__heading", group.title || "🎁 Free gift"),
        );
        if (items.length > 1) {
          section.appendChild(
            el("div", "cgp-free__sub", "Choose your free gift:"),
          );
        }
        var list = el("div", "cgp-free__list");
        section.appendChild(list);
        wrap.appendChild(section);

        var groupKey = "fg" + gi + "_" + (group.id || gi);
        var radioName = "cgp-free-" + groupKey;
        var single = items.length > 1;

        items.forEach(function (data, idx) {
          var row = el("label", "cgp-free__row");
          list.appendChild(row);
          var cur = renderFreeItem(ctx, row, group, data, {
            single: single,
            radioName: radioName,
            checked: idx === 0,
            onPick: function (current) {
              chosenByGroup[groupKey] = {
                productId: String(data.id),
                current: current,
              };
              rebuild();
            },
          });
          if (idx === 0) {
            chosenByGroup[groupKey] = {
              productId: String(data.id),
              current: cur,
            };
          }
        });
        rebuild();
      });
    });
  }

  function renderFreeItem(ctx, row, group, data, opts) {
    row.innerHTML = "";
    var offered = offeredVariants(group, data);
    var chosen = firstAvailableIn(offered);
    var link = data.handle ? "/products/" + data.handle : null;

    // Single-select radio when the group offers a choice; else a locked ✓.
    var selector;
    if (opts.single) {
      selector = el("input", "cgp-free__radio");
      selector.type = "radio";
      selector.name = opts.radioName;
      selector.checked = !!opts.checked;
      selector.addEventListener("change", function () {
        if (selector.checked) opts.onPick(current);
      });
    } else {
      selector = el("span", "cgp-check is-on is-locked", "✓");
      selector.setAttribute("aria-label", "Free gift (included)");
    }
    row.appendChild(selector);

    var thumb = el(link ? "a" : "div", "cgp-free__thumb");
    if (link) thumb.href = link;
    var img = data.featured_image || (data.images && data.images[0]);
    if (img) {
      var im = el("img");
      im.src = img;
      im.alt = data.title;
      im.loading = "lazy";
      thumb.appendChild(im);
    }
    row.appendChild(thumb);

    var info = el("div", "cgp-free__info");
    var nameRow = el("div", "cgp-free__name-row");
    var nameEl = el(link ? "a" : "span", "cgp-free__name", data.title);
    if (link) nameEl.href = link;
    nameRow.appendChild(nameEl);
    nameRow.appendChild(el("span", "cgp-free__badge", "FREE"));
    info.appendChild(nameRow);

    var price = el("div", "cgp-free__price");
    price.appendChild(el("span", "cgp-free__now", money(0, ctx.currency)));
    if (ctx.showStrike) {
      price.appendChild(
        el("span", "cgp-free__was", money(data.price, ctx.currency)),
      );
    }
    info.appendChild(price);

    var select = null;
    if (offered.length > 1) {
      select = el("select", "cgp-free__variant");
      offered.forEach(function (v) {
        var opt = el("option", null, v.title + (v.available ? "" : " — sold out"));
        opt.value = v.id;
        if (!v.available) opt.disabled = true;
        select.appendChild(opt);
      });
      select.value = String(chosen.id);
      // Changing the variant of the currently-picked gift updates the cart plan.
      select.addEventListener("change", function () {
        if (!opts.single || (row.querySelector("input") || {}).checked) {
          opts.onPick(current);
        }
      });
      // Clicking the dropdown shouldn't toggle the row's radio.
      select.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      info.appendChild(select);
    }
    row.appendChild(info);

    function current() {
      if (select) {
        return (
          offered.filter(function (v) {
            return String(v.id) === select.value;
          })[0] || chosen
        );
      }
      return chosen;
    }

    // ctx.freeItems / freeReqs are managed centrally by renderFree.rebuild()
    // (via chosenByGroup) so single- and single-item groups stay consistent.
    return current;
  }

  // Line item properties that mark a free gift. `_cgp_free_for` ties the gift
  // to its main product so reconcile can clean it up from any page once the
  // main is removed (one-to-one). The Function gives the line "🎁 Free Gift"
  // 100% off, so no extra visible tag is needed.
  function freeProps(mainId) {
    return { _cgp_free: "1", _cgp_free_for: String(mainId || "") };
  }

  /* ---------- Commit: add main + selected extras, then reset + open cart ---------- */

  function setupCTA(ctx) {
    if (!ctx.cta) return;
    ctx.cta.addEventListener("click", function () {
      commit(ctx);
    });
    // This block's CTA is now the single add-to-cart, so hide the theme's own
    // add button to avoid two competing buttons / two cart logics.
    hideThemeAddButton();
  }

  function hideThemeAddButton() {
    document
      .querySelectorAll('form[action*="/cart/add"] [name="add"]')
      .forEach(function (b) {
        b.style.display = "none";
      });
  }

  // Add the main product + selected accessories in ONE request, asking for the
  // exact sections the theme's cart element wants, then hand the response to the
  // theme's own renderContents() — so the cart drawer/notification updates and
  // opens exactly like a native add, with no second cart logic to fight.
  function commit(ctx) {
    var cta = ctx.cta;
    var original = cta.textContent;
    cta.disabled = true;
    cta.classList.add("is-loading");

    var cart =
      document.querySelector("cart-notification") ||
      document.querySelector("cart-drawer");
    var mv = mainVariant(ctx);

    fetch("/cart.js", { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (state) {
        var mainInCart = (state.items || []).some(function (it) {
          return String(it.product_id) === ctx.mainProductId;
        });
        var plan = buildPlan(ctx, mainInCart);
        var items = [];
        // Plain main(s): the "just the product" default card's quantity, and/or
        // the shared main add-ons attach to (no bundle tag).
        if (plan.mainsForAddons > 0 && mv.id) {
          items.push({ id: mv.id, quantity: plan.mainsForAddons });
        }
        plan.addonItems.forEach(function (it) {
          items.push({
            id: it.id,
            quantity: it.qty || 1,
            properties: { _addon_for: ctx.mainHandle },
          });
        });
        // Each bundle = its OWN main + accessories, all tagged with a unique
        // instance id (`_cgp_grp`) + the visible bundle name, so the discount
        // Function pairs them and deleting that main reverts only this bundle.
        // Each bundle = its OWN main + accessories, tagged with a unique
        // instance id (`_cgp_grp`) + the visible bundle name. A bundle with a
        // LIVE limited offer also carries `_cgp_lo` (the offer id) so its
        // time-gated node applies the deep price inside the window and the main
        // node takes over after expiry. Same grouping/cleanup either way.
        plan.bundles.forEach(function (b) {
          var grp =
            "b" +
            Date.now().toString(36) +
            Math.random().toString(36).slice(2, 7);
          // Only HIDDEN tags (underscore-prefixed) — no visible "Bundle: name"
          // property. The bundle name is shown via the discount message instead,
          // so it disappears automatically when the kit breaks (main removed).
          var props = function (extra) {
            var p = { _cgp_grp: grp };
            if (b.offerId) p._cgp_lo = b.offerId;
            if (b.bid) p._cgp_bid = b.bid; // which bundle group (main discount)
            // No visible "Bundle: name (code)" property — a static line property
            // would linger after the kit is broken. The name + code ride in the
            // discount MESSAGE instead (see bundleLabel in run.js), so they appear
            // only while the kit is complete and the discount applies, and vanish
            // automatically the moment a bundle item is removed.
            if (extra) for (var k in extra) p[k] = extra[k];
            return p;
          };
          // A bundle tied to a specific main variant adds THAT variant as its main.
          // Quantity N: main + every accessory get quantity N under the SAME grp,
          // so the Function's kitCount = N and all N kits are discounted.
          var bq = b.qty || 1;
          var bundleMainId = b.mainVariantId || mv.id;
          if (bundleMainId) {
            items.push({ id: bundleMainId, quantity: bq, properties: props() });
          }
          b.items.forEach(function (it) {
            items.push({
              id: it.id,
              quantity: bq,
              properties: props({ _addon_for: ctx.mainHandle }),
            });
          });
        });
        // Free gifts ride along with the main, unless already in the cart.
        ctx.freeItems.forEach(function (f) {
          var already = (state.items || []).some(function (it) {
            return (
              String(it.product_id) === f.productId &&
              it.properties &&
              it.properties._cgp_free
            );
          });
          if (already) return;
          var v = f.current();
          if (v)
            items.push({
              id: v.id,
              quantity: 1,
              properties: freeProps(ctx.mainProductId),
            });
        });
        // Campaign gift: add the CHOSEN gift as its own pair with this add. No
        // background reconcile touches it afterwards — the customer deletes what
        // they don't want, and the Function prices only up to the main count
        // (extra gifts revert to full price on their own).
        (giftCampaigns || []).forEach(function (c) {
          if (!giftActive(c)) return;
          var desired = chosenGift(c);
          if (!desired) return;
          items.push({
            handle: desired,
            quantity: Number(c.perQualifying) || 1,
            _giftCampId: c.id, // resolved to a variant id + tag below
          });
        });

        if (!items.length && mv.id) items.push({ id: mv.id, quantity: 1 });

        // Resolve any gift entries (by handle) to a variant id + _cgp_gift tag,
        // then drop any that couldn't resolve, before sending the add.
        return Promise.all(
          items.map(function (it) {
            if (!it._giftCampId) return null;
            return fetchProduct(it.handle).then(function (data) {
              var v = data && firstAvailable(data);
              it.id = v && v.id;
              it.properties = { _cgp_gift: it._giftCampId };
              delete it._giftCampId;
              delete it.handle;
            });
          }),
        ).then(function () {
          var finalItems = items.filter(function (it) {
            return it.id;
          });
          if (!finalItems.length) return null;
          var body = { items: finalItems };
          if (cart && typeof cart.getSectionsToRender === "function") {
            body.sections = cart
              .getSectionsToRender()
              .map(function (s) {
                return s.id;
              })
              .join(",");
            body.sections_url = window.location.pathname;
          }
          return fetch("/cart/add.js", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(body),
          }).then(function (r) {
            return r.json().then(function (b) {
              if (b && b.status) throw b; // Shopify error payload
              if (!r.ok) throw b;
              return b;
            });
          });
        });
      })
      .then(function () {
        cta.classList.remove("is-loading");
        cta.classList.add("is-done");
        cta.textContent = "✓ Added to cart";
        ctx.mainInCart = true; // the main is now in the cart
        clearSelection(ctx);
        document.dispatchEvent(new CustomEvent("cgp:addon:added"));
        return refreshCartUI(true); // explicit add → open the drawer
      })
      .then(function () {
        setTimeout(function () {
          cta.classList.remove("is-done");
          cta.disabled = false;
          updateCTA(ctx);
        }, 1800);
      })
      .catch(function (err) {
        cta.classList.remove("is-loading");
        cta.disabled = false;
        cta.textContent = original;
        try {
          console.error("[cgp] add to cart failed:", err);
        } catch (e) {}
        var msg =
          (err && (err.description || err.message)) ||
          "Could not add to cart.";
        alert(msg);
      });
  }

  function clearSelection(ctx) {
    ctx.extras.clear();
    ctx.resetFns.forEach(function (fn) {
      try {
        fn();
      } catch (e) {}
    });
    updateCounter(ctx);
  }

  // Add items only. The cart UI refresh is a SEPARATE, best-effort step so a
  // theme-specific section quirk can never break the actual add-to-cart.
  function postAdd(ctx, items) {
    return fetch("/cart/add.js", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        items: items.map(function (it) {
          return {
            id: it.id,
            quantity: it.quantity || 1,
            properties: it.addon ? { _addon_for: ctx.mainHandle } : {},
          };
        }),
      }),
    }).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok) throw b;
        return b;
      });
    });
  }

  // Best-effort cart refresh, fully decoupled from the add. Re-renders the
  // theme's cart sections (Section Rendering API), updates the count, opens the
  // drawer. Any failure here never affects the completed add-to-cart.
  // Refresh the cart UI. `shouldOpen` = open the drawer (ONLY after an explicit
  // "Add to cart"). cartBusy is held for the whole refresh so the fetch-watcher
  // ignores our own section fetches (else rerenderDrawer's /cart/update.js would
  // retrigger the watcher → open loop).
  //
  // NB: the theme's native renderContents() (Dawn) OPENS the drawer as a side
  // effect, so we only use it when shouldOpen is true. For passive refreshes we
  // inject fresh sections in place, which updates the (closed) drawer WITHOUT
  // popping it open.
  function refreshCartUI(shouldOpen) {
    cartBusy = true;
    var done = function () {
      cartBusy = false;
    };
    var cartEl =
      document.querySelector("cart-notification") ||
      document.querySelector("cart-drawer");

    if (
      shouldOpen &&
      cartEl &&
      typeof cartEl.getSectionsToRender === "function" &&
      typeof cartEl.renderContents === "function"
    ) {
      return rerenderDrawer().then(done, done); // native render (opens drawer)
    }

    // Passive update, or no native cart API: inject sections in place.
    if (detectSections().length) {
      return renderCartSections()
        .then(updateCount)
        .then(function () {
          if (shouldOpen) openDrawer();
        })
        .then(done, done);
    }

    // Unknown theme: broadcast common events; only hard-reload on an explicit add.
    try {
      document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
      document.documentElement.dispatchEvent(
        new CustomEvent("cart:change", { bubbles: true }),
      );
    } catch (e) {}
    if (shouldOpen) {
      return new Promise(function () {
        window.location.reload();
      });
    }
    done();
    return Promise.resolve();
  }

  function detectSections() {
    var s = [];
    if (document.getElementById("cart-icon-bubble")) s.push("cart-icon-bubble");
    if (document.querySelector("cart-drawer")) s.push("cart-drawer");
    if (document.querySelector("cart-notification")) s.push("cart-notification");
    return s;
  }

  function renderCartSections() {
    var wanted = detectSections();
    if (!wanted.length) return Promise.resolve();
    return fetch(
      window.location.pathname + "?sections=" + encodeURIComponent(wanted.join(",")),
      { headers: { Accept: "application/json" } },
    )
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (sections) {
        if (!sections) return;
        injectSection(
          sections["cart-icon-bubble"],
          "#cart-icon-bubble",
          ".shopify-section",
        );
        injectSection(
          sections["cart-drawer"],
          "#CartDrawer .drawer__inner, .drawer__inner",
          ".drawer__inner",
        );
        injectSection(
          sections["cart-notification"],
          "#cart-notification",
          ".shopify-section",
        );
      })
      .catch(function () {});
  }

  function injectSection(html, targetSelector, innerSelector) {
    if (!html) return;
    var target = document.querySelector(targetSelector);
    if (!target) return;
    try {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var src = doc.querySelector(innerSelector) || doc.body;
      if (src) target.innerHTML = src.innerHTML;
    } catch (e) {}
  }

  function updateCount() {
    return fetch("/cart.js", { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (cart) {
        document
          .querySelectorAll(".cart-count-bubble, [data-cart-count]")
          .forEach(function (n) {
            var span = n.querySelector("span[aria-hidden='true']") || n;
            if (span) span.textContent = cart.item_count;
          });
        document.dispatchEvent(
          new CustomEvent("cart:refresh", { bubbles: true }),
        );
      })
      .catch(function () {});
  }

  function openDrawer() {
    var drawer = document.querySelector("cart-drawer");
    if (drawer && typeof drawer.open === "function") {
      try {
        drawer.open();
      } catch (e) {}
    }
  }

  // ---- Gift campaigns (cross-product "gift with purchase") ----
  // Theme-readable snapshot of active campaigns (set by bootGifts).
  var giftCampaigns = null;
  // Single guard for the one cart reconcile pass (prevents overlap/recursion).
  var cartBusy = false;

  function giftActive(c) {
    var now = Date.now();
    var s = c.startsAt ? Date.parse(c.startsAt) : NaN;
    var e = c.endsAt ? Date.parse(c.endsAt) : NaN;
    if (!isNaN(e) && now >= e) return false;
    if (!isNaN(s) && now < s) return false;
    return true;
  }

  // Which gift the customer chose per campaign. Default = first gift (selected);
  // the sentinel "__none__" means the customer opted OUT (no gift added).
  var giftChoice = {};
  var GIFT_DECLINE = "__none__";
  function chosenGift(c) {
    var handles = c.giftHandles || [];
    var sel = giftChoice[c.id];
    if (sel === GIFT_DECLINE) return null; // customer declined the gift
    // Honor a valid selection in either mode (fixed defaults to the first shown,
    // which may differ from handles[0] when a sold-out gift was hidden).
    if (sel && handles.indexOf(sel) >= 0) return sel;
    return handles[0];
  }

  // On a trigger product page: show the "free gift" badge, and for choice mode a
  // picker so the customer selects which gift they'll get.
  function renderGiftPromo(root) {
    var host = root.querySelector("[data-cgp-giftpromo]");
    if (!host || !giftCampaigns || !giftCampaigns.length) return;
    var currency = root.getAttribute("data-currency") || "USD";
    var active = giftCampaigns.filter(function (c) {
      return giftActive(c) && (c.giftHandles || []).length;
    });
    if (!active.length) {
      host.hidden = true;
      return;
    }
    // Prefetch each active campaign's gift products so availability + price/title
    // are known up front (needed for "hide when sold out" and the struck price).
    Promise.all(
      active.map(function (c) {
        return Promise.all((c.giftHandles || []).map(fetchProduct));
      }),
    ).then(function (allData) {
      host.innerHTML = "";
      var any = false;
      active.forEach(function (c, ci) {
        var handles = c.giftHandles || [];
        var datas = allData[ci];
        var isAvail = function (i) {
          var d = datas[i];
          return d
            ? d.variants.some(function (v) {
                return v.available;
              })
            : true;
        };
        // "choice" shows every gift; "fixed" shows just the first. Drop sold-out
        // gifts when the campaign hides them; skip the whole group if none remain.
        var idx =
          c.rewardMode === "choice"
            ? handles.map(function (_h, i) {
                return i;
              })
            : [0];
        if (c.hideWhenSoldOut) idx = idx.filter(isAvail);
        if (!idx.length) return;
        any = true;

        var section = el("div", "cgp-free");
        section.appendChild(
          el("div", "cgp-free__heading", c.badge || "🎁 Free gift"),
        );
        section.appendChild(
          el("div", "cgp-free__sub", c.subtitle || "Choose your free gift:"),
        );
        var groupName = "cgp-gift-" + c.id;
        var list = el("div", "cgp-free__list");
        section.appendChild(list);

        // Default = first shown gift. If the prior choice is now hidden, reset.
        var shownHandles = idx.map(function (i) {
          return handles[i];
        });
        if (giftChoice[c.id] === undefined) giftChoice[c.id] = shownHandles[0];
        if (
          giftChoice[c.id] !== GIFT_DECLINE &&
          shownHandles.indexOf(giftChoice[c.id]) < 0
        ) {
          giftChoice[c.id] = shownHandles[0];
        }

        idx.forEach(function (i) {
          var h = handles[i];
          var data = datas[i];
          var row = el("label", "cgp-free__row");
          list.appendChild(row);

          var selector = el("input", "cgp-free__radio");
          selector.type = "radio";
          selector.name = groupName;
          selector.checked = giftChoice[c.id] === h;
          selector.addEventListener("change", function () {
            if (selector.checked) giftChoice[c.id] = h;
          });
          row.appendChild(selector);

          // Image + title link to the product page (new tab). stopPropagation
          // keeps the click from toggling the radio.
          var href = (data && data.url) || "/products/" + h;
          var stop = function (e) {
            e.stopPropagation();
          };
          var thumb = el("a", "cgp-free__thumb");
          thumb.href = href;
          thumb.target = "_blank";
          thumb.rel = "noopener";
          thumb.addEventListener("click", stop);
          var img =
            data && (data.featured_image || (data.images && data.images[0]));
          if (img) {
            var im = el("img");
            im.src = img;
            im.alt = (data && data.title) || h;
            im.loading = "lazy";
            thumb.appendChild(im);
          }
          row.appendChild(thumb);

          var info = el("div", "cgp-free__info");
          var nameRow = el("div", "cgp-free__name-row");
          var nameEl = el("a", "cgp-free__name");
          nameEl.textContent = (data && data.title) || h;
          nameEl.href = href;
          nameEl.target = "_blank";
          nameEl.rel = "noopener";
          nameEl.addEventListener("click", stop);
          nameRow.appendChild(nameEl);
          // Struck original price so the customer sees the gift's value.
          var val = data && (data.compare_at_price || data.price);
          if (val)
            nameRow.appendChild(
              el("span", "cgp-free__price", money(val, currency)),
            );
          nameRow.appendChild(el("span", "cgp-free__badge", "FREE"));
          info.appendChild(nameRow);
          row.appendChild(info);
        });

        // Opt-out row — the customer can decline the free gift entirely.
        var declineRow = el("label", "cgp-free__row cgp-free__row--decline");
        list.appendChild(declineRow);
        var declineRadio = el("input", "cgp-free__radio");
        declineRadio.type = "radio";
        declineRadio.name = groupName;
        declineRadio.checked = giftChoice[c.id] === GIFT_DECLINE;
        declineRadio.addEventListener("change", function () {
          if (declineRadio.checked) giftChoice[c.id] = GIFT_DECLINE;
        });
        declineRow.appendChild(declineRadio);
        declineRow.appendChild(
          el(
            "span",
            "cgp-free__decline",
            "No thanks — I don't want the free gift",
          ),
        );

        host.appendChild(section);
      });
      host.hidden = !any;
    });
  }

  function bootGifts(root) {
    if (window.__cgpGiftsBooted) return;
    var node = root.querySelector("[data-cgp-gifts]");
    if (!node) return;
    var raw;
    try {
      raw = JSON.parse(node.textContent);
    } catch (e) {
      raw = null;
    }
    if (!raw || !raw.length) return;
    // Normalise the product's gift_trigger entries into the campaign shape used
    // by the promo UI + the commit's gift-add (accepts both `triggers`/`gifts`
    // and the older `triggerProductIds`/`giftHandles`).
    giftCampaigns = raw.map(function (e) {
      return {
        id: e.id,
        rewardMode: e.rewardMode || "fixed",
        perQualifying: Number(e.perQualifying) || 1,
        startsAt: e.startsAt || "",
        endsAt: e.endsAt || "",
        badge: e.badge || "🎁 Free gift",
        subtitle: e.subtitle || "",
        hideWhenSoldOut: !!e.hideWhenSoldOut,
        triggerProductIds: e.triggers || e.triggerProductIds || [],
        giftHandles: e.gifts || e.giftHandles || [],
      };
    });
    if (!giftCampaigns.length) return;
    window.__cgpGiftsBooted = true;
    // No cart watcher / reconcile: gifts are added (paired) on Add to cart, and
    // the discount Function prices them (free up to the main count). The customer
    // deletes what they don't want; nothing is auto-added or swapped.
    renderGiftPromo(root);
  }

  function cartPost(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json();
      })
      .catch(function () {});
  }


  // Re-render the cart drawer via the theme's own renderContents, fed by a fresh
  // POST /cart/update.js (a no-op update that returns the rendered sections).
  // POST responses aren't cached, and renderContents is the theme's native path.
  function rerenderDrawer() {
    var cart =
      document.querySelector("cart-notification") ||
      document.querySelector("cart-drawer");
    if (
      !cart ||
      typeof cart.getSectionsToRender !== "function" ||
      typeof cart.renderContents !== "function"
    ) {
      return renderCartSections().then(updateCount);
    }
    var ids = cart.getSectionsToRender().map(function (s) {
      return s.id;
    });
    return fetch("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sections: ids,
        sections_url: window.location.pathname,
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (state) {
        try {
          cart.renderContents(state);
        } catch (e) {}
        // Keep the empty/not-empty class correct, or the empty-state layout
        // (which needs `is-empty`) renders broken.
        if (state && typeof state.item_count === "number") {
          cart.classList.toggle("is-empty", state.item_count === 0);
        }
      })
      .catch(function () {});
  }

  function boot() {
    document.querySelectorAll("[data-cgp-addon]").forEach(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
