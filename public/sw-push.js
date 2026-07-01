// Service worker para notificaciones push (Web Push)
// Recibe el push y lo muestra aunque la app esté cerrada.

self.addEventListener("push", (event) => {
  let data = { title: "Centro de Operaciones", body: "Tienes una nueva notificación" };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  const title = data.title || "Centro de Operaciones";
  const options = {
    body: data.body || "",
    icon: "/icono-192.png",
    badge: "/icono-192.png",
    vibrate: [100, 50, 100],
    data: { url: "/" },
  };
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
