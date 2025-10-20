import { spawn } from "child_process";
import { syncSchema } from "./schema-sync";

export interface MigrateSchemaOptions {
  drizzleConfigPath: string;
  verbose?: boolean;
}

export interface MigrateSchemaResult {
  success: boolean;
  error?: string;
}

/**
 * Runs drizzle-kit generate to create migration files from schema
 */
async function generateMigrations(
  drizzleConfigPath: string,
  verbose: boolean = false
): Promise<boolean> {
  return new Promise((resolve) => {
    if (verbose) {
      console.log("[CI Migrate] 🔄 Generating migrations from schema...");
    }
    
    const child = spawn(
      "npx",
      ["drizzle-kit", "generate", "--config", drizzleConfigPath],
      {
        stdio: verbose ? "inherit" : "pipe",
        shell: true,
      }
    );

    let errorOutput = "";
    let standardOutput = "";

    if (!verbose) {
      if (child.stderr) {
        child.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });
      }
      if (child.stdout) {
        child.stdout.on("data", (data) => {
          standardOutput += data.toString();
        });
      }
    }

    child.on("error", (error) => {
      if (verbose) {
        console.error("[CI Migrate] ✗ Failed to start drizzle-kit generate:", error.message);
      }
      resolve(false);
    });

    child.on("close", (code) => {
      const allOutput = (errorOutput + standardOutput).trim();
      
      if (code === 0) {
        if (verbose) {
          console.log("[CI Migrate] ✓ Migrations generated successfully");
        }
        resolve(true);
      } else {
        const errorMsg = allOutput || `Process exited with code ${code}`;
        if (verbose) {
          console.error(`[CI Migrate] ✗ Migration generation failed: ${errorMsg}`);
        }
        resolve(false);
      }
    });
  });
}

/**
 * Migrates the database schema by running generate + sync
 * @param options Configuration options for schema migration
 * @returns Promise with migration result
 */
export async function migrateSchema(
  options: MigrateSchemaOptions,
): Promise<MigrateSchemaResult> {
  const { drizzleConfigPath, verbose = false } = options;

  try {
    if (verbose) {
      console.log("[CI Migrate] 🚀 Starting CI migration process...");
    }

    // Step 1: Generate migrations from schema
    const generateSuccess = await generateMigrations(drizzleConfigPath, verbose);
    if (!generateSuccess) {
      return {
        success: false,
        error: "Migration generation failed",
      };
    }

    // Step 2: Sync schema to database
    if (verbose) {
      console.log("[CI Migrate] 🔄 Syncing schema to database...");
    }
    
    const syncResult = await syncSchema({
      drizzleConfigPath,
      verbose,
    });

    if (syncResult.success) {
      if (verbose) {
        console.log("[CI Migrate] ✅ CI migration completed successfully");
      }
      return { success: true };
    } else {
      return {
        success: false,
        error: `Schema sync failed: ${syncResult.error}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Unexpected error during migration: ${error}`,
    };
  }
}
