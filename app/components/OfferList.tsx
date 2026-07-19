import { useNavigate } from "@remix-run/react";
import {
  Card,
  InlineStack,
  BlockStack,
  Text,
  Thumbnail,
  Badge,
  Box,
  EmptyState,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";

type Kind = "bundle" | "sale" | "addon" | "free";

type Accessory = {
  title: string;
  image: string | null;
  price: number;
  pct: number;
  now: number;
};

export type OfferRow = {
  key: string;
  groupId: string;
  numericId: string;
  code: string;
  title: string;
  productTitle: string;
  productImage: string | null;
  accessoryCount: number;
  discountPercent: number;
  mainPrice: number;
  accessories: Accessory[];
  origTotal: number;
  nowTotal: number;
  effectivePct: number;
  salePct: number | null;
  saleState: "active" | "upcoming" | "ended" | null;
  saleMode: "revert" | "end" | null;
  startsAt: string | null;
  endsAt: string | null;
  dim: boolean;
};

function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(n || 0);
  } catch {
    return "$" + (n || 0).toFixed(2);
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SaleStatusBadge({ state }: { state: OfferRow["saleState"] }) {
  if (state === "active") return <Badge tone="success">Live</Badge>;
  if (state === "upcoming") return <Badge tone="info">Scheduled</Badge>;
  return <Badge tone="critical">Ended</Badge>;
}

/** The one-line "what happens with this sale" summary under a sale bundle. */
function saleSummary(r: OfferRow): string {
  const after =
    r.saleMode === "end"
      ? "then the bundle is hidden"
      : `then reverts to ${r.discountPercent}% off`;
  if (r.saleState === "active")
    return `${r.salePct}% off · ends ${fmtDate(r.endsAt)} · ${after}`;
  if (r.saleState === "upcoming")
    return `${r.salePct}% off · starts ${fmtDate(r.startsAt)} · ends ${fmtDate(
      r.endsAt,
    )}`;
  // ended
  return r.saleMode === "end"
    ? `Ended ${fmtDate(r.endsAt)} · bundle hidden`
    : `Ended ${fmtDate(r.endsAt)} · now ${r.discountPercent}% off`;
}

/** A rich, single-row card for one offer (bundle / sale bundle / add-on). */
function OfferRowCard({
  r,
  kind,
  currency,
  last,
}: {
  r: OfferRow;
  kind: Kind;
  currency: string;
  last: boolean;
}) {
  const navigate = useNavigate();
  const showTotal = kind !== "addon"; // add-ons are individual, no kit total
  const savings = r.origTotal > r.nowTotal;

  return (
    <Box
      padding="400"
      borderBlockEndWidth={last ? undefined : "025"}
      borderColor="border"
    >
      <div
        onClick={() =>
          navigate(`/app/products/${r.numericId}#${r.groupId}`)
        }
        style={{ cursor: "pointer" }}
      >
        <BlockStack gap="300">
          {/* Header: name + code + status  |  kit price */}
          <InlineStack align="space-between" blockAlign="start" wrap={false}>
            <BlockStack gap="150">
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text
                  as="span"
                  variant="bodyMd"
                  fontWeight="semibold"
                  tone={r.dim ? "subdued" : undefined}
                >
                  {r.title}
                </Text>
                {r.code && <Badge>{r.code}</Badge>}
                {kind === "sale" && <SaleStatusBadge state={r.saleState} />}
              </InlineStack>
              <InlineStack gap="150" blockAlign="center">
                <Thumbnail
                  source={r.productImage || ImageIcon}
                  alt={r.productTitle}
                  size="extraSmall"
                />
                <Text as="span" variant="bodySm" tone="subdued">
                  {kind === "addon" ? "On " : "Main · "}
                  {r.productTitle}
                </Text>
              </InlineStack>
            </BlockStack>

            {showTotal && (
              <BlockStack gap="100" inlineAlign="end">
                <InlineStack gap="150" blockAlign="center">
                  {savings && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      <s>{money(r.origTotal, currency)}</s>
                    </Text>
                  )}
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {money(r.nowTotal, currency)}
                  </Text>
                </InlineStack>
                {r.effectivePct > 0 && (
                  <Badge tone="success">{`${r.effectivePct}% off kit`}</Badge>
                )}
              </BlockStack>
            )}
          </InlineStack>

          {/* Included / add-on products with per-item pricing */}
          {r.accessories.length > 0 && (
            <Box
              background="bg-surface-secondary"
              padding="300"
              borderRadius="200"
            >
              <BlockStack gap="150">
                <Text as="span" variant="bodyXs" tone="subdued">
                  {kind === "addon" ? "Add-ons" : "Includes"} (
                  {r.accessoryCount})
                </Text>
                {r.accessories.map((a, i) => (
                  <InlineStack
                    key={i}
                    align="space-between"
                    blockAlign="center"
                    wrap={false}
                  >
                    <InlineStack gap="150" blockAlign="center" wrap={false}>
                      <Thumbnail
                        source={a.image || ImageIcon}
                        alt={a.title}
                        size="extraSmall"
                      />
                      <Text as="span" variant="bodySm">
                        {a.title}
                      </Text>
                    </InlineStack>
                    <InlineStack gap="150" blockAlign="center" wrap={false}>
                      {a.pct > 0 && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          <s>{money(a.price, currency)}</s>
                        </Text>
                      )}
                      <Text as="span" variant="bodySm" fontWeight="medium">
                        {money(a.now, currency)}
                      </Text>
                      {a.pct > 0 && (
                        <Badge tone="success" size="small">{`${a.pct}%`}</Badge>
                      )}
                    </InlineStack>
                  </InlineStack>
                ))}
              </BlockStack>
            </Box>
          )}

          {/* Sale schedule / after-end behaviour */}
          {kind === "sale" && (
            <Text as="span" variant="bodySm" tone="subdued">
              🕒 {saleSummary(r)}
            </Text>
          )}
        </BlockStack>
      </div>
    </Box>
  );
}

/** A section of offer rows of one kind. */
export function OfferTable({
  rows,
  kind,
  currency,
}: {
  rows: OfferRow[];
  kind: Kind;
  currency: string;
}) {
  if (rows.length === 0) return null;
  return (
    <BlockStack>
      {rows.map((r, i) => (
        <OfferRowCard
          key={r.key}
          r={r}
          kind={kind}
          currency={currency}
          last={i === rows.length - 1}
        />
      ))}
    </BlockStack>
  );
}

/** Empty-state card shown when a page has no offers of its kinds yet. */
export function OfferEmpty({
  heading,
  body,
  onConfigure,
}: {
  heading: string;
  body: string;
  onConfigure: () => void;
}) {
  return (
    <Card>
      <EmptyState
        heading={heading}
        action={{ content: "Configure a product", onAction: onConfigure }}
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>{body}</p>
      </EmptyState>
    </Card>
  );
}

/** Reusable product picker → navigate to that product's editor. */
export function useConfigureProduct() {
  const navigate = useNavigate();
  return async () => {
    const picked = await window.shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: false,
    });
    if (picked && picked[0]) {
      const num = String(picked[0].id).replace("gid://shopify/Product/", "");
      navigate(`/app/products/${num}`);
    }
  };
}

export function SectionCard({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Card padding="0">
      <Box padding="400" borderBlockEndWidth="025" borderColor="border">
        <InlineStack gap="200" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {title}
          </Text>
          {typeof count === "number" && (
            <Badge tone="info">{String(count)}</Badge>
          )}
        </InlineStack>
      </Box>
      {children}
    </Card>
  );
}
