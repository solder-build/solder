import { spawn } from "child_process";
import { syncSchema } from "@solder-build/core";

const DRIZZLE_CONFIG_PATH = "./drizzle.config.ts";

/**
 * Runs drizzle-kit generate to create migration files from schema
 */
async function generateMigrations(): Promise<boolean> {
  return new Promise((resolve) => {
    console.log("[CI Migrate] 🔄 Generating migrations from schema...");
    
    const child = spawn(
      "npx",
      ["drizzle-kit", "generate", "--config", DRIZZLE_CONFIG_PATH],
      {
        stdio: "inherit",
        shell: true,
      }
    );

    child.on("error", (error) => {
      console.error("[CI Migrate] ✗ Failed to start drizzle-kit generate:", error.message);
      resolve(false);
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log("[CI Migrate] ✓ Migrations generated successfully");
        resolve(true);
      } else {
        console.error(`[CI Migrate] ✗ Migration generation failed with code ${code}`);
        resolve(false);
      }
    });
  });
}

/**
 * Main CI migration function
 * Runs generate + syncSchema for CI environments
 */
async function main() {
  console.log("[CI Migrate] 🚀 Starting CI migration process...");
  
  try {
    // Step 1: Generate migrations from schema
    const generateSuccess = await generateMigrations();
    if (!generateSuccess) {
      console.error("[CI Migrate] ✗ Migration generation failed, aborting");
      process.exit(1);
    }

    // Step 2: Sync schema to database
    console.log("[CI Migrate] 🔄 Syncing schema to database...");
    const syncResult = await syncSchema({
      drizzleConfigPath: DRIZZLE_CONFIG_PATH,
      verbose: true,
    });

    if (syncResult.success) {
      console.log("[CI Migrate] ✅ CI migration completed successfully");
      process.exit(0);
    } else {
      console.error(`[CI Migrate] ✗ Schema sync failed: ${syncResult.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("[CI Migrate] ✗ Unexpected error during migration:", error);
    process.exit(1);
  }
}

// Run the migration
main();
