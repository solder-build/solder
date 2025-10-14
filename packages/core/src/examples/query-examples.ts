/**
 * Examples of using the fine-grained REST API query features
 * 
 * These examples demonstrate how to use the new query parameters
 * with Solder's auto-generated APIs.
 */

// Example 1: Basic Filtering
// GET /trades?is_buy=eq.true&sol_amount=gt.1000
export const basicFilteringExample = {
  description: "Filter trades where is_buy=true and sol_amount>1000",
  endpoint: "/trades",
  queryParams: {
    is_buy: "eq.true",
    sol_amount: "gt.1000",
  },
};

// Example 2: Logical OR
// GET /trades?or=(is_buy.eq.true,sol_amount.gt.5000)
export const logicalOrExample = {
  description: "Get trades where is_buy=true OR sol_amount>5000",
  endpoint: "/trades",
  queryParams: {
    or: "(is_buy.eq.true,sol_amount.gt.5000)",
  },
};

// Example 3: Sorting
// GET /trades?order=timestamp.desc
export const sortingExample = {
  description: "Get all trades sorted by timestamp (newest first)",
  endpoint: "/trades",
  queryParams: {
    order: "timestamp.desc",
  },
};

// Example 4: Pagination
// GET /trades?limit=10&offset=20
export const paginationExample = {
  description: "Get page 3 of trades (10 per page)",
  endpoint: "/trades",
  queryParams: {
    limit: "10",
    offset: "20",
  },
};

// Example 5: Field Selection
// GET /trades?select=mint,user,timestamp
export const fieldSelectionExample = {
  description: "Get only specific fields from trades",
  endpoint: "/trades",
  queryParams: {
    select: "mint,user,timestamp",
  },
};

// Example 6: Complex Query
// GET /trades?is_buy=eq.true&sol_amount=gt.1000&order=timestamp.desc&limit=10&select=mint,user,sol_amount,timestamp
export const complexQueryExample = {
  description: "Complex query combining all features",
  endpoint: "/trades",
  queryParams: {
    is_buy: "eq.true",
    sol_amount: "gt.1000",
    order: "timestamp.desc",
    limit: "10",
    select: "mint,user,sol_amount,timestamp",
  },
};

// Example 7: Date Range Query
// GET /trades?timestamp=gte.2024-01-01&timestamp=lt.2024-02-01
export const dateRangeExample = {
  description: "Get trades within a date range",
  endpoint: "/trades",
  queryParams: {
    "timestamp": "gte.2024-01-01",
    // Note: Multiple filters on same field create AND condition
  },
};

// Example 8: Find by Specific Address
// GET /trades?user=eq.abc123xyz789...&order=timestamp.desc
export const findByAddressExample = {
  description: "Get all trades for a specific user address",
  endpoint: "/trades",
  queryParams: {
    user: "eq.abc123xyz789...",
    order: "timestamp.desc",
  },
};

/**
 * Helper function to build query string from params
 */
export function buildQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}

/**
 * Usage example with fetch:
 * 
 * const query = buildQueryString(complexQueryExample.queryParams);
 * const response = await fetch(`http://localhost:3000${complexQueryExample.endpoint}?${query}`);
 * const data = await response.json();
 * console.log(data);
 */

