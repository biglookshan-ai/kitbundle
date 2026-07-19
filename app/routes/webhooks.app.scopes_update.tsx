import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    // HMAC/auth failures MUST return 401 (App Store requirement), never a 500.
    let auth;
    try {
      auth = await authenticate.webhook(request);
    } catch (e) {
      if (e instanceof Response) return e;
      return new Response("Unauthorized", { status: 401 });
    }
    const { payload, session, topic, shop } = auth;
    console.log(`Received ${topic} webhook for ${shop}`);

    const current = payload.current as string[];
    if (session) {
        await db.session.update({   
            where: {
                id: session.id
            },
            data: {
                scope: current.toString(),
            },
        });
    }
    return new Response();
};
