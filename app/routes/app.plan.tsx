import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  authenticate,
  PRO_PLAN,
  BILLING_TEST,
  BILLING_ENABLED,
} from "../shopify.server";
import { FREE_PRODUCT_LIMIT, FREE_CAMPAIGN_LIMIT } from "../models/plan";
import { isFreeShop } from "../models/plan.server";
import { Shell, PageHead, Panel, Pill, Banner, Btn } from "../ui/kit";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  if (!BILLING_ENABLED) throw redirect("/app"); // free launch → no plan page
  const comped = isFreeShop(session.shop);
  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: [PRO_PLAN],
    isTest: BILLING_TEST,
  });
  const sub = appSubscriptions?.[0] ?? null;
  return {
    pro: hasActivePayment,
    comped,
    subName: sub?.name ?? null,
    test: BILLING_TEST,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "upgrade");

  if (intent === "cancel") {
    const { appSubscriptions } = await billing.check({
      plans: [PRO_PLAN],
      isTest: BILLING_TEST,
    });
    const sub = appSubscriptions?.[0];
    if (sub) {
      await billing.cancel({
        subscriptionId: sub.id,
        isTest: BILLING_TEST,
        prorate: true,
      });
    }
    return { ok: true };
  }

  // Upgrade: redirects the merchant to Shopify's subscription confirmation.
  await billing.request({
    plan: PRO_PLAN,
    isTest: BILLING_TEST,
    returnUrl: `https://${session.shop}/admin/apps`,
  });
  return { ok: true };
};

export default function Plan() {
  const { pro, comped, test } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  return (
    <Shell section="Plan">
      <PageHead title="Plan" subtitle="Your KitBundle subscription." />

      {comped ? (
        <Banner tone="ok">
          <b>Complimentary access.</b> This store has full access to all features
          at no charge. No subscription needed.
        </Banner>
      ) : null}
      {test ? (
        <Banner>
          Billing is in TEST mode — no real charges. (Disable
          SHOPIFY_BILLING_TEST before launch.)
        </Banner>
      ) : null}

      <div className="kb-plans">
        <div className="kb-plan">
          <Panel title="Free" actions={!pro ? <Pill tone="ok">Current plan</Pill> : null}>
            <div className="kb-plan__price">$0</div>
            <ul>
              <li>{FREE_PRODUCT_LIMIT} product with bundles &amp; add-ons</li>
              <li>{FREE_CAMPAIGN_LIMIT} gift campaign</li>
              <li>All offer types included</li>
              <li>Automatic Function-based discounts</li>
            </ul>
          </Panel>
        </div>
        <div className="kb-plan">
          <Panel title="Pro" actions={pro ? <Pill tone="ok">Current plan</Pill> : null}>
            <div className="kb-plan__price">
              $29<small>/ month</small>
            </div>
            <ul>
              <li>Unlimited products</li>
              <li>Unlimited gift campaigns</li>
              <li>Limited-time offers &amp; countdowns</li>
              <li>Priority support</li>
            </ul>
            {pro ? (
              <Btn
                variant="danger"
                loading={busy}
                onClick={() => fetcher.submit({ intent: "cancel" }, { method: "POST" })}
              >
                Cancel subscription
              </Btn>
            ) : (
              <Btn
                variant="primary"
                loading={busy}
                onClick={() => fetcher.submit({ intent: "upgrade" }, { method: "POST" })}
              >
                Start 7-day free trial
              </Btn>
            )}
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
