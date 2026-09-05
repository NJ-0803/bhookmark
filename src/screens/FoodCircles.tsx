import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LIQUID_SPRING, TAP_SCALE } from "../motion";
import { disablePushNotifications, enablePushNotifications, getPushSubscriptionState, simulateFriendNearby } from "../push";
import { addFriend, createCircle, getCircleDetail, getCircles, getFriends, getMyFriendCode, type Circle, type PublicUser } from "../api";
import { haptic } from "../haptics";
import BottomSheet from "../components/BottomSheet";

function initialsFor(phone: string) {
  // No display names exist yet (phone-only accounts) — last 2 digits reads
  // better than a blank avatar and is already what the masked-phone UI
  // elsewhere in the app treats as identifying enough to show at a glance.
  return phone.replace(/\D/g, "").slice(-2);
}

function MatchRing({ score }: { score: number }) {
  return (
    <div
      className="relative w-9 h-9 rounded-full shrink-0"
      style={{ background: `conic-gradient(#E879F9 ${score * 3.6}deg, #202826 0deg)` }}
    >
      <div className="absolute inset-[3px] rounded-full bg-surface flex items-center justify-center">
        <span className="font-mono text-[9px] font-semibold text-accent tabular">{score}</span>
      </div>
    </div>
  );
}

export default function FoodCircles() {
  const [pushState, setPushState] = useState<"unsupported" | "denied" | "subscribed" | "not-subscribed" | "checking">("checking");
  const [simResult, setSimResult] = useState<string | null>(null);

  const [myCode, setMyCode] = useState<string | null>(null);
  const [friends, setFriends] = useState<PublicUser[] | null>(null);
  const [circles, setCircles] = useState<Circle[] | null>(null);

  const [addCodeInput, setAddCodeInput] = useState("");
  const [addFriendError, setAddFriendError] = useState<string | null>(null);
  const [addingFriend, setAddingFriend] = useState(false);

  const [sheet, setSheet] = useState<"create" | "detail" | null>(null);
  const [newCircleName, setNewCircleName] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [creatingCircle, setCreatingCircle] = useState(false);

  const [detailCircle, setDetailCircle] = useState<{ circle: Circle; members: PublicUser[] } | null>(null);

  useEffect(() => {
    getPushSubscriptionState().then(setPushState);
    getMyFriendCode().then((r) => r.ok && setMyCode(r.code));
    refreshFriendsAndCircles();
  }, []);

  function refreshFriendsAndCircles() {
    getFriends().then((r) => r.ok && setFriends(r.friends));
    getCircles().then((r) => r.ok && setCircles(r.circles));
  }

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

  async function submitAddFriend() {
    if (!addCodeInput.trim()) return;
    setAddingFriend(true);
    setAddFriendError(null);
    const res = await addFriend(addCodeInput.trim());
    setAddingFriend(false);
    if (res.ok) {
      haptic("success");
      setAddCodeInput("");
      refreshFriendsAndCircles();
    } else {
      setAddFriendError(res.error ?? "Couldn't add that code.");
    }
  }

  function toggleMember(id: string) {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function submitCreateCircle() {
    if (!newCircleName.trim()) return;
    setCreatingCircle(true);
    const res = await createCircle(newCircleName.trim(), [...selectedMemberIds]);
    setCreatingCircle(false);
    if (res.ok) {
      haptic("success");
      setSheet(null);
      setNewCircleName("");
      setSelectedMemberIds(new Set());
      refreshFriendsAndCircles();
    }
  }

  async function openCircleDetail(circle: Circle) {
    setSheet("detail");
    setDetailCircle(null);
    const res = await getCircleDetail(circle.id);
    if (res.ok) setDetailCircle({ circle: { ...circle, matchScore: res.matchScore }, members: res.members });
  }

  return (
    <div className="px-5 pt-6 pb-32">
      <p className="text-muted text-sm mb-5">Small, private groups — shared lists, a taste-match score, and a fast way to settle "where are we eating."</p>

      <div className="bg-surface border border-line rounded-card p-4 mb-5">
        <p className="font-mono text-[11px] tracking-[0.08em] uppercase text-faint mb-2">Your friend code</p>
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-2xl font-bold tabular text-gradient">{myCode ?? "········"}</span>
          <span className="text-faint text-xs">Share this so others can add you</span>
        </div>
        <div className="flex gap-2">
          <input
            value={addCodeInput}
            onChange={(e) => setAddCodeInput(e.target.value.toUpperCase())}
            placeholder="Enter a friend's code"
            aria-label="Friend code"
            className="flex-1 bg-surface2 border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent font-mono uppercase"
          />
          <motion.button
            whileTap={TAP_SCALE}
            onClick={submitAddFriend}
            disabled={addingFriend || !addCodeInput.trim()}
            className="gradient-primary text-white font-semibold rounded-lg px-4 text-sm disabled:opacity-40"
          >
            Add
          </motion.button>
        </div>
        {addFriendError && <p className="text-bad text-xs mt-2">{addFriendError}</p>}
        {friends && friends.length > 0 && (
          <p className="text-faint text-[11px] mt-2">{friends.length} friend{friends.length === 1 ? "" : "s"} added</p>
        )}
      </div>

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
            className={`w-full rounded-xl py-2.5 text-sm font-semibold ${pushState === "subscribed" ? "bg-surface2 border border-line text-muted" : "gradient-primary text-white"}`}
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
        {circles === null ? (
          <p className="text-faint text-sm text-center py-6">Loading your circles…</p>
        ) : circles.length === 0 ? (
          <div className="border border-dashed border-line rounded-card px-6 py-8 text-center">
            <p className="text-muted text-sm">No circles yet — add a friend above, then start one.</p>
          </div>
        ) : (
          circles.map((c, i) => (
            <motion.button
              key={c.id}
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, margin: "-40px" }}
              whileTap={{ scale: 0.98 }}
              transition={{ ...LIQUID_SPRING, delay: Math.min(i, 4) * 0.05 }}
              onClick={() => openCircleDetail(c)}
              className="text-left bg-surface border border-line rounded-card p-4 hover:border-accent/50 transition-colors flex items-center gap-3"
            >
              <MatchRing score={c.matchScore} />
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-sm truncate block">{c.name}</span>
                <div className="text-faint text-xs truncate">{c.memberCount} member{c.memberCount === 1 ? "" : "s"} · {c.matchScore}% taste match</div>
              </div>
            </motion.button>
          ))
        )}
      </div>
      <button
        onClick={() => setSheet("create")}
        disabled={!friends || friends.length === 0}
        className="w-full mt-5 bg-surface border border-dashed border-line rounded-card py-3.5 text-sm font-medium text-muted disabled:opacity-40"
      >
        + Start a Food Circle
      </button>
      {friends?.length === 0 && <p className="text-faint text-[11px] text-center mt-2">Add a friend first to start a circle</p>}

      <BottomSheet open={sheet === "create"} onClose={() => setSheet(null)} title="Start a Food Circle">
        <input
          value={newCircleName}
          onChange={(e) => setNewCircleName(e.target.value)}
          placeholder="Circle name, e.g. Flatmates"
          aria-label="Circle name"
          className="w-full bg-surface2 border border-line rounded-lg px-3 py-2.5 text-sm outline-none focus:border-accent mb-4"
        />
        <p className="font-mono text-[10px] tracking-[0.08em] uppercase text-faint mb-2">Add from your friends</p>
        <div className="flex flex-col gap-2 mb-4">
          {(friends ?? []).map((f) => (
            <button
              key={f.id}
              onClick={() => toggleMember(f.id)}
              className={`flex items-center justify-between rounded-lg px-3 py-2.5 border ${
                selectedMemberIds.has(f.id) ? "bg-accentDim border-accent/40" : "bg-surface2 border-line"
              }`}
            >
              <span className="text-sm">•••• {initialsFor(f.phone)}</span>
              <span className={`text-xs ${selectedMemberIds.has(f.id) ? "text-accent" : "text-faint"}`}>
                {selectedMemberIds.has(f.id) ? "added" : "add"}
              </span>
            </button>
          ))}
        </div>
        <motion.button
          whileTap={TAP_SCALE}
          onClick={submitCreateCircle}
          disabled={creatingCircle || !newCircleName.trim()}
          className="w-full gradient-primary text-white font-semibold rounded-xl py-3 disabled:opacity-40"
        >
          Create circle
        </motion.button>
      </BottomSheet>

      <BottomSheet open={sheet === "detail"} onClose={() => setSheet(null)} title={detailCircle?.circle.name ?? "Circle"}>
        {!detailCircle ? (
          <p className="text-faint text-sm text-center py-6">Loading…</p>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4">
              <MatchRing score={detailCircle.circle.matchScore} />
              <p className="text-sm text-ink/90">
                {detailCircle.circle.matchScore}% real taste overlap — how many of the group's loved categories every member shares.
              </p>
            </div>
            <p className="font-mono text-[10px] tracking-[0.08em] uppercase text-faint mb-2">{detailCircle.members.length} members</p>
            <div className="flex flex-col gap-2">
              {detailCircle.members.map((m) => (
                <div key={m.id} className="bg-surface2 rounded-lg px-3 py-2.5 text-sm">•••• {initialsFor(m.phone)}</div>
              ))}
            </div>
          </>
        )}
      </BottomSheet>
    </div>
  );
}
