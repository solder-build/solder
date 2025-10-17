import { watch } from "fs";
import { resolve, basename } from "path";
import { syncSchema } from "./schema-sync";

export interface WatchSchemaOptions {
  schemaPath: string;
  drizzleConfigPath: string;
  enabled?: boolean;
  debounceMs?: number;
  verbose?: boolean;
}

let watcherInstance: ReturnType<typeof watch> | null = null;
let syncInProgress = false;
let pendingSync = false;

/**
 * Watches the schema file and automatically syncs the database on changes
 * @param options Configuration options for schema watching
 */
export function watchSchema(options: WatchSchemaOptions): void {
  const {
    schemaPath,
    drizzleConfigPath,
    enabled = true,
    debounceMs = 300,
    verbose = false,
  } = options;

  if (!enabled) {
    if (verbose) {
      console.log("[Schema Watcher] Schema watching is disabled");
    }
    return;
  }

  // Stop existing watcher if any
  if (watcherInstance) {
    watcherInstance.close();
    watcherInstance = null;
  }

  const resolvedSchemaPath = resolve(schemaPath);
  const schemaFileName = basename(resolvedSchemaPath);

  console.log(`[Schema Watcher] 👀 Watching ${schemaFileName} for changes...`);

  let debounceTimer: NodeJS.Timeout | null = null;

  const handleSchemaChange = async () => {
    // Clear any pending debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Set up new debounce timer
    debounceTimer = setTimeout(async () => {
      if (syncInProgress) {
        // If a sync is already in progress, mark that we need another sync
        pendingSync = true;
        return;
      }

      try {
        syncInProgress = true;
        console.log(`[Schema Watcher] 📝 Schema change detected, syncing...`);

        const result = await syncSchema({
          drizzleConfigPath,
          verbose: true, // Always show output for debugging
        });

        if (result.success) {
          console.log("[Schema Watcher] ✓ Schema synced successfully");
        } else {
          console.error(
            `[Schema Watcher] ✗ Schema sync failed: ${result.error}`,
          );
        }
      } catch (error) {
        console.error(
          "[Schema Watcher] ✗ Unexpected error during sync:",
          error,
        );
      } finally {
        syncInProgress = false;

        // If a change occurred during sync, trigger another sync
        if (pendingSync) {
          pendingSync = false;
          handleSchemaChange();
        }
      }
    }, debounceMs);
  };

  try {
    watcherInstance = watch(resolvedSchemaPath, (eventType, filename) => {
      if (eventType === "change") {
        handleSchemaChange();
      }
    });

    watcherInstance.on("error", (error) => {
      console.error("[Schema Watcher] Error watching schema file:", error);
    });

    // Initial sync to ensure schema is up to date
    handleSchemaChange();
  } catch (error) {
    console.error("[Schema Watcher] Failed to start watching:", error);
  }
}

/**
 * Stops the schema watcher if it's running
 */
export function stopSchemaWatcher(): void {
  if (watcherInstance) {
    watcherInstance.close();
    watcherInstance = null;
    console.log("[Schema Watcher] Stopped watching schema");
  }
}

