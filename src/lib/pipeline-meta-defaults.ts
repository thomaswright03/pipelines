// Fallback card copy shown for a pipeline until someone edits it (which
// writes a real row into PipelineMeta). Keyed by pipeline id.
import { GARBAGE_AI_BRAND } from "@/lib/garbage-ai-config";
import { ROOM_DESIGNER_BRAND } from "@/lib/room-designer-config";

export type PipelineMetaFields = {
  name: string;
  company: string;
  productDescription: string;
  pipelineDescription: string;
};

const PIPELINE_META_DEFAULTS: Record<string, PipelineMetaFields> = {
  "ai-lead-responder": {
    name: "AI Lead Responder",
    company: "Mountain High Disposal / Eastern Waste & Recycling / Garden State Bin Cleaning",
    productDescription: "Dumpster rental and waste removal services for residential and commercial customers.",
    pipelineDescription:
      "Claude drafts and sends SMS replies to inbound leads in GoHighLevel, with deterministic safety checks (opt-outs, quiet hours) enforced in code before any AI-drafted message goes out.",
  },
  dataleadsell: {
    name: "dataleadsell.com",
    company: "Wright AI Solutions, LLC",
    productDescription:
      "Probate Property Leads subscriptions sold by county to real estate agents — verified leads corroborated against the deceased's obituary, plus optional mailed letters to the heirs.",
    pipelineDescription:
      "Finds real estate agents in Maricopa, Salt Lake, and Utah counties, finds their email, pitches them a subscription by email, tracks replies, opt-outs and bounce notices that reach the reply inbox, and routes non-responders to a phone cold-call deck.",
  },
  "cold-outreach": {
    name: "Cold Outreach",
    company: "Wright AI Solutions, LLC",
    productDescription:
      "Custom websites, AI, automations, and software built around whatever a business actually needs — no fixed package.",
    pipelineDescription:
      "Scrapes local businesses nationwide, finds contact info, sends cold email outreach, tracks replies, opt-outs and bounce notices that reach the reply inbox, and routes non-responders into a phone cold-call queue.",
  },
  "garbage-ai": {
    name: "Garbage AI",
    company: GARBAGE_AI_BRAND,
    productDescription:
      "An AI that texts back every online lead a waste or recycling hauler gets, day or night, in the company's own voice. It quotes only the hauler's approved prices and policies, gets the customer's typed-name sign-off on the terms by text, can write the contract into the hauler's back-office system, and hands anything that needs a person to the hauler's team.",
    pipelineDescription:
      "Finds local trash, recycling and dumpster-rental haulers in a business list (Foursquare), one new US city per day, finds their email on their own website, and pitches them a 15-minute demo with Max by email. Tracks replies and routes non-responders to a phone cold-call deck.",
  },
  "room-designer": {
    name: "Room Designer 3D",
    company: ROOM_DESIGNER_BRAND,
    productDescription:
      "A 3D bathroom designer and estimator for remodeling businesses: lay out the bathroom with the customer using real manufacturer fixtures, tile, flooring and paint, check clearances as you go, and hand them a rough estimate at your own labor prices with a PDF and materials list. Starter $49.99/month after a free week; runs in the browser in English, Spanish or Brazilian Portuguese.",
    pipelineDescription:
      "Finds independent bathroom remodelers in a business list (Foursquare), one new US city each weekday, finds their email on their own website, and emails them Thomas's pitch with the free-week link. Tracks replies and routes non-responders to a phone cold-call deck.",
  },
};

export function getPipelineMetaDefaults(id: string): PipelineMetaFields {
  return (
    PIPELINE_META_DEFAULTS[id] ?? {
      name: id,
      company: "",
      productDescription: "",
      pipelineDescription: "",
    }
  );
}
