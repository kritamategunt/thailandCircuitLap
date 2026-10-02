"use client";
import { useState } from "react";

/** Share the spectator link (/live/<id>) — native share sheet on phones, clipboard otherwise. */
export function ShareLiveButton({ sessionId }: { sessionId: string }) {
  const [done, setDone] = useState(false);
  async function share() {
    const url = `${location.origin}/live/${sessionId}`;
    try {
      if (navigator.share) await navigator.share({ title: "Watch me live", url });
      else {
        await navigator.clipboard.writeText(url);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }
    } catch {
      // user cancelled the share sheet
    }
  }
  return (
    <button onClick={share} className="rounded bg-line px-3 py-1.5 text-xs font-black tracking-widest uppercase">
      {done ? "Link copied" : "Share live"}
    </button>
  );
}
