import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createCrudApp, makeDb } from "@repo/core/src/index.js";
import { schema } from "../solder.schema.js";
import { solderConfig } from "../solder.config.js";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

// Create a db connection using the shared core helper and schema
const db = makeDb(schema, solderConfig.db.connectionString);

// Mount CRUD routes for all tables defined in the schema at their base paths
const crud = createCrudApp(schema.tables, db);
app.route("/", crud);

const port = Number(process.env.PORT ?? 3000);
serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
