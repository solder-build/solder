// your-package/api.ts
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { TableDefinition } from "./tables.js";

type DbLike = {
  select: () => any;
  insert: (t: any) => { values: (v: any) => { returning: () => Promise<any> } };
  update: (t: any) => {
    set: (v: any) => {
      where: (pred: any) => { returning: () => Promise<any> };
    };
  };
  delete: (t: any) => {
    where: (pred: any) => { returning: () => Promise<any> };
  };
};

function normalizeBasePath(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return path.endsWith("/") ? path : `${path}/`;
}

function resolvePrimaryKey(options: {
  primaryKey?: string | string[];
}): string {
  const pkOption = options.primaryKey;
  if (Array.isArray(pkOption)) {
    return pkOption[0] ?? "id";
  }
  return pkOption ?? "id";
}

export function generateCrudRouter(tableDef: TableDefinition, db: DbLike) {
  const app = new Hono();

  const ops = {
    list: tableDef.options.api?.operations?.list ?? true,
    read: tableDef.options.api?.operations?.read ?? true,
    create: tableDef.options.api?.operations?.create ?? true,
    update: tableDef.options.api?.operations?.update ?? true,
    delete: tableDef.options.api?.operations?.delete ?? true,
  };

  console.log(`[CRUD] Setting up routes for table: ${tableDef.name}`);
  console.log(`[CRUD] Operations enabled:`, ops);

  // LIST - register at root "/" since router will be mounted at basePath
  if (ops.list) {
    console.log(`[CRUD] Registering GET / for ${tableDef.name}`);
    app.get("/", async (c) => {
      try {
        console.log(`[CRUD] LIST request for ${tableDef.name}`);
        const rows = await db.select().from(tableDef.table);
        console.log(`[CRUD] Found ${rows.length} rows for ${tableDef.name}`);
        return c.json(rows);
      } catch (error) {
        console.error(`[CRUD] Error listing ${tableDef.name}:`, error);
        return c.json({ error: String(error) }, 500);
      }
    });
  }

  // CREATE - register at root "/" since router will be mounted at basePath
  if (ops.create) {
    console.log(`[CRUD] Registering POST / for ${tableDef.name}`);
    app.post("/", async (c) => {
      try {
        console.log(`[CRUD] CREATE request for ${tableDef.name}`);
        const body = await c.req.json();
        console.log(`[CRUD] Request body:`, body);
        const inserted = await db
          .insert(tableDef.table)
          .values(body)
          .returning();
        console.log(`[CRUD] Inserted:`, inserted);
        return c.json(inserted);
      } catch (error) {
        console.error(`[CRUD] Error creating ${tableDef.name}:`, error);
        return c.json({ error: String(error) }, 500);
      }
    });
  }

  // READ by id
  if (ops.read) {
    console.log(`[CRUD] Registering GET /:id for ${tableDef.name}`);
    app.get("/:id", async (c) => {
      try {
        const id = c.req.param("id");
        console.log(`[CRUD] READ request for ${tableDef.name} with id: ${id}`);
        const pk = resolvePrimaryKey(tableDef.options);
        const rows = await db
          .select()
          .from(tableDef.table)
          .where(eq((tableDef.table as any)[pk], id));
        return rows?.[0] ? c.json(rows[0]) : c.notFound();
      } catch (error) {
        console.error(`[CRUD] Error reading ${tableDef.name}:`, error);
        return c.json({ error: String(error) }, 500);
      }
    });
  }

  // UPDATE by id
  if (ops.update) {
    console.log(`[CRUD] Registering PATCH /:id for ${tableDef.name}`);
    app.patch("/:id", async (c) => {
      try {
        const id = c.req.param("id");
        const body = await c.req.json();
        console.log(
          `[CRUD] UPDATE request for ${tableDef.name} with id: ${id}`,
          body,
        );
        const pk = resolvePrimaryKey(tableDef.options);
        const updated = await db
          .update(tableDef.table)
          .set(body)
          .where(eq((tableDef.table as any)[pk], id))
          .returning();
        console.log(`[CRUD] Updated:`, updated);
        return c.json(updated);
      } catch (error) {
        console.error(`[CRUD] Error updating ${tableDef.name}:`, error);
        return c.json({ error: String(error) }, 500);
      }
    });
  }

  // DELETE by id
  if (ops.delete) {
    console.log(`[CRUD] Registering DELETE /:id for ${tableDef.name}`);
    app.delete("/:id", async (c) => {
      try {
        const id = c.req.param("id");
        console.log(
          `[CRUD] DELETE request for ${tableDef.name} with id: ${id}`,
        );
        const pk = resolvePrimaryKey(tableDef.options);
        const deleted = await db
          .delete(tableDef.table)
          .where(eq((tableDef.table as any)[pk], id))
          .returning();
        console.log(`[CRUD] Deleted:`, deleted);
        return c.json(deleted);
      } catch (error) {
        console.error(`[CRUD] Error deleting ${tableDef.name}:`, error);
        return c.json({ error: String(error) }, 500);
      }
    });
  }

  return app;
}

export function generateCrudRouters(tables: TableDefinition[], db: DbLike) {
  console.log(`[CRUD] Generating routers for ${tables.length} tables`);
  const routers = tables
    .filter((t) => {
      const enabled = t.options.api?.enabled ?? true;
      console.log(`[CRUD] Table ${t.name}: API enabled = ${enabled}`);
      return enabled;
    })
    .map((t) => {
      const basePath = normalizeBasePath(t.options.api?.basePath ?? "/");
      console.log(
        `[CRUD] Creating router for ${t.name} at basePath: ${basePath}`,
      );
      return {
        name: t.name,
        basePath,
        router: generateCrudRouter(t, db),
      };
    });
  console.log(`[CRUD] Generated ${routers.length} routers`);
  return routers;
}

export type CrudOperation = "list" | "read" | "create" | "update" | "delete";

export type CrudRoute = {
  table: string;
  operation: CrudOperation;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  primaryKey: string;
};

export type CrudApiDefinition = {
  routes: CrudRoute[];
};

export function buildCrudApiDefinition(
  tables: TableDefinition[],
): CrudApiDefinition {
  const routes: CrudRoute[] = [];
  for (const t of tables) {
    const enabled = t.options.api?.enabled ?? true;
    if (!enabled) continue;
    const basePath = t.options.api?.basePath ?? "/";
    // Remove trailing slash for final path representation
    const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
    const pk = resolvePrimaryKey(t.options);
    const ops = {
      list: t.options.api?.operations?.list ?? true,
      read: t.options.api?.operations?.read ?? true,
      create: t.options.api?.operations?.create ?? true,
      update: t.options.api?.operations?.update ?? true,
      delete: t.options.api?.operations?.delete ?? true,
    };

    if (ops.list)
      routes.push({
        table: t.name,
        operation: "list",
        method: "GET",
        path: base,
        primaryKey: pk,
      });
    if (ops.create)
      routes.push({
        table: t.name,
        operation: "create",
        method: "POST",
        path: base,
        primaryKey: pk,
      });
    if (ops.read)
      routes.push({
        table: t.name,
        operation: "read",
        method: "GET",
        path: `${base}/:id`,
        primaryKey: pk,
      });
    if (ops.update)
      routes.push({
        table: t.name,
        operation: "update",
        method: "PATCH",
        path: `${base}/:id`,
        primaryKey: pk,
      });
    if (ops.delete)
      routes.push({
        table: t.name,
        operation: "delete",
        method: "DELETE",
        path: `${base}/:id`,
        primaryKey: pk,
      });
  }
  return { routes };
}

export function createCrudApp(tables: TableDefinition[], db: DbLike) {
  console.log(`[CRUD] Creating CRUD app with ${tables.length} tables`);
  const app = new Hono();
  const routers = generateCrudRouters(tables, db);
  for (const r of routers) {
    // Mount sub-router under its base path (remove trailing slash for Hono)
    const mountPath = r.basePath.endsWith("/")
      ? r.basePath.slice(0, -1)
      : r.basePath;
    console.log(`[CRUD] Mounting router for ${r.name} at: ${mountPath}`);
    app.route(mountPath, r.router);
  }
  console.log(`[CRUD] CRUD app created successfully`);
  return app;
}
