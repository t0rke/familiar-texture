import fs from "fs";
import path from "path";

const LOG_DIR = "logs";
const LOG_FILE = path.join(LOG_DIR, "trades.jsonl");

export function logEvent(event) {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  const row = {
    timestamp: new Date().toISOString(),
    ...event,
  };

  fs.appendFileSync(LOG_FILE, JSON.stringify(row) + "\n");
}
