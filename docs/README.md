# Shape of You documentation

## Sources of truth

- `wiki/` contains canonical current project knowledge.
- `adr/` contains canonical architecture decisions.
- `templates/` defines the minimum shape of new pages.

These Markdown files are edited directly and reviewed through Git. There are
no generated Wiki mirrors.

## Change rules

1. Discuss an architecture decision and compare alternatives first.
2. Create or update an ADR after the decision is accepted.
3. Update the Wiki with the current consequences and link to the ADR without
   copying its full decision history.
4. Use plans to describe execution, not as architecture authority.
5. Before completing a major task, run:

   ```shell
   node scripts/validate-docs.mjs
   ```

6. Wiki and ADR changes must be visible in the Git diff.

## Search

The current documentation volume does not need a separate index:

```powershell
rg "DayClosure" docs
rg --files docs/wiki docs/adr
```

Do not register `docs/` in `4dt-sources`. Git, the IDE, and `rg` provide search
without duplicating index state.

## Language

Plans under `plans/**/*.md` are written in Russian. Wiki pages, ADRs, guides,
READMEs, templates, and other agent-facing repository documentation are written
in English. Paths, identifiers, YAML keys, controlled `kind` and `status`
values, commands, APIs, and other technical contracts are preserved exactly.

Operator-facing collaboration follows the operator's language. Localized
application strings and realistic test fixtures are not documentation.
