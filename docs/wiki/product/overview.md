---
id: "product-overview"
kind: product
title: "Product overview"
status: draft
tags: []
---

# Product overview

## Summary

The product combines physical-development evidence into safe, explainable
recommendations while keeping the user in control of facts and meaningful
actions.

## Content

Nutrition, training, body, recovery, and wearable evidence is fragmented. A
spreadsheet can store and calculate data but is not a durable platform for
traceable reasoning, safe automation, shared web/mobile access, and controlled
AI assistance.

The confirmed target user is the operator. Broader audience assumptions are
intentionally deferred.

The system should answer: what happened, what the evidence may mean, what
action is safe today, why it is recommended, and what still needs confirmation.

The authenticated Web entry point is `/progress`. It shows factual trends for
the trailing week, month, or year, preserves missing data as gaps, and links
only dates with current facts to the exact dated record.

Progress also explains accumulated profile evidence separately for sleep, HRV,
resting heart rate, Body Battery, Training, Weight, and Nutrition. It keeps
historical depth, freshness, and recent regularity separate and explains where
evidence is sparse, partial, or good enough to support recommendation context.
This view is independent of data provider and never presents a combined health
percentage or a medical-quality claim. Import lifecycle controls remain on
Connections.

Safety position:

- analyze trends rather than isolated measurements;
- preserve the existing training program unless a new program is explicitly
  requested;
- never recommend fasting, double sessions, or excessive cardio as punishment
  after overeating or alcohol;
- high load risk may block progression but cannot create a new program.

## Evidence

- Operator baseline supplied on 2026-07-28.
- Current Google Sheets behavior is the operational reference.

## Decisions

- Product-first and domain-first discovery precede service design.
- A focused progress overview precedes any customizable dashboard surface.
- Profile data readiness is explainable per direction rather than combined into
  one score.

## Open questions

- Additional personas, supported languages/regions, and the formal boundary
  between medicine, coaching, and wellness.

## Related material

- [Vision](../vision/overview.md)
- [Scope](scope.md)
- [Domain overview](../domain/overview.md)
- [Architecture drivers](../architecture/drivers.md)
