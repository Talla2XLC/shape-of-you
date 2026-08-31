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

The MCP connector does not expose that complete internal snapshot as mandatory
LLM bookkeeping. `record_meal` and `correct_meal` accept the reported item
label plus only the amount or nutrient evidence that is actually available.
The API-owned MCP adapter fills omitted nullable fields, defaults interactive
provenance to `manual`, infers the amount-evidence kind only from non-null
evidence, and then validates the unchanged strict Meal command before calling
the Nutrition service. Contradictory evidence still fails closed. This keeps
ordinary text/photo capture concise without weakening domain or persistence
invariants. Successful Meal tools keep the same typed `structuredContent`, while
their model-facing text is a concise presentation contract rather than a JSON
copy of the domain snapshot. It directs a natural acknowledgement and one
evidence-grounded observation or next step when supported, without exposing
internal completeness or transport vocabulary.

Controlled historical import may return item nutrient components and exact
totals as `null`, with `nutritionCompleteness = partial`. Null means unknown and
is never converted to zero. Daily totals also return `incompleteMealCount`; an
exact component total is null when any current item lacks that component.
Interactive create/correction inputs may preserve unknown nutrients as `null`;
they never convert missing evidence to zero. Progress metrics omit an incomplete
date instead of publishing a known-subset sum as the full value. Later amount or
nutrition detail creates an append-only full-snapshot correction.

## Evidence

- Nutrition contracts/controller/integration tests.

## Decisions

- Responses/totals reproduce stored item snapshots; catalog revisions do not
  change Meal; totals are not a mutable table.
- Amount and nutrient evidence remain machine-readable without turning
  completeness into a user workflow or blocking direct fact capture.
- [Unquantified Meal amount and natural Coach language](../../adr/20260830-model-unquantified-meal-amount-evidence-and-natural-coach-language.md).

## Open questions

- Nutrition targets and longer-term aggregation policy for partial Meals.

## Related material

- [Meal](../domain/meal.md)
- [Catalog API](nutrition-catalog.md)
