---
sidebar_position: 2
---

# Hot Schema Reloading

Solder includes automatic schema synchronization during development, making it incredibly fast to iterate on your database schema.

## How It Works

When you run `pnpm run dev`, Solder automatically:

1. **Watches** your `solder.schema.ts` file for changes
2. **Syncs** schema changes to your database instantly (using `drizzle-kit push`)
3. **Skips** migration file generation entirely in development mode

## Benefits

- **No manual pushes** - Schema changes sync automatically as you save files
- **Fast iteration** - See your changes reflected immediately
- **No migration files** - Keep your repo clean during development
- **Production-ready** - Generate migrations when you're ready to deploy

## Usage

Just edit your `solder.schema.ts` file:

```typescript
// Add a new field to your table
const trades = solderTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    mint: varchar("mint", { length: 44 }).notNull(),
    // Add this new field - it syncs automatically!
    fee: integer("fee").default(0),
    // ... other fields
  },
  // ... options
);
```

**Save the file** and watch the console - your database updates automatically! 🎉

## Disabling Hot Reloading

If you need to disable automatic schema syncing:

```bash
# Set NODE_ENV to production
NODE_ENV=production pnpm run dev
```

## Production Deployments

For production, generate proper migration files:

```bash
# Generate migration files
pnpm run generate

# Review and commit the migration files
git add drizzle/

# Apply migrations in production
pnpm run push
```

**Important:** Migration files in the `drizzle/` folder are only needed for production deployments. In development, schema changes sync automatically without creating migration files.
