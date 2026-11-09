/**
 * "Added to the order only" campaigns — the order side (2026-11-09).
 *
 * orders/create → claim the order (one row per order, unique) → read its lines
 * and their products' gift stamps → add the parts at £0 with one order edit,
 * without notifying the customer. The scheduler retries rows that failed or
 * were cut off (e.g. a deploy restart). Orders that need nothing leave no row.
 */
import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import { pickVariant, planParts, type OrderLine, type PartNeed } from "./included-orders";

type AdminGraphql = {
  graphql: (query: string, opts?: { variables?: any }) => Promise<Response>;
};

const MAX_ATTEMPTS = 4;
const STALE_MS = 5 * 60 * 1000;

async function gql(admin: AdminGraphql, query: string, variables?: any): Promise<any> {
  try {
    const resp = await admin.graphql(query, { variables });
    const json: any = await resp.json();
    if (json?.errors?.length) {
      throw new Error(json.errors.map((e: any) => e?.message || String(e)).join("; "));
    }
    return json?.data;
  } catch (e: any) {
    // GraphqlQueryError from the library carries the response body.
    const body = e?.body?.errors?.graphQLErrors ?? e?.body?.errors;
    const msg = Array.isArray(body)
      ? body.map((x: any) => x?.message || String(x)).join("; ")
      : String(e?.message ?? e);
    throw new Error(msg);
  }
}

function localDate(iso: string, tz: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
}

export type FillResult = {
  status: "added" | "none" | "skipped" | "failed";
  detail: string;
  campaignIds: string[];
};

/** Add an order's included parts (one order edit). */
export async function fillOrder(admin: AdminGraphql, orderId: string): Promise<FillResult> {
  const data = await gql(
    admin,
    `#graphql
      query KbIncludedOrder($id: ID!) {
        shop { ianaTimezone }
        order(id: $id) {
          id name createdAt cancelledAt displayFulfillmentStatus
          lineItems(first: 100) {
            nodes {
              currentQuantity
              customAttributes { key value }
              variant { id title product { id title metafield(namespace: "custom", key: "gift_trigger") { value } } }
            }
          }
        }
      }`,
    { id: orderId },
  );
  const order = data?.order;
  if (!order) return { status: "skipped", detail: "Order not found", campaignIds: [] };

  const lines: OrderLine[] = (order.lineItems?.nodes ?? [])
    .filter((n: any) => n?.variant?.product)
    .map((n: any) => ({
      productTitle: String(n.variant.product.title || "").replace(/^[#\s]+/, ""),
      variantTitle: String(n.variant.title || ""),
      variantId: n.variant.id,
      quantity: Number(n.currentQuantity) || 0,
      stamp: n.variant.product.metafield?.value ?? null,
      props: Object.fromEntries((n.customAttributes ?? []).map((a: any) => [a.key, a.value ?? ""])),
    }));
  const today = localDate(order.createdAt, data?.shop?.ianaTimezone || "UTC");
  const planned = planParts(lines, today);
  if (!planned.length) return { status: "none", detail: "", campaignIds: [] };

  // Idempotent: units of a part already on the order (an earlier run whose
  // bookkeeping didn't finish, or a gift line) count towards what it needs.
  const have = new Map<string, number>();
  for (const n of order.lineItems?.nodes ?? []) {
    const t = String(n?.variant?.product?.id ?? "").split("/").pop();
    if (t) have.set(t, (have.get(t) ?? 0) + (Number(n.currentQuantity) || 0));
  }
  const needs = planned
    .map((n) => ({ ...n, quantity: n.quantity - (have.get(n.productTail) ?? 0) }))
    .filter((n) => n.quantity > 0);
  if (!needs.length) {
    return {
      status: "added",
      detail: "Already on the order",
      campaignIds: [...new Set(planned.flatMap((n) => n.campaignIds))],
    };
  }

  const campaignIds = [...new Set(needs.flatMap((n) => n.campaignIds))];
  if (order.cancelledAt) {
    return { status: "skipped", detail: "Order was cancelled", campaignIds };
  }
  if (order.displayFulfillmentStatus === "FULFILLED") {
    return { status: "skipped", detail: "Order already fulfilled", campaignIds };
  }

  // The parts' variants.
  const prods = await gql(
    admin,
    `#graphql
      query KbIncludedParts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product { id title status variants(first: 50) { nodes { id title availableForSale } } }
        }
      }`,
    { ids: needs.map((n) => `gid://shopify/Product/${n.productTail}`) },
  );
  const byTail = new Map<string, any>();
  for (const p of prods?.nodes ?? []) if (p?.id) byTail.set(String(p.id).split("/").pop()!, p);

  const adds: { need: PartNeed; variantId: string; title: string }[] = [];
  const missing: string[] = [];
  for (const need of needs) {
    const p = byTail.get(need.productTail);
    const vid = p ? pickVariant(p.variants?.nodes ?? [], need.variantTails) : null;
    if (!p || !vid) {
      missing.push(p?.title || `product ${need.productTail}`);
      continue;
    }
    adds.push({ need, variantId: vid, title: String(p.title || "").replace(/^[#\s]+/, "") });
  }
  if (!adds.length) {
    return { status: "failed", detail: `Part not found: ${missing.join(", ")}`, campaignIds };
  }

  // One edit: add each part, make it free, commit without telling the customer.
  const begin = await gql(
    admin,
    `#graphql
      mutation KbEditBegin($id: ID!) {
        orderEditBegin(id: $id) { calculatedOrder { id } userErrors { message } }
      }`,
    { id: order.id },
  );
  const errs0 = begin?.orderEditBegin?.userErrors ?? [];
  const calcId = begin?.orderEditBegin?.calculatedOrder?.id;
  if (errs0.length || !calcId) {
    return { status: "failed", detail: errs0.map((e: any) => e.message).join("; ") || "Couldn't start the order edit", campaignIds };
  }

  const done: string[] = [];
  for (const a of adds) {
    const add = await gql(
      admin,
      `#graphql
        mutation KbEditAdd($id: ID!, $variantId: ID!, $quantity: Int!) {
          orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity, allowDuplicates: true) {
            calculatedLineItem { id originalUnitPriceSet { shopMoney { amount } } }
            userErrors { message }
          }
        }`,
      { id: calcId, variantId: a.variantId, quantity: a.need.quantity },
    );
    const r = add?.orderEditAddVariant;
    if (r?.userErrors?.length || !r?.calculatedLineItem?.id) {
      return {
        status: "failed",
        detail: `${a.title}: ${(r?.userErrors ?? []).map((e: any) => e.message).join("; ") || "couldn't add"}`,
        campaignIds,
      };
    }
    const price = Number(r.calculatedLineItem.originalUnitPriceSet?.shopMoney?.amount) || 0;
    if (price > 0) {
      const disc = await gql(
        admin,
        `#graphql
          mutation KbEditFree($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
            orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
              userErrors { message }
            }
          }`,
        {
          id: calcId,
          lineItemId: r.calculatedLineItem.id,
          discount: { percentValue: 100, description: "Included" },
        },
      );
      const de = disc?.orderEditAddLineItemDiscount?.userErrors ?? [];
      if (de.length) {
        return { status: "failed", detail: `${a.title}: ${de.map((e: any) => e.message).join("; ")}`, campaignIds };
      }
    }
    done.push(`${a.need.quantity} × ${a.title}`);
  }

  const withText = [...new Set(adds.flatMap((a) => a.need.withTitles))].join(", ");
  const commit = await gql(
    admin,
    `#graphql
      mutation KbEditCommit($id: ID!, $note: String) {
        orderEditCommit(id: $id, notifyCustomer: false, staffNote: $note) {
          order { id }
          userErrors { message }
        }
      }`,
    { id: calcId, note: `KitBundle: included parts added (${done.join(", ")}) with ${withText}`.slice(0, 250) },
  );
  const ce = commit?.orderEditCommit?.userErrors ?? [];
  if (ce.length) {
    return { status: "failed", detail: ce.map((e: any) => e.message).join("; "), campaignIds };
  }
  const note = missing.length ? ` · not found: ${missing.join(", ")}` : "";
  return { status: "added", detail: `${done.join(", ")}${note}`, campaignIds };
}

/** Any live order-only campaigns? (Cheap gate before touching the order.) */
async function hasOrderCampaigns(shop: string) {
  const n = await prisma.giftCampaign.count({
    where: { shop, presentation: "order", kind: { not: "deal" }, enabled: true, draft: false },
  });
  return n > 0;
}

async function process(rowId: string) {
  const row = await prisma.includedOrder.update({
    where: { id: rowId },
    data: { attempts: { increment: 1 }, status: "working" },
  });
  let r: FillResult;
  try {
    const { admin } = await unauthenticated.admin(row.shop);
    r = await fillOrder(admin as unknown as AdminGraphql, row.orderId);
  } catch (e) {
    r = { status: "failed", detail: String((e as Error)?.message ?? e).slice(0, 500), campaignIds: [] };
  }
  if (r.status === "none") {
    await prisma.includedOrder.delete({ where: { id: row.id } }).catch(() => {});
    return;
  }
  await prisma.includedOrder.update({
    where: { id: row.id },
    data: {
      status: r.status,
      detail: r.detail.slice(0, 1000),
      ...(r.campaignIds.length ? { campaignIdsJson: JSON.stringify(r.campaignIds) } : {}),
    },
  });
  if (r.status === "failed") console.error(`[gifts] included parts failed ${row.shop} ${row.orderName}: ${r.detail}`);
  else console.log(`[gifts] included parts ${r.status} ${row.shop} ${row.orderName}: ${r.detail}`);
}

/** orders/create: claim the order once, then add its parts. */
export async function queueIncludedOrder(shop: string, orderId: string, orderName: string) {
  if (!(await hasOrderCampaigns(shop))) return;
  let row;
  try {
    row = await prisma.includedOrder.create({ data: { shop, orderId, orderName } });
  } catch (e: any) {
    if (e?.code === "P2002") return; // already claimed (webhook re-delivery)
    throw e;
  }
  await process(row.id);
}

/** Scheduler backstop: retry failed rows and rows cut off mid-way. */
export async function retryIncludedOrders(now = new Date()) {
  const rows = await prisma.includedOrder.findMany({
    where: {
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { status: "failed" },
        { status: { in: ["pending", "working"] }, updatedAt: { lt: new Date(now.getTime() - STALE_MS) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  for (const r of rows) {
    await process(r.id).catch((e) => console.error("[gifts] included retry failed", e));
  }
}

/** Recent orders a campaign added parts to (for the campaign page). */
export async function recentIncludedOrders(shop: string, campaignId: string, take = 15) {
  const rows = await prisma.includedOrder.findMany({
    where: { shop, campaignIdsJson: { contains: `"${campaignId}"` } },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((r) => ({
    orderId: r.orderId,
    orderName: r.orderName,
    status: r.status,
    detail: r.detail,
    attempts: r.attempts,
    createdAt: r.createdAt.toISOString(),
  }));
}
