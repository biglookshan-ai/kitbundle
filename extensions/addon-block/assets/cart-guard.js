/* KitBundle cart guard — site-wide (app embed).
 *
 * Gift and "included" lines added by KitBundle carry hidden properties:
 *   _cgp_gift  campaign id        _cgp_main  main variant id it came with
 *   _cgp_per   units per main     _cgp_inc   "1" for included parts
 * After any cart change we make sure each such line has at most
 * (main units in cart × _cgp_per) units, removing it when its main is gone.
 * Included parts also lose their product links inside the cart.
 * (The checkout rule still blocks anything that slips through.) */
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

  function json(r) {
    return r.json();
  }
  function getCart() {
    return origFetch("/cart.js", { headers: { Accept: "application/json" } }).then(json);
  }

  // Allowed units per guarded line = main units in the cart × per.
  function plan(cart) {
    var mains = {};
    (cart.items || []).forEach(function (it) {
      var p = it.properties || {};
      if (p._cgp_gift || p._addon_for) return; // gifts / kit parts aren't mains
      mains[String(it.variant_id)] = (mains[String(it.variant_id)] || 0) + it.quantity;
    });
    var updates = {};
    var n = 0;
    (cart.items || []).forEach(function (it) {
      var p = it.properties || {};
      if (!p._cgp_gift || !p._cgp_main) return; // older lines: leave alone
      var per = Math.max(1, parseInt(p._cgp_per, 10) || 1);
      var allowed = (mains[String(p._cgp_main)] || 0) * per;
      if (it.quantity > allowed) {
        updates[it.key] = allowed;
        n++;
      }
    });
    return n ? updates : null;
  }

  // Re-render the theme's cart (drawer via its own renderer, else reload /cart).
  function applyUpdates(updates) {
    var drawer = document.querySelector("cart-drawer") || document.querySelector("cart-notification");
    var canRender =
      drawer &&
      typeof drawer.getSectionsToRender === "function" &&
      typeof drawer.renderContents === "function";
    var body = { updates: updates };
    if (canRender) {
      body.sections = drawer.getSectionsToRender().map(function (s) {
        return s.id;
      });
      body.sections_url = window.location.pathname;
    }
    var headers = { "Content-Type": "application/json", Accept: "application/json" };
    headers[OWN] = "1";
    return origFetch("/cart/update.js", {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    })
      .then(json)
      .then(function (state) {
        if (/^\/cart\/?$/.test(window.location.pathname)) {
          window.location.reload();
          return;
        }
        if (canRender && state && state.sections) {
          try {
            drawer.renderContents(state);
            if (typeof state.item_count === "number") {
              drawer.classList.toggle("is-empty", state.item_count === 0);
            }
          } catch (e) {}
        }
        return state;
      });
  }

  // Included parts: no links to their (button-less) product page in the cart.
  function unlinkIncluded(cart) {
    var handles = (cart && cart.items ? cart.items : [])
      .filter(function (it) {
        var p = it.properties || {};
        return p._cgp_inc || p["Included with"];
      })
      .map(function (it) {
        return it.handle;
      });
    if (!handles.length) return;
    var scopes = document.querySelectorAll(
      'cart-drawer, cart-notification, cart-items, #CartDrawer, #cart-notification, form[action="/cart"], form[action*="/cart"]',
    );
    Array.prototype.forEach.call(scopes, function (scope) {
      handles.forEach(function (h) {
        var links = scope.querySelectorAll('a[href*="/products/' + h + '"]');
        Array.prototype.forEach.call(links, function (a) {
          a.removeAttribute("href");
          a.setAttribute("aria-disabled", "true");
          a.setAttribute("tabindex", "-1");
          a.style.pointerEvents = "none";
          a.style.cursor = "default";
          a.style.textDecoration = "none";
        });
      });
    });
  }

  function check() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    getCart()
      .then(function (cart) {
        lastCart = cart;
        var updates = plan(cart);
        if (updates) return applyUpdates(updates).then(getCart).then(function (c) {
          lastCart = c;
        });
      })
      .catch(function () {})
      .then(function () {
        busy = false;
        unlinkIncluded(lastCart);
        if (again) {
          again = false;
          setTimeout(check, 50);
        }
      });
  }

  // Run after every cart change the theme (or another app) makes.
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var own = init && init.headers && (init.headers[OWN] || (init.headers.get && init.headers.get(OWN)));
    var p = origFetch.apply(this, arguments);
    if (!own && CART_RE.test(url)) {
      p.then(function () {
        setTimeout(check, 150);
      }, function () {});
    }
    return p;
  };

  // Keep included links disabled when the theme re-renders its cart.
  var t = null;
  new MutationObserver(function () {
    if (!lastCart) return;
    clearTimeout(t);
    t = setTimeout(function () {
      unlinkIncluded(lastCart);
    }, 80);
  }).observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", check);
  } else {
    check();
  }
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) check();
  });
})();
