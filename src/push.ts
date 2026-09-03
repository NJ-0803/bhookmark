import { api } from "./api";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return navigator.serviceWorker.register("/sw.js");
}

export async function getPushSubscriptionState(): Promise<"unsupported" | "denied" | "subscribed" | "not-subscribed"> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  if (!reg) return "not-subscribed";
  const sub = await reg.pushManager.getSubscription();
  return sub ? "subscribed" : "not-subscribed";
}

export async function enablePushNotifications(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: "Push notifications aren't supported in this browser." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, error: "Notification permission was denied." };

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, error: "Couldn't register the service worker." };
  await navigator.serviceWorker.ready;

  const keyRes = await api("/notifications/vapid-public-key");
  const { key } = await keyRes.json();

  const existing = await reg.pushManager.getSubscription();
  const subscription = existing ?? (await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
  }));

  const res = await api("/notifications/subscribe", {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  });
  const body = await res.json();
  return body.ok ? { ok: true } : { ok: false, error: body.error };
}

export async function disablePushNotifications(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
  await api("/notifications/unsubscribe", { method: "POST" });
}

export async function simulateFriendNearby(friendName: string, dishName: string, distanceKm: number) {
  const res = await api("/notifications/simulate-friend-nearby", {
    method: "POST",
    body: JSON.stringify({ friendName, dishName, distanceKm }),
  });
  return res.json();
}
