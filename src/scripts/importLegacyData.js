import fs from "node:fs";
import { prisma } from "../core/db.js";
import { SETTINGS_FILE, validateSettings } from "../core/configStore.js";

async function main() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    console.log(`No legacy settings found at ${SETTINGS_FILE}.`);
    return;
  }

  const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  const validation = validateSettings(parsed);

  if (!validation.valid) {
    throw new Error(`Legacy settings are invalid: ${validation.errors.join(" ")}`);
  }

  await prisma.appSetting.upsert({
    create: {
      key: "settings",
      valueJson: validation.settings,
    },
    update: {
      valueJson: validation.settings,
    },
    where: {
      key: "settings",
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "LEGACY_SETTINGS_IMPORTED",
      entityType: "AppSetting",
      metadataJson: {
        source: SETTINGS_FILE,
      },
    },
  });

  console.log(`Imported ${SETTINGS_FILE} into Prisma AppSetting.settings.`);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
