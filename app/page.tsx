"use client";

import { FormEvent, useState, useEffect } from "react";
import { LogoMark } from "./components/logo-mark";

export default function HomePage() {
  const [confession, setConfession] = useState("");
  const [instagramId, setInstagramId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [jsLoaded, setJsLoaded] = useState(false);
  useEffect(() => setJsLoaded(true), []);

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setIsSubmitting(true);
    setStatusMessage("");

    try {
      const response = await fetch("/api/confess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confession, instagramId })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatusMessage(payload.message ?? "Could not send confession.");
        return;
      }

      setSent(true);
      setConfession("");
      setInstagramId("");
    } catch (err) {
      setStatusMessage(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  function reset() {
    setSent(false);
    setStatusMessage("");
  }

  async function copyShareText() {
    const text = `I just sent an anonymous message via SHCS_Tea — check it out.`;
    try {
      await navigator.clipboard.writeText(text);
      setStatusMessage("Share text copied to clipboard.");
    } catch {
      setStatusMessage("Unable to copy — your browser blocked clipboard access.");
    }
  }

  return (
    <main className="page">
      <div className="shell">
        <div className="card">
          <LogoMark />
          {!sent ? (
            <form className="form" onSubmit={handleSubmit}>
              <h1 className="title">SHCS_Tea</h1>
              <p className="lede">Confess anonymously — be honest, be brief.</p>

              <div className="field">
                <textarea
                  id="confession"
                  name="confession"
                  value={confession}
                  onChange={(e) => setConfession(e.target.value)}
                  placeholder="Write your confession..."
                  required
                />
              </div>

              <div className="row">
                <input
                  className="small"
                  id="instagramId"
                  name="instagramId"
                  value={instagramId}
                  onChange={(e) => setInstagramId(e.target.value)}
                  placeholder="@handle (optional)"
                  autoComplete="off"
                />
              </div>

              <div className="actions">
                <button
                  className="submit"
                  type="button"
                  disabled={isSubmitting}
                  aria-busy={isSubmitting}
                  onClick={(e) => {
                    if (e) e.preventDefault();
                    if (!isSubmitting) handleSubmit();
                  }}
                >
                  {isSubmitting ? "Sending…" : "Send"}
                </button>
              </div>

              <div className="status">{statusMessage}</div>
            </form>
          ) : (
            <div className="sent">
              <div className="sent-emoji">📨</div>
              <h2>Sent</h2>
              <p className="lede">Your confession was forwarded to the admin inbox.</p>
              <div className="actions">
                <button className="submit" onClick={copyShareText}>
                  Copy share text
                </button>
                <button className="submit secondary" onClick={reset}>
                  Send another
                </button>
              </div>
              <div className="status">{statusMessage}</div>
            </div>
          )}
          {/* client hydration indicator removed */}
        </div>
      </div>
    </main>
  );
}
// end component