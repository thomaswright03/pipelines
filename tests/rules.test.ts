import { describe, expect, it } from "vitest";
import { addressFilterFor, addressMatchesPerson, hostNamesPerson, isRoleAddress } from "@/lib/outreach/email-policy";
import { digitsOnly, formatPhone, normalizePhone } from "@/lib/phone";
import { normalizeState } from "@/lib/us-states";
import { dayKey, formatDateTime, parseZonedInputValue, startOfZoneDay, toZonedInputValue } from "@/lib/time";
import { allowedTransitions, coldCallResult, isBackwardMove, isStatusOf } from "@/lib/lead-status";
import { escapeVCardValue, buildVCard } from "@/lib/vcard";
import { isAuthorizedBearer } from "@/lib/auth-header";
import { agentLeadSchema, coldOutreachLeadSchema, fieldErrorsOf } from "@/lib/lead-forms";
import { missingEnvVars } from "@/instrumentation";
import { describeMailDestination, resolveTransportKind } from "@/lib/mail-transport-kind";
import { classifySendError, MailConfigError } from "@/lib/send-email";
import { smtpError } from "./helpers";

describe("email policy", () => {
  it("recognises shared office inboxes", () => {
    for (const e of ["frontdesk@kw.test", "info@kw.test", "info2@kw.test", "sales.team@kw.test", "Office@kw.test"]) {
      expect(isRoleAddress(e)).toBe(true);
    }
    expect(isRoleAddress("jane.doe@kw.test")).toBe(false);
  });

  it("accepts only an address that identifies this specific person", () => {
    for (const e of ["john.doe@", "jdoe@", "johndoe@", "doej@", "john_doe@", "doe.john@", "j.doe@", "jdoe2@", "john-doe@", "jdoe+web@"]) {
      expect(addressMatchesPerson(`${e}homesmart.test`, "John Doe"), e).toBe(true);
    }
    expect(addressMatchesPerson("jqdoe@kw.test", "John Q Doe")).toBe(true);
    expect(addressMatchesPerson("jdoe@kw.test", "Jane Q Doe")).toBe(true);
  });

  it("rejects a colleague's address that merely contains part of the name", () => {
    // Substrings and a bare first or last name aren't enough on a brokerage's site.
    for (const e of ["john.smith@", "johnson@", "john@", "doe.family@", "doe@", "janedoe@", "doeteam@", "jdoesmith@"]) {
      expect(addressMatchesPerson(`${e}homesmart.test`, "John Doe"), e).toBe(false);
    }
    expect(addressMatchesPerson("fleetsales@homesmart.test", "Ann Lee")).toBe(false);
    expect(addressMatchesPerson("bob.smith@kw.test", "Jane Doe")).toBe(false);
    expect(addressMatchesPerson("madonna@kw.test", "Madonna")).toBe(false);
  });

  it("handles hyphenated surnames and suffixes", () => {
    expect(addressMatchesPerson("maria.garcia-lopez@kw.test", "Maria Garcia-Lopez")).toBe(true);
    expect(addressMatchesPerson("mgarcialopez@kw.test", "Maria Garcia-Lopez")).toBe(true);
    expect(addressMatchesPerson("rob.king@kw.test", "Rob King Jr.")).toBe(true);
    expect(addressMatchesPerson("patricia.oneil@kw.test", "Patricia O'Neil")).toBe(true);
  });

  it("rejects a team or assistant inbox built on the agent's name", () => {
    for (const e of ["jdoe.team@", "john.doe.assistant@", "johndoe-office@", "jdoe.info@"]) {
      expect(addressMatchesPerson(`${e}kw.test`, "John Doe"), e).toBe(false);
    }
  });

  it("only accepts the agent's own address on a brokerage site", () => {
    const filter = addressFilterFor("John Doe", "brokerage");
    for (const e of [
      "frontdesk@homesmart.test",
      "john.smith@homesmart.test",
      "johnson@homesmart.test",
      "john@homesmart.test",
      "doe.family@homesmart.test",
    ]) {
      expect(filter(e), e).toBe(false);
    }
    for (const e of ["john.doe@homesmart.test", "jdoe@homesmart.test", "johndoe@homesmart.test"]) {
      expect(filter(e), e).toBe(true);
    }
    expect(addressFilterFor("Ann Lee", "brokerage")("fleetsales@homesmart.test")).toBe(false);
    expect(addressFilterFor("Jane Doe", "name")("info@janedoehomes.test")).toBe(true);
  });

  it("treats a domain as the agent's own only when it carries their name", () => {
    expect(hostNamesPerson("www.janedoehomes.com", "Jane Doe")).toBe(true);
    expect(hostNamesPerson("jdoerealty.com", "Jane Doe")).toBe(true);
    expect(hostNamesPerson("doe-homes.com", "Jane Doe")).toBe(true);
    expect(hostNamesPerson("www.fleetrealty.com", "Ann Lee")).toBe(false);
    expect(hostNamesPerson("www.homesmart.com", "Jane Doe")).toBe(false);
    expect(hostNamesPerson("www.doerun.com", "Jane Doe")).toBe(false);
  });
});

describe("phones, states and money", () => {
  it("normalises Yelp's E.164 and typed numbers to one format", () => {
    expect(normalizePhone("+14805550101")).toBe("(480) 555-0101");
    expect(normalizePhone("480.555.0199")).toBe("(480) 555-0199");
    expect(normalizePhone("(480)555-0199")).toBe("(480) 555-0199");
    expect(normalizePhone("  ")).toBeNull();
    expect(digitsOnly("1-480-555-0101")).toBe("4805550101");
    expect(formatPhone("12")).toBe("12");
  });

  it("stores two-letter state codes", () => {
    expect(normalizeState("Arizona")).toBe("AZ");
    expect(normalizeState(" az ")).toBe("AZ");
    expect(normalizeState("new york")).toBe("NY");
    expect(normalizeState("Narnia")).toBeNull();
  });

  it("validates the manual forms with field-level messages", () => {
    const bad = coldOutreachLeadSchema.safeParse({
      name: "x".repeat(300),
      company: "",
      email: "nope",
      phone: "12",
      address: "",
      city: "",
      state: "Narnia",
      website: "",
      source: "",
      estimatedValue: "-5000",
      notes: "",
    });
    expect(bad.success).toBe(false);
    const errors = fieldErrorsOf<Record<string, string>>(bad.error!);
    expect(Object.keys(errors).sort()).toEqual(["email", "estimatedValue", "name", "phone", "state"]);
    expect(errors.phone).toMatch(/10-digit/);

    const agent = agentLeadSchema.safeParse({
      name: "A",
      brokerage: "",
      email: "",
      phone: "",
      city: "Tucson",
      county: "Pima",
      website: "",
      notes: "",
    });
    expect(agent.success).toBe(false);
    expect(fieldErrorsOf<Record<string, string>>(agent.error!).county).toMatch(/Maricopa, Salt Lake or Utah/);
  });
});

describe("time zone handling (America/Phoenix)", () => {
  it("stores 10:00 AM Arizona as 17:00Z and shows it back as 10:00 AM", () => {
    const instant = parseZonedInputValue("2026-09-25T10:00")!;
    expect(instant.toISOString()).toBe("2026-09-25T17:00:00.000Z");
    expect(toZonedInputValue(instant)).toBe("2026-09-25T10:00");
    expect(formatDateTime(instant)).toBe("Sep 25, 2026, 10:00 AM MST");
  });

  it("puts 6 PM Arizona in that Arizona day, not the next UTC day", () => {
    const sixPm = new Date("2026-09-26T01:00:00Z"); // 6 PM MST on Sep 25
    expect(dayKey(sixPm)).toBe("2026-09-25");
    expect(startOfZoneDay(0, sixPm).toISOString()).toBe("2026-09-25T07:00:00.000Z");
  });

  it("rejects malformed appointment input", () => {
    expect(parseZonedInputValue("tomorrow")).toBeNull();
  });
});

describe("lead status machine", () => {
  it("offers only valid moves and never 'contacted' from new", () => {
    expect(allowedTransitions("cold-outreach", "new")).not.toContain("contacted");
    expect(allowedTransitions("dataleadsell", "new")).not.toContain("contacted");
    expect(allowedTransitions("cold-outreach", "lost")).toContain("responded");
    expect(isStatusOf("cold-outreach", "banana")).toBe(false);
    expect(isStatusOf("dataleadsell", "paying_client")).toBe(false);
    expect(isBackwardMove("paying_client", "working_for")).toBe(true);
    expect(isBackwardMove("contacted", "responded")).toBe(false);
  });

  it("maps cold-call outcomes per pipeline", () => {
    expect(coldCallResult("dataleadsell", "not_interested").status).toBe("not_interested");
    expect(coldCallResult("cold-outreach", "not_interested").status).toBe("lost");
    expect(coldCallResult("cold-outreach", "no_answer").status).toBeUndefined();
  });
});

describe("vCard", () => {
  it("escapes RFC 6350 special characters", () => {
    expect(escapeVCardValue("Smith, Jones; Co\\\nLine")).toBe("Smith\\, Jones\\; Co\\\\\\nLine");
    expect(buildVCard("A;B", "(480) 555-0101")).toContain("FN:A\\;B\r\n");
  });
});

describe("auth and startup checks", () => {
  it("never authorizes when the secret is unset", () => {
    expect(isAuthorizedBearer("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedBearer("Bearer ", "")).toBe(false);
    expect(isAuthorizedBearer("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorizedBearer("Bearer wrong", "s3cret")).toBe(false);
  });

  it("captures mail locally unless deployed or configured otherwise", () => {
    expect(resolveTransportKind({})).toBe("outbox");
    expect(resolveTransportKind({ VERCEL: "1" })).toBe("zeptomail");
    expect(resolveTransportKind({ EMAIL_TRANSPORT: "smtp" })).toBe("smtp");
  });

  it("requires production secrets only where they're needed", () => {
    expect(missingEnvVars({ PIPELINES_DATABASE_URL: "postgres://x" })).toEqual([]);
    expect(missingEnvVars({ PIPELINES_DATABASE_URL: "postgres://x", VERCEL: "1" })).toEqual([
      "ZEPTOMAIL_SMTP_PASSWORD",
      "YELP_API_KEY",
      "EMAIL_INBOUND_SECRET",
      "CRON_SECRET",
    ]);
  });
});

describe("send error classification", () => {
  it("treats connection problems as 'nothing was sent', in plain words", () => {
    const refused = classifySendError(smtpError("connect ECONNREFUSED 127.0.0.1:587", { code: "ESOCKET", syscall: "connect" }));
    expect(refused).toEqual({
      delivery: "not_sent",
      message: "Couldn't reach the email service — nothing was sent. Try again in a few minutes.",
    });
    expect(classifySendError(smtpError("Connection timeout", { code: "ETIMEDOUT" })).delivery).toBe("not_sent");
    expect(classifySendError(smtpError("Invalid login", { code: "EAUTH" })).delivery).toBe("not_sent");
    expect(classifySendError(smtpError("Message failed: 550", { code: "EMESSAGE", responseCode: 550 })).delivery).toBe("not_sent");
    expect(classifySendError(new MailConfigError("no password")).delivery).toBe("not_sent");
  });

  it("treats a dropped connection mid-send as 'unknown'", () => {
    expect(classifySendError(smtpError("Timeout", { code: "ETIMEDOUT" })).delivery).toBe("unknown");
    expect(classifySendError(smtpError("Connection closed unexpectedly", { code: "ECONNECTION" })).delivery).toBe("unknown");
  });
});

describe("where mail goes", () => {
  it("only claims nobody receives mail for the outbox or an SMTP catcher on this machine", () => {
    expect(describeMailDestination({ EMAIL_TRANSPORT: "outbox" })).toMatchObject({
      delivers: false,
      badge: "Test mode — emails are saved, not delivered",
    });
    expect(describeMailDestination({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "1025" })).toMatchObject({
      delivers: false,
      badge: "Mail captured locally (127.0.0.1:1025)",
    });
    const relay = describeMailDestination({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "mail.example.org", SMTP_PORT: "587" });
    expect(relay).toMatchObject({ delivers: true, badge: "Mail sent via mail.example.org:587" });
    expect(relay.description).not.toMatch(/Nobody receives/);
    expect(describeMailDestination({ VERCEL: "1" })).toMatchObject({ kind: "zeptomail", delivers: true, badge: null });
  });
});

describe("estimated value errors name the actual problem", () => {
  const base = { name: "Acme" };
  const errorFor = (estimatedValue: string) => {
    const parsed = coldOutreachLeadSchema.safeParse({ ...base, estimatedValue });
    return parsed.success ? null : (fieldErrorsOf<Record<string, string>>(parsed.error).estimatedValue ?? null);
  };
  it("too many decimals", () => expect(errorFor("12.345")).toMatch(/at most two decimal places/));
  it("negative", () => expect(errorFor("-5")).toMatch(/can't be negative/));
  it("not a number", () => expect(errorFor("lots")).toMatch(/must be a dollar amount/));
  it("fine", () => {
    expect(errorFor("$2,500.50")).toBeNull();
    expect(errorFor("")).toBeNull();
  });
});
