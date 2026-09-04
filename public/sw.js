self.addEventListener("push", (event) => {
  let data = { title: "Bhookmark", body: "Something's happening nearby." };
  try {
    data = event.data.json();
  } catch {
    // non-JSON payload, keep default
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/vite.svg",
      tag: data.tag ?? "bhookmark",
      badge: "/vite.svg",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })
  );
});
