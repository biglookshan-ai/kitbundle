/**
 * Public privacy policy — the URL required by the App Store listing.
 * No auth: served at https://<app-host>/privacy
 */
export const loader = () => {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KitBundle — Privacy Policy</title>
<style>
  body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
       max-width:720px;margin:0 auto;padding:48px 20px;color:#202223}
  h1{font-size:28px} h2{font-size:20px;margin-top:32px}
  a{color:#005bd3}
</style>
</head>
<body>
<h1>KitBundle Privacy Policy</h1>
<p>Last updated: July 17, 2026</p>

<p>KitBundle ("the App") provides product bundles, add-on offers and free-gift
campaigns for Shopify stores. This policy describes what information the App
handles and how.</p>

<h2>Information we collect</h2>
<p>The App stores only <strong>shop-level configuration</strong>:</p>
<ul>
  <li>Your shop domain and the offer settings you create (which products are
      bundled, discount percentages, campaign schedules).</li>
  <li>OAuth session tokens required to operate the App, provided by Shopify.</li>
</ul>
<p>The App does <strong>not</strong> collect, store or process customer
personal information. Discounts are computed inside Shopify's own
infrastructure (Shopify Functions); customer carts and orders never leave
Shopify.</p>

<h2>How we use information</h2>
<p>Configuration data is used solely to display your offers on your storefront
and to apply the discounts you configured. We do not sell, rent or share any
data with third parties.</p>

<h2>Data retention &amp; deletion</h2>
<ul>
  <li>Uninstalling the App deletes your sessions and configuration from our
      database automatically.</li>
  <li>We honor Shopify's mandatory privacy webhooks: shop data is purged on
      <code>shop/redact</code>; <code>customers/data_request</code> and
      <code>customers/redact</code> are no-ops because we hold no customer
      data.</li>
</ul>

<h2>Hosting</h2>
<p>The App's backend and database are hosted on Railway (railway.app) in the
United States, secured with TLS in transit.</p>

<h2>Contact</h2>
<p>Questions about this policy: <a href="mailto:biglookshan@gmail.com">biglookshan@gmail.com</a></p>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
