import { useNavigate } from "@remix-run/react";
import {
  Card,
  IndexTable,
  InlineStack,
  Text,
  Thumbnail,
  Badge,
  Box,
  EmptyState,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";

type Kind = "bundle" | "sale" | "addon" | "free";

/** A section of offer rows of one kind, rendered as an IndexTable. */
export function OfferTable({
  rows,
  kind,
}: {
  rows: any[];
  kind: Kind;
}) {
  const navigate = useNavigate();
  const nameCol =
    kind === "bundle"
      ? "Bundle"
      : kind === "sale"
        ? "Sale bundle"
        : kind === "addon"
          ? "Add-on"
          : "Free gift";
  const lastCol =
    kind === "sale" ? "Status" : kind === "free" ? "Type" : "Discount";

  if (rows.length === 0) return null;
  return (
    <IndexTable
      resourceName={{ singular: nameCol, plural: nameCol + "s" }}
      itemCount={rows.length}
      selectable={false}
      headings={[
        { title: "Name" },
        { title: "Main product" },
        { title: lastCol },
        { title: "Items" },
      ]}
    >
      {rows.map((r, index) => (
        <IndexTable.Row
          id={r.key}
          key={r.key}
          position={index}
          onClick={() => navigate(`/app/products/${r.numericId}#${r.groupId}`)}
        >
          <IndexTable.Cell>
            <Text
              variant="bodyMd"
              fontWeight="semibold"
              as="span"
              tone={r.dim ? "subdued" : undefined}
            >
              {r.title}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Thumbnail
                source={r.productImage || ImageIcon}
                alt={r.productTitle}
                size="small"
              />
              <Text as="span" variant="bodyMd">
                {r.productTitle}
              </Text>
            </InlineStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            {kind === "sale" ? (
              r.saleState === "active" ? (
                <Badge tone="success">Live</Badge>
              ) : r.saleState === "upcoming" ? (
                <Badge>Scheduled</Badge>
              ) : (
                <Badge tone="critical">Ended</Badge>
              )
            ) : kind === "free" ? (
              <Badge tone="success">Free</Badge>
            ) : (
              <Text as="span" tone="subdued" variant="bodySm">
                {`${r.discountPercent}% off`}
              </Text>
            )}
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Badge>{String(r.accessoryCount)}</Badge>
          </IndexTable.Cell>
        </IndexTable.Row>
      ))}
    </IndexTable>
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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card padding="0">
      <Box padding="300" borderBlockEndWidth="025" borderColor="border">
        <Text as="h3" variant="headingSm">
          {title}
        </Text>
      </Box>
      {children}
    </Card>
  );
}
