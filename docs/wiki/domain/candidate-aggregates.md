---
id: "domain-candidate-aggregates"
kind: domain
title: "Candidate aggregates"
status: draft
tags:
  - "aggregates"
  - "domain"
  - "draft"
---

# Candidate aggregates

## Summary

Candidate aggregates follow observed consistency boundaries. They are fewer
than the 26 sheets and are not deployable-service mappings.

## Content

Independent facts include WeightMeasurement, BodyMeasurementSession, Meal,
WorkoutSession/sets, RecoveryObservation, assessments, CoachingRecommendation,
and RecommendationDecision. Daily projections reference but do not own them.

- Nutrition separates stable Food/FoodVersion, personal overlay, and immutable
  Meal snapshot.
- Training separates ExerciseVersion, immutable TrainingProgramVersion,
  WorkoutSession, and query projections for records/progression.
- RecoveryObservation has one typed detail; assessments are separate immutable
  decisions over evidence.
- CoachingRecommendation has typed detail; policy/evidence are references;
  RecommendationDecision and execution remain separate facts.

`DayClosure` is a narrow Person-owned coordination artifact for explicit local
date/timezone closure. An open day has no active closure; a closed day holds an
immutable typed summary snapshot and a typed reference manifest. Reopen
supersedes the active version with a reason, and reclose appends a new version.
It does not own or mutate the referenced facts.

`Daily_Log` is primarily a legacy read model/migration projection, not evidence
for a broad aggregate.

The progress overview is also a read model rather than an aggregate. It
projects sparse current facts across a bounded date range through owning-module
read ports and does not give `DayClosure` or a new `DayRecord` ownership of
history.

## Evidence

- Session grouping, Program prescriptions/derived fields, Meal snapshots,
  mixed Daily_Log projections, and append-only/recommend-only contracts.

## Decisions

- Do not create one aggregate per sheet or a broad `DayRecord`.
- Keep shared reference catalogs separate from Person facts.

## Open questions

- Initial unit vocabulary and external matching moderation. Multiple weight
  measurements per day are allowed.

## Related material

- [Extraction map](domain-extraction-map.md)
- [Invariants](invariants.md)
- [Open questions](open-modeling-questions.md)
- [Versioned Person-local day closures](../../adr/20260811-model-versioned-person-local-day-closures.md)
- [Progress overview API](../api/progress-overview.md)
