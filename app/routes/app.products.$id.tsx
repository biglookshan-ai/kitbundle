import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Select,
  Button,
  ButtonGroup,
  Badge,
  Thumbnail,
  Box,
  Banner,
  Divider,
  Checkbox,
  Icon,
  Popover,
} from "@shopify/polaris";
import {
  DeleteIcon,
  PlusIcon,
  ImageIcon,
  ArchiveIcon,
  DragHandleIcon,
  QuestionCircleIcon,
} from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { canConfigureProduct } from "../models/plan.server";
import {
  readConfig,
  saveConfig,
  fetchProductPrices,
} from "../models/addon-config.server";
import {
  reconcileLimitedOffers,
  checkLimitedOfferNodes,
} from "../models/limited-offer.server";
import { getProductGiftInfo } from "../models/gift-campaign.server";
import type { ProductGiftInfo } from "../models/gift-campaign";
import {
  newGroupId,
  newOfferId,
  normalizeCode,
  clampPercent,
  displayCode,
  formLabel,
  effectiveAccessoryPercent,
  type AddonConfig,
  type AddonGroup,
  type AddonAccessory,
  type LimitedOffer,
} from "../models/addon-config";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const productId = `gid://shopify/Product/${params.id}`;
  const { product, config } = await readConfig(admin, productId);
  if (!product) {
    throw new Response("Product not found", { status: 404 });
  }
  const ids = [
    product.id,
    ...config.groups.flatMap((g) => g.accessories.map((a) => a.productId)),
  ];
  const { prices, compareAt, variants, info, inventory, currency } =
    await fetchProductPrices(admin, ids);

  // Self-heal: a limited offer's time-gated discount node can go missing (e.g. it
  // was created before the Function was deployed), which silently charges the base
  // price. Check node status on load; if any is missing, re-run reconcile to
  // recreate it and re-check. The healthy path stays read-only (no writes).
  let offerHealError: string | null = null;
  let offerStatus = await checkLimitedOfferNodes(admin, product, config);
  const missing = Object.values(offerStatus).some((s) => !s.hasNode);
  if (missing) {
    const heal = await reconcileLimitedOffers(admin, product, config);
    if (heal.userErrors.length > 0) offerHealError = heal.userErrors.join("; ");
    offerStatus = await checkLimitedOfferNodes(admin, product, config);
  }

  // ④ Which gift campaigns give a free gift when this product is bought.
  const giftInfo = await getProductGiftInfo(admin, session.shop, product.id);

  return {
    product,
    config,
    prices,
    compareAt,
    variants,
    info,
    inventory,
    currency,
    offerStatus,
    offerHealError,
    giftInfo,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session, billing } = await authenticate.admin(request);
  const productId = `gid://shopify/Product/${params.id}`;

  const gate = await canConfigureProduct(billing, session.shop, productId);
  if (!gate.ok) return { ok: false, error: gate.error };

  const formData = await request.formData();
  const raw = String(formData.get("config") ?? "");
  let parsed: AddonConfig;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid configuration payload." };
  }

  const { product } = await readConfig(admin, productId);
  if (!product) return { ok: false, error: "Product not found." };

  parsed.groups = (parsed.groups ?? []).map((g) => {
    const base: AddonGroup = {
      ...g,
      code: normalizeCode(g.code),
      discountPercent:
        g.type === "free" ? 100 : clampPercent(g.discountPercent),
    };
    if (g.type === "bundle" && g.limited) {
      const enabled = Boolean(g.limited.enabled);
      base.limited = {
        enabled,
        discountPercent: clampPercent(g.limited.discountPercent),
        mode: g.limited.mode === "end" ? "end" : "revert",
        startsAt:
          typeof g.limited.startsAt === "string" ? g.limited.startsAt : "",
        endsAt: typeof g.limited.endsAt === "string" ? g.limited.endsAt : "",
      };
      if (enabled) {
        base.offerId = g.offerId && g.offerId.length ? g.offerId : newOfferId();
      }
    } else if (g.type !== "bundle") {
      delete base.limited;
      delete base.offerId;
    }
    // A bundle is one discount on the whole kit — drop any stale per-accessory
    // overrides (an add-on-only concept) so the cart/Function match the editor.
    if (g.type === "bundle") {
      base.accessories = base.accessories.map((a) => {
        const { discountPercent: _drop, ...rest } = a;
        return rest;
      });
    }
    return base;
  });

  // Bundle codes are customer-facing (search / deep-link / cart / order), so they
  // must be present and unique within the product before we save.
  const seenCodes = new Map<string, string>();
  for (const g of parsed.groups) {
    if (!g.code) {
      return {
        ok: false,
        error: `“${g.title || "Untitled"}” needs a code. Enter a unique code for every bundle/add-on.`,
      };
    }
    const prev = seenCodes.get(g.code);
    if (prev) {
      return {
        ok: false,
        error: `Code “${g.code}” is used by more than one group (“${prev}” and “${g.title}”). Codes must be unique.`,
      };
    }
    seenCodes.set(g.code, g.title || "Untitled");
  }

  // Keep each accessory's stored title/handle in sync with Shopify (renames,
  // handle changes) so the editor and the storefront (which fetches by handle)
  // stay correct.
  const accIds = parsed.groups.flatMap((g) =>
    g.accessories.map((a) => a.productId),
  );
  if (accIds.length) {
    const { info } = await fetchProductPrices(admin, accIds);
    parsed.groups = parsed.groups.map((g) => ({
      ...g,
      accessories: g.accessories.map((a) => {
        const m = info[a.productId];
        return m
          ? { ...a, title: m.title || a.title, handle: m.handle || a.handle }
          : a;
      }),
    }));
  }

  const result = await saveConfig(admin, session.shop, product, parsed);
  if (!result.ok) {
    return { ok: false, error: result.userErrors.join("; ") };
  }

  const reconcile = await reconcileLimitedOffers(admin, product, parsed);
  if (reconcile.userErrors.length > 0) {
    return {
      ok: false,
      error: `Saved, but limited offers had issues: ${reconcile.userErrors.join("; ")}`,
    };
  }
  return redirect("/app");
};

const LIMITED_MODE_OPTIONS = [
  { label: "Revert to normal bundle price", value: "revert" },
  { label: "End — hide the bundle (full price)", value: "end" },
];

// Free gifts are now their own feature (see Free gifts / campaigns), so the
// product editor only configures Bundles and Add-ons.
const TAB_TYPES = ["bundle", "addon"] as const;
type GroupType = (typeof TAB_TYPES)[number];

/** ISO string -> value for a <input type="datetime-local"> in the browser tz. */
function toLocalInput(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** datetime-local value (browser tz) -> ISO-8601 UTC for storage. */
function fromLocalInput(v: string) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function fmtMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount || 0);
  } catch {
    return "$" + (amount || 0).toFixed(2);
  }
}

const DEFAULT_LIMITED: LimitedOffer = {
  enabled: true,
  discountPercent: 30,
  mode: "revert",
  startsAt: "",
  endsAt: "",
};

function blankGroup(type: GroupType): AddonGroup {
  const titles: Record<GroupType, string> = {
    bundle: "Bundle & Save",
    addon: "Add On & Save",
  };
  return {
    id: newGroupId(),
    code: "",
    title: titles[type],
    type,
    discountPercent: 10,
    accessories: [],
  };
}

function priceOfPicked(p: any): number | null {
  const cand =
    p?.variants?.[0]?.price ??
    p?.priceRange?.minVariantPrice?.amount ??
    p?.priceRangeV2?.minVariantPrice?.amount;
  const n = Number(cand);
  return Number.isFinite(n) ? n : null;
}

export default function ProductConfig() {
  const {
    product,
    config: initial,
    prices,
    compareAt,
    variants,
    info,
    inventory,
    currency,
    offerStatus,
    offerHealError,
    giftInfo,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [groups, setGroups] = useState<AddonGroup[]>(initial.groups);
  const [tab, setTab] = useState(0);
  const [priceMap, setPriceMap] = useState<Record<string, number>>(prices);
  const compareMap = compareAt;
  const [variantMap, setVariantMap] =
    useState<Record<string, { id: string; title: string; price?: number; compareAt?: number }[]>>(variants);
  const [infoMap, setInfoMap] =
    useState<Record<string, { title: string; handle: string; image: string | null }>>(
      info,
    );
  const isSaving = fetcher.state !== "idle";

  // Deep link from the dashboard (#groupId): switch to that group's tab, then
  // scroll + flash it.
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.replace("#", ""));
    if (!hash) return;
    const g = groups.find((x) => x.id === hash);
    if (g && !g.archived)
      setTab(Math.max(0, (TAB_TYPES as readonly string[]).indexOf(g.type)));
    const t = setTimeout(() => {
      const node = document.getElementById(hash);
      if (!node) return;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.style.transition = "box-shadow .3s";
      node.style.boxShadow = "0 0 0 3px #2b44ff";
      setTimeout(() => (node.style.boxShadow = ""), 1600);
    }, 80);
    return () => clearTimeout(t);
  }, []);

  const addGroup = useCallback((type: GroupType) => {
    setGroups((prev) => [...prev, blankGroup(type)]);
  }, []);

  const updateGroup = useCallback((id: string, patch: Partial<AddonGroup>) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }, []);

  const updateAccessory = useCallback(
    (groupId: string, productId: string, patch: Partial<AddonAccessory>) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? {
                ...g,
                accessories: g.accessories.map((a) =>
                  a.productId === productId ? { ...a, ...patch } : a,
                ),
              }
            : g,
        ),
      );
    },
    [],
  );

  // Deleting a group ARCHIVES it (soft delete) so it can be restored/reused.
  const archiveGroup = useCallback((id: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, archived: true } : g)),
    );
  }, []);
  const restoreGroup = useCallback((id: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, archived: false } : g)),
    );
  }, []);
  const deleteGroup = useCallback((id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
  }, []);

  // Drag-to-reorder groups within the current tab (same type only).
  const dragGroupId = useRef<string | null>(null);
  const moveGroup = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setGroups((prev) => {
      const fromGroup = prev.find((g) => g.id === fromId);
      if (!fromGroup) return prev;
      const type = fromGroup.type;
      const ids = prev
        .filter((g) => !g.archived && g.type === type)
        .map((g) => g.id);
      const fromIdx = ids.indexOf(fromId);
      const toIdx = ids.indexOf(toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, fromId);
      const byId = new Map(prev.map((g) => [g.id, g]));
      let i = 0;
      // Refill the slots that belong to this tab's type in the new order.
      return prev.map((g) =>
        !g.archived && g.type === type ? (byId.get(ids[i++]) as AddonGroup) : g,
      );
    });
  }, []);

  const pickAccessories = useCallback(
    async (groupId: string, existing: AddonAccessory[]) => {
      const picked = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: true,
        selectionIds: existing.map((a) => ({ id: a.productId })),
      });
      if (!picked) return;
      const prevById = new Map(existing.map((a) => [a.productId, a]));
      const captured: Record<string, number> = {};
      const capturedVars: Record<string, { id: string; title: string; price?: number; compareAt?: number }[]> = {};
      const capturedInfo: Record<
        string,
        { title: string; handle: string; image: string | null }
      > = {};
      const accessories: AddonAccessory[] = picked
        .filter((p: any) => p.id !== product.id)
        .map((p: any) => {
          const price = priceOfPicked(p);
          if (price != null) captured[p.id] = price;
          capturedInfo[p.id] = {
            title: p.title || "",
            handle: p.handle || "",
            image:
              p.images?.[0]?.originalSrc ??
              p.images?.[0]?.src ??
              p.featuredImage?.url ??
              null,
          };
          if (Array.isArray(p.variants) && p.variants.length) {
            capturedVars[p.id] = p.variants
              .filter((v: any) => v?.id)
              .map((v: any) => ({ id: v.id, title: v.title || "" }));
          }
          const prior = prevById.get(p.id);
          const acc: AddonAccessory = {
            productId: p.id,
            handle: p.handle,
            title: p.title,
          };
          if (prior?.discountPercent != null)
            acc.discountPercent = prior.discountPercent;
          if (prior?.variantIds) acc.variantIds = prior.variantIds;
          return acc;
        });
      if (Object.keys(captured).length) {
        setPriceMap((prev) => ({ ...prev, ...captured }));
      }
      if (Object.keys(capturedVars).length) {
        setVariantMap((prev) => ({ ...prev, ...capturedVars }));
      }
      setInfoMap((prev) => ({ ...prev, ...capturedInfo }));
      updateGroup(groupId, { accessories });
    },
    [shopify, product.id, updateGroup],
  );

  const removeAccessory = useCallback((groupId: string, productId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              accessories: g.accessories.filter((a) => a.productId !== productId),
            }
          : g,
      ),
    );
  }, []);

  const save = useCallback(() => {
    const payload: AddonConfig = { version: 1, groups };
    fetcher.submit({ config: JSON.stringify(payload) }, { method: "POST" });
  }, [groups, fetcher]);

  const numericId = product.id.replace("gid://shopify/Product/", "");
  const activeGroups = groups.filter((g) => !g.archived);
  // Free is now its own feature (Free gifts); don't surface legacy free groups
  // (active or archived) in the product editor.
  const archivedGroups = groups.filter((g) => g.archived && g.type !== "free");
  const countOf = (t: GroupType) =>
    activeGroups.filter((g) => g.type === t).length;
  const currentType = TAB_TYPES[tab];
  const tabGroups = activeGroups.filter((g) => g.type === currentType);
  const mainPrice = priceMap[product.id] ?? null;

  // Codes must be present and unique across the whole product (they drive search,
  // deep-links and cart/order labels). Count across ALL groups so a collision is
  // flagged even when the twin lives on the other tab.
  const codeCounts = groups.reduce<Record<string, number>>((acc, g) => {
    if (g.code) acc[g.code] = (acc[g.code] ?? 0) + 1;
    return acc;
  }, {});
  const codeErrorFor = (g: AddonGroup): string | undefined => {
    if (!g.code) return "Enter a code.";
    if (codeCounts[g.code] > 1) return "Another group already uses this code.";
    return undefined;
  };

  // A saved limited offer whose backing discount node is missing would silently
  // charge the base price. The loader self-heals on open; if it still couldn't
  // create the node (e.g. Function not deployed), surface a warning on the card.
  const offerWarningFor = (g: AddonGroup): string | undefined => {
    if (!(g.type === "bundle" && g.limited?.enabled && g.offerId)) return undefined;
    const st = offerStatus[g.offerId];
    if (st && !st.hasNode) {
      return offerHealError
        ? `This limited offer’s discount isn’t active: ${offerHealError}`
        : "This limited offer’s discount isn’t active yet — click Save to activate it.";
    }
    return undefined;
  };

  const TAB_LABELS = [
    `Bundle (${countOf("bundle")})`,
    `Add-on (${countOf("addon")})`,
  ];
  const addLabel = currentType === "bundle" ? "Add bundle" : "Add add-on";

  return (
    <Page
      backAction={{ content: "Add-ons", url: "/app" }}
      title={product.title}
      titleMetadata={
        <Badge tone="info">{`${activeGroups.length} group(s)`}</Badge>
      }
      secondaryActions={[
        {
          content: "View product",
          url: `shopify:admin/products/${numericId}`,
          target: "_blank",
        },
      ]}
      primaryAction={{
        content: "Save",
        loading: isSaving,
        disabled: groups.some((g) => Boolean(codeErrorFor(g))),
        onAction: save,
      }}
    >
      <TitleBar title={`Configure: ${product.title}`} />
      <BlockStack gap="500">
        {fetcher.data?.error && (
          <Banner tone="critical" title="Could not save">
            <p>{fetcher.data.error}</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {/* Main product shown ONCE — every bundle/add-on on this page
                  attaches to it, so no need to repeat it per card. */}
              <Card>
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  wrap={false}
                >
                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    <Thumbnail
                      source={infoMap[product.id]?.image ?? product.image ?? ImageIcon}
                      alt={product.title}
                      size="small"
                    />
                    <BlockStack gap="050">
                      <InlineStack gap="150" blockAlign="center">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {product.title}
                        </Text>
                        <Badge tone="info">Main product</Badge>
                      </InlineStack>
                      {mainPrice != null && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {fmtMoney(mainPrice, currency)}
                        </Text>
                      )}
                    </BlockStack>
                  </InlineStack>
                  <StockBadge qty={inventory[product.id] ?? null} />
                </InlineStack>
              </Card>

              <ButtonGroup variant="segmented">
                {TAB_LABELS.map((label, i) => (
                  <Button key={i} pressed={tab === i} onClick={() => setTab(i)}>
                    {label}
                  </Button>
                ))}
              </ButtonGroup>

              {tabGroups.length === 0 ? (
                <Card>
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No {currentType + "s"} yet.
                    </Text>
                    <Button
                      variant="primary"
                      icon={PlusIcon}
                      onClick={() => addGroup(currentType)}
                    >
                      {addLabel}
                    </Button>
                  </BlockStack>
                </Card>
              ) : (
                tabGroups.map((group) => (
                  <div
                    key={group.id}
                    id={group.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragGroupId.current)
                        moveGroup(dragGroupId.current, group.id);
                      dragGroupId.current = null;
                    }}
                  >
                    <GroupCard
                      group={group}
                      productHandle={product.handle}
                      codeError={codeErrorFor(group)}
                      offerWarning={offerWarningFor(group)}
                      prices={priceMap}
                      compareAt={compareMap}
                      variants={variantMap}
                      info={infoMap}
                      inventory={inventory}
                      mainVariants={variantMap[product.id] || []}
                      mainPrice={mainPrice}
                      mainCompareAt={compareMap[product.id] ?? mainPrice}
                      currency={currency}
                      dragHandle={
                        <span
                          draggable
                          onDragStart={(e) => {
                            dragGroupId.current = group.id;
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => {
                            dragGroupId.current = null;
                          }}
                          style={{ cursor: "grab", display: "inline-flex" }}
                          aria-label="Drag to reorder"
                          title="Drag to reorder"
                        >
                          <Icon source={DragHandleIcon} tone="subdued" />
                        </span>
                      }
                      onChange={(patch) => updateGroup(group.id, patch)}
                      onArchive={() => archiveGroup(group.id)}
                      onPickAccessories={() =>
                        pickAccessories(group.id, group.accessories)
                      }
                      onRemoveAccessory={(pid) => removeAccessory(group.id, pid)}
                      onUpdateAccessory={(pid, patch) =>
                        updateAccessory(group.id, pid, patch)
                      }
                    />
                  </div>
                ))
              )}

              {tabGroups.length > 0 && (
                <InlineStack>
                  <Button icon={PlusIcon} onClick={() => addGroup(currentType)}>
                    {addLabel}
                  </Button>
                </InlineStack>
              )}

              {archivedGroups.length > 0 && (
                <ArchivedSection
                  groups={archivedGroups}
                  onRestore={restoreGroup}
                  onDelete={deleteGroup}
                />
              )}
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <GiftInfoCard gifts={giftInfo} />
              <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  How it works
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  <b>Bundle</b> — a curated set sold together. One discount
                  applies to the whole kit (main + accessories). Toggle{" "}
                  <b>Limited-time offer</b> for a countdown + deeper price.
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  <b>Add-on</b> — individual extras. <b>Free add-on</b> rides
                  along at 100% off.
                </Text>
                <Divider />
                <Text as="p" variant="bodyMd" tone="subdued">
                  Each accessory can override the group discount — leave its box
                  blank to use the group %. Give each bundle a unique{" "}
                  <b>code</b> — it's searchable and shows on the cart & order.
                </Text>
              </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

const GIFT_STATE_BADGE: Record<
  ProductGiftInfo["state"],
  { label: string; tone: "success" | "attention" | "info" | undefined }
> = {
  active: { label: "Active", tone: "success" },
  scheduled: { label: "Scheduled", tone: "attention" },
  ended: { label: "Ended", tone: undefined },
  disabled: { label: "Off", tone: undefined },
};

/** ④ Read-only card: which gift campaigns give a free gift with this product. */
function GiftInfoCard({ gifts }: { gifts: ProductGiftInfo[] }) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            🎁 Free gifts
          </Text>
          <Button url="/app/gifts" variant="plain">
            Manage
          </Button>
        </InlineStack>
        {gifts.length === 0 ? (
          <Text as="p" variant="bodySm" tone="subdued">
            No gift campaign includes this product yet. Buyers get a free gift
            when a campaign's trigger product is purchased — set one up under{" "}
            <b>Free gifts</b>.
          </Text>
        ) : (
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" tone="subdued">
              Buying this product triggers these free-gift campaigns:
            </Text>
            {gifts.map((g) => {
              const badge = GIFT_STATE_BADGE[g.state];
              return (
                <Box
                  key={g.id}
                  background="bg-surface-secondary"
                  padding="300"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodySm" fontWeight="medium">
                        {g.title}
                      </Text>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="center" wrap>
                      {g.gifts.map((gp, i) => (
                        <InlineStack key={i} gap="100" blockAlign="center">
                          <Thumbnail
                            source={gp.image || ImageIcon}
                            alt={gp.title}
                            size="extraSmall"
                          />
                          <Text as="span" variant="bodySm" tone="subdued">
                            {gp.title}
                          </Text>
                        </InlineStack>
                      ))}
                    </InlineStack>
                    {g.perQualifying > 1 && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {g.perQualifying} free per qualifying item
                      </Text>
                    )}
                  </BlockStack>
                </Box>
              );
            })}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

/** Inventory badge: green in-stock, amber low, red sold-out; nothing if untracked. */
function StockBadge({ qty }: { qty: number | null | undefined }) {
  if (qty == null) return null; // not tracked / unknown
  if (qty <= 0) return <Badge tone="critical">Sold out</Badge>;
  if (qty <= 5) return <Badge tone="warning">{`${qty} left`}</Badge>;
  return <Badge tone="success">{`${qty} in stock`}</Badge>;
}

/** A small "?" that reveals a short explanation on click — keeps cards uncluttered. */
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      active={open}
      onClose={() => setOpen(false)}
      preferredAlignment="left"
      activator={
        <Button
          variant="plain"
          icon={QuestionCircleIcon}
          onClick={() => setOpen((o) => !o)}
          accessibilityLabel="What's this?"
        />
      }
    >
      <Box padding="300" maxWidth="260px">
        <Text as="p" variant="bodySm">
          {text}
        </Text>
      </Box>
    </Popover>
  );
}

/** A field label with an inline "?" info popover, used with labelHidden fields. */
function FieldLabel({
  text,
  tip,
  required,
}: {
  text: string;
  tip: string;
  required?: boolean;
}) {
  return (
    <InlineStack gap="100" blockAlign="center">
      <Text as="span" variant="bodySm" fontWeight="medium">
        {text}
        {required ? " *" : ""}
      </Text>
      <InfoTip text={tip} />
    </InlineStack>
  );
}

function GroupCard({
  group,
  productHandle,
  codeError,
  offerWarning,
  prices,
  compareAt,
  variants,
  info,
  inventory,
  mainVariants,
  mainPrice,
  mainCompareAt,
  currency,
  dragHandle,
  onChange,
  onArchive,
  onPickAccessories,
  onRemoveAccessory,
  onUpdateAccessory,
}: {
  group: AddonGroup;
  productHandle: string;
  codeError?: string;
  offerWarning?: string;
  prices: Record<string, number>;
  compareAt: Record<string, number>;
  variants: Record<string, { id: string; title: string; price?: number; compareAt?: number }[]>;
  info: Record<string, { title: string; handle: string; image: string | null }>;
  inventory: Record<string, number | null>;
  mainVariants: { id: string; title: string; price?: number; compareAt?: number }[];
  mainPrice: number | null;
  mainCompareAt: number | null;
  currency: string;
  dragHandle: ReactNode;
  onChange: (patch: Partial<AddonGroup>) => void;
  onArchive: () => void;
  onPickAccessories: () => void;
  onRemoveAccessory: (productId: string) => void;
  onUpdateAccessory: (productId: string, patch: Partial<AddonAccessory>) => void;
}) {
  // Drag-to-reorder accessories within this group.
  const dragAccId = useRef<string | null>(null);
  const moveAccessory = (fromPid: string, toPid: string) => {
    if (fromPid === toPid) return;
    const arr = group.accessories.slice();
    const fromIdx = arr.findIndex((a) => a.productId === fromPid);
    const toIdx = arr.findIndex((a) => a.productId === toPid);
    if (fromIdx < 0 || toIdx < 0) return;
    const [m] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, m);
    onChange({ accessories: arr });
  };

  const isFree = group.type === "free";
  const isBundle = group.type === "bundle";
  const limitedOn = isBundle && Boolean(group.limited?.enabled);

  // Bundle = ONE discount on the whole kit. Each line carries its TRUE original
  // (compare-at, `orig`) and its current Shopify selling price (`now`). The
  // representative is the FIRST variant actually OFFERED to the customer (so a
  // cheaper, non-offered variant doesn't skew the estimate) — matching what the
  // storefront defaults to. Falls back to the product-level price if needed.
  const repFromOffered = (
    vs: { id: string; title: string; price?: number; compareAt?: number }[],
    offeredIds: string[] | undefined,
    fallbackNow: number,
    fallbackOrig: number,
  ): { now: number; orig: number } => {
    const offered =
      offeredIds && offeredIds.length
        ? vs.filter((v) => offeredIds.includes(v.id))
        : vs;
    const v = offered[0] || vs[0];
    if (v && typeof v.price === "number") {
      return { now: v.price, orig: v.compareAt ?? v.price };
    }
    return { now: fallbackNow, orig: fallbackOrig };
  };
  const haveAllPrices = group.accessories.every(
    (a) => prices[a.productId] != null,
  );
  const mainRep = repFromOffered(
    mainVariants,
    group.mainVariantIds,
    mainPrice ?? 0,
    mainCompareAt ?? mainPrice ?? 0,
  );
  const bundleLines: { label: string; orig: number; now: number }[] = [
    ...(mainPrice != null
      ? [{ label: "Main product", orig: mainRep.orig, now: mainRep.now }]
      : []),
    ...group.accessories.map((a) => {
      const fb = prices[a.productId] ?? 0;
      const rep = repFromOffered(
        variants[a.productId] || [],
        a.variantIds,
        fb,
        compareAt[a.productId] ?? fb,
      );
      return {
        label: info[a.productId]?.title || a.title || a.handle,
        orig: rep.orig,
        now: rep.now,
      };
    }),
  ];
  const bundleTotalNow = bundleLines.reduce((s, l) => s + l.now, 0);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            {dragHandle}
            <Badge
              tone={
                isFree
                  ? "success"
                  : limitedOn
                    ? "attention"
                    : isBundle
                      ? "info"
                      : undefined
              }
            >
              {formLabel(group)}
            </Badge>
          </InlineStack>
          <Button
            icon={ArchiveIcon}
            variant="tertiary"
            onClick={onArchive}
            accessibilityLabel="Archive group"
          >
            Archive
          </Button>
        </InlineStack>

        {offerWarning && (
          <Banner tone="critical" title="Limited offer not active">
            <Text as="p" variant="bodySm">
              {offerWarning}
            </Text>
          </Banner>
        )}

        {/* Code + title (+ discount for add-ons) on one tidy row. */}
        <InlineStack gap="300" wrap={false} blockAlign="start">
          <Box width={isBundle ? "38%" : "30%"}>
            <BlockStack gap="100">
              <FieldLabel
                text="Code"
                required
                tip="Customer-facing code — searchable, shown on the storefront card, and on the cart line & order via the discount. A–Z, 0–9 and dashes."
              />
              <TextField
                label="Code"
                labelHidden
                autoComplete="off"
                value={group.code}
                onChange={(v) => onChange({ code: normalizeCode(v) })}
                error={codeError}
                placeholder="e.g. CREATOR-KIT"
              />
            </BlockStack>
          </Box>
          <Box width={isBundle ? "62%" : "42%"}>
            <BlockStack gap="100">
              <FieldLabel
                text={isFree ? "Section title" : "Card / tab title"}
                tip={
                  isFree
                    ? "Heading for the gift section, e.g. “🎁 Free gift”."
                    : isBundle
                      ? "Shown as the bundle card name, e.g. “Advanced Kit”."
                      : "Shown as the tab label, e.g. “T-Series Lenses”."
                }
              />
              <TextField
                label="Title"
                labelHidden
                autoComplete="off"
                value={group.title}
                onChange={(v) => onChange({ title: v })}
              />
            </BlockStack>
          </Box>
          {!isBundle && (
            <Box width="28%">
              <BlockStack gap="100">
                <FieldLabel
                  text="Discount %"
                  tip={
                    isFree
                      ? "Free add-ons are always 100% off."
                      : "Default % for accessories that don't set their own."
                  }
                />
                <TextField
                  label="Discount %"
                  labelHidden
                  type="number"
                  min={0}
                  max={100}
                  autoComplete="off"
                  suffix="%"
                  disabled={isFree}
                  value={String(isFree ? 100 : group.discountPercent)}
                  onChange={(v) => onChange({ discountPercent: clampPercent(v) })}
                />
              </BlockStack>
            </Box>
          )}
        </InlineStack>

        {/* Deep-link (bundle only): just the link + a "?" for how to use it. */}
        {isBundle && (
          <BlockStack gap="100">
            <FieldLabel
              text="Search deep-link"
              tip="Link customers straight to this bundle (auto-selected). Your search engine can read every bundle from this product's custom.addon_config metafield and link to it with this code."
            />
            <TextField
              label="Deep-link"
              labelHidden
              readOnly
              autoComplete="off"
              value={`/products/${productHandle}?kb_bundle=${group.code}`}
            />
          </BlockStack>
        )}

        {!isFree && mainVariants.length > 1 && (
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <BlockStack gap="150">
              <Text as="span" variant="bodySm" tone="subdued">
                {isBundle ? "Main product variants in this bundle" : "Show this add-on for main variants"}{" "}
                ({group.mainVariantIds?.length ?? mainVariants.length}/
                {mainVariants.length})
              </Text>
              <InlineStack gap="150" wrap>
                {mainVariants.map((v) => {
                  const current =
                    group.mainVariantIds && group.mainVariantIds.length
                      ? group.mainVariantIds
                      : mainVariants.map((x) => x.id);
                  const on = current.includes(v.id);
                  return (
                    <Button
                      key={v.id}
                      size="micro"
                      pressed={on}
                      onClick={() => {
                        const next = on
                          ? current.filter((x) => x !== v.id)
                          : [...current, v.id];
                        if (next.length === 0) return;
                        onChange({
                          mainVariantIds:
                            next.length === mainVariants.length
                              ? undefined
                              : next,
                        });
                      }}
                    >
                      {v.title}
                    </Button>
                  );
                })}
              </InlineStack>
              <Text as="span" variant="bodySm" tone="subdued">
                {isBundle
                  ? "Offered as the main-product options inside the bundle — the customer picks one (synced with the product page selector)."
                  : "This add-on group only shows when the selected main variant is one of these — otherwise it's hidden."}
              </Text>
            </BlockStack>
          </Box>
        )}

        {!isFree && (
          <InlineStack gap="100" blockAlign="center">
            <Checkbox
              label="Hide when sold out"
              checked={!!group.hideWhenSoldOut}
              onChange={(v) => onChange({ hideWhenSoldOut: v })}
            />
            <InfoTip
              text={
                isBundle
                  ? "Off by default. When on, the whole bundle disappears from the storefront if any item in it is out of stock (the kit can't be completed)."
                  : "Off by default. When on, an item with no stock disappears from the storefront; when every item is sold out the whole group hides."
              }
            />
          </InlineStack>
        )}

        <Divider />

        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="headingSm">
            Accessories ({group.accessories.length})
          </Text>
          <Button onClick={onPickAccessories}>Select accessories</Button>
        </InlineStack>

        {group.accessories.length > 0 ? (
          <BlockStack gap="200">
            {group.accessories.map((a) => {
              const accVariants = variants[a.productId] || [];
              const offeredIds =
                a.variantIds && a.variantIds.length
                  ? a.variantIds
                  : accVariants.map((v) => v.id);
              // Show the FIRST offered variant's price (what the storefront
              // defaults to), not the cheapest non-offered one.
              const repV =
                accVariants.find((v) => offeredIds.includes(v.id)) ||
                accVariants[0];
              const price =
                typeof repV?.price === "number"
                  ? repV.price
                  : prices[a.productId];
              const pct = effectiveAccessoryPercent(group, a);
              const now = price != null ? price * (1 - pct / 100) : null;
              const toggleVariant = (vid: string) => {
                const next = offeredIds.includes(vid)
                  ? offeredIds.filter((x) => x !== vid)
                  : [...offeredIds, vid];
                if (next.length === 0) return; // keep at least one offered
                onUpdateAccessory(a.productId, {
                  variantIds:
                    next.length === accVariants.length ? undefined : next,
                });
              };
              return (
                <div
                  key={a.productId}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragAccId.current)
                      moveAccessory(dragAccId.current, a.productId);
                    dragAccId.current = null;
                  }}
                >
                  <BlockStack gap="150">
                    <InlineStack
                      align="space-between"
                      blockAlign="center"
                      wrap={false}
                    >
                      <InlineStack gap="200" blockAlign="center">
                        <span
                          draggable
                          onDragStart={(e) => {
                            dragAccId.current = a.productId;
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => {
                            dragAccId.current = null;
                          }}
                          style={{ cursor: "grab", display: "inline-flex" }}
                          title="Drag to reorder"
                        >
                          <Icon source={DragHandleIcon} tone="subdued" />
                        </span>
                        <Thumbnail
                          source={info[a.productId]?.image || ImageIcon}
                          alt={info[a.productId]?.title || a.title}
                          size="small"
                        />
                      <BlockStack gap="050">
                        <InlineStack gap="150" blockAlign="center" wrap>
                          <Text as="span" variant="bodyMd">
                            {info[a.productId]?.title || a.title || a.handle}
                          </Text>
                          <StockBadge qty={inventory[a.productId]} />
                        </InlineStack>
                        {price != null && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            {fmtMoney(price, currency)}
                          </Text>
                        )}
                      </BlockStack>
                    </InlineStack>

                      <Button
                        icon={DeleteIcon}
                        variant="tertiary"
                        tone="critical"
                        accessibilityLabel={`Remove ${a.title}`}
                        onClick={() => onRemoveAccessory(a.productId)}
                      />
                    </InlineStack>

                    {isFree ? (
                      <InlineStack align="end">
                        <Text as="span" variant="bodyMd" tone="subdued">
                          FREE
                        </Text>
                      </InlineStack>
                    ) : isBundle ? null : price != null ? (
                      <Box paddingInlineStart="800">
                        <InlineStack
                          align="space-between"
                          blockAlign="end"
                          wrap
                        >
                          <DiscountCalc
                            price={price}
                            percent={pct}
                            onChangePercent={(p) =>
                              onUpdateAccessory(a.productId, {
                                discountPercent: p,
                              })
                            }
                          />
                          {a.discountPercent != null && (
                            <Button
                              variant="plain"
                              onClick={() =>
                                onUpdateAccessory(a.productId, {
                                  discountPercent: undefined,
                                })
                              }
                            >
                              {`Reset to group ${pctStr(group.discountPercent)}%`}
                            </Button>
                          )}
                        </InlineStack>
                      </Box>
                    ) : (
                      <Box paddingInlineStart="800" width="120px">
                        <TextField
                          label="Discount %"
                          type="number"
                          min={0}
                          max={100}
                          suffix="%"
                          autoComplete="off"
                          placeholder={String(group.discountPercent)}
                          value={
                            a.discountPercent == null
                              ? ""
                              : String(a.discountPercent)
                          }
                          onChange={(v) =>
                            onUpdateAccessory(a.productId, {
                              discountPercent:
                                v === "" ? undefined : clampPercent(v),
                            })
                          }
                        />
                      </Box>
                    )}

                  {accVariants.length > 1 && (
                    <Box paddingInlineStart="800">
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">
                          Variants offered to the customer ({offeredIds.length}/
                          {accVariants.length})
                        </Text>
                        <InlineStack gap="150" wrap>
                          {accVariants.map((v) => (
                            <Button
                              key={v.id}
                              size="micro"
                              pressed={offeredIds.includes(v.id)}
                              onClick={() => toggleVariant(v.id)}
                            >
                              {v.title}
                            </Button>
                          ))}
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  )}
                  </BlockStack>
                </div>
              );
            })}
          </BlockStack>
        ) : (
          <Text as="p" variant="bodyMd" tone="subdued">
            No accessories in this group yet.
          </Text>
        )}

        {isBundle && group.accessories.length > 0 && haveAllPrices && (
          <BundleTotals
            group={group}
            lines={bundleLines}
            currency={currency}
            onChange={onChange}
          />
        )}

        {isBundle && (
          <LimitedOfferCard
            group={group}
            totalNow={bundleTotalNow}
            haveTotal={haveAllPrices}
            currency={currency}
            onChange={onChange}
          />
        )}
      </BlockStack>
    </Card>
  );
}

/**
 * Limited-time offer — a DEEPER whole-kit discount that runs on a timer. Same
 * three-way calculator as the normal bundle price (on the current total), plus
 * the mode + start/end window. Server-enforced via the time-gated discount node.
 */
function LimitedOfferCard({
  group,
  totalNow,
  haveTotal,
  currency,
  onChange,
}: {
  group: AddonGroup;
  totalNow: number;
  haveTotal: boolean;
  currency: string;
  onChange: (patch: Partial<AddonGroup>) => void;
}) {
  const limited = group.limited;
  const limitedOn = Boolean(limited?.enabled);
  const ended =
    limitedOn && !!limited?.endsAt && Date.parse(limited.endsAt) < Date.now();
  const patchLimited = (patch: Partial<LimitedOffer>) =>
    onChange({
      limited: { ...(limited ?? DEFAULT_LIMITED), ...patch },
      offerId: group.offerId || newOfferId(),
    });
  const deepPct = clampPercent(limited?.discountPercent ?? 0);
  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Checkbox
            label="Limited-time offer (countdown + deeper price)"
            checked={limitedOn}
            onChange={(checked) =>
              onChange(
                checked
                  ? {
                      limited: { ...(limited ?? DEFAULT_LIMITED), enabled: true },
                      offerId: group.offerId || newOfferId(),
                    }
                  : {
                      limited: limited
                        ? { ...limited, enabled: false }
                        : { ...DEFAULT_LIMITED, enabled: false },
                    },
              )
            }
          />
          {limitedOn &&
            (ended ? (
              <Badge tone="critical">Ended</Badge>
            ) : (
              <Badge tone="success">Active</Badge>
            ))}
        </InlineStack>

        {limitedOn && (
          <>
            {ended && (
              <Banner tone="warning">
                <p>
                  This promotion has ended — the bundle is now at its
                  {limited?.mode === "end"
                    ? " normal full price (hidden on the storefront)."
                    : " normal price."}{" "}
                  Set a new end date below to start a fresh promotion.
                </p>
                <Box paddingBlockStart="200">
                  <Button
                    onClick={() => patchLimited({ startsAt: "", endsAt: "" })}
                  >
                    Start a new promotion
                  </Button>
                </Box>
              </Banner>
            )}
            <BlockStack gap="100">
              <Text as="span" variant="headingSm">
                Deal price — deeper bundle discount while the timer runs
              </Text>
              {haveTotal ? (
                <DiscountCalc
                  price={totalNow}
                  percent={deepPct}
                  onChangePercent={(p) =>
                    patchLimited({ discountPercent: clampPercent(p) })
                  }
                />
              ) : (
                <Box width="110px">
                  <TextField
                    label="Deal discount"
                    type="text"
                    inputMode="decimal"
                    suffix="%"
                    autoComplete="off"
                    disabled={ended}
                    value={pctStr(deepPct)}
                    onChange={(v) =>
                      patchLimited({ discountPercent: clampPercent(v) })
                    }
                  />
                </Box>
              )}
            </BlockStack>
            <InlineStack gap="400" wrap blockAlign="start">
              <Box minWidth="220px">
                <Select
                  label="When the timer ends"
                  options={LIMITED_MODE_OPTIONS}
                  disabled={ended}
                  value={limited?.mode ?? "revert"}
                  onChange={(v) => patchLimited({ mode: v as "revert" | "end" })}
                />
              </Box>
              <Box minWidth="220px">
                <TextField
                  label="Starts"
                  type={"datetime-local" as any}
                  autoComplete="off"
                  disabled={ended}
                  value={toLocalInput(limited?.startsAt)}
                  onChange={(v) => patchLimited({ startsAt: fromLocalInput(v) })}
                  helpText="Leave blank to start immediately."
                />
              </Box>
              <Box minWidth="220px">
                <TextField
                  label="Ends"
                  type={"datetime-local" as any}
                  autoComplete="off"
                  value={toLocalInput(limited?.endsAt)}
                  onChange={(v) => patchLimited({ endsAt: fromLocalInput(v) })}
                  helpText="Server-enforced — reverts even for unpaid carts."
                />
              </Box>
            </InlineStack>
          </>
        )}
      </BlockStack>
    </Box>
  );
}

/** Percent formatted without trailing zeros: 50, 52.6, 33.33. */
function pctStr(p: number) {
  return String(Math.round(p * 100) / 100);
}

/**
 * Three linked fields — New price / Disc % / Save — for one price. Editing any
 * one updates the other two; the source of truth is always the PERCENT (so it
 * tracks Shopify price changes). The field being typed in keeps the raw text
 * until blur so it doesn't fight the user as it reformats.
 */
function DiscountCalc({
  price,
  percent,
  onChangePercent,
}: {
  price: number;
  percent: number;
  onChangePercent: (pct: number) => void;
}) {
  type Field = "price" | "disc" | "save";
  const [active, setActive] = useState<Field | null>(null);
  const [draft, setDraft] = useState("");
  const newPrice = price * (1 - percent / 100);
  const save = price - newPrice;
  const disp: Record<Field, string> = {
    price: newPrice.toFixed(2),
    disc: pctStr(percent),
    save: save.toFixed(2),
  };
  const valOf = (f: Field) => (active === f ? draft : disp[f]);
  const onF = (f: Field, v: string) => {
    setActive(f);
    setDraft(v);
    if (v === "") return;
    const num = Number(v);
    if (!Number.isFinite(num)) return;
    const clampAmt = (n: number) => Math.min(Math.max(n, 0), price);
    let pct = percent;
    if (f === "price") pct = price > 0 ? ((price - clampAmt(num)) / price) * 100 : 0;
    else if (f === "save") pct = price > 0 ? (clampAmt(num) / price) * 100 : 0;
    else pct = num;
    onChangePercent(clampPercent(pct));
  };
  const onBlur = () => setActive(null);
  return (
    <InlineStack gap="200" blockAlign="end" wrap>
      <Box width="120px">
        <TextField
          label="New price"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={valOf("price")}
          onChange={(v) => onF("price", v)}
          onBlur={onBlur}
        />
      </Box>
      <Box width="110px">
        <TextField
          label="Discount"
          type="text"
          inputMode="decimal"
          suffix="%"
          autoComplete="off"
          value={valOf("disc")}
          onChange={(v) => onF("disc", v)}
          onBlur={onBlur}
        />
      </Box>
      <Box width="120px">
        <TextField
          label="Save"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={valOf("save")}
          onChange={(v) => onF("save", v)}
          onBlur={onBlur}
        />
      </Box>
    </InlineStack>
  );
}

/**
 * Bundle pricing — ONE discount on the whole kit. A line per part shows its
 * true original (MSRP / compare-at), its current selling price, and any
 * pre-existing sale. Below: the MSRP total, the current total, then a single
 * three-way calculator that sets the bundle discount (applied on top of the
 * current selling prices, to the main and every accessory).
 */
function BundleTotals({
  group,
  lines,
  currency,
  onChange,
}: {
  group: AddonGroup;
  lines: { label: string; orig: number; now: number }[];
  currency: string;
  onChange: (patch: Partial<AddonGroup>) => void;
}) {
  const totalOrig = lines.reduce((s, l) => s + l.orig, 0); // Σ MSRP
  const totalNow = lines.reduce((s, l) => s + l.now, 0); // Σ current selling
  const pct = clampPercent(group.discountPercent); // our bundle discount
  const bundlePrice = totalNow * (1 - pct / 100);
  const totalSave = totalOrig - bundlePrice; // vs original
  const savePct = totalOrig > 0 ? (totalSave / totalOrig) * 100 : 0;
  const priceCell = (orig: number, now: number, strong?: boolean) => (
    <InlineStack gap="150" blockAlign="center" wrap={false}>
      {orig > now + 0.005 && (
        <Text as="span" variant="bodySm" tone="subdued">
          <s>{fmtMoney(orig, currency)}</s>
        </Text>
      )}
      <Text
        as="span"
        variant={strong ? "bodyMd" : "bodySm"}
        fontWeight={strong ? "semibold" : undefined}
      >
        {fmtMoney(now, currency)}
      </Text>
    </InlineStack>
  );
  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
      <BlockStack gap="200">
        {lines.map((l, i) => (
          <InlineStack key={i} align="space-between" blockAlign="center" wrap={false}>
            <Text as="span" variant="bodySm">
              {l.label}
            </Text>
            {priceCell(l.orig, l.now)}
          </InlineStack>
        ))}

        <Divider />

        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodySm" tone="subdued">
            Items total
          </Text>
          {priceCell(totalOrig, totalNow, true)}
        </InlineStack>

        <Divider />

        <InlineStack gap="100" blockAlign="center">
          <Text as="span" variant="headingSm">
            Buy together — bundle discount
          </Text>
          <InfoTip text="One discount on the whole kit — applied on top of current prices, to the main and every accessory." />
        </InlineStack>
        <DiscountCalc
          price={totalNow}
          percent={pct}
          onChangePercent={(p) => onChange({ discountPercent: clampPercent(p) })}
        />

        <Divider />

        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            Bundle price
          </Text>
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {fmtMoney(bundlePrice, currency)}
          </Text>
        </InlineStack>
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodySm" tone="subdued">
            You save
          </Text>
          <Text as="span" variant="bodySm" tone="success">
            {fmtMoney(totalSave, currency)}
            {savePct > 0.05 ? ` · ${pctStr(savePct)}% off` : ""}
          </Text>
        </InlineStack>
      </BlockStack>
    </Box>
  );
}

function ArchivedSection({
  groups,
  onRestore,
  onDelete,
}: {
  groups: AddonGroup[];
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <ArchiveIcon width={18} height={18} />
          <Text as="h3" variant="headingSm">
            Archived ({groups.length})
          </Text>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          Archived groups are hidden from the storefront and grant no discount.
          Restore one to use it again, or delete it permanently. Changes apply
          when you Save.
        </Text>
        <Divider />
        <BlockStack gap="200">
          {groups.map((group) => (
            <InlineStack
              key={group.id}
              align="space-between"
              blockAlign="center"
              wrap={false}
            >
              <InlineStack gap="200" blockAlign="center">
                <Badge>{displayCode(group)}</Badge>
                <Text as="span" variant="bodyMd">
                  {group.title || "Untitled"}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {formLabel(group)} · {group.accessories.length} item
                  {group.accessories.length === 1 ? "" : "s"}
                </Text>
              </InlineStack>
              <InlineStack gap="200">
                <Button onClick={() => onRestore(group.id)}>Restore</Button>
                <Button
                  icon={DeleteIcon}
                  tone="critical"
                  variant="tertiary"
                  accessibilityLabel="Delete permanently"
                  onClick={() => onDelete(group.id)}
                >
                  Delete
                </Button>
              </InlineStack>
            </InlineStack>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
