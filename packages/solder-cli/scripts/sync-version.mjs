#!/usr/bin/env node
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corePackageJsonPath = path.join(__dirname, "../../core/package.json");
const cliPackageJsonPath = path.join(__dirname, "../package.json");

console.log("🔄 Syncing @solder-build/core version...");

try {
  // Read core package.json to get its version
  const corePackageJson = await fs.readJson(corePackageJsonPath);
  const coreVersion = corePackageJson.version;

  // Read CLI package.json
  const cliPackageJson = await fs.readJson(cliPackageJsonPath);

  // Update the @solder-build/core dependency version
  if (cliPackageJson.dependencies && cliPackageJson.dependencies["@solder-build/core"]) {
    cliPackageJson.dependencies["@solder-build/core"] = `^${coreVersion}`;
    console.log(`✅ Updated @solder-build/core to version ^${coreVersion}`);
  } else {
    console.log("⚠️  @solder-build/core not found in dependencies");
  }

  // Write updated package.json
  await fs.writeJson(cliPackageJsonPath, cliPackageJson, { spaces: 2 });

  console.log("✅ Version sync completed successfully!");
} catch (error) {
  console.error("❌ Error syncing version:", error.message);
  process.exit(1);
}

