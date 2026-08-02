# Shape of You

Shape of You is a long-term production project for a personal fitness
assistant. It collects traceable data about physical state, nutrition,
training, and recovery and turns that evidence into explainable
recommendations.

## Current status

The repository is a modular monorepo with one NestJS API, PostgreSQL
persistence, Drizzle migrations, and implemented domain slices for Physical
State and Goals, Nutrition, Training, Recovery, Coaching, and the foundation of
asynchronous Intake.

The operational `Fitness Tracker` Google Sheet remains authoritative for real
fitness data until a verified dual-run and explicitly approved cutover.

## Architecture position

- Start as a modular monorepo.
- Avoid premature microservices.
- Forbid cross-service SQL.
- Future deployable services communicate only through APIs or events.
- Model domain facts independently; do not create a broad `DayRecord`
  aggregate.
- Treat `Daily_Log` primarily as a legacy read model.
- Retain the current five bounded contexts as a draft logical model, not a
  service map.

Accepted decisions are in [ADR](docs/adr/), and current project knowledge is
in the [Wiki](docs/wiki/).

## Documentation and authority

- `docs/wiki/**/*.md` is the canonical Wiki.
- `docs/adr/**/*.md` is the canonical ADR collection.
- `.4dt/db.sqlite3` stores local board, memory, source registry, and internal
  index state.
- The managed 4DreamTeam Wiki is a frozen legacy copy and is not a source of
  truth.
- Plans are written in Russian under `plans/YYYY/MM/`.
- Completed plans move to the corresponding `completed/` directory.
- All other repository documentation is written in English.

Agent operating rules are defined in [AGENTS.md](AGENTS.md). The documentation
guide is in [docs/README.md](docs/README.md).

## Delivery sequence

The current sequence is:

1. `DEV-027` — workspace, discovery, inventory, and documentation baseline;
2. `DEV-023` — backend API and domain extraction, currently in progress;
3. `DEV-024` — PostgreSQL migration and verified dual-run;
4. `DEV-025` — Web MVP;
5. `DEV-026` — mobile client.

Detailed scope is approved through plans, Architecture Review, and ADRs.

## Development

Use the workspace package scripts and service-specific instructions in
`apps/*/AGENTS.md`. Do not implement architecture changes before approval and
an authorized plan.
