// A short identifier for a set of heuristic rules, stored next to every
// decision they make (InboundReply.rulesVersion, the leads'
// emailRulesVersion), so a change in production accuracy can be traced to
// the rule change that caused it.
//
// The identifier is a hash of the rules themselves — every pattern, word
// list and threshold passed in — plus a revision number for changes to the
// code around them. Editing a pattern or a word list changes it on its own;
// a change to the logic alone (a threshold in an `if`, the order checks run
// in) needs the module's revision bumped.

type RulePart = RegExp | string | number | boolean | null | ReadonlySet<string> | readonly RulePart[] | { readonly [key: string]: RulePart };

function serialize(part: RulePart): string {
  if (part instanceof RegExp) return `/${part.source}/${part.flags}`;
  if (part instanceof Set) return `{${[...part].sort().join("|")}}`;
  if (Array.isArray(part)) return `[${part.map(serialize).join(",")}]`;
  if (part !== null && typeof part === "object") {
    return `{${Object.keys(part)
      .sort()
      .map((k) => `${k}:${serialize((part as { [key: string]: RulePart })[k]!)}`)
      .join(",")}}`;
  }
  return JSON.stringify(part);
}

/** 32-bit FNV-1a, as 8 hex digits (no Node-only APIs, so it runs anywhere). */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** "reply.3-1a2b3c4d": the rule set's name, its revision and a hash of its rules. */
export function rulesVersion(name: string, revision: number, parts: readonly RulePart[]): string {
  return `${name}.${revision}-${fnv1a(serialize(parts))}`;
}
