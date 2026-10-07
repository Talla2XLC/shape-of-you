---
id: "architecture-api-meals"
kind: architecture
title: "Meal API"
status: draft
tags:
  - "api"
  - "meals"
  - "nutrition"
  - "snapshots"
---

# Meal API

## Summary

Creates/reads Person-owned Meal snapshots, full-replacement corrections, and
query-only daily nutrition totals.

## Content

- `POST /v1/nutrition/meals` — idempotent create.
- `GET /v1/nutrition/meals` — current facts with cursor/localDate.
- `GET /v1/nutrition/meals/:id` — any immutable fact.
- `POST /v1/nutrition/meals/:id/corrections` — append-only replacement.
- `GET /v1/nutrition/meals/:id/history` — correction chain.
- `GET /v1/nutrition/daily-totals?localDate=YYYY-MM-DD` — projection.

Commands contain complete item snapshots. Optional accessible `foodVersionId`
never replaces the snapshot. Each item carries explicit amount evidence:
`unknown` when no amount or reasonable estimation basis is available,
`described` for the user's unnormalized
everyday wording, `quantified` for an explicit quantity/unit pair, or
`estimated` for a real text/photo estimate with method and confidence.
`unknown` and `described` never receive a fabricated `1 serving` sentinel.
Existing dedupe returns `200`, new fact `201`, and conflicting second correction
`409`. Current list uses
`(occurredAt DESC, id DESC)`. Totals include only current Meals.

The MCP connector exposes a smaller command than the complete internal snapshot.
The API-owned adapter fills omitted nullable fields, defaults interactive
provenance to `manual`, and validates the unchanged strict Meal domain command
before calling Nutrition. Honest unknown amounts and nutrients are accepted;
contradictory evidence and invalid numeric values still fail before dispatch.
Successful tools retain typed `structuredContent` and a concise model-facing
presentation. Routine capture may end with a natural acknowledgement; advice
or a question is added when useful or requested. Ordinary replies keep internal
transport and completeness vocabulary out of the conversation.

The connector-facing schemas remain backward compatible under the existing
tool names. Evidence fields stay advertised for current clients but are
optional at the transport boundary, so a conversation holding an older schema
can still send a complete Meal with label, quantity/unit, and nutrients. The
adapter infers omitted evidence fields before domain validation runs. Frozen
compatibility tests reject new required fields, removal of
previously published fields, and narrowing of published enums; a genuinely
incompatible contract requires a new versioned tool name.

Published MCP input schemas describe fractional precision in text instead of
using fractional `multipleOf`, so client validators accept ordinary decimals
such as confidence `0.7` and protein `5.1`. The API still validates the original
schemas with `multipleOfPrecision: 6` and enforces domain evidence rules.
Integer divisors, bounds and required fields remain advertised; REST and MCP
output schemas are unchanged.

For a sufficiently legible meal photo or useful text description, the MCP
contract directs the client to make and save a best-effort estimate immediately:
each identifiable item carries estimated quantity/unit, `text|photo` method,
bounded confidence, and calories/protein/fat/carbohydrates for that estimated
portion. Missing measured grams alone does not make the amount unknown. When
there is no reasonable basis for estimation, the Coach preserves honest unknown
or described evidence and null nutrients; a clarification is useful only when
its answer materially changes the result.
User-facing replies describe stored estimates as approximate, and a later
clarification uses the existing append-only full-snapshot correction.

Natural Meal corrections use a current-read transaction protocol. Before
assembling the full replacement, the Coach reads the exact local date, selects
the current matching Meal, preserves its canonical fields and items, and
overlays only the user's clarification. A successful `correct_meal` response
contains the canonical Meal serialized from the committed transaction and is
sufficient write verification; another list is used only when the user also
requested the updated day or totals, and it must not replay the correction.
Invalid replacements return a machine-readable re-read/rebuild/retry state;
stale or missing targets require the same rebase onto the current Meal; other
execution failures permit one retry with the same idempotency key. Until typed
success, the clarification remains pending intent and cannot be presented or
used as a persisted fact. These recovery details remain model-facing and are
not exposed in the natural user reply.

Controlled historical import may return item nutrient components and exact
totals as `null`, with `nutritionCompleteness = partial`. Null means unknown and
is never converted to zero. Daily totals also return `incompleteMealCount`; an
exact component total is null when any current item lacks that component.
REST create/correction inputs may preserve unknown nutrients as `null`; they
never convert missing evidence to zero. Coach MCP creates and corrections
preserve the same honest null semantics. Progress metrics omit an incomplete
date instead
of publishing a known-subset sum as the full value. Later amount or nutrition
detail creates an append-only full-snapshot correction.

## Evidence

- Nutrition contracts/controller/integration tests.
- TASK-0086 accepted MCP photo-estimation and read-back fixture.
- TASK-0114 accepted current-read correction assembly, typed recovery states,
  canonical command verification, and replay prevention tests.
- TASK-0164 Stage A accepted decimal publication and isolated PostgreSQL
  persistence, idempotent replay, and menu nutrient tests.

## Decisions

- [Incomplete fact capture and contextual Coach replies](../../adr/20261002-capture-incomplete-facts-and-use-contextual-coach-replies.md).

- Responses/totals reproduce stored item snapshots; catalog revisions do not
  change Meal; totals are not a mutable table.
- Amount and nutrient evidence remain machine-readable without turning
  completeness into a user workflow or blocking direct fact capture.
- [Unquantified Meal amount and natural Coach language](../../adr/20260830-model-unquantified-meal-amount-evidence-and-natural-coach-language.md).
- [Backward-compatible MCP tool schemas](../../adr/20260902-evolve-mcp-tool-schemas-backward-compatibly.md).
- [Decimal-compatible MCP input publication](../../adr/20261007-diagnose-and-recover-meal-capture-failures.md).
- [Transactional Meal correction recovery](../../adr/20260915-make-meal-correction-recovery-transactional.md).

## Open questions

- Nutrition targets and longer-term aggregation policy for partial Meals.

## Related material

- [Meal](../domain/meal.md)
- [Catalog API](nutrition-catalog.md)
