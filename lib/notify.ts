export function playChime() {
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const context = new AudioContextClass();
    [0, 0.25, 0.5].forEach((delay, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.type = "sine";
      oscillator.frequency.value = 660 + index * 110;
      const startAt = context.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.35, startAt + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.7);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.75);
    });
  } catch {
    // Audio is best effort and may be blocked by the browser.
  }
}

export function requestNotificationPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    // Notifications are best effort.
  }
}

export function sendNotification(title: string, body = "") {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {
    // Notifications are best effort.
  }
}
