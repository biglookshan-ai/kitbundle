/* KitBundle cart guard — site-wide (app embed).
 *
 * Gift lines added by KitBundle carry hidden properties:
 *   _cgp_gift  campaign id        _cgp_main  main variant id it came with
 *   _cgp_per   units per main     _cgp_inc   "1" for included parts
 *
 * After any cart change (from any page, quick add, another app):
 * - "Included" campaigns (2026-11-09) work like a bundle: every main product
 *   in the cart gets its parts (main units × each part's qty), added here, not
 *   on the product page. They're listed right under their main product with no
 *   price, no quantity box and no link.
 * - Free gifts never exceed (main units × per); they go when the main goes.
 * The checkout rule still blocks anything that slips through. */
(function () {
  "use strict";
  if (window.__kbCartGuard) return;
  window.__kbCartGuard = true;

  var CART_RE = /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/;
  var OWN = "x-kb-cart-guard";
  var busy = false;
  var again = false;
  var lastCart = null;
  var origFetch = window.fetch;
  var stamps = {}; // product handle → gift_trigger entries ([] = none)
  var TTL = 10 * 60 * 1000;

  function json(r) {
    return r.json();
  }
  function getCart() {
    return origFetch("/cart.js", { headers: { Accept: "application/json" } }).then(json);
  }
  function props(it) {
    return it.properties || {};
  }
  function isMain(it) {
    var p = props(it);
    return !p._cgp_gift && !p._addon_for;
  }

  /* ---------- Stamps (which campaigns a product triggers) ---------- */

  // Seeded by the embed (cart items + this product) on every page load.
  try {
    var seed = document.querySelector("script[data-kb-stamps]");
    if (seed) {
      var s = JSON.parse(seed.textContent || "{}");
      Object.keys(s).forEach(function (h) {
        if (h) stamps[h] = Array.isArray(s[h]) ? s[h] : [];
      });
    }
  } catch (e) {}

  function cached(h) {
    try {
      var c = JSON.parse(sessionStorage.getItem("kbst:" + h) || "null");
      if (c && Date.now() - c.t < TTL) return c.v;
    } catch (e) {}
    return null;
  }
  // A product added from another page: read the stamp its product page carries.
  function fetchStamp(h) {
    return origFetch("/products/" + encodeURIComponent(h))
      .then(function (r) {
        return r.ok ? r.text() : "";
      })
      .then(function (html) {
        var m = /<script[^>]*data-cgp-gifts[^>]*>([\s\S]*?)<\/script>/.exec(html);
        var v = [];
        try {
          v = m ? JSON.parse(m[1]) : [];
        } catch (e) {}
        if (!Array.isArray(v)) v = [];
        try {
          sessionStorage.setItem("kbst:" + h, JSON.stringify({ t: Date.now(), v: v }));
        } catch (e) {}
        return v;
      })
      .catch(function () {
        return [];
      });
  }
  function loadStamps(cart) {
    var need = [];
    (cart.items || []).forEach(function (it) {
      if (!isMain(it) || !it.handle || stamps[it.handle]) return;
      var c = cached(it.handle);
      if (c) stamps[it.handle] = c;
      else if (need.indexOf(it.handle) < 0) need.push(it.handle);
    });
    return Promise.all(
      need.map(function (h) {
        return fetchStamp(h).then(function (v) {
          stamps[h] = v;
        });
      }),
    );
  }

  /* ---------- Campaign rules (same as the discount / checkout rule) ---------- */

  function today() {
    var d = new Date();
    var p = function (n) {
      return (n < 10 ? "0" : "") + n;
    };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function dateOk(e, t) {
    var s = e.startDate || (e.startsAt ? String(e.startsAt).slice(0, 10) : "");
    var en = e.endDate || (e.endsAt ? String(e.endsAt).slice(0, 10) : "");
    return !(s && t < s) && !(en && t > en);
  }
  function winners(list) {
    if (list.length <= 1) return list;
    var sorted = list
      .map(function (c, i) {
        return { c: c, i: i };
      })
      .sort(function (a, b) {
        return (Number(b.c.priority) || 0) - (Number(a.c.priority) || 0) || a.i - b.i;
      })
      .map(function (x) {
        return x.c;
      });
    if (sorted[0].exclusive) return [sorted[0]];
    return sorted.filter(function (c) {
      return !c.exclusive;
    });
  }
  function qtyOf(e, t) {
    var n = e.giftQty && Number(e.giftQty[t]);
    return n >= 1 ? Math.floor(n) : 1;
  }
  function label(it) {
    var t = String(it.product_title || "").replace(/^[#\s]+/, "").replace(/\s+/g, " ").trim();
    if (t.length > 42) t = t.slice(0, 43).replace(/\s+\S*$/, "").replace(/[\s,(-]+$/, "") + "…";
    var v = it.variant_title && it.variant_title !== "Default Title" ? " (" + it.variant_title + ")" : "";
    return t + v;
  }

  // What the cart should hold. Returns { updates: {key: qty}, adds: [...] }.
  function plan(cart) {
    var items = cart.items || [];
    var mains = {}; // variant id → units
    var mainLine = {}; // variant id → a line (for the label)
    items.forEach(function (it) {
      if (!isMain(it)) return;
      var v = String(it.variant_id);
      mains[v] = (mains[v] || 0) + it.quantity;
      mainLine[v] = mainLine[v] || it;
    });

    // Included parts each main variant needs: "camp|main|giftId" → need.
    var want = {};
    var t = today();
    Object.keys(mains).forEach(function (v) {
      var it = mainLine[v];
      var valid = (stamps[it.handle] || []).filter(function (e) {
        return (
          e && e.id && e.kind !== "deal" && dateOk(e, t) &&
          !(e.triggerVariants && e.triggerVariants.length && e.triggerVariants.map(String).indexOf(v) < 0)
        );
      });
      winners(valid).forEach(function (e) {
        if (!e.included) return;
        (e.giftIds || []).forEach(function (gid, i) {
          var h = (e.gifts || [])[i];
          if (!h) return;
          var per = qtyOf(e, String(gid));
          want[e.id + "|" + v + "|" + gid] = {
            camp: e.id, main: v, gid: String(gid), handle: h, per: per,
            qty: mains[v] * per, allowed: (e.giftVariants || {})[gid] || [],
            label: label(it),
          };
        });
      });
    });

    var updates = {};
    var n = 0;
    items.forEach(function (it) {
      var p = props(it);
      if (!p._cgp_gift || !p._cgp_main) return; // older lines: leave alone
      var k = p._cgp_gift + "|" + p._cgp_main + "|" + it.product_id;
      var target;
      if (want[k]) {
        target = want[k].seen ? 0 : want[k].qty; // one line per part
        want[k].seen = true;
      } else {
        var per = Math.max(1, parseInt(p._cgp_per, 10) || 1);
        target = Math.min(it.quantity, (mains[String(p._cgp_main)] || 0) * per);
      }
      if (it.quantity !== target) {
        updates[it.key] = target;
        n++;
      }
    });
    var adds = Object.keys(want)
      .map(function (k) {
        return want[k];
      })
      .filter(function (w) {
        return !w.seen && w.qty > 0;
      });
    return { updates: n ? updates : null, adds: adds };
  }

  /* ---------- Applying + re-rendering the theme's cart ---------- */

  function drawer() {
    var d = document.querySelector("cart-drawer") || document.querySelector("cart-notification");
    return d && typeof d.getSectionsToRender === "function" ? d : null;
  }
  function post(url, body) {
    var d = drawer();
    if (d) {
      body.sections = d.getSectionsToRender().map(function (s) {
        return s.id;
      });
      body.sections_url = window.location.pathname;
    }
    var headers = { "Content-Type": "application/json", Accept: "application/json" };
    headers[OWN] = "1";
    return origFetch(url, { method: "POST", headers: headers, body: JSON.stringify(body) }).then(json);
  }
  // Swap the drawer's sections in place (without opening it).
  function render(state) {
    var d = drawer();
    if (!d || !state || !state.sections) return;
    d.getSectionsToRender().forEach(function (s) {
      var html = state.sections[s.id];
      var el = s.selector ? document.querySelector(s.selector) : document.getElementById(s.id);
      if (!html || !el) return;
      var doc = new DOMParser().parseFromString(html, "text/html");
      var src = doc.querySelector(s.selector || ".shopify-section");
      if (src) el.innerHTML = src.innerHTML;
    });
    if (typeof state.item_count === "number") d.classList.toggle("is-empty", state.item_count === 0);
  }

  function variantFor(w) {
    return origFetch("/products/" + encodeURIComponent(w.handle) + ".js", { headers: { Accept: "application/json" } })
      .then(json)
      .then(function (p) {
        var vs = (p && p.variants) || [];
        var ok = w.allowed.length
          ? vs.filter(function (v) {
              return w.allowed.map(String).indexOf(String(v.id)) >= 0;
            })
          : vs;
        var v = ok.filter(function (x) {
          return x.available;
        })[0] || ok[0];
        return v ? v.id : null;
      })
      .catch(function () {
        return null;
      });
  }

  function apply(pl) {
    var steps = Promise.resolve(null);
    var changed = false;
    if (pl.updates) {
      changed = true;
      steps = steps.then(function () {
        return post("/cart/update.js", { updates: pl.updates });
      });
    }
    if (pl.adds.length) {
      steps = steps
        .then(function (st) {
          return Promise.all(pl.adds.map(variantFor)).then(function (ids) {
            var items = [];
            pl.adds.forEach(function (w, i) {
              if (!ids[i]) return;
              items.push({
                id: ids[i],
                quantity: w.qty,
                properties: {
                  _cgp_gift: w.camp,
                  _cgp_main: w.main,
                  _cgp_per: String(w.per),
                  _cgp_inc: "1",
                  "Included with": w.label,
                },
              });
            });
            if (!items.length) return st;
            changed = true;
            return post("/cart/add.js", { items: items });
          });
        });
    }
    return steps.then(function (st) {
      if (!changed) return false;
      if (/^\/cart\/?$/.test(window.location.pathname)) {
        window.location.reload();
        return true;
      }
      if (st && st.sections) {
        if (st.items && typeof st.item_count === "number") {
          lastCart = st;
          fresh = true;
        }
        render(st);
      }
      else if (st) {
        // /cart/add.js returns the added items only: fetch fresh sections.
        var d = drawer();
        if (d) {
          var ids = d.getSectionsToRender().map(function (s) {
            return s.id;
          });
          return origFetch(window.location.pathname + "?sections=" + ids.join(","))
            .then(json)
            .then(function (sections) {
              render({ sections: sections });
              return true;
            })
            .catch(function () {
              return true;
            });
        }
      }
      return true;
    });
  }

  /* ---------- How included parts look in the cart ---------- */

  var css =
    ".kb-inc-row .cart-item__totals>*:not(.kb-inc-tag),.kb-inc-row .cart-item__price-wrapper," +
    ".kb-inc-row .cart-item__details>div.product-option,.kb-inc-row .discounts," +
    ".kb-inc-row quantity-input,.kb-inc-row cart-remove-button,.kb-inc-row .cart-item__error{display:none!important}" +
    ".kb-inc-row td{padding-top:0!important}" +
    ".kb-inc-row .cart-item__media{padding-left:2.4rem}" +
    ".kb-inc-row .cart-item__image{max-width:64%;height:auto}" +
    ".kb-inc-row .cart-item__name{font-size:.92em}" +
    ".kb-inc-tag,.kb-inc-qty{font-size:.85em;opacity:.75;white-space:nowrap}";
  function styles() {
    if (document.getElementById("kb-cart-guard-css")) return;
    var st = document.createElement("style");
    st.id = "kb-cart-guard-css";
    st.textContent = css;
    document.head.appendChild(st);
  }

  // Included-part rows, recognised straight from the DOM (their "Included
  // with:" line), so they never show as an ordinary product, not even for the
  // moment between the theme re-rendering and our next cart read.
  function isIncRow(row) {
    return Array.prototype.some.call(row.querySelectorAll("dt"), function (dt) {
      return /^\s*Included with/i.test(dt.textContent);
    });
  }
  function styleRow(row) {
    row.classList.add("kb-inc-row");
    var tot = row.querySelector(".cart-item__totals");
    if (tot && !tot.querySelector(".kb-inc-tag")) {
      var tag = document.createElement("span");
      tag.className = "kb-inc-tag";
      tag.textContent = "Included";
      tot.appendChild(tag);
    }
    var input = row.querySelector("input.quantity__input, input[name='updates[]']");
    var n = input ? parseInt(input.value, 10) || 1 : 1;
    var q = row.querySelector(".cart-item__quantity-wrapper, .cart-item__quantity");
    var qs = row.querySelector(".kb-inc-qty");
    if (q && n > 1 && !qs) {
      qs = document.createElement("span");
      qs.className = "kb-inc-qty";
      q.appendChild(qs);
    }
    if (qs && qs.textContent !== (n > 1 ? "× " + n : "")) qs.textContent = n > 1 ? "× " + n : "";
    // Internal part names start with "#": shoppers shouldn't see it.
    var nm = row.querySelector(".cart-item__name");
    if (nm && nm.childNodes.length === 1 && /^\s*#/.test(nm.textContent)) {
      nm.textContent = nm.textContent.replace(/^\s*#\s*/, "");
    }
    Array.prototype.forEach.call(row.querySelectorAll('a[href*="/products/"]'), function (a) {
      var m = /variant=(\d+)/.exec(a.getAttribute("href") || "");
      if (m) row.setAttribute("data-kb-vid", m[1]);
      a.removeAttribute("href");
      a.setAttribute("aria-disabled", "true");
      a.setAttribute("tabindex", "-1");
      a.style.pointerEvents = "none";
      a.style.textDecoration = "none";
    });
  }
  function rowVid(row) {
    if (row.getAttribute("data-kb-vid")) return row.getAttribute("data-kb-vid");
    var a = row.querySelector('a[href*="variant="]');
    var m = a && /variant=(\d+)/.exec(a.getAttribute("href"));
    return m ? m[1] : "";
  }
  function decorate() {
    var rows = document.querySelectorAll('[id^="CartDrawer-Item-"], [id^="CartItem-"]');
    var any = false;
    Array.prototype.forEach.call(rows, function (row) {
      if (!isIncRow(row)) return;
      any = true;
      styleRow(row);
    });
    if (any) styles();
    // Sit right under the main product (needs the cart: which main it's for).
    var items = (lastCart && lastCart.items) || [];
    if (!any || !items.length) return;
    items.forEach(function (it, i) {
      var p = props(it);
      if (!(p._cgp_inc || p["Included with"]) || !p._cgp_main) return;
      var mi = -1;
      items.forEach(function (m, j) {
        if (mi < 0 && isMain(m) && String(m.variant_id) === String(p._cgp_main)) mi = j;
      });
      if (mi < 0) return;
      ["CartDrawer-Item-", "CartItem-"].forEach(function (prefix) {
        var row = document.getElementById(prefix + (i + 1));
        var main = document.getElementById(prefix + (mi + 1));
        // Row numbers only match the cart we read if the variants agree.
        if (!row || !main || rowVid(row) !== String(it.variant_id) || rowVid(main) !== String(p._cgp_main)) return;
        if (main.parentNode !== row.parentNode) return;
        var at = main;
        while (at.nextElementSibling && at.nextElementSibling !== row && at.nextElementSibling.classList.contains("kb-inc-row")) {
          at = at.nextElementSibling;
        }
        if (at.nextElementSibling !== row) at.after(row);
      });
    });
  }

  /* ---------- Quantity changes: main + its parts in ONE request ---------- */

  // The theme changes one line (`line` = row number, or `id`). If that's a
  // main product with parts, change the parts in the same request, so the
  // cart never shows them out of step; a part on its own can't be changed.
  function bundleUpdates(cart, body) {
    var items = cart.items || [];
    var it = body.line
      ? items[Number(body.line) - 1]
      : items.filter(function (x) {
          return x.key === body.id || String(x.variant_id) === String(body.id);
        })[0];
    if (!it) return null;
    var q = Math.max(0, parseInt(body.quantity, 10) || 0);
    var p = props(it);
    var units = function (vid, self, selfQty) {
      return items.reduce(function (n, x) {
        if (!isMain(x) || String(x.variant_id) !== String(vid)) return n;
        return n + (x === self ? selfQty : x.quantity);
      }, 0);
    };
    var up = {};
    if (p._cgp_inc && p._cgp_main) {
      up[it.key] = units(p._cgp_main) * Math.max(1, parseInt(p._cgp_per, 10) || 1);
      return up;
    }
    if (!isMain(it)) return null;
    var u = units(it.variant_id, it, q);
    var n = 0;
    items.forEach(function (x) {
      var xp = props(x);
      if (!xp._cgp_gift || String(xp._cgp_main) !== String(it.variant_id)) return;
      var per = Math.max(1, parseInt(xp._cgp_per, 10) || 1);
      // Included parts follow the main; free gifts only go down with it.
      up[x.key] = xp._cgp_inc ? u * per : Math.min(x.quantity, u * per);
      n++;
    });
    if (!n) return null;
    up[it.key] = q;
    return up;
  }

  function remember(r) {
    // Keep our copy of the cart in step with what the theme is about to render.
    r.clone()
      .json()
      .then(function (st) {
        if (st && st.items && typeof st.item_count === "number") {
          delete st.sections;
          lastCart = st;
          fresh = true;
        }
      })
      .catch(function () {});
    return r;
  }

  function changeAsBundle(input, init, body) {
    version++;
    var cartP = fresh && lastCart ? Promise.resolve(lastCart) : getCart();
    return cartP
      .then(function (cart) {
        lastCart = cart;
        var up = bundleUpdates(cart, body);
        if (!up) return origFetch(input, init);
        var nb = { updates: up };
        if (body.sections) nb.sections = body.sections;
        if (body.sections_url) nb.sections_url = body.sections_url;
        var headers = { "Content-Type": "application/json", Accept: "application/json" };
        headers[OWN] = "1";
        return origFetch("/cart/update.js", { method: "POST", headers: headers, body: JSON.stringify(nb) });
      })
      .then(function (r) {
        return r.ok ? remember(r) : r;
      });
  }

  /* ---------- Run after every cart change ---------- */

  var fresh = false; // lastCart matches the rendered cart
  var version = 0; // bumps on every cart request from the theme / other apps

  function check() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    var v = version;
    getCart()
      .then(function (cart) {
        lastCart = cart;
        fresh = true;
        return loadStamps(cart).then(function () {
          // The cart changed meanwhile: plan again on the new one.
          if (v !== version) {
            again = true;
            return false;
          }
          return apply(plan(cart));
        });
      })
      .then(function (changed) {
        if (changed) return getCart().then(function (c) {
          lastCart = c;
        });
      })
      .catch(function () {})
      .then(function () {
        busy = false;
        decorate();
        if (again) {
          again = false;
          setTimeout(check, 50);
        }
      });
  }

  var CHANGE_RE = /\/cart\/change(\.js)?(\?|$)/;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var own = init && init.headers && (init.headers[OWN] || (init.headers.get && init.headers.get(OWN)));
    if (own || !CART_RE.test(url)) return origFetch.apply(this, arguments);
    version++;
    var p;
    var body = null;
    if (CHANGE_RE.test(url) && init && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch (e) {}
    }
    if (body && (body.line || body.id) && body.quantity !== undefined) {
      p = changeAsBundle(input, init, body);
    } else {
      if (!/\/cart\/change/.test(url)) fresh = false; // add / update / clear: re-read
      p = origFetch.apply(this, arguments);
    }
    p.then(function () {
      setTimeout(check, 150);
    }, function () {});
    return p;
  };

  // Style included rows the moment the theme renders them (before paint).
  var styling = false;
  var mo = new MutationObserver(function () {
    if (styling) return;
    styling = true;
    try {
      decorate();
    } catch (e) {}
    mo.takeRecords();
    styling = false;
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", check);
  else check();
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) check();
  });
})();
