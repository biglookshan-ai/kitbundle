import { useState } from "react";
import { useNavigate } from "@remix-run/react";
import {
  Card,
  InlineStack,
  BlockStack,
  Text,
  TextField,
  Button,
  ButtonGroup,
  Thumbnail,
  Badge,
  Box,
  Icon,
  EmptyState,
} from "@shopify/polaris";
import { ImageIcon, SearchIcon } from "@shopify/polaris-icons";

type Kind = "bundle" | "sale" | "addon" | "free";
type ViewMode = "simple" | "detailed";

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

export type OfferSection = {
  key: string;
  title: string;
  kind: Kind;
  rows: OfferRow[];
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
  return r.saleMode === "end"
    ? `Ended ${fmtDate(r.endsAt)} · bundle hidden`
    : `Ended ${fmtDate(r.endsAt)} · now ${r.discountPercent}% off`;
}

/** Right-aligned price block: was → now (+ % off badge for kits). */
function PriceBlock({
  r,
  kind,
  currency,
}: {
  r: OfferRow;
  kind: Kind;
  currency: string;
}) {
  const savings = r.origTotal > r.nowTotal;
  return (
    <BlockStack gap="100" inlineAlign="end">
      <InlineStack gap="150" blockAlign="center" wrap={false}>
        {savings && (
          <Text as="span" variant="bodySm" tone="subdued">
            <s>{money(r.origTotal, currency)}</s>
          </Text>
        )}
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {money(r.nowTotal, currency)}
        </Text>
      </InlineStack>
      {kind !== "addon" && r.effectivePct > 0 && (
        <Badge tone="success">{`${r.effectivePct}% off kit`}</Badge>
      )}
    </BlockStack>
  );
}

/** Compact single-line row: code · name · main · N items · price. */
function OfferRowSimple({
  r,
  kind,
  currency,
  last,
  onOpen,
}: {
  r: OfferRow;
  kind: Kind;
  currency: string;
  last: boolean;
  onOpen: () => void;
}) {
  return (
    <Box
      padding="300"
      borderBlockEndWidth={last ? undefined : "025"}
      borderColor="border"
    >
      <div onClick={onOpen} style={{ cursor: "pointer" }}>
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Badge tone={r.dim ? undefined : "info"}>
              {r.code || "—"}
            </Badge>
            <Thumbnail
              source={r.productImage || ImageIcon}
              alt={r.productTitle}
              size="extraSmall"
            />
            <BlockStack gap="0">
              <Text
                as="span"
                variant="bodyMd"
                fontWeight="medium"
                tone={r.dim ? "subdued" : undefined}
              >
                {r.title}
              </Text>
              <Text as="span" variant="bodyXs" tone="subdued">
                {r.productTitle} · {r.accessoryCount}{" "}
                {r.accessoryCount === 1 ? "item" : "items"}
                {kind === "sale" && r.saleState
                  ? ` · ${r.saleState === "active" ? "Live" : r.saleState === "upcoming" ? "Scheduled" : "Ended"}`
                  : ""}
              </Text>
            </BlockStack>
          </InlineStack>
          <PriceBlock r={r} kind={kind} currency={currency} />
        </InlineStack>
      </div>
    </Box>
  );
}

/** A rich, expanded row for one offer (bundle / sale bundle / add-on). */
function OfferRowCard({
  r,
  kind,
  currency,
  last,
  onOpen,
}: {
  r: OfferRow;
  kind: Kind;
  currency: string;
  last: boolean;
  onOpen: () => void;
}) {
  return (
    <Box
      padding="400"
      borderBlockEndWidth={last ? undefined : "025"}
      borderColor="border"
    >
      <div onClick={onOpen} style={{ cursor: "pointer" }}>
        <BlockStack gap="300">
          {/* Header: code + name + status  |  kit price */}
          <InlineStack align="space-between" blockAlign="start" wrap={false}>
            <BlockStack gap="150">
              <InlineStack gap="200" blockAlign="center" wrap>
                <Badge tone={r.dim ? undefined : "info"}>
                  {r.code || "—"}
                </Badge>
                <Text
                  as="span"
                  variant="bodyMd"
                  fontWeight="semibold"
                  tone={r.dim ? "subdued" : undefined}
                >
                  {r.title}
                </Text>
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
            <PriceBlock r={r} kind={kind} currency={currency} />
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
                      {a.pct > 0 && <Badge tone="success">{`${a.pct}%`}</Badge>}
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

/** A section of rows rendered in the chosen view mode. */
function OfferSectionCard({
  section,
  mode,
  currency,
  onOpen,
}: {
  section: OfferSection;
  mode: ViewMode;
  currency: string;
  onOpen: (r: OfferRow) => void;
}) {
  return (
    <SectionCard title={section.title} count={section.rows.length}>
      <BlockStack>
        {section.rows.map((r, i) => {
          const last = i === section.rows.length - 1;
          const props = {
            r,
            kind: section.kind,
            currency,
            last,
            onOpen: () => onOpen(r),
          };
          return mode === "simple" ? (
            <OfferRowSimple key={r.key} {...props} />
          ) : (
            <OfferRowCard key={r.key} {...props} />
          );
        })}
      </BlockStack>
    </SectionCard>
  );
}

/**
 * The full offer list surface: a toolbar (search, type filter, Simple/Detailed
 * toggle) over one or more sections. Filtering is client-side — instant even with
 * hundreds of offers. Search matches code, name and main product.
 */
export function OfferBrowser({
  sections,
  currency,
  showTypeFilter,
}: {
  sections: OfferSection[];
  currency: string;
  showTypeFilter?: boolean;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ViewMode>("simple");
  const [type, setType] = useState<string>("all");

  const q = query.trim().toLowerCase();
  const match = (r: OfferRow) =>
    !q ||
    r.code.toLowerCase().includes(q) ||
    r.title.toLowerCase().includes(q) ||
    r.productTitle.toLowerCase().includes(q);

  const filtered = sections
    .filter((s) => type === "all" || s.key === type)
    .map((s) => ({ ...s, rows: s.rows.filter(match) }));
  const totalMatches = filtered.reduce((n, s) => n + s.rows.length, 0);

  const onOpen = (r: OfferRow) =>
    navigate(`/app/products/${r.numericId}#${r.groupId}`);

  return (
    <BlockStack gap="400">
      <Box>
        <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
          <Box minWidth="260px">
            <TextField
              label="Search"
              labelHidden
              value={query}
              onChange={setQuery}
              autoComplete="off"
              placeholder="Search by code, name or product"
              prefix={<Icon source={SearchIcon} />}
              clearButton
              onClearButtonClick={() => setQuery("")}
            />
          </Box>
          <InlineStack gap="200" blockAlign="center">
            {showTypeFilter && sections.length > 1 && (
              <ButtonGroup variant="segmented">
                <Button
                  pressed={type === "all"}
                  onClick={() => setType("all")}
                >
                  All
                </Button>
                {sections.map((s) => (
                  <Button
                    key={s.key}
                    pressed={type === s.key}
                    onClick={() => setType(s.key)}
                  >
                    {s.title.replace("Limited-time sale bundles", "Sale")}
                  </Button>
                ))}
              </ButtonGroup>
            )}
            <ButtonGroup variant="segmented">
              <Button
                pressed={mode === "simple"}
                onClick={() => setMode("simple")}
              >
                Simple
              </Button>
              <Button
                pressed={mode === "detailed"}
                onClick={() => setMode("detailed")}
              >
                Detailed
              </Button>
            </ButtonGroup>
          </InlineStack>
        </InlineStack>
      </Box>

      {totalMatches === 0 ? (
        <Card>
          <Box padding="400">
            <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
              No offers match “{query}”.
            </Text>
          </Box>
        </Card>
      ) : (
        filtered.map(
          (s) =>
            s.rows.length > 0 && (
              <OfferSectionCard
                key={s.key}
                section={s}
                mode={mode}
                currency={currency}
                onOpen={onOpen}
              />
            ),
        )
      )}
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
