# Schemas

Run validation from the repository root using the commands in the main README. Zod in `src/schema.ts` is authoritative; `json/*.schema.json` is generated. `json/parts.json` supplies chain tasks and roles for other validators. `fixtures/*.json` must be rejected.

Beyond schema validation, `scripts/check.ts` checks unique ids and existing word, answer and service references. Answers keep product names out of checks and link products instead. Service roles must fit their kind; products have chain parts, while documentation entries cover products. Guides name covered publishers, share a product or chain part with linked answers, and carry a generated display title. Carrier ids and plan ids within a carrier are unique. Country codes must be assigned ISO alpha-2 codes. An MNO has no host; an MVNO references an MNO in the same country. The carrier dataset may be empty. Synthetic runtime cases exercise these relationships without asserting real-world facts.

The privacy scan checks repository files and every dataset string. Standard metadata URLs in generated schemas and the unmodified official licence text are permitted; insecure source URLs are rejected in datasets. Do not add private references to fixtures.
