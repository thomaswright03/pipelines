// End-to-end per pipeline, through the same server actions the pages call:
// discover → find emails → confirm and bulk-send → reply / bounce → stats.
// External services are fixtures: Yelp and business websites via a fetch
// stub, SMTP via a capturing transport.
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { searchLeadsAction } from "@/lib/actions/vault-pipeline";
import { searchAgentsAction } from "@/lib/actions/dataleadsell";
import {
  confirmColdCallAction,
  findEmailsChunkAction,
  markBouncedAction,
  previewBulkSendAction,
  sendBulkChunkAction,
} from "@/lib/actions/outreach";
import { handleInboundReply } from "@/lib/outreach/inbound";
import { getDataleadsellStats, getVaultStats } from "@/lib/pipeline-stats";
import type { PipelineId } from "@/lib/outreach/pipeline-id";
import { captureMail, page, stubFetch, YELP_PREFIX, yelpResponse } from "./helpers";

let mail: ReturnType<typeof captureMail>;
afterEach(() => mail?.restore());

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

async function confirmAndSendAll(pipeline: PipelineId) {
  const preview = await previewBulkSendAction(pipeline);
  if (!preview.ok) throw new Error(preview.error);
  let ids = preview.preview.leadIds;
  let sent = 0;
  while (ids.length) {
    const chunk = await sendBulkChunkAction(pipeline, ids);
    if (!chunk.ok) throw new Error(chunk.error);
    sent += chunk.result.sent;
    ids = ids.filter((id) => !chunk.result.processedIds.includes(id));
    if (chunk.result.stop || chunk.result.processedIds.length === 0) break;
  }
  return { willSend: preview.preview.willSend, sent };
}

describe("Cold Outreach, end to end", () => {
  it("finds businesses, emails each once, records a reply and a bounce, and reports the rates", async () => {
    mail = captureMail();
    stubFetch({
      [YELP_PREFIX]: () =>
        yelpResponse([
          { name: "Alpha Plumbing", phone: "+14805550111" },
          { name: "Bravo Dental", phone: "+14805550112" },
          { name: "Charlie Nails", phone: "+14805550113" },
        ]),
      "https://www.alphaplumbing.com": page(`Alpha Plumbing — hello@alphaplumbing.test`),
      "https://www.bravodental.com": page(`Bravo Dental <a href="mailto:frontdesk@bravodental.test">email</a>`),
    });

    const search = await searchLeadsAction({}, form({ city: "Mesa", state: "Arizona", businessType: "" }));
    expect(search.error).toBeUndefined();
    expect(search.message).toMatch(/Found 3 businesses in Mesa, AZ and added 2 new leads \(skipped 1 with no findable email\)/);

    const { willSend, sent } = await confirmAndSendAll("cold-outreach");
    expect([willSend, sent]).toEqual([2, 2]);
    expect(mail.to().sort()).toEqual(["frontdesk@bravodental.test", "hello@alphaplumbing.test"]);

    await handleInboundReply({ from: "Hello <hello@alphaplumbing.test>", subject: "Re: hi", text: "Sure, call me Tuesday." });
    const bravo = await prisma.lead.findFirstOrThrow({ where: { name: "Bravo Dental" } });
    expect(await markBouncedAction("cold-outreach", bravo.id)).toEqual({
      ok: true,
      message: "Marked Bravo Dental as bounced — moved to Lost.",
    });

    const alpha = await prisma.lead.findFirstOrThrow({ where: { name: "Alpha Plumbing" } });
    expect(alpha).toMatchObject({ status: "responded", state: "AZ", phone: "(480) 555-0111" });
    const stats = await getVaultStats();
    expect(stats).toMatchObject({ emailsSentTotal: 2, leadsEmailed: 2, replied: 1, replyRate: 0.5, bounced: 1, bounceRate: 0.5 });

    // A second run of the bulk send finds nobody left.
    expect(await confirmAndSendAll("cold-outreach")).toEqual({ willSend: 0, sent: 0 });
    expect(mail.messages).toHaveLength(2);
  });
});

describe("dataleadsell, end to end", () => {
  it("finds agents, emails their own address, sends the rest to the call deck, and records calls", async () => {
    mail = captureMail();
    stubFetch({
      [YELP_PREFIX]: () =>
        yelpResponse([
          { name: "Dana Diaz - Desert Realty", phone: "+16025550121" },
          { name: "Eli Evans - Desert Realty", phone: "+16025550122" },
        ]),
      // The brokerage site lists its front desk and one agent's own address.
      "https://www.desertrealty.com": page(`Desert Realty: frontdesk@desertrealty.test · dana.diaz@desertrealty.test`),
    });

    const search = await searchAgentsAction({}, form({ county: "Maricopa", city: "Mesa" }));
    expect(search.message).toMatch(/Found 2 agents in Mesa, Maricopa County and added 1 new/);
    const dana = await prisma.agentLead.findFirstOrThrow();
    expect(dana).toMatchObject({ name: "Dana Diaz - Desert Realty", email: "dana.diaz@desertrealty.test", county: "Maricopa" });

    expect(await confirmAndSendAll("dataleadsell")).toEqual({ willSend: 1, sent: 1 });
    expect(mail.to()).toEqual(["dana.diaz@desertrealty.test"]);

    // Eli was added by hand without an email; the sweep finds none and
    // moves him to the call deck.
    const eli = await prisma.agentLead.create({
      data: { name: "Eli Evans", brokerage: "Desert Realty", phone: "(602) 555-0122", county: "Maricopa", state: "AZ" },
    });
    const sweep = await findEmailsChunkAction("dataleadsell");
    expect(sweep).toMatchObject({ ok: true, result: { checked: 1, found: 0, remaining: 0 } });
    expect((await prisma.agentLead.findUniqueOrThrow({ where: { id: eli.id } })).status).toBe("cold_call_list");

    expect(await confirmColdCallAction("dataleadsell", eli.id, "interested", "Wants the Maricopa plan")).toEqual({
      ok: true,
      message: "Saved the call with Eli Evans — moved to Responded.",
    });
    const after = await prisma.agentLead.findUniqueOrThrow({ where: { id: eli.id } });
    expect(after).toMatchObject({ status: "responded", callOutcome: "interested" });
    expect(after.notes).toMatch(/Wants the Maricopa plan/);

    const stats = await getDataleadsellStats();
    expect(stats).toMatchObject({ emailsSentTotal: 1, leadsEmailed: 1, replied: 0, replyRate: 0 });
  });
});
