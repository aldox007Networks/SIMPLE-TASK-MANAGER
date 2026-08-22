import { supabase } from "./supabase";

// Clave pública VAPID (es pública, puede ir en el código)
const VAPID_PUBLIC = "BBcVCa9W1zEqYNAMLTgEvpTdrZgMpm8hPJd05pvTxqAYu4mxe04M16oSgfJxvXyC5M2nCGc_kl2iewxoEE7OV5U";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Registra el service worker de push (una vez)
export async function registerPushSW() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    return await navigator.serviceWorker.register("/sw-push.js");
  } catch (e) {
    console.error("No se pudo registrar el SW de push:", e);
    return null;
  }
}

// Pide permiso y guarda la suscripción para este usuario
export async function activarNotificaciones(userId) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, error: "Este dispositivo no soporta notificaciones push." };
  }
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") return { ok: false, error: "Permiso de notificaciones no concedido." };

  const reg = await navigator.serviceWorker.ready;
  // Si ya había una suscripción, la cancelamos para crear una fresca
  try {
    const vieja = await reg.pushManager.getSubscription();
    if (vieja) await vieja.unsubscribe();
  } catch (e) {}

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
  });

  // Guardar la suscripción en Supabase (evitando duplicados por endpoint)
  const subJson = sub.toJSON();
  await supabase.from("push_subs").delete().eq("user_id", userId).eq("sub->>endpoint", subJson.endpoint);
  const { error } = await supabase.from("push_subs").insert({ user_id: userId, sub: subJson });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Refresca la suscripción en segundo plano al abrir la app (si ya hay permiso).
// Esto evita que las suscripciones caduquen sin que nadie lo note.
export async function refrescarSuscripcion(userId) {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // Si no hay suscripción activa, crear una
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
    }
    const subJson = sub.toJSON();
    // Upsert: borrar la que tenga este endpoint y volver a guardar (mantiene fresca la BD)
    await supabase.from("push_subs").delete().eq("user_id", userId).eq("sub->>endpoint", subJson.endpoint);
    await supabase.from("push_subs").insert({ user_id: userId, sub: subJson });
  } catch (e) {
    // Silencioso: es una tarea de mantenimiento en segundo plano
  }
}

// ¿Ya tiene permiso concedido?
export function permisoConcedido() {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}
