---
id: "start-overview"
kind: start
title: "Getting started"
status: draft
tags: []
---

# Getting started

## Summary

Shape of You is a personal AI platform for evidence-based physical-development
decisions. Repository baseline is complete. DEV-023 has implemented core
Physical State, Nutrition, Training, Recovery, Coaching, and asynchronous
Intake foundations.

## Content

### Navigation

- Vision: `vision/overview.md`
- Product: `product/overview.md` and `product/scope.md`
- Domain: `domain/overview.md`, `domain/glossary.md`, and
  `domain/bounded-contexts.md`
- Architecture: `architecture/overview.md`
- Roadmap: `roadmap/overview.md`
- Decisions: ADRs in `../adr/`

### Current stage

DEV-027 completed the workspace, product/domain baseline, architecture
documentation, ADRs, and versioned plans. DEV-023 currently provides one NestJS
API with `FastifyAdapter`, PostgreSQL, typed provenance and append-only
corrections, Physical State and Goals, Nutrition, Training, Recovery, Coaching,
and a durable Intake queue with the first Weight route.

A production Intake parser, remaining Intake routes, and the shared day
lifecycle are not implemented. Google Sheets remains authoritative for
operational fitness data until verified dual-run and approved cutover.

## Evidence

- Operator baseline supplied on 2026-07-28.
- Implemented runtime, integration tests, and accepted staging evidence.

## Decisions

- This page is a navigation/current-stage summary. Detailed authority lives in
  the linked Wiki pages and ADRs.

## Open questions

- Remaining DEV-023 ordering and completion of the Google Sheets behavior
  catalog.

## Related material

- [Vision](../vision/overview.md)
- [Product](../product/overview.md)
- [Domain](../domain/overview.md)
- [Architecture](../architecture/overview.md)
- [Roadmap](../roadmap/overview.md)
