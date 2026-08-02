# 4DreamTeam runtime boundary

`sources/` is the built-in local source boundary for `4dt-sources`. It
participates in source registry validation, source inventory construction, and
agent access control for local source material.

The directory may:

- contain explicitly approved local source material or references to it;
- define the built-in read boundary for `4dt-sources`;
- allow source indexing and search without external paths.

Rules:

- the directory may remain empty;
- it is not the project root and must not contain `sources/shape-of-you`;
- project documentation belongs only in `docs/`;
- external source paths require explicit operator approval and registration
  through `4dt-sources`;
- secrets, credentials, `.env` files, keys, dumps, and production data are
  forbidden;
- persistent Wiki exports do not belong here.
