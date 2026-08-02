---
id: "domain-domain-extraction-map"
kind: domain
title: "Domain extraction map"
status: draft
tags:
  - "domain"
  - "extraction"
  - "google-sheets"
---

# Domain extraction map

## Summary

Draft mapping from spreadsheet mechanisms to domain concepts. It separates
facts/policies from projections, integration workflows, and governance.

## Content

| Spreadsheet area | Domain interpretation | Authority shape |
| --- | --- | --- |
| Weight, Body, goals | Physical State and Goals | Independent measurements and versioned goals |
| Foods, Ingredients, Brands, Food_Ingredients, Meals | Nutrition | Shared versioned catalog, Person overlays, Meal snapshots |
| Training, Program, Personal Records | Training and Performance | Versioned prescriptions, sessions/sets, derived records |
| Wearable/recovery evidence | Recovery and Readiness | Typed observations and evidence-pinned assessments |
| AI Insights, Load Risk, Weight Autopilot, Coach Planner | Coaching | Evidence-linked recommendations and decisions |
| Daily_Log, Dashboard | Cross-context projections | Legacy read models, not aggregate roots |

Intake, reconciliation, timeline, and self-healing are supporting capabilities
that route or compare facts. They are not contexts because sheets exist for
them.

Use five draft contexts inside the modular backend, explicit adapters, and read
models. Governance remains outside runtime domain.

Nutrition catalog is shared reference knowledge, not per-Person copies or one
provider cache. Source records stage and explicitly match before creating
canonical revisions. Meal pins a catalog version and its own nutrient snapshot.

## Evidence

- [Google Sheets inventory](../data/google-sheets-inventory.md) and workflow
  contracts.

## Decisions

- Logical extraction does not decide service topology.

## Open questions

- Day lifecycle; remaining GoalProfile placement; approved external Nutrition
  sources; whether health-device privacy ever requires a separate boundary.

## Related material

- [Candidate aggregates](candidate-aggregates.md)
- [Invariants](invariants.md)
- [Source authority](../data/source-of-truth-and-authority.md)
