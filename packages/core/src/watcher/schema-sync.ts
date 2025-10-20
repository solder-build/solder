import { spawn } from "child_process";

export interface SyncSchemaOptions {
  drizzleConfigPath: string;
  verbose?: boolean;
}

export interface SyncSchemaResult {
  success: boolean;
  error?: string;
}

/**
 * Synchronizes the database schema by running drizzle-kit push
 * @param options Configuration options for schema sync
 * @returns Promise with sync result
 */
export async function syncSchema(
  options: SyncSchemaOptions,
): Promise<SyncSchemaResult> {
  const { drizzleConfigPath, verbose = false } = options;

  return new Promise((resolve) => {
    const configPath = drizzleConfigPath;

    if (verbose) {
      console.log(
        `[Schema Sync] Running drizzle-kit push with config: ${configPath}`,
      );
    }

    // Spawn drizzle-kit push process
    const child = spawn(
      "npx",
      ["drizzle-kit", "push", "--config", configPath, "--force"],
      {
        stdio: verbose ? "inherit" : "pipe",
        shell: true,
      },
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
      console.error("[Schema Sync] Failed to start drizzle-kit:", error.message);
      resolve({
        success: false,
        error: error.message,
      });
    });

    child.on("close", (code) => {
      const allOutput = (errorOutput + standardOutput).trim();
      
      if (code === 0) {
        // Check if there are any warnings or errors in the output
        if (allOutput.includes("error") || allOutput.includes("Error") || 
            allOutput.includes("failed") || allOutput.includes("Failed")) {
          console.error(`[Schema Sync] ✗ Schema sync completed with warnings/errors: ${allOutput}`);
          resolve({
            success: false,
            error: allOutput,
          });
        } else {
          if (verbose) {
            console.log("[Schema Sync] ✓ Schema synchronized successfully");
          }
          resolve({ success: true });
        }
      } else {
        const errorMsg = allOutput || `Process exited with code ${code}`;
        console.error(`[Schema Sync] ✗ Failed to sync schema: ${errorMsg}`);
        resolve({
          success: false,
          error: errorMsg,
        });
      }
    });
  });
}

