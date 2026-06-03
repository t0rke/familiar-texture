export function isRegularMarketHours(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    minute: "numeric",
    timeZone: "America/New_York",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  const weekday = parts.weekday;

  if (weekday === "Sat" || weekday === "Sun") return false;

  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
}

export function getMarketHoursSafety(date = new Date()) {
  const regularHours = isRegularMarketHours(date);

  return {
    liveSafe: regularHours,
    reason: regularHours
      ? "Regular US equity market hours."
      : "Outside regular US equity market hours.",
    regularHours,
  };
}
