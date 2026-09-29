import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  ensureFunctionDiscount,
  findDiscountFunctionId,
  findExistingDiscount,
} from "../models/function-discount.server";
import {
  getShopSettings,
  saveShopSettings,
} from "../models/shop-settings.server";
import {
  Shell,
  PageHead,
  Panel,
  Pill,
  Banner,
  Btn,
  Field,
  Input,
  Checkbox,
} from "../ui/kit";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureFunctionDiscount(admin).catch(() => {}); // self-heal
  const [functionId, existing, settings] = await Promise.all([
    findDiscountFunctionId(admin),
    findExistingDiscount(admin),
    getShopSettings(session.shop),
  ]);
  return {
    functionId,
    activated: Boolean(existing),
    status: existing?.status ?? null,
    settings,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "activate");
  if (intent === "settings") {
    const settings = await saveShopSettings(session.shop, {
      tagOffers: form.get("tagOffers") === "true",
      offerTag: String(form.get("offerTag") || "kitbundle"),
    });
    return { ok: true, settings };
  }
  return await ensureFunctionDiscount(admin);
};

export default function Settings() {
  const { functionId, activated, status, settings } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const settingsFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";
  const active = activated || fetcher.data?.ok;
  const activateError = (fetcher.data as { error?: string } | undefined)?.error;

  const [tagOffers, setTagOffers] = useState(settings.tagOffers);
  const [offerTag, setOfferTag] = useState(settings.offerTag);
  const savingSettings = settingsFetcher.state !== "idle";

  useEffect(() => {
    if (settingsFetcher.state === "idle" && settingsFetcher.data?.ok) {
      shopify.toast.show("Saved. Re-save a product to apply the tag.");
    }
  }, [settingsFetcher.state, settingsFetcher.data, shopify]);

  return (
    <Shell section="Settings">
      <PageHead
        title="Settings"
        subtitle="Automatic discount, search tag and storefront setup."
      />

      <div className="kb-grid-2">
        <div className="kb-stack">
          {/* Discount status */}
          <Panel
            title={
              <span className="kb-inline" style={{ gap: 8 }}>
                <span className={`kb-dot ${active ? "is-ok" : "is-warn"}`} />
                Automatic discount
              </span>
            }
            actions={
              active ? (
                <Pill tone="ok">
                  {status === "ACTIVE" || fetcher.data?.ok ? "Active" : "Created"}
                </Pill>
              ) : (
                <Pill tone="warn">Not active</Pill>
              )
            }
          >
            <p className="kb-muted" style={{ margin: "0 0 12px" }}>
              A single Shopify Function discount applies all your bundle, add-on
              and free-gift pricing automatically at checkout — no codes, no
              manual work. It activates itself; this is only here to repair it if
              it was ever deleted.
            </p>
            {activateError ? (
              <Banner tone="danger">
                <b>Could not activate.</b> {activateError}
              </Banner>
            ) : null}
            {!functionId && !active ? (
              <Banner tone="warn">
                <b>Function not deployed.</b> Reinstall the app or contact support
                if this persists.
              </Banner>
            ) : null}
            {!active ? (
              <Btn
                variant="primary"
                loading={busy}
                onClick={() => fetcher.submit({}, { method: "POST" })}
              >
                Re-activate discount
              </Btn>
            ) : null}
          </Panel>

          {/* Search & discovery tag */}
          <Panel title="Search &amp; discovery tag">
            <p className="kb-muted" style={{ margin: "0 0 12px" }}>
              Add a product tag to every product that has a live offer, so you can
              find bundled products in Shopify search, build automated
              collections, or feed a custom search engine. Only KitBundle&apos;s
              own tag is added or removed — your other tags are untouched.
            </p>
            <div className="kb-stack kb-stack--tight">
              <Checkbox
                label="Tag products that have a live offer"
                checked={tagOffers}
                onChange={setTagOffers}
              />
              <div style={{ maxWidth: 260 }}>
                <Field
                  label="Tag"
                  help="Lowercase, no spaces (e.g. kitbundle, has-bundle)."
                >
                  <Input
                    value={offerTag}
                    onChange={(e) => setOfferTag(e.target.value)}
                    disabled={!tagOffers}
                    autoComplete="off"
                  />
                </Field>
              </div>
              <div>
                <Btn
                  loading={savingSettings}
                  onClick={() =>
                    settingsFetcher.submit(
                      {
                        intent: "settings",
                        tagOffers: String(tagOffers),
                        offerTag,
                      },
                      { method: "POST" },
                    )
                  }
                >
                  Save
                </Btn>
              </div>
            </div>
          </Panel>

          {/* Storefront block */}
          <Panel title="Storefront block">
            <p className="kb-muted" style={{ margin: "0 0 8px" }}>
              Your offers appear through the <b>KitBundle</b> app block. Add it
              once to your product template:
            </p>
            <ol className="kb-steps" style={{ marginBottom: 0 }}>
              <li>Online Store → Themes → Customize.</li>
              <li>
                Open a <b>Product</b> template, click Add block, choose{" "}
                <b>KitBundle — Bundle &amp; Add-ons</b>.
              </li>
              <li>
                Position it where you want, adjust its colors and headings in the
                block settings, and Save.
              </li>
            </ol>
          </Panel>
        </div>

        <aside className="kb-side">
          <Panel title="Support">
            <p>Questions or setup help — we usually reply within a day.</p>
            <div className="kb-stack kb-stack--tight" style={{ alignItems: "flex-start" }}>
              <a className="kb-btn kb-btn--link" href="mailto:biglookshan@gmail.com" target="_blank" rel="noreferrer">
                biglookshan@gmail.com
              </a>
              <a className="kb-btn kb-btn--link" href="/privacy" target="_blank" rel="noreferrer">
                Privacy policy
              </a>
            </div>
          </Panel>
        </aside>
      </div>
    </Shell>
  );
}
