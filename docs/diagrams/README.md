# Diagrams

Two kinds live in this repo, on purpose.

**Mermaid, inline in the ADR.** Anything that explains one decision belongs next to that decision —
GitHub renders it, a diff shows what changed, and nobody has to open a file to review it. See
`docs/adr/ADR-011` and `docs/adr/ADR-012`.

**Archify, here.** One explorable per subject, for the picture that is worth panning around: themes,
guided views, search, export. The `.json` is the source; the `.html` is generated and self-contained
(no network, no build step — open it in a browser).

| File | Subject |
|---|---|
| `storefront-architecture.*` | The web front end: token → primitive → pattern → page layering, the public page map ending at the auth wall, and the path a search takes from the schema to PostGIS. Sources: `ADR-011`, `ADR-012` |

## Regenerating

Edit the `.json`, then:

```bash
node ~/.claude/skills/archify/bin/archify.mjs validate architecture \
  docs/diagrams/storefront-architecture.architecture.json --quality showcase --json

node ~/.claude/skills/archify/bin/archify.mjs deliver architecture \
  docs/diagrams/storefront-architecture.architecture.json \
  docs/diagrams/storefront-architecture.html --quality showcase --json
```

`visual-check` additionally screenshots the delivered file at four viewports. Its output —
`*.visual-check.*` — is evidence, not a deliverable: it is regenerable, weighs more than the diagram,
and is **not** committed.
