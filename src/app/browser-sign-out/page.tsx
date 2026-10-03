"use client";

import { useEffect, useRef, useState } from "react";

const products = new Set(["aegyo", "arcade", "daebak"]);

export default function BrowserSignOutPage() {
  const started = useRef(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const product = new URLSearchParams(window.location.search).get("return");
    if (!product || !products.has(product)) {
      setError(true);
      return;
    }
    fetch("/api/accounts/logout", { method: "POST", credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("logout_failed");
        window.location.replace(
          `https://aegyoarena.com/browser-sign-out?return=${product}`,
        );
      })
      .catch(() => setError(true));
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#110d1b", color: "white", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 420, textAlign: "center" }}>
        <h1>{error ? "Sign-out needs another try" : "Signing you out"}</h1>
        <p>{error ? "We couldn't finish signing out in this browser." : "Finishing up across Aegyo Arena, Arcade and Daebak…"}</p>
        {error && <button type="button" onClick={() => window.location.reload()}>Try again</button>}
      </section>
    </main>
  );
}
