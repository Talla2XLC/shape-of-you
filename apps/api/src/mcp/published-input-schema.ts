const schemaMaps = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const schemaLists = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const schemaValues = new Set([
  "additionalProperties", "unevaluatedProperties", "additionalItems", "unevaluatedItems",
  "contains", "propertyNames", "not", "if", "then", "else", "contentSchema"
]);

/**
 * Copies a tool input schema for clients with inexact fractional multipleOf validation.
 *
 * @param schema - The unchanged schema still used by strict API validation.
 * @returns A separate schema with fractional divisors described rather than advertised
 * as multipleOf constraints. Integer divisors and non-schema annotations are preserved.
 */
export function publishMcpInputSchema(
  schema: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  return publishMcpSchema(schema, false);
}

/**
 * Copies an inline result schema for standard MCP client validators.
 *
 * @param schema - The unchanged strict server result contract, with no $ref links.
 * @returns A client schema without fractional multipleOf or nested resource IDs;
 * object-union results gain the root object type required by MCP discovery.
 * Root identity, alternatives, ranges and integer divisors remain intact.
 */
export function publishMcpOutputSchema(
  schema: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  return publishMcpSchema(schema, true);
}

function publishMcpSchema(schema: Readonly<Record<string, unknown>>, output: boolean): Readonly<Record<string, unknown>> {
  const published: Record<string, unknown> = structuredClone(schema);
  if (output && published.type === undefined) published.type = "object";
  const visited = new WeakSet<object>();
  function visit(value: unknown, root = false): void {
    if (value === null || typeof value !== "object" || Array.isArray(value) || visited.has(value)) return;
    visited.add(value);
    const node = value as Record<string, unknown>;
    // These contracts inline reusable definitions. Nested IDs otherwise collide
    // within one result or with another tool in the client's shared validator.
    if (output && !root) delete node.$id;
    if (typeof node.multipleOf === "number" && !Number.isInteger(node.multipleOf)) {
      const precision = `The API requires multiples of ${node.multipleOf}.`;
      node.description = typeof node.description === "string" ? `${node.description} ${precision}` : precision;
      delete node.multipleOf;
    }
    for (const [key, child] of Object.entries(node)) {
      if (schemaMaps.has(key) && child !== null && typeof child === "object" && !Array.isArray(child)) {
        Object.values(child).forEach((entry) => visit(entry));
      } else if ((schemaLists.has(key) || key === "items") && Array.isArray(child)) {
        child.forEach((entry) => visit(entry));
      } else if (schemaValues.has(key) || key === "items") {
        visit(child);
      }
    }
  }
  visit(published, true);
  return published;
}
