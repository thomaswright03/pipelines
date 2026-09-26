import ColdCallFlashcards from "@/components/ColdCallFlashcards";
import { loadCallDeck } from "@/lib/call-deck";
import type { PipelineId } from "@/lib/outreach/pipeline-id";

/** A pipeline's call deck page: one batch of the cold-call list (`?after=` continues past the first). */
export default async function CallDeckPage({ pipeline, title, after }: { pipeline: PipelineId; title: string; after?: string | string[] }) {
  const deck = await loadCallDeck(pipeline, { afterId: typeof after === "string" && after ? after : undefined });
  return (
    <div>
      <h1 className="accent-text mb-4 text-center text-xl font-bold tracking-tight">{title}</h1>
      {/* Keyed by batch so loading the next batch starts a fresh card index. */}
      <ColdCallFlashcards key={deck.offset} pipeline={pipeline} deck={deck} />
    </div>
  );
}
