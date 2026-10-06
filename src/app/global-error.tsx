"use client";

// Only fires if the root layout itself throws — replaces the entire
// <html>, so it can't rely on layout.tsx's header/footer and has to repeat
// the minimum (including the copyright line, which must appear on every
// route with no exception).
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          color: "#1b1813",
          background: "#f6f2ea",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <p style={{ fontSize: "1.125rem", fontWeight: 600 }}>Something went wrong.</p>
        <p style={{ maxWidth: "24rem", fontSize: "0.875rem", color: "#544c43" }}>That&apos;s on us, not you. Try again.</p>
        <button
          onClick={() => retry()}
          style={{
            marginTop: "8px",
            borderRadius: "8px",
            padding: "8px 16px",
            fontSize: "0.875rem",
            fontWeight: 500,
            color: "white",
            background: "linear-gradient(to bottom, #5654d6, #34328f)",
            border: "none",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
        <footer style={{ marginTop: "24px", fontSize: "0.75rem", color: "#544c43" }}>
          © {new Date().getFullYear()} Wright AI Solutions LLC
        </footer>
      </body>
    </html>
  );
}
