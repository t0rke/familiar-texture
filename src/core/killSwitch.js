import fs from "fs";

export function assertKillSwitchOff() {
  if (fs.existsSync("KILL_SWITCH")) {
    throw new Error("KILL_SWITCH file exists. Trading is disabled.");
  }
}
