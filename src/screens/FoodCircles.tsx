import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";
import { disablePushNotifications, enablePushNotifications, getPushSubscriptionState, simulateFriendNearby } from "../push";

const CIRCLES = [
  { name: "College friends", members: 6, matchScore: 78, lastActive: "Aish added a dosa pick" },
  { name: "Flatmates", members: 3, matchScore: 91, lastActive: "3 unread in 'Where are we eating?'" },
  { name: "Office lunch crew", members: 9, matchScore: 64, lastActive: "New Craving Room started" },
];

export default function FoodCircles() {
  const [pushState, setPushState] = useState<"unsupported" | "denied" | "subscribed" | "not-subscribed" | "checking">("checking");
  const [simResult, setSimResult] = useState<string | null>(null);

  useEffect(() => {
    getPushSubscriptionState().then(setPushState);
  }, []);

  async function togglePush() {
    if (pushState === "subscribed") {
      await disablePushNotifications();
      setPushState("not-subscribed");
      return;
    }
    setPushState("checking");
    const res = await enablePushNotifications();
    setPushState(res.ok ? "subscribed" : "denied");
  }

  async function simulate() {
    setSimResult(null);
    const res = await simulateFriendNearby("Aish", "Benne Masala Dosa", 0.4);
    setSimResult(res.ok ? "Sent — check your notifications." : res.error ?? "Couldn't send.");
  }

  return (
    <div className="px-5 pt-6 pb-32">
      <p className="text-muted text-sm mb-5">Small, private groups — shared lists, a taste-match score, and a fast way to settle "where are we eating."</p>

      <div className="bg-surface border border-line rounded-card p-4 mb-5">
        <div className="flex items-center justify-between mb-1.5">
          <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint">Friend-nearby alerts</p>
          {pushState === "subscribed" && <span className="text-accent text-[11px] font-medium">on</span>}
        </div>
        <p className="text-sm text-ink/90 mb-3">
          {pushState === "unsupported"
            ? "This browser doesn't support push notifications."
            : pushState === "denied"
            ? "Notifications are blocked — enable them in your browser's site settings to turn this on."
            : "Get a real notification the moment someone in your circle logs a dish nearby."}
        </p>
        {(pushState === "subscribed" || pushState === "not-subscribed") && (
          <motion.button
            onClick={togglePush}
            whileTap={TAP_SCALE}
            transition={LIQUID_SPRING}
            className={`w-full rounded-xl py-2.5 text-sm font-semibold ${pushState === "subscribed" ? "bg-surface2 border border-line text-muted" : "bg-accent text-accentInk"}`}
          >
            {pushState === "subscribed" ? "Turn off" : "Turn on notifications"}
          </motion.button>
        )}
        {pushState === "subscribed" && (
          <>
            <motion.button
              onClick={simulate}
              whileTap={TAP_SCALE}
              transition={LIQUID_SPRING}
              className="w-full rounded-xl py-2.5 text-xs font-medium text-accent border border-accent/30 mt-2"
            >
              Test it: simulate "Aish logged nearby"
            </motion.button>
            {simResult && <p className="text-faint text-[11px] mt-2 text-center">{simResult}</p>}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {CIRCLES.map((c) => (
          <button key={c.name} className="text-left bg-surface border border-line rounded-card p-4 hover:border-accent/50 transition-colors">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-sm">{c.name}</span>
              <span className="font-mono text-xs text-accent tabular">{c.matchScore}% match</span>
            </div>
            <div className="text-faint text-xs">{c.members} members · {c.lastActive}</div>
          </button>
        ))}
      </div>
      <button className="w-full mt-5 bg-surface border border-dashed border-line rounded-card py-3.5 text-sm font-medium text-muted">
        + Start a Food Circle
      </button>
    </div>
  );
}
