import fs from "fs";

const KILL_SWITCH_FILE = "KILL_SWITCH";

export function assertKillSwitchOff() {
  if (fs.existsSync(KILL_SWITCH_FILE)) {
    throw new Error("KILL_SWITCH file exists. Trading is disabled.");
  }
}

export function isKillSwitchActive() {
  return fs.existsSync(KILL_SWITCH_FILE);
}

export function enableKillSwitch() {
  fs.writeFileSync(KILL_SWITCH_FILE, `${new Date().toISOString()}\n`);
}

export function disableKillSwitch() {
  if (fs.existsSync(KILL_SWITCH_FILE)) {
    fs.unlinkSync(KILL_SWITCH_FILE);
  }
}
