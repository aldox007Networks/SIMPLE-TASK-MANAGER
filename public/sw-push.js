// Service worker para notificaciones push (Web Push) — iTask
// Recibe el push y lo muestra aunque la app esté cerrada.

// Activar el SW nuevo de inmediato (sin esperar a que se cierren pestañas)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "iTask", body: "Tienes una nueva notificación" };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  const title = data.title || "iTask";
  const options = {
    body: data.body || "",
    icon: "/icono-192.png",
    badge: "/icono-192.png",
    vibrate: [100, 50, 100],
    // tag único por mensaje: evita que se "peguen" o se pierdan entre sí
    tag: "itask-" + Date.now(),
    renotify: true,
    requireInteraction: false,
    data: { url: "/" },
  };
  // waitUntil mantiene vivo el SW hasta que la notificación se muestra
  event.waitUntil(self.registration.showNotification(title, options));
});

// Al tocar la notificación, abre o enfoca la app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
