---
id: "data-google-sheets-behavior-catalog"
kind: data
title: "Google Sheets behavior catalog"
status: draft
tags:
  - "behavior"
  - "data"
  - "dev-023"
  - "google-sheets"
---

# Google Sheets behavior catalog

## Summary

Read-only catalog of meaningful `Fitness Tracker` behavior for DEV-023. It
separates source facts, policy, workflow state, projections, and governance
without copying personal values or prescribing PostgreSQL schema.

## Content

### Facts and reference data

| Sheets | Observed responsibility | Classification |
| --- | --- | --- |
| Weight, Body | Timed weight/body measurements | Physical State facts; Body row is one session |
| Foods, Ingredients, Brands, Food_Ingredients | Nutrition catalog/composition | Nutrition reference data |
| Meals | Intake facts with captured calories/macros | Nutrition facts with catalog link and snapshot |
| Training | Performed sessions/exercises | Training facts |
| Program | Prescriptions plus computed next progression | Mutable plan plus projection |
| Personal Records | Best exercise performance | Derived Training projection |

Observed Food/Ingredient/Brand/Exercise/Session/Measurement IDs are migration
references; row numbers are not durable identifiers.

### Configuration and policy

`Settings` mixes profile, goals, constraints, nutrition parameters,
progression, and safety guidance. Numeric targets/thresholds are versioned
policy candidates, not eternal invariants.

`Rules` mixes business/safety policy, Intake ambiguity, queue/repair state,
insights/coaching, spreadsheet operations, and project governance. It contains
at least a duplicate ID, shifted fields, a semantically mismatched action, and
obsolete managed-Wiki rules. It cannot be imported as a runtime rules engine;
each rule needs classification, stable ID, owner, and test vector.

### Daily projections

`Daily_Log` combines independent facts and computed fields:

- `Weight` is authority; `Daily_Log.Weight` is a verified mirror;
- Meal totals aggregate by local date;
- remaining calories/protein and day target derive from policy;
- recovery combines AI/device evidence;
- next workout derives from last completed training;
- progression permission depends on recovery;
- readiness combines available objective indicators, modifier, data quality,
  alerts, and safety signals;
- day lifecycle uses `open`, `closed`, `partial`.

`Dashboard` provides rolling trends, latest statuses, next workout,
recommendations, and Meal integrity comparison. Both are cross-module read
models, not evidence for a broad `DayRecord`.

### Intake and execution

- **NL_Engine:** splits one text into atomic events with ID/type/local date,
  source text, typed payload intent, confidence, validation/ambiguity, and
  dedupe. Unknown entities require clarification; closed days block hidden
  writes. Spreadsheet target/operation are legacy routing details.
- **AI_Inbox:** transitions through received, validated, processing, written,
  and blocked/duplicate/failed states. Completion requires result and integrity
  verification.
- **Self_Healing:** allowlisted eligibility, dry-run, snapshot, minimal apply,
  read-back, rollback, and idempotency. Ambiguous/closed-day mutation is blocked.
  In PostgreSQL this complements transactions/constraints for migration and
  controlled repair; it does not replace them.
- **AI_Timeline:** append-only source/parent/severity/confidence/dedupe/status
  chronology. It is audit/read model, not full event sourcing.

### Analytics and coaching

- **AI_Insights:** analysis window, sample size, effect/direction/confidence,
  evidence/confounders, recommendation, lifecycle, and expiry. One-day evidence
  is insufficient; correlation is not causation; thresholds are versioned
  policy.
- **Load_Risk:** multi-day factors, hard stops, and data quality. Missing
  objective evidence limits confidence; results pin policy/evidence.
- **Weight_Autopilot:** despite its name, controls working-load progression:
  hold, repetitions/load/difficulty change, reduction, or calibration. It is a
  recommendation, changes at most one parameter, and requires repeated success
  plus safety gates.
- **Coach_Planner:** prioritizes safety, recovery, nutrition floor, existing
  program, progression, and day closure. It produces one evidence-linked main
  recommendation and never creates execution facts or rewrites the program.

### Governance and Apps Script

Changelog, Roadmap, Ideas, and project-level Decisions/Rules are project
governance, not product database modules. Current architecture authority is
only `docs/adr/**/*.md`.

No pre-existing linked Apps Script was found: the workbook opened a new empty
default project. That accidentally created empty project was removed with
operator approval and is not source behavior.

### Parity gaps

- Limited ranges do not prove all historical validation violations.
- Future independent-channel conflict policy remains open; the confirmed Weight
  mirror is resolved separately.
- Source-text/photo/wearable privacy and retention are not accepted.
- No authoritative Exercise catalog is defined.
- Policy parameters lack stable IDs, versions, and effective periods.

## Evidence

- Workbook metadata, limited reads of all 26 sheets, Daily_Log/Dashboard
  formulas, DayStatus validation, workflow contracts, and Apps Script check.

## Decisions

- DEV-023 migrates business/workflow meaning, not sheet layout, formulas, or
  governance. Verify parity with synthetic vectors only.

## Open questions

- Minimum behavior required before DEV-024; user-editable versus release/expert
  policies; whether a narrow JournalDay lifecycle is needed.

## Related material

- [Sheets inventory](google-sheets-inventory.md)
- [Authority](source-of-truth-and-authority.md)
- [Integrity](integrity-and-lifecycle.md)
- [Domain map](../domain/domain-extraction-map.md)
