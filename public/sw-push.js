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
  const cuerpo = data.body || "";
  // Detectar si es una prioridad (el texto viene con 🔴 o "ALTA PRIORIDAD")
  const esPrioridad = cuerpo.includes("🔴") || cuerpo.includes("ALTA PRIORIDAD");

  const options = {
    body: cuerpo,
    icon: "/icono-192.png",
    badge: "/icono-192.png",
    // Prioridad: vibración más larga e insistente
    vibrate: esPrioridad ? [200, 100, 200, 100, 200, 100, 200] : [100, 50, 100],
    tag: "itask-" + Date.now(),
    renotify: true,
    // Prioridad: la notificación se queda en pantalla hasta que la tocan
    requireInteraction: esPrioridad,
    data: { url: "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

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
