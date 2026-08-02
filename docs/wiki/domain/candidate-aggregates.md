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

`DayClosure` or `JournalDay` remains a narrow candidate for Person-local date,
timezone, open/closed lifecycle, closure time, explicit corrections,
fact references, and daily projection creation. Name and invariants are open.

`Daily_Log` is primarily a legacy read model/migration projection, not evidence
for a broad aggregate.

## Evidence

- Session grouping, Program prescriptions/derived fields, Meal snapshots,
  mixed Daily_Log projections, and append-only/recommend-only contracts.

## Decisions

- Do not create one aggregate per sheet or a broad `DayRecord`.
- Keep shared reference catalogs separate from Person facts.

## Open questions

- DayClosure snapshot semantics, initial unit vocabulary, and external matching
  moderation. Multiple weight measurements per day are allowed.

## Related material

- [Extraction map](domain-extraction-map.md)
- [Invariants](invariants.md)
- [Open questions](open-modeling-questions.md)
