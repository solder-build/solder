// Query parameter parser for fine-grained REST API queries

export type FilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

export type FilterCondition = {
  field: string;
  operator: FilterOperator;
  value: string;
};

export type LogicalCondition = {
  operator: "or";
  conditions: FilterCondition[];
};

export type SortDirection = "asc" | "desc";

export type SortConfig = {
  field: string;
  direction: SortDirection;
} | null;

export type PaginationConfig = {
  limit: number | null;
  offset: number | null;
};

const OPERATORS: FilterOperator[] = ["eq", "neq", "gt", "gte", "lt", "lte"];
const RESERVED_PARAMS = ["order", "limit", "offset", "select", "or"];

/**
 * Parse filter operators from query parameters
 * Example: ?is_buy=eq.true&sol_amount=gt.1000
 */
export function parseQueryFilters(
  queryParams: Record<string, string | undefined>,
): FilterCondition[] {
  const filters: FilterCondition[] = [];

  for (const [field, value] of Object.entries(queryParams)) {
    // Skip reserved parameters or undefined values
    if (RESERVED_PARAMS.includes(field) || !value) {
      continue;
    }

    // Parse operator from value (format: operator.value)
    const match = value.match(/^(eq|neq|gt|gte|lt|lte)\.(.+)$/);
    if (match && match[1] && match[2]) {
      const operator = match[1] as FilterOperator;
      const filterValue = match[2];
      filters.push({
        field,
        operator,
        value: filterValue,
      });
    } else {
      // Default to 'eq' if no operator specified
      filters.push({
        field,
        operator: "eq",
        value,
      });
    }
  }

  return filters;
}

/**
 * Parse logical OR operator
 * Example: ?or=(is_buy.eq.true,sol_amount.gt.5000)
 */
export function parseLogicalOperator(orParam: string): LogicalCondition | null {
  if (!orParam) {
    return null;
  }

  // Remove parentheses and split by comma
  const cleaned = orParam.replace(/^\(|\)$/g, "");
  const parts = cleaned.split(",");

  const conditions: FilterCondition[] = [];

  for (const part of parts) {
    // Parse each condition: field.operator.value
    const match = part.match(/^([^.]+)\.(eq|neq|gt|gte|lt|lte)\.(.+)$/);
    if (match && match[1] && match[2] && match[3]) {
      const field = match[1];
      const operator = match[2] as FilterOperator;
      const value = match[3];
      conditions.push({ field, operator, value });
    }
  }

  if (conditions.length === 0) {
    return null;
  }

  return {
    operator: "or",
    conditions,
  };
}

/**
 * Parse sorting configuration
 * Example: ?order=timestamp.desc
 */
export function parseSorting(orderParam?: string): SortConfig {
  if (!orderParam) {
    return null;
  }

  const match = orderParam.match(/^([^.]+)\.(asc|desc)$/);
  if (match && match[1] && match[2]) {
    const field = match[1];
    const direction = match[2] as SortDirection;
    return { field, direction };
  }

  // Default to ascending if no direction specified
  return {
    field: orderParam,
    direction: "asc",
  };
}

/**
 * Parse pagination configuration
 * Example: ?limit=10&offset=20
 */
export function parsePagination(
  limit?: string | undefined,
  offset?: string | undefined,
): PaginationConfig {
  return {
    limit: limit ? parseInt(limit, 10) : null,
    offset: offset ? parseInt(offset, 10) : null,
  };
}

/**
 * Parse field selection
 * Example: ?select=mint,user,timestamp
 * Returns null if no selection (return all fields)
 */
export function parseFieldSelection(selectParam?: string | undefined): string[] | null {
  if (!selectParam) {
    return null;
  }

  return selectParam.split(",").map((f) => f.trim());
}

