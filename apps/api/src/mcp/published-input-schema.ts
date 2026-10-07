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
  const published = structuredClone(schema);
  const visited = new WeakSet<object>();
  function visit(value: unknown): void {
    if (value === null || typeof value !== "object" || Array.isArray(value) || visited.has(value)) return;
    visited.add(value);
    const node = value as Record<string, unknown>;
    if (typeof node.multipleOf === "number" && !Number.isInteger(node.multipleOf)) {
      const precision = `The API requires multiples of ${node.multipleOf}.`;
      node.description = typeof node.description === "string" ? `${node.description} ${precision}` : precision;
      delete node.multipleOf;
    }
    for (const [key, child] of Object.entries(node)) {
      if (schemaMaps.has(key) && child !== null && typeof child === "object" && !Array.isArray(child)) {
        Object.values(child).forEach(visit);
      } else if ((schemaLists.has(key) || key === "items") && Array.isArray(child)) {
        child.forEach(visit);
      } else if (schemaValues.has(key) || key === "items") {
        visit(child);
      }
    }
  }
  visit(published);
  return published;
}
