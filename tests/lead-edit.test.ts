// Editing and deleting leads: the same address rules as adding one, a
// pitched lead keeps its address, and a deleted lead's address is still
// never pitched again.
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createLeadAction, updateLeadAction } from "@/lib/actions/vault-pipeline";
import { createAgentAction, updateAgentAction } from "@/lib/actions/dataleadsell";
import { confirmAddressAction, deleteLeadAction } from "@/lib/actions/outreach";
import { previewBulkSend, sendFirstTouch } from "@/lib/outreach/send";
import { suppressEmail } from "@/lib/email-suppression";
import { captureMail, makeAgentLead, makeColdLead } from "./helpers";

let mail: ReturnType<typeof captureMail> | undefined;
afterEach(() => mail?.restore());

const coldInput = (over: Record<string, string> = {}) => ({
  name: "Acme Plumbing",
  company: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  website: "",
  source: "",
  estimatedValue: "",
  notes: "",
  ...over,
});

describe("editing a lead", () => {
  it("changes a New lead's address, records it as entered by hand, and it can be sent", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ name: "Acme Plumbing", email: "typo@acme.tset", sendBlockedReason: "Duplicate address — old one" });

    const result = await updateLeadAction(lead.id, coldInput({ email: "Owner@Acme.test", phone: "4805550101", city: "Mesa", state: "AZ" }));

    expect(result).toEqual({ ok: true, leadId: lead.id });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after).toMatchObject({ email: "owner@acme.test", phone: "(480) 555-0101", city: "Mesa", state: "AZ", sendBlockedReason: null });
    expect(after.emailEvidence).toMatch(/^Entered by hand on /);
    expect((await sendFirstTouch("cold-outreach", lead.id)).ok).toBe(true);
    expect(mail.to()).toEqual(["owner@acme.test"]);
  });

  it("refuses an address another lead holds, with a link to that lead", async () => {
    const holder = await makeColdLead({ name: "Holder", email: "taken@x.test" });
    const lead = await makeColdLead({ name: "Acme Plumbing" });

    const result = await updateLeadAction(lead.id, coldInput({ email: "taken@x.test" }));

    expect(result.fieldErrors?.email).toBe("taken@x.test already belongs to Holder — each address gets one pitch.");
    expect(result.fieldLinks?.email).toEqual({ href: `/vault-pipeline/${holder.id}`, label: "Open Holder" });
  });

  it("refuses an address on the do-not-email list", async () => {
    await suppressEmail("gone@x.test", { reason: "t", source: "manual" });
    const lead = await makeAgentLead({ name: "Jane Doe" });
    const result = await updateAgentAction(lead.id, {
      name: "Jane Doe",
      brokerage: "",
      email: "gone@x.test",
      phone: "",
      city: "",
      county: "",
      website: "",
      notes: "",
    });
    expect(result.fieldErrors?.email).toMatch(/do-not-email list/);
  });

  it("keeps the address of a lead that was already emailed, but saves its other details", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ name: "Pitched Co", email: "sent@x.test" });
    await sendFirstTouch("cold-outreach", lead.id);

    const refused = await updateLeadAction(lead.id, coldInput({ name: "Pitched Co", email: "new@x.test" }));
    expect(refused.fieldErrors?.email).toMatch(/already emailed at sent@x.test/);

    const saved = await updateLeadAction(lead.id, coldInput({ name: "Pitched Company", email: "sent@x.test", phone: "(480) 555-0102" }));
    expect(saved.ok).toBe(true);
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      name: "Pitched Company",
      email: "sent@x.test",
      phone: "(480) 555-0102",
      status: "contacted",
    });
  });

  it("validates like the add form", async () => {
    const lead = await makeColdLead();
    const result = await updateLeadAction(lead.id, coldInput({ name: "", email: "nope" }));
    expect(result.fieldErrors).toMatchObject({ name: "Name is required", email: "Enter a full email address, like name@business.com" });
  });

  it("the add form links to the lead that already has the address", async () => {
    const holder = await makeAgentLead({ name: "Jane Doe", email: "jane@kw.test" });
    const result = await createAgentAction({
      name: "Jane D",
      brokerage: "",
      email: "jane@kw.test",
      phone: "",
      city: "",
      county: "",
      website: "",
      notes: "",
    });
    expect(result.fieldLinks?.email).toEqual({ href: `/dataleadsell/${holder.id}`, label: "Open Jane Doe" });
  });
});

describe("deleting a lead", () => {
  it("removes it, keeps its send history, and its pitched address is still refused", async () => {
    mail = captureMail();
    const lead = await makeColdLead({ name: "Gone Co", email: "gone@co.test" });
    await sendFirstTouch("cold-outreach", lead.id);

    expect(await deleteLeadAction("cold-outreach", lead.id)).toEqual({ ok: true, message: "Deleted Gone Co." });
    expect(await prisma.lead.count()).toBe(0);
    expect(await prisma.leadEmailSendLog.count()).toBe(1);
    expect(await prisma.outreachRecipient.count({ where: { email: "gone@co.test" } })).toBe(1);

    const readd = await createLeadAction(coldInput({ name: "Gone Co again", email: "gone@co.test" }));
    expect(readd.ok).toBeUndefined();
    expect(readd.fieldErrors?.email).toMatch(/^gone@co.test was already pitched/);
  });

  it("says so when the lead is already gone", async () => {
    expect(await deleteLeadAction("dataleadsell", "missing")).toMatchObject({ ok: false });
  });
});

describe("addresses held back by the old unchecked website guess", () => {
  it("aren't sent until the operator marks the address checked", async () => {
    mail = captureMail();
    const lead = await makeColdLead({
      name: "Legacy Co",
      email: "legacy@co.test",
      source: "Yelp search",
      sendBlockedReason: "Unverified address — found by an older website guess.",
    });
    expect((await previewBulkSend("cold-outreach")).willSend).toBe(0);
    expect((await sendFirstTouch("cold-outreach", lead.id)).ok).toBe(false);

    expect(await confirmAddressAction("cold-outreach", lead.id)).toEqual({
      ok: true,
      message: "Marked legacy@co.test as checked — Legacy Co can be emailed.",
    });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).emailEvidence).toMatch(/^Checked by hand on /);
    expect((await previewBulkSend("cold-outreach")).willSend).toBe(1);
    expect(await confirmAddressAction("cold-outreach", lead.id)).toMatchObject({ ok: false });
  });
});
