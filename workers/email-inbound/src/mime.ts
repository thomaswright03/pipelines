// A small MIME reader for the email Worker: enough to turn a raw inbound
// message into the { from, subject, text, messageId, headers } the app's
// /api/email-inbound route takes. It handles folded headers, RFC 2047
// encoded words, multipart bodies (preferring text/plain, falling back to
// text/html with the tags stripped), and quoted-printable / base64 bodies in
// any charset TextDecoder knows. It is not a general-purpose parser.

export type ParsedHeaders = Map<string, { name: string; values: string[] }>;

export type ParsedMessage = { headers: ParsedHeaders; text: string };

/** Bytes as a "binary string" (one char per byte), so encoded bodies survive until decoded. */
function bytesToBinary(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

function decodeBytes(bytes: Uint8Array, charset: string | null): string {
  const label = (charset ?? "utf-8").trim().toLowerCase();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function decodeBase64(text: string): string {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    return atob(clean);
  } catch {
    return "";
  }
}

function decodeQuotedPrintable(text: string, underscoreIsSpace = false): string {
  const body = underscoreIsSpace ? text.replace(/_/g, " ") : text.replace(/=\r?\n/g, "");
  return body.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Decodes RFC 2047 encoded words ("=?utf-8?B?…?=") in a header value. */
function decodeEncodedWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?") // whitespace between encoded words is dropped
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, encoding: string, data: string) => {
      const binary = encoding.toUpperCase() === "B" ? decodeBase64(data) : decodeQuotedPrintable(data, true);
      return decodeBytes(binaryToBytes(binary), charset.replace(/\*.*$/, ""));
    });
}

/** Splits a raw message (binary string) into its header block and body. */
function splitHeaderBody(raw: string): { head: string; body: string } {
  const match = /\r?\n\r?\n/.exec(raw);
  if (!match) return { head: raw, body: "" };
  return { head: raw.slice(0, match.index), body: raw.slice(match.index + match[0].length) };
}

function parseHeaders(head: string): ParsedHeaders {
  const headers: ParsedHeaders = new Map();
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    if (!/^[!-9;-~]+$/.test(name)) continue;
    // Header values are Latin-1 bytes here; decode UTF-8 raw headers (RFC 6532) and encoded words.
    const rawValue = line.slice(colon + 1).trim();
    const value = decodeEncodedWords(decodeBytes(binaryToBytes(rawValue), "utf-8"));
    const key = name.toLowerCase();
    const entry = headers.get(key);
    if (entry) entry.values.push(value);
    else headers.set(key, { name, values: [value] });
  }
  return headers;
}

export function firstHeader(headers: ParsedHeaders, name: string): string | null {
  return headers.get(name.toLowerCase())?.values[0] ?? null;
}

function contentTypeOf(headers: ParsedHeaders): { type: string; params: Record<string, string> } {
  const value = firstHeader(headers, "content-type") ?? "text/plain";
  const [type = "text/plain", ...rest] = value.split(";");
  const params: Record<string, string> = {};
  for (const part of rest) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    params[part.slice(0, eq).trim().toLowerCase()] = part
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
  }
  return { type: type.trim().toLowerCase(), params };
}

function decodeBody(body: string, headers: ParsedHeaders, charset: string | null): string {
  const encoding = (firstHeader(headers, "content-transfer-encoding") ?? "7bit").trim().toLowerCase();
  const binary = encoding === "base64" ? decodeBase64(body) : encoding === "quoted-printable" ? decodeQuotedPrintable(body) : body;
  return decodeBytes(binaryToBytes(binary), charset);
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Found = { plain: string | null; html: string | null };

function walk(head: ParsedHeaders, body: string, found: Found, depth: number): void {
  const { type, params } = contentTypeOf(head);
  if (type.startsWith("multipart/") && params.boundary && depth < 10) {
    const delimiter = `--${params.boundary}`;
    const parts = body.split(new RegExp(`\\r?\\n?${delimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \\t]*\\r?\\n?`));
    // parts[0] is the preamble and the last is the epilogue; empty ones are skipped anyway.
    for (const part of parts.slice(1)) {
      if (!part.trim()) continue;
      const split = splitHeaderBody(part);
      walk(parseHeaders(split.head), split.body, found, depth + 1);
    }
    return;
  }
  const disposition = (firstHeader(head, "content-disposition") ?? "").toLowerCase();
  if (disposition.startsWith("attachment")) return;
  if (type === "text/plain" && found.plain === null) found.plain = decodeBody(body, head, params.charset ?? null);
  else if (type === "text/html" && found.html === null) found.html = decodeBody(body, head, params.charset ?? null);
  else if (type === "message/delivery-status" || type === "message/rfc822-headers" || type === "text/rfc822-headers") {
    // Bounce notices: the delivery-status part holds Final-Recipient and the SMTP diagnostic.
    found.plain = `${found.plain ?? ""}\n${decodeBody(body, head, params.charset ?? null)}`;
  }
}

/** Parses a raw message given as bytes. */
export function parseMessage(raw: Uint8Array): ParsedMessage {
  const { head, body } = splitHeaderBody(bytesToBinary(raw));
  const headers = parseHeaders(head);
  const found: Found = { plain: null, html: null };
  walk(headers, body, found, 0);
  const text = found.plain !== null ? found.plain : found.html !== null ? htmlToText(found.html) : "";
  return { headers, text: text.replace(/\r\n?/g, "\n").trim() };
}
