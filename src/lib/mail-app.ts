// The one remaining local-only Mail.app convenience: jumping to a lead's
// message thread in your own Mail.app. Sending moved to ZeptoMail (see
// send-email.ts) so it works from Vercel — this one function is inherently
// local-only forever (it brings *this Mac's* Mail.app to the front), so it
// stays guarded rather than needing a cloud equivalent.
import { spawn } from "node:child_process";
import { assertRunningLocally } from "@/lib/local-only";

async function runAppleScript(script: string): Promise<string> {
  assertRunningLocally("Viewing an email thread in Mail.app", "Mail.app");
  return new Promise<string>((resolve, reject) => {
    const child = spawn("osascript", ["-e", script]);
    let out = "";
    let err = "";

    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));

    child.on("error", (spawnErr) => {
      if ((spawnErr as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("osascript not found — this only works on macOS with Mail.app."));
        return;
      }
      reject(spawnErr);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `Mail.app AppleScript exited with code ${code}`));
        return;
      }
      resolve(out);
    });
  });
}

function appleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Brings Mail.app to the front with the most recent message from `email`
 * open, via the `message://<id>` system URL — see git history for why
 * this doesn't just select the message in the viewer directly (that
 * property was found to be unreliable in this environment).
 */
export async function revealLatestMessageInMailApp(account: string, email: string): Promise<boolean> {
  const script = `
tell application "Mail"
  set targetAccount to (first account whose name is "${appleScriptString(account)}")
  set bestMsg to missing value
  set bestDate to (current date) - (20 * 365 * days)
  repeat with mb in every mailbox of targetAccount
    set mbName to name of mb
    if mbName is "INBOX" or mbName is "Junk" or mbName is "Spam" then
      set theMatches to (messages of mb whose sender contains "${appleScriptString(email)}")
      repeat with m in theMatches
        try
          set dReceived to date received of m
          if dReceived > bestDate then
            set bestDate to dReceived
            set bestMsg to m
          end if
        end try
      end repeat
    end if
  end repeat
  if bestMsg is missing value then
    return "not_found"
  end if
  return "found:::" & (message id of bestMsg)
end tell
`.trim();

  const result = (await runAppleScript(script)).trim();
  if (result === "not_found") return false;

  const messageId = result.split(":::")[1];
  if (!messageId) return false;

  await new Promise<void>((resolve, reject) => {
    const child = spawn("open", [`message://${encodeURIComponent(`<${messageId}>`)}`]);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`open exited with code ${code}`))));
  });
  return true;
}
