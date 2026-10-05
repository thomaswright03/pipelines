// The lint setup runs ESLint 10 with eslint-config-next, whose React, import
// and jsx-a11y plugins don't support ESLint 10 yet and are wrapped by
// @eslint/compat (eslint.config.mjs). This checks every plugin family still
// reports its problems, so a wrapper that quietly stopped a plugin's rules
// would fail here rather than let lint pass on everything.
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const PROBE = `import { useState } from "react";
export function Probe({ items, flag }: { items: string[]; flag: boolean }) {
  if (flag) {
    const [x] = useState(0);
    void x;
  }
  return (
    <div>
      {items.map((i) => (
        <span>{i}</span>
      ))}
      <img src="/a.png" />
      <a href="/settings">x</a>
    </div>
  );
}
const unused = 1;
export default () => null;
`;

describe("the lint configuration", () => {
  it("runs every plugin's rules under ESLint 10", { timeout: 60_000 }, async () => {
    const root = path.resolve(__dirname, "..");
    const eslint = new ESLint({ cwd: root });
    const [result] = await eslint.lintText(PROBE, { filePath: path.join(root, "src/components/LintProbe.tsx") });
    expect(ESLint.version).toMatch(/^10\./);
    expect(result!.messages.filter((m) => m.fatal)).toEqual([]);
    const rules = new Set(result!.messages.map((m) => m.ruleId));
    for (const rule of [
      "react-hooks/rules-of-hooks",
      "react/jsx-key",
      "jsx-a11y/alt-text",
      "@next/next/no-img-element",
      "@next/next/no-html-link-for-pages",
      "@typescript-eslint/no-unused-vars",
      "import/no-anonymous-default-export",
    ]) {
      expect(rules, rule).toContain(rule);
    }
  });
});
