---
id: "product-scope"
kind: product
title: "Product scope"
status: draft
tags:
  - "product"
  - "scope"
---

# Product scope

## Summary

The baseline separates confirmed capabilities, the proposed first useful
product slice, later scope, and explicit non-goals.

## Content

### Capabilities

- Normalize nutrition, training, body, recovery, and wearable evidence.
- Preserve history, provenance, corrections, and explainable chronology.
- Analyze trends across days and weeks.
- Produce concrete daily nutrition, training, and recovery recommendations.
- Parse natural-language input into atomic confirmable events.
- Assess load risk and exercise-level progression.
- Create evidence-linked insights without claiming causality.
- Reconcile data and perform only deterministic safe self-healing.
- Support web and mobile clients through one backend contract.
- Provide passkey-only browser enrollment, sign-in, and account security
  management without moving Identity policy into the client.

### Proposed MVP

After DEV-023 and DEV-024, provide a web-facing stable backend, controlled
Google Sheets coexistence, unified history/trends, confirmed input, and a safe
daily plan based on the existing training program, recovery, load risk, and
exercise progression rules.

### Later

- DEV-026 mobile client.
- Final Google Sheets cutover after verified dual-run criteria.
- Additional wearable sources beyond confirmed Garmin data.
- Broader automation/analytics after sufficient evidence.
- Audience and commercial expansion after product discovery.

### Explicit non-goals

- Medical diagnosis or treatment claims.
- LLM output as authoritative fact.
- Persisting ambiguous facts or executed actions without confirmation.
- Creating a new training program without explicit request.
- Punitive fasting, double sessions, or excessive cardio.
- Independent business-rule implementations in clients.
- Premature microservices or deployable decomposition.
- Immediate Google Sheets shutdown before reconciliation and cutover.

## Evidence

- Capabilities and roadmap from the operator baseline.
- MVP boundary is a proposed interpretation, not implementation authority.

## Decisions

- MVP remains subject to review and approved plans.

## Open questions

- Exact UX and acceptance metrics, mandatory first-release Sheets behavior,
  authentication/privacy/retention/export, and target availability/latency.

## Related material

- [Product overview](overview.md)
- [Roadmap](../roadmap/overview.md)
- [Migration strategy](../architecture/migration-strategy.md)
- [Bounded contexts](../domain/bounded-contexts.md)
