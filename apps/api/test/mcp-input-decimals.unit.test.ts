import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it, vi } from "vitest";
import { MealListSchema, PartialNutrientValuesSchema } from "@shape-of-you/contracts";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { publishMcpInputSchema, publishMcpOutputSchema } from "../src/mcp/published-input-schema.js";
import { decimalMenuMeal, mcpMealServer } from "./fixtures/mcp-meal-server.js";

const personId = "00000000-0000-4000-8000-000000000101";
function fixture() {
  const input = decimalMenuMeal("synthetic-fractions");
  const createMeal = vi.fn().mockResolvedValue({ created: true, meal: {
    ...input, id: "00000000-0000-4000-8000-000000000102", personId, temporalPrecision: "instant",
    localDate: "2026-10-07", description: null, note: null, photoMediaId: null,
    sourceReference: { id: "00000000-0000-4000-8000-000000000103", channel: "manual",
      externalSystem: null, externalRecordId: null, occurredAt: input.occurredAt, ingestedAt: input.occurredAt },
    confidence: null, supersedesId: null, correctionReason: null, createdAt: input.occurredAt,
    totals: input.items[0]!.nutrients, nutritionCompleteness: "complete",
    items: input.items.map((item, index) => ({ ...item, position: index + 1, foodVersionId: null, amountDescription: null }))
  } });
  return { ...mcpMealServer({ createMeal, listMeals: vi.fn(), correctMeal: vi.fn() }, personId), createMeal };
}
function standardValidator(schema: object) {
  const ajv = new Ajv({ strict: false, allErrors: true });
  (addFormats as unknown as (instance: Ajv) => Ajv)(ajv);
  return ajv.compile(schema);
}

describe("MCP input decimal compatibility", () => {
  it("accepts ordinary fractional Meal evidence through the published schema and actual handler", async () => {
    const { server, list, call, createMeal } = fixture();
    try {
      const { tools } = await list();
      const schema = tools.find((tool: { name: string }) => tool.name === "record_meal").inputSchema;
      const input = decimalMenuMeal("synthetic-fractions");
      const validate = standardValidator(schema);
      expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
      const saved = await call("record_meal", input);
      expect(saved.isError).not.toBe(true);
      const outputSchema = tools.find((tool: { name: string }) => tool.name === "record_meal").outputSchema;
      const client = new AjvJsonSchemaValidator().getValidator(outputSchema);
      expect(client(saved.structuredContent)).toMatchObject({ valid: true });
      expect(client(JSON.parse(saved.content[1].text))).toMatchObject({ valid: true });
      expect(createMeal).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({
        amountConfidence: 0.7, nutrients: { caloriesKcal: 635, proteinG: 5.1, fatG: 11, carbsG: 69 }
      })] }));
      expect(PartialNutrientValuesSchema.properties.proteinG.multipleOf).toBe(0.001);
      expect(tools.find((tool: { name: string }) => tool.name === "list_meals").outputSchema).toEqual(publishMcpOutputSchema(MealListSchema));
    } finally { await server.close(); }
  });

  it.each(["extra_precision", "out_of_range", "missing_estimate_confidence"])("keeps strict server rejection for %s", async (scenario) => {
    const { server, call, createMeal } = fixture();
    const input = decimalMenuMeal(`synthetic-${scenario}`);
    if (scenario === "extra_precision") input.items[0]!.nutrients.proteinG = 5.1001;
    if (scenario === "out_of_range") input.items[0]!.amountConfidence = 1.1;
    if (scenario === "missing_estimate_confidence") delete (input.items[0] as Partial<typeof input.items[0]>)!.amountConfidence;
    try {
      expect((await call("record_meal", input)).isError).toBe(true);
      expect(createMeal).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it("preserves integer constraints and literal annotations without mutating shared schema nodes", () => {
    const fraction = { type: "number", multipleOf: 0.001, minimum: 0, maximum: 1 };
    const original = { type: "object", required: ["count", "confidence"], properties: {
      count: { type: "integer", multipleOf: 2 }, confidence: fraction,
      nested: { type: "array", items: { anyOf: [fraction, { type: "null" }] } }
    }, default: { multipleOf: 0.001 }, examples: [{ multipleOf: 0.001 }] };
    const before = structuredClone(original);
    const published = publishMcpInputSchema(original);
    expect(original).toEqual(before);
    expect(published.default).toEqual(original.default);
    expect(published.examples).toEqual(original.examples);
    const validate = standardValidator(published);
    expect(validate({ count: 2, confidence: 0.7, nested: [0.7, null] })).toBe(true);
    expect(validate({ count: 3, confidence: 0.7 })).toBe(false);
    expect(validate({ count: 2, confidence: 1.1 })).toBe(false);
    expect(validate({ count: 2 })).toBe(false);
  });

  it("publishes inline outputs without resource collisions while preserving annotations and strict originals", () => {
    const nested = { $id: "RepeatedInlineFact", type: "number", minimum: 0, maximum: 1, multipleOf: 0.001 };
    const original = { $id: "SyntheticResult", type: "object", required: ["first", "second"],
      properties: { first: nested, second: nested, count: { type: "integer", multipleOf: 2 } },
      default: { $id: "literal-data", multipleOf: 0.001 }, examples: [{ $id: "literal-example" }] };
    const before = structuredClone(original);
    const published = publishMcpOutputSchema(original);
    expect(original).toEqual(before);
    expect(published).toMatchObject({ $id: "SyntheticResult", default: original.default, examples: original.examples });
    const client = new AjvJsonSchemaValidator().getValidator(published);
    expect(client({ first: 0.7, second: 0.3, count: 2 }).valid).toBe(true);
    expect(client({ first: 0.7, second: 0.3, count: 3 }).valid).toBe(false);
    expect(client({ first: 1.1, second: 0.3 }).valid).toBe(false);
    expect(published).not.toHaveProperty("properties.first.$id");
    expect(published).not.toHaveProperty("properties.first.multipleOf");
  });
});
