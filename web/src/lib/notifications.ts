export function requestNotificationPermission() {
  if (typeof Notification === "undefined") return
  if (Notification.permission === "default") Notification.requestPermission()
}

export function isPageBackground(): boolean {
  return document.hidden || !document.hasFocus()
}

export function sendSystemNotification(title: string, body: string, onClick?: () => void) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return
  const n = new Notification(title, { body })
  n.onclick = () => {
    window.focus()
    n.close()
    onClick?.()
  }
}
