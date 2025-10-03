import { solderSchema, solderTable } from "@repo/core";
import {
  serial,
  text,
  timestamp,
  varchar,
  integer,
  boolean,
} from "drizzle-orm/pg-core";

// Example tables for the example-app. Adjust as needed.
// users: simple user table
const users = solderTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  {
    primaryKey: "id",
    api: {
      basePath: "/users",
      enabled: true,
      operations: {
        list: true,
        read: true,
        create: true,
        update: true,
        delete: true,
      },
    },
    description: "Users of the system",
  },
);

// posts: authored by users
const posts = solderTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content"),
    published: boolean("published").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  {
    primaryKey: "id",
    api: {
      basePath: "/posts",
      enabled: true,
      operations: {
        list: true,
        read: true,
        create: true,
        update: true,
        delete: true,
      },
    },
    description: "Posts authored by users",
  },
);

const built = solderSchema(users, posts);

// Export individual tables for Drizzle Kit
export const usersTable = users.table;
export const postsTable = posts.table;

// Export the schema object for application use
export const schema = built.schema;
export type AppSchema = typeof schema;
