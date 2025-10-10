#!/usr/bin/env node
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(__dirname, "../../../apps/example-app");
const targetDir = path.join(__dirname, "../template");

console.log("🔄 Syncing template from example-app...");

// Remove old template
await fs.remove(targetDir);
await fs.ensureDir(targetDir);

// Copy from example-app, excluding build artifacts
await fs.copy(sourceDir, targetDir, {
  filter: (src) => {
    const relativePath = path.relative(sourceDir, src);
    // Skip these files/folders
    const skipPatterns = [
      "node_modules",
      "dist",
      ".turbo",
      "pnpm-lock.yaml",
      ".env", // Keep .env.example but not .env
      "drizzle", // Skip generated migrations
    ];

    return !skipPatterns.some((pattern) => relativePath.includes(pattern));
  },
});

// Rename .gitignore to gitignore (to avoid npm issues)
const gitignoreSrc = path.join(targetDir, ".gitignore");
const gitignoreDest = path.join(targetDir, "gitignore");
if (await fs.pathExists(gitignoreSrc)) {
  await fs.move(gitignoreSrc, gitignoreDest, { overwrite: true });
}

console.log("✅ Template synced successfully!");
