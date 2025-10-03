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

  const basePath = normalizeBasePath(tableDef.options.api?.basePath ?? "/");
  const ops = {
    list: tableDef.options.api?.operations?.list ?? true,
    read: tableDef.options.api?.operations?.read ?? true,
    create: tableDef.options.api?.operations?.create ?? true,
    update: tableDef.options.api?.operations?.update ?? true,
    delete: tableDef.options.api?.operations?.delete ?? true,
  };

  // LIST
  if (ops.list) {
    app.get(basePath, async (c) => {
      const rows = await db.select().from(tableDef.table);
      return c.json(rows);
    });
  }

  // CREATE
  if (ops.create) {
    app.post(basePath, async (c) => {
      const body = await c.req.json();
      const inserted = await db.insert(tableDef.table).values(body).returning();
      return c.json(inserted);
    });
  }

  // READ by id
  if (ops.read) {
    app.get(`${basePath}:id`, async (c) => {
      const id = c.req.param("id");
      const pk = resolvePrimaryKey(tableDef.options);
      const rows = await db
        .select()
        .from(tableDef.table)
        .where(eq((tableDef.table as any)[pk], id));
      return rows?.[0] ? c.json(rows[0]) : c.notFound();
    });
  }

  // UPDATE by id
  if (ops.update) {
    app.patch(`${basePath}:id`, async (c) => {
      const id = c.req.param("id");
      const body = await c.req.json();
      const pk = resolvePrimaryKey(tableDef.options);
      const updated = await db
        .update(tableDef.table)
        .set(body)
        .where(eq((tableDef.table as any)[pk], id))
        .returning();
      return c.json(updated);
    });
  }

  // DELETE by id
  if (ops.delete) {
    app.delete(`${basePath}:id`, async (c) => {
      const id = c.req.param("id");
      const pk = resolvePrimaryKey(tableDef.options);
      const deleted = await db
        .delete(tableDef.table)
        .where(eq((tableDef.table as any)[pk], id))
        .returning();
      return c.json(deleted);
    });
  }

  return app;
}

export function generateCrudRouters(tables: TableDefinition[], db: DbLike) {
  return tables
    .filter((t) => t.options.api?.enabled ?? true)
    .map((t) => ({
      name: t.name,
      basePath: normalizeBasePath(t.options.api?.basePath ?? "/"),
      router: generateCrudRouter(t, db),
    }));
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
    const base = normalizeBasePath(t.options.api?.basePath ?? "/");
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
        path: `${base}:id`,
        primaryKey: pk,
      });
    if (ops.update)
      routes.push({
        table: t.name,
        operation: "update",
        method: "PATCH",
        path: `${base}:id`,
        primaryKey: pk,
      });
    if (ops.delete)
      routes.push({
        table: t.name,
        operation: "delete",
        method: "DELETE",
        path: `${base}:id`,
        primaryKey: pk,
      });
  }
  return { routes };
}

export function createCrudApp(tables: TableDefinition[], db: DbLike) {
  const app = new Hono();
  const routers = generateCrudRouters(tables, db);
  for (const r of routers) {
    // Mount sub-router under its base path
    app.route(r.basePath, r.router);
  }
  return app;
}
