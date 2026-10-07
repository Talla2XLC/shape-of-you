/**
 * Publishes common V2 workout fields without conditional-only client signatures.
 * The MCP normalizer still validates the original temporal and measurement rules.
 * @param schema - Original create or correction contract, which is never mutated.
 * @param correction - Whether this is a full-replacement correction tool.
 * @returns A connector object schema retaining field types and bounds.
 */
export function connectorWorkoutV2Schema(
  schema: Readonly<Record<string, unknown>>, correction: boolean
): Readonly<Record<string, unknown>> & { readonly required: readonly string[]; readonly properties: Readonly<Record<string, unknown>> } {
  const result = structuredClone(schema) as Record<string, unknown>;
  delete result.anyOf;
  const properties = result.properties as Record<string, Record<string, unknown>>;
  const exercises = properties.exercises!.items as Record<string, unknown>;
  const sets = (exercises.properties as Record<string, Record<string, unknown>>).sets!;
  delete (sets.items as Record<string, unknown>).anyOf;
  result.required = (result.required as string[]).filter((field) =>
    field !== "sourceReference" && (correction || field !== "temporalPrecision"));
  if (!correction) properties.startReportedNow = {
    type: "boolean", description: "True only for an explicit immediate start report, never a finish or retrospective report. The API records receipt time with manual command provenance."
  };
  return result as Readonly<Record<string, unknown>> & { readonly required: readonly string[]; readonly properties: Readonly<Record<string, unknown>> };
}
