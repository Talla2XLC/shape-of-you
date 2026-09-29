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
- Show bounded week/month/year factual progress with date-proportional sparse
  observations, continuous trend lines, and dated drill-down through one
  backend read model.
- Provide passkey-only browser enrollment, sign-in, and account security
  management without moving Identity policy into the client.
- Open one Person-bound persistent ChatGPT Work coaching conversation from the
  authenticated Web product without plugin search, repeated app selection,
  mentions, or chat switching.

### Current usable slice

The staging API owns fitness facts in PostgreSQL; the former workbook is a
frozen, non-authoritative reference. The authenticated Web client provides
account access, factual progress, and dated records, and opens the persistent
ChatGPT Coach. The Coach uses Person-authorized typed MCP tools for supported
confirmed input and explains the API-owned daily assessment. Broader Web
workflows remain separate scope decisions. A production asynchronous Intake
parser and routes beyond Weight are deferred from near-term delivery; the
existing Intake foundation remains in place.

### Later

- DEV-026 mobile client.
- Separately approved rollback operations; the legacy Google Sheets workbook
  remains an indefinite non-authoritative read-only reference.
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
- Automatic reverse sync or rollback to Google Sheets.
- Custom dashboards, saved layouts, arbitrary formulas, forecasts, and
  persisted cross-domain progress aggregates.

## Evidence

- Capabilities and roadmap from the operator baseline.
- Current-slice claims are grounded in accepted task outcomes and canonical
  current-state API, Identity, and Web documentation.

## Decisions

- Further Web scope remains subject to review and approved plans.
- TASK-0149 defers Intake expansion beyond the existing foundation. Reconsider
  it only for a concrete non-chat, batch, or offline source; an API-owned
  resumable multi-fact need; measured Coach failure; or a separately approved
  in-product assistant. Implementation still requires a separate approved plan.

## Open questions

- Exact broader UX and acceptance metrics, authentication/privacy/retention/
  export, and target availability/latency.

## Related material

- [Product overview](overview.md)
- [Roadmap](../roadmap/overview.md)
- [Migration strategy](../architecture/migration-strategy.md)
- [Bounded contexts](../domain/bounded-contexts.md)
