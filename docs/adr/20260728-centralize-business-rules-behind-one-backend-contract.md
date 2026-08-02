---
id: "decisions-20260728-centralize-business-rules-behind-one-backend-contract"
kind: adr
title: "Centralize business rules behind one backend contract"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "architecture"
  - "clients"
---

# Centralize business rules behind one backend contract

## Context

Web and mobile clients must apply the same safety, decision, validation, and
migration rules. Independent client implementations would diverge over time
and make behavior harder to verify.

## Decision

Expose one backend contract to web and mobile clients and keep authoritative
business rules behind it. Clients may own presentation and platform-specific
interaction, but not independent domain decisions.

## Considered alternatives

- Duplicate rules in every client: improves offline autonomy but creates a
  high risk of divergence and safety defects.
- Create a backend for each client: enables specialized contracts but
  duplicates behavior before distinct domain needs exist.

## Consequences

Backend contract stability is a prerequisite for web and mobile releases.
Offline behavior, local caching, and client projections require separate
design without creating an alternative domain authority.

API style, versioning, authentication, offline behavior, and client cache
policy remain open.

## Verification

- The operator explicitly approved the decision and roadmap on 2026-07-28.

## Related material

- `../wiki/product/scope.md`
- `../wiki/roadmap/overview.md`
- `../wiki/architecture/drivers.md`
