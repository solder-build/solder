// Query builder for converting parsed parameters into Drizzle ORM queries

import {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  asc,
  desc,
  SQL,
} from "drizzle-orm";
import type {
  FilterCondition,
  LogicalCondition,
  SortConfig,
  PaginationConfig,
} from "./api-query-parser";

/**
 * Convert filter value to appropriate type
 */
function parseValue(value: string): string | number | boolean | null {
  // Handle null
  if (value === "null") {
    return null;
  }

  // Handle boolean
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  // Handle number
  const num = Number(value);
  if (!isNaN(num) && value !== "") {
    return num;
  }

  // Default to string
  return value;
}

/**
 * Build WHERE clause from filter conditions
 * @param table - Drizzle table object (not used directly, kept for compatibility)
 * @param filters - Parsed filter conditions
 * @param columnMap - Mapping of database column names to Drizzle column objects
 */
export function buildWhereClause(
  table: any,
  filters: FilterCondition[],
  columnMap: Record<string, any>,
): SQL | undefined {
  if (filters.length === 0) {
    return undefined;
  }

  const conditions = filters.map((filter) => {
    const column = columnMap[filter.field];
    if (!column) {
      throw new Error(`Unknown field: ${filter.field}`);
    }

    const value = parseValue(filter.value);

    switch (filter.operator) {
      case "eq":
        return eq(column, value);
      case "neq":
        return ne(column, value);
      case "gt":
        return gt(column, value);
      case "gte":
        return gte(column, value);
      case "lt":
        return lt(column, value);
      case "lte":
        return lte(column, value);
      default:
        throw new Error(`Unknown operator: ${filter.operator}`);
    }
  });

  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

/**
 * Build WHERE clause for logical OR operator
 * @param table - Drizzle table object (not used directly, kept for compatibility)
 * @param logicalCondition - Parsed OR condition
 * @param columnMap - Mapping of database column names to Drizzle column objects
 */
export function buildLogicalOrClause(
  table: any,
  logicalCondition: LogicalCondition,
  columnMap: Record<string, any>,
): SQL | undefined {
  if (!logicalCondition || logicalCondition.conditions.length === 0) {
    return undefined;
  }

  const conditions = logicalCondition.conditions.map((filter) => {
    const column = columnMap[filter.field];
    if (!column) {
      throw new Error(`Unknown field: ${filter.field}`);
    }

    const value = parseValue(filter.value);

    switch (filter.operator) {
      case "eq":
        return eq(column, value);
      case "neq":
        return ne(column, value);
      case "gt":
        return gt(column, value);
      case "gte":
        return gte(column, value);
      case "lt":
        return lt(column, value);
      case "lte":
        return lte(column, value);
      default:
        throw new Error(`Unknown operator: ${filter.operator}`);
    }
  });

  return or(...conditions);
}

/**
 * Apply filters to query
 * @param query - Drizzle query builder
 * @param table - Drizzle table object (not used directly, kept for compatibility)
 * @param filters - Parsed filter conditions
 * @param logicalCondition - Parsed OR condition (if any)
 * @param columnMap - Mapping of database column names to Drizzle column objects
 */
export function applyFiltersToQuery(
  query: any,
  table: any,
  filters: FilterCondition[],
  logicalCondition: LogicalCondition | null,
  columnMap: Record<string, any>,
): any {
  // Handle logical OR first
  if (logicalCondition) {
    const orClause = buildLogicalOrClause(table, logicalCondition, columnMap);
    if (orClause) {
      return query.where(orClause);
    }
  }

  // Handle regular AND filters
  const whereClause = buildWhereClause(table, filters, columnMap);
  if (whereClause) {
    return query.where(whereClause);
  }

  return query;
}

/**
 * Apply sorting to query
 * @param query - Drizzle query builder
 * @param table - Drizzle table object (not used directly, kept for compatibility)
 * @param sortConfig - Sort configuration
 * @param columnMap - Mapping of database column names to Drizzle column objects
 */
export function applySorting(
  query: any,
  table: any,
  sortConfig: SortConfig,
  columnMap: Record<string, any>,
): any {
  if (!sortConfig) {
    return query;
  }

  const column = columnMap[sortConfig.field];
  if (!column) {
    throw new Error(`Unknown field for sorting: ${sortConfig.field}`);
  }

  const orderFn = sortConfig.direction === "desc" ? desc : asc;
  return query.orderBy(orderFn(column));
}

/**
 * Apply pagination to query
 */
export function applyPagination(
  query: any,
  pagination: PaginationConfig,
): any {
  let result = query;

  if (pagination.limit !== null) {
    result = result.limit(pagination.limit);
  }

  if (pagination.offset !== null) {
    result = result.offset(pagination.offset);
  }

  return result;
}

/**
 * Apply field selection to query
 * If fields is null, return all fields
 */
export function applyFieldSelection(
  query: any,
  table: any,
  fields: string[] | null,
  columns: any,
): any {
  if (!fields || fields.length === 0) {
    return query;
  }

  // Build selection object
  const selection: Record<string, any> = {};
  for (const field of fields) {
    const column = table[field];
    if (!column) {
      throw new Error(`Unknown field for selection: ${field}`);
    }
    selection[field] = column;
  }

  // Replace the select with specific fields
  // Note: This creates a new query with the selection
  return query.select(selection);
}

