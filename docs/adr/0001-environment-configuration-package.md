# One Environment Configuration Package for moving global definitions between environments

Developing this personal tool across several machines needs the global definitions — Custom Field definitions, Work Owner Account mappings, XLS export templates — to travel together and converge. We decided on a single versioned JSON **Environment Configuration Package** bundling all three sections, transported by clipboard and file, with Additive Import by default and an optional Sync Import. There is no pre-existing definition-migration mechanism at HEAD to fold in: an earlier, uncommitted custom-field template feature (schemaVersion 1, fields-only, additive) exists on some development nodes, so the package is schemaVersion 2 and the parser accepts v1 files as fields-only packages to keep those nodes portable.

## Considered Options

- **One export mechanism per definition kind** — rejected: three paths doing one job, three preview/confirm flows, and no way to converge drift.
- **Extend the JSON data transfer (数据导入导出)** — rejected: that transfer replaces all business data in one transaction and is deliberately not a definition-only, per-section tool.
- **Chosen**: one package, one mechanism, per-section import granularity.

## Consequences

- Identity travels as the stable key — Custom Field `key`, mapping `ownerName`, XLS export template `name` — and local ids are regenerated on import, so packages are portable across environments.
- The parser accepts `schemaVersion: 1` documents with a `fields` array even though no v1 producer ships in this repo — that acceptance is the compatibility path for files produced by the earlier uncommitted feature.
