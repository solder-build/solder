# Fine-Grained REST API Query Guide

Solder's auto-generated REST APIs now support PostgREST-style query parameters for fine-grained data filtering, sorting, pagination, and field selection.

**Important:** All query parameters use **database column names** (snake_case like `is_buy`, `sol_amount`), not schema property names (camelCase like `isBuy`, `solAmount`).

## Table of Contents

- [Basic Filtering](#basic-filtering)
- [Filter Operators](#filter-operators)
- [Logical Operators](#logical-operators)
- [Sorting](#sorting)
- [Pagination](#pagination)
- [Field Selection](#field-selection)
- [Combining Parameters](#combining-parameters)

## Basic Filtering

Filter results by adding query parameters with operator syntax: `field=operator.value`

### Examples

```bash
# Get trades where is_buy equals true
GET /trades?is_buy=eq.true

# Get trades where sol_amount is greater than 1000
GET /trades?sol_amount=gt.1000

# Multiple filters (AND condition by default)
GET /trades?is_buy=eq.true&sol_amount=gt.1000
```

## Filter Operators

Solder supports the following comparison operators:

| Operator | Description              | Example                    |
|----------|--------------------------|----------------------------|
| `eq`     | Equal                    | `?amount=eq.100`           |
| `neq`    | Not equal                | `?amount=neq.0`            |
| `gt`     | Greater than             | `?amount=gt.1000`          |
| `gte`    | Greater than or equal    | `?amount=gte.1000`         |
| `lt`     | Less than                | `?amount=lt.500`           |
| `lte`    | Less than or equal       | `?amount=lte.500`          |

### Type Handling

The API automatically converts values to the appropriate type:

- **Booleans**: `true` and `false`
- **Numbers**: Any numeric value (e.g., `100`, `1.5`)
- **Strings**: Everything else
- **Null**: The literal string `"null"`

## Logical Operators

### OR Conditions

Combine multiple conditions with logical OR using the `or` parameter:

```bash
# Get trades where is_buy is true OR sol_amount is greater than 5000
GET /trades?or=(is_buy.eq.true,sol_amount.gt.5000)
```

**Syntax**: `?or=(field1.operator.value1,field2.operator.value2,...)`

### AND Conditions (Default)

Multiple query parameters are combined with AND by default:

```bash
# Get trades where is_buy is true AND sol_amount is greater than 1000
GET /trades?is_buy=eq.true&sol_amount=gt.1000
```

## Sorting

Sort results by specifying a field and direction:

```bash
# Sort by timestamp descending (newest first)
GET /trades?order=timestamp.desc

# Sort by amount ascending
GET /trades?order=sol_amount.asc
```

**Syntax**: `?order=field.direction`

- Directions: `asc` (ascending) or `desc` (descending)
- If no direction is specified, defaults to `asc`

## Pagination

Control the number of results and starting position:

```bash
# Get first 10 results
GET /trades?limit=10

# Skip first 20 results, then get 10
GET /trades?limit=10&offset=20

# Page 3 with 25 items per page
GET /trades?limit=25&offset=50
```

**Parameters**:
- `limit`: Maximum number of results to return
- `offset`: Number of results to skip

## Field Selection

Return only specific fields instead of all columns:

```bash
# Return only mint, user, and timestamp fields
GET /trades?select=mint,user,timestamp

# Return only the amount fields
GET /trades?select=sol_amount,token_amount
```

**Syntax**: `?select=field1,field2,field3`

- If `select` is not provided, all fields are returned
- **Field names must match the database column names** (snake_case), not the schema property names

## Combining Parameters

All query parameters can be combined for powerful queries:

```bash
# Complex query: Filter, sort, paginate, and select fields
GET /trades?is_buy=eq.true&sol_amount=gt.1000&order=timestamp.desc&limit=10&select=mint,user,sol_amount,timestamp

# OR condition with sorting and pagination
GET /trades?or=(is_buy.eq.true,sol_amount.gt.5000)&order=sol_amount.desc&limit=20

# Filter by date range with field selection
GET /trades?timestamp=gte.2024-01-01&timestamp=lt.2024-02-01&select=mint,timestamp,sol_amount
```

## Examples for Solana Use Cases

### Get Recent Buys Over a Certain Amount
```bash
GET /trades?is_buy=eq.true&sol_amount=gt.10&order=timestamp.desc&limit=50
```

### Find All Trades for a Specific Mint
```bash
GET /trades?mint=eq.abc123...&order=timestamp.desc
```

### Get Large Trades (Buy or Sell)
```bash
GET /trades?or=(sol_amount.gt.100,token_amount.gt.1000000)&order=sol_amount.desc
```

### Monitor Recent Activity
```bash
GET /trades?order=timestamp.desc&limit=100&select=mint,user,is_buy,sol_amount,timestamp
```

## Error Handling

If a query is malformed or references invalid fields, the API will return a 400 error with details:

```json
{
  "error": "Unknown field: invalid_field_name"
}
```

## Backwards Compatibility

If no query parameters are provided, the API behaves as before and returns all records:

```bash
# Returns all trades (no filtering)
GET /trades
```

## Implementation Notes

- All filters are case-sensitive
- Field names must match exactly with your schema column names
- The query parser validates field names against your table schema
- Invalid operators or malformed queries return descriptive error messages

