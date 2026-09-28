// The call deck picks up where the tab left off after a refresh, and works
// without browser storage.
import { describe, expect, it } from "vitest";
import { firstUnhandled, readSavedDeck, recordCall, writeSavedDeck, type DeckStorage } from "@/lib/call-deck-session";

function memoryStorage(): DeckStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const deck = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("call deck session", () => {
  it("restores the log and resumes at the first card not yet worked", () => {
    const storage = memoryStorage();
    let saved = recordCall([], { lead: { id: "a", name: "A" }, outcome: "no_answer" });
    saved = recordCall(saved.log, { lead: { id: "c", name: "C" }, outcome: "skipped" });
    writeSavedDeck(storage, "cold-outreach", saved);

    const restored = readSavedDeck(storage, "cold-outreach");
    expect(restored).toEqual(saved);
    expect(firstUnhandled(deck, restored!.handled)).toBe(1);
    // Each pipeline keeps its own place.
    expect(readSavedDeck(storage, "dataleadsell")).toBeNull();
  });

  it("reports the end of the deck when every card was worked", () => {
    expect(firstUnhandled(deck, ["a", "b", "c"])).toBe(3);
  });

  it("starting over forgets the saved place", () => {
    const storage = memoryStorage();
    writeSavedDeck(storage, "cold-outreach", recordCall([], { lead: { id: "a", name: "A" }, outcome: "interested" }));
    writeSavedDeck(storage, "cold-outreach", null);
    expect(readSavedDeck(storage, "cold-outreach")).toBeNull();
  });

  it("ignores corrupt or foreign data, and works with no storage or storage that throws", () => {
    const storage = memoryStorage();
    storage.data.set("call-deck:cold-outreach", "{not json");
    expect(readSavedDeck(storage, "cold-outreach")).toBeNull();
    storage.data.set("call-deck:cold-outreach", JSON.stringify({ handled: "a", log: [] }));
    expect(readSavedDeck(storage, "cold-outreach")).toBeNull();
    storage.data.set(
      "call-deck:cold-outreach",
      JSON.stringify({ handled: ["a", 7], log: [{ lead: { id: "a", name: "A" }, outcome: "no_answer" }, { bogus: true }] }),
    );
    expect(readSavedDeck(storage, "cold-outreach")).toEqual({
      handled: ["a"],
      log: [{ lead: { id: "a", name: "A" }, outcome: "no_answer" }],
    });

    expect(readSavedDeck(null, "cold-outreach")).toBeNull();
    const throwing: DeckStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSavedDeck(throwing, "cold-outreach")).toBeNull();
    expect(() => writeSavedDeck(throwing, "cold-outreach", { handled: [], log: [] })).not.toThrow();
  });
});
