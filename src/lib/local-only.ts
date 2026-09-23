// Vercel sets this in every deployed environment (production, preview, and
// `vercel dev`). Used to give a clear, friendly error instead of a raw
// ENOENT/spawn crash when a local-machine-only feature (Python/Selenium
// scraping, Mail.app AppleScript) gets invoked from the deployed app — see
// LEAD_GEN_PIPELINE_SPEC.md §8: this is a known, permanent limitation of
// those two integrations, not a bug to chase.
export function assertRunningLocally(feature: string, needs: string): void {
  if (process.env.VERCEL) {
    throw new Error(`${feature} only works on the local Mac this app runs on (it needs ${needs}, which this deployment doesn't have). Run it from localhost instead.`);
  }
}
