import { migrateSchema } from "@solder-build/core";

const DRIZZLE_CONFIG_PATH = "./drizzle.config.ts";

/**
 * Main CI migration function
 * Runs generate + syncSchema for CI environments
 */
async function main() {
  console.log("[CI Migrate] 🚀 Starting CI migration process...");
  
  const result = await migrateSchema({
    drizzleConfigPath: DRIZZLE_CONFIG_PATH,
    verbose: true,
  });

  if (result.success) {
    console.log("[CI Migrate] ✅ CI migration completed successfully");
    process.exit(0);
  } else {
    console.error(`[CI Migrate] ✗ Migration failed: ${result.error}`);
    process.exit(1);
  }
}

// Run the migration
main();
