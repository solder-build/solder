import { pgTable } from "drizzle-orm/pg-core";

export type ApiCrudOptions = {
  basePath?: string;
  enabled?: boolean;
  operations?: {
    list?: boolean;
    read?: boolean;
    create?: boolean;
    update?: boolean;
    delete?: boolean;
  };
};

export type TableOptions = {
  primaryKey?: string | string[];
  api?: ApiCrudOptions;
  description?: string;
};

export type TableDefinition<TTable = any> = {
  table: TTable;
  name: string;
  columns: any;
  options: TableOptions;
};

export function defineTable(
  name: string,
  columns: any,
  options: TableOptions = {},
): TableDefinition {
  const table = pgTable(name, columns);
  return {
    table,
    name,
    columns,
    options,
  };
}

export type Schema = {
  tables: TableDefinition[];
  schema: Record<string, any>;
};

export function defineSchema(...tables: TableDefinition[]): Schema {
  const schema = Object.fromEntries(tables.map((t) => [t.name, t.table]));
  return { tables, schema };
}
