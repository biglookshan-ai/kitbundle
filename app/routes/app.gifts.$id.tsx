import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Checkbox,
  Select,
  Button,
  Badge,
  Box,
  Banner,
  Thumbnail,
  Divider,
  Collapsible,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { ImageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { canCreateCampaign } from "../models/plan.server";
import { getCampaign, saveCampaign } from "../models/gift-campaign.server";
import { fetchProductPrices } from "../models/addon-config.server";
import {
  emptyCampaign,
  campaignState,
  type GiftCampaign,
  type Ref,
} from "../models/gift-campaign";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const id = params.id;
  let campaign: GiftCampaign | null = null;
  if (id && id !== "new") {
    campaign = await getCampaign(session.shop, id);
    if (!campaign) throw new Response("Not found", { status: 404 });
  }
  const c = campaign ?? emptyCampaign();
  // Variants of each gift product, so the editor can offer per-variant selection.
  const giftIds = c.giftProducts.map((g) => g.id).filter(Boolean);
  let giftVariantMap: Record<string, { id: string; title: string }[]> = {};
  if (giftIds.length) {
    const { variants } = await fetchProductPrices(admin, giftIds);
    giftVariantMap = variants as Record<string, { id: string; title: string }[]>;
  }
  return { campaign: c, isNew: !campaign, giftVariantMap };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const form = await request.formData();
  let campaign: GiftCampaign;
  try {
    campaign = JSON.parse(String(form.get("campaign")));
  } catch {
    return { ok: false, error: "Invalid payload" };
  }
  // Gate NEW campaigns only — editing an existing one is always allowed.
  const exists = campaign.id
    ? await prisma.giftCampaign.findFirst({
        where: { shop: session.shop, id: campaign.id },
        select: { id: true },
      })
    : null;
  if (!exists) {
    const gate = await canCreateCampaign(billing, session.shop);
    if (!gate.ok) return { ok: false, error: gate.error };
  }
  if (
    campaign.triggerProducts.length === 0 &&
    campaign.triggerCollections.length === 0
  ) {
    return { ok: false, error: "Add at least one trigger product or collection." };
  }
  if (campaign.giftProducts.length === 0) {
    return { ok: false, error: "Add at least one gift product." };
  }
  const r = await saveCampaign(admin, session.shop, campaign);
  if (!r.ok) return { ok: false, error: r.errors.join("; ") };
  return redirect("/app/gifts");
};

function toLocalInput(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export default function GiftCampaignEditor() {
  const { campaign: initial, giftVariantMap } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [c, setC] = useState<GiftCampaign>(initial);
  // Variants per gift product (seeded from the loader, augmented when picking).
  const [variantMap, setVariantMap] = useState<
    Record<string, { id: string; title: string }[]>
  >(giftVariantMap || {});
  const [openVarPids, setOpenVarPids] = useState<Record<string, boolean>>({});
  const toggleVarOpen = (pid: string) =>
    setOpenVarPids((m) => ({ ...m, [pid]: !m[pid] }));
  const busy = fetcher.state !== "idle";
  const patch = (p: Partial<GiftCampaign>) => setC((cur) => ({ ...cur, ...p }));

  const pick = async (
    type: "product" | "collection",
    current: Ref[],
    onPick: (refs: Ref[]) => void,
  ) => {
    const picked = await shopify.resourcePicker({
      type,
      multiple: true,
      action: "select",
      selectionIds: current.map((r) => ({ id: r.id })),
    });
    if (!picked) return;
    const priorById = new Map(current.map((r) => [r.id, r]));
    const caps: Record<string, { id: string; title: string }[]> = {};
    onPick(
      picked.map((p: any) => {
        if (Array.isArray(p.variants) && p.variants.length) {
          caps[p.id] = p.variants
            .filter((v: any) => v?.id)
            .map((v: any) => ({ id: v.id, title: v.title || "" }));
        }
        const prior = priorById.get(p.id);
        return {
          id: p.id,
          title: p.title || "",
          handle: p.handle || "",
          image:
            p.images?.[0]?.originalSrc ??
            p.images?.[0]?.src ??
            p.image?.originalSrc ??
            p.image?.src ??
            null,
          // Keep any prior per-variant selection when re-opening the picker.
          variantIds: prior?.variantIds,
        };
      }),
    );
    if (Object.keys(caps).length) {
      setVariantMap((m) => ({ ...m, ...caps }));
    }
  };

  const refList = (
    refs: Ref[],
    onRemove: (id: string) => void,
  ) =>
    refs.length === 0 ? (
      <Text as="span" variant="bodySm" tone="subdued">
        None selected
      </Text>
    ) : (
      <BlockStack gap="150">
        {refs.map((r) => (
          <InlineStack key={r.id} align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Thumbnail source={r.image || ImageIcon} alt={r.title} size="small" />
              <Text as="span" variant="bodyMd">
                {r.title || r.handle || r.id}
              </Text>
            </InlineStack>
            <Button variant="tertiary" tone="critical" onClick={() => onRemove(r.id)}>
              Remove
            </Button>
          </InlineStack>
        ))}
      </BlockStack>
    );

  const save = () =>
    fetcher.submit({ campaign: JSON.stringify(c) }, { method: "POST" });

  const state = campaignState(c);

  return (
    <Page
      backAction={{ content: "Gift campaigns", onAction: () => navigate("/app/gifts") }}
    >
      <TitleBar title={initial.title || "Gift campaign"} />
      <BlockStack gap="400">
        {fetcher.data?.error && (
          <Banner tone="critical">{fetcher.data.error}</Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack gap="400" wrap={false} blockAlign="start">
              <Box width="70%">
                <TextField
                  label="Campaign name"
                  autoComplete="off"
                  value={c.title}
                  onChange={(v) => patch({ title: v })}
                  helpText="Internal name, e.g. “Buy a camera, get a free battery”."
                />
              </Box>
              <Box width="30%">
                <BlockStack gap="150">
                  <Checkbox
                    label="Enabled"
                    checked={c.enabled}
                    onChange={(v) => patch({ enabled: v })}
                  />
                  <Badge
                    tone={
                      state === "active"
                        ? "success"
                        : state === "scheduled"
                          ? "info"
                          : state === "ended"
                            ? "attention"
                            : undefined
                    }
                  >
                    {state}
                  </Badge>
                </BlockStack>
              </Box>
            </InlineStack>

            <InlineStack gap="400" wrap={false}>
              <Box width="50%">
                <TextField
                  label="Starts (optional)"
                  type={"datetime-local" as any}
                  autoComplete="off"
                  value={toLocalInput(c.startsAt)}
                  onChange={(v) => patch({ startsAt: fromLocalInput(v) })}
                  helpText="Blank = starts immediately."
                />
              </Box>
              <Box width="50%">
                <TextField
                  label="Ends (optional)"
                  type={"datetime-local" as any}
                  autoComplete="off"
                  value={toLocalInput(c.endsAt)}
                  onChange={(v) => patch({ endsAt: fromLocalInput(v) })}
                  helpText="Server-enforced end."
                />
              </Box>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              Trigger — buy any of these
            </Text>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                Products ({c.triggerProducts.length})
              </Text>
              <Button
                onClick={() =>
                  pick("product", c.triggerProducts, (refs) =>
                    patch({ triggerProducts: refs }),
                  )
                }
              >
                Select products
              </Button>
            </InlineStack>
            {refList(c.triggerProducts, (id) =>
              patch({
                triggerProducts: c.triggerProducts.filter((r) => r.id !== id),
              }),
            )}
            <Divider />
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                Collections ({c.triggerCollections.length})
              </Text>
              <Button
                onClick={() =>
                  pick("collection", c.triggerCollections, (refs) =>
                    patch({ triggerCollections: refs }),
                  )
                }
              >
                Select collections
              </Button>
            </InlineStack>
            {refList(c.triggerCollections, (id) =>
              patch({
                triggerCollections: c.triggerCollections.filter(
                  (r) => r.id !== id,
                ),
              }),
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              Gift — get free
            </Text>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                Gift products ({c.giftProducts.length})
              </Text>
              <Button
                onClick={() =>
                  pick("product", c.giftProducts, (refs) =>
                    patch({ giftProducts: refs }),
                  )
                }
              >
                Select gifts
              </Button>
            </InlineStack>
            {c.giftProducts.length === 0 ? (
              <Text as="span" variant="bodySm" tone="subdued">
                None selected
              </Text>
            ) : (
              <BlockStack gap="200">
                {c.giftProducts.map((g) => {
                  const gvs = variantMap[g.id] || [];
                  const offeredIds =
                    g.variantIds && g.variantIds.length
                      ? g.variantIds
                      : gvs.map((v) => v.id);
                  const toggleGiftVariant = (vid: string) => {
                    const next = offeredIds.includes(vid)
                      ? offeredIds.filter((x) => x !== vid)
                      : [...offeredIds, vid];
                    if (next.length === 0) return; // keep at least one offered
                    const variantIds =
                      next.length === gvs.length ? undefined : next;
                    patch({
                      giftProducts: c.giftProducts.map((x) =>
                        x.id === g.id ? { ...x, variantIds } : x,
                      ),
                    });
                  };
                  return (
                    <BlockStack key={g.id} gap="100">
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                        wrap={false}
                      >
                        <InlineStack gap="200" blockAlign="center">
                          <Thumbnail
                            source={g.image || ImageIcon}
                            alt={g.title}
                            size="small"
                          />
                          <Text as="span" variant="bodyMd">
                            {g.title || g.handle || g.id}
                          </Text>
                        </InlineStack>
                        <InlineStack gap="150" blockAlign="center" wrap={false}>
                          {gvs.length > 1 && (
                            <Button
                              size="slim"
                              disclosure={openVarPids[g.id] ? "up" : "down"}
                              onClick={() => toggleVarOpen(g.id)}
                            >
                              {`Variants ${offeredIds.length}/${gvs.length}`}
                            </Button>
                          )}
                          <Button
                            variant="tertiary"
                            tone="critical"
                            onClick={() =>
                              patch({
                                giftProducts: c.giftProducts.filter(
                                  (r) => r.id !== g.id,
                                ),
                              })
                            }
                          >
                            Remove
                          </Button>
                        </InlineStack>
                      </InlineStack>
                      {gvs.length > 1 && (
                        <Collapsible
                          open={!!openVarPids[g.id]}
                          id={`giftvars-${g.id}`}
                        >
                          <Box paddingInlineStart="800">
                            <BlockStack gap="100">
                              <Text as="span" variant="bodySm" tone="subdued">
                                Variants offered free ({offeredIds.length}/
                                {gvs.length})
                              </Text>
                              <InlineStack gap="150" wrap>
                                {gvs.map((v) => (
                                  <Button
                                    key={v.id}
                                    size="micro"
                                    pressed={offeredIds.includes(v.id)}
                                    onClick={() => toggleGiftVariant(v.id)}
                                  >
                                    {v.title}
                                  </Button>
                                ))}
                              </InlineStack>
                            </BlockStack>
                          </Box>
                        </Collapsible>
                      )}
                    </BlockStack>
                  );
                })}
              </BlockStack>
            )}
            <Divider />
            <InlineStack gap="400" wrap={false} blockAlign="start">
              <Box width="33%">
                <TextField
                  label="Free per qualifying unit"
                  type="number"
                  min={1}
                  autoComplete="off"
                  value={String(c.perQualifying)}
                  onChange={(v) =>
                    patch({ perQualifying: Math.max(1, Number(v) || 1) })
                  }
                  helpText={`Buy 1 → get ${c.perQualifying} free per qualifying item.`}
                />
              </Box>
              <Box width="33%">
                <Select
                  label="Reward mode"
                  options={[
                    { label: "Fixed — auto-add the gift", value: "fixed" },
                    {
                      label: "Choice — customer picks on the product page",
                      value: "choice",
                    },
                  ]}
                  value={c.rewardMode}
                  onChange={(v) => patch({ rewardMode: v as "fixed" | "choice" })}
                />
              </Box>
              <Box width="33%">
                <TextField
                  label="Badge text"
                  autoComplete="off"
                  value={c.badgeText}
                  onChange={(v) => patch({ badgeText: v })}
                  helpText="Shown on product / search."
                />
              </Box>
            </InlineStack>
            <TextField
              label="Picker prompt"
              autoComplete="off"
              value={c.subtitle}
              onChange={(v) => patch({ subtitle: v })}
              placeholder="Choose your free gift:"
              helpText="Shown above the gift options on the product page. Customers can also pick “No thanks” to skip the gift."
            />
            <Checkbox
              label="Hide when sold out"
              helpText="Off by default. When on, a sold-out gift is hidden from the picker; if every gift is sold out the whole group hides."
              checked={c.hideWhenSoldOut}
              onChange={(v) => patch({ hideWhenSoldOut: v })}
            />
          </BlockStack>
        </Card>

        <InlineStack align="end">
          <Button variant="primary" loading={busy} onClick={save}>
            Save campaign
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
