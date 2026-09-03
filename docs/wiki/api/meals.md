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
`unknown` when the user gave no amount, `described` for the user's unnormalized
everyday wording, `quantified` for an explicit quantity/unit pair, or
`estimated` for a real text/photo estimate with method and confidence.
`unknown` and `described` never receive a fabricated `1 serving` sentinel.
Existing dedupe returns `200`, new fact `201`, and conflicting second correction
`409`. Current list uses
`(occurredAt DESC, id DESC)`. Totals include only current Meals.

The MCP connector exposes a smaller command than the complete internal snapshot,
but `record_meal` and `correct_meal` require every accepted Coach item to carry
non-unknown amount evidence plus numeric calories, protein, fat, and
carbohydrates. The API-owned MCP adapter fills unrelated omitted nullable
fields, defaults interactive provenance to `manual`, and then validates both
the Coach completeness guard and the unchanged strict Meal command before
calling the Nutrition service. Incomplete or contradictory evidence fails
before dispatch. This keeps ordinary text/photo capture concise without
weakening domain or persistence invariants. Successful Meal tools keep the same
typed `structuredContent`, while their model-facing text is a concise
presentation contract rather than a JSON copy of the domain snapshot. It
directs a natural acknowledgement and one evidence-grounded observation or next
step. Unless the user explicitly asks for raw facts only, acknowledgement or
nutrition summary without that final next step is incomplete. When a specific
nutrition recommendation is not safe, the Coach ends with the safest useful
action supported by verified facts or requests the one observation needed next,
without exposing internal completeness or transport
vocabulary.

The connector-facing schemas remain backward compatible under the existing
tool names. Evidence fields stay advertised for current clients but are
optional at the transport boundary, so a conversation holding an older schema
can still send a complete Meal with label, quantity/unit, and nutrients. The
adapter infers omitted evidence fields before the same completeness and domain
guards run. Frozen compatibility tests reject new required fields, removal of
previously published fields, and narrowing of published enums; a genuinely
incompatible contract requires a new versioned tool name.

For a sufficiently legible meal photo or useful text description, the MCP
contract directs the client to make and save a best-effort estimate immediately:
each identifiable item carries estimated quantity/unit, `text|photo` method,
bounded confidence, and calories/protein/fat/carbohydrates for that estimated
portion. Missing measured grams alone does not make the amount unknown. Unknown
values remain representable by the domain and historical import contracts, but
when material foods or scale genuinely cannot be estimated the Coach asks one
natural clarification instead of saving an incomplete interactive Meal.
User-facing replies describe stored estimates as approximate, and a later
clarification uses the existing append-only full-snapshot correction.

Controlled historical import may return item nutrient components and exact
totals as `null`, with `nutritionCompleteness = partial`. Null means unknown and
is never converted to zero. Daily totals also return `incompleteMealCount`; an
exact component total is null when any current item lacks that component.
REST create/correction inputs may preserve unknown nutrients as `null`; they
never convert missing evidence to zero. Coach MCP creates and corrections use a
stricter adapter contract and do not dispatch an accepted item until all four
nutrient estimates are numeric. Progress metrics omit an incomplete date instead
of publishing a known-subset sum as the full value. Later amount or nutrition
detail creates an append-only full-snapshot correction.

## Evidence

- Nutrition contracts/controller/integration tests.
- TASK-0086 accepted MCP photo-estimation and read-back fixture.

## Decisions

- Responses/totals reproduce stored item snapshots; catalog revisions do not
  change Meal; totals are not a mutable table.
- Amount and nutrient evidence remain machine-readable without turning
  completeness into a user workflow or blocking direct fact capture.
- [Unquantified Meal amount and natural Coach language](../../adr/20260830-model-unquantified-meal-amount-evidence-and-natural-coach-language.md).
- [Backward-compatible MCP tool schemas](../../adr/20260902-evolve-mcp-tool-schemas-backward-compatibly.md).

## Open questions

- Nutrition targets and longer-term aggregation policy for partial Meals.

## Related material

- [Meal](../domain/meal.md)
- [Catalog API](nutrition-catalog.md)
