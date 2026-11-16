# Schemas

We describe the data with [zod](https://zod.dev) schemas in `src/schema.ts`. The JSON Schemas in `json/` are generated from them, so validators in other languages can use the same rules and field descriptions. `json/parts.json` lists the chain parts, their tasks and the roles. Every file in `fixtures/` is a broken example that must be rejected.

Changing a schema: see [CONTRIBUTING](../CONTRIBUTING.md#checks). Freshness rules: [data/README](../data/README.md#freshness).

## Rules across entries and files

The JSON Schemas carry the rules they can express for a single entry. `scripts/check.ts` and zod also check these:

**All files**

- Ids are unique, and every reference to a word, answer or service exists.
- Dates are real and not in the future.
- Sources in the data are https.
- The privacy scan checks the repository files and every data string. Standard metadata URLs in the generated schemas and the official licence text are allowed. Fixtures carry no private references.

**Words**

- `also_called` and `search_terms` don't repeat each other or the term.
- With a naming block, every `also_called` name is the label or an also-used alternative, and every also-used alternative is in `also_called` or is the term itself.
- Recommended labels are unique.
- A technical alternative never equals another word's label. An also-used alternative may, but only with a `see` that resolves and `seen_in` backed by direct evidence for that product's exact label. An ambiguous or narrower alternative may, but only with `see` pointing at that word. Any `see` must resolve to the word the alternative normally names.
- `seen_in` lists services with direct evidence for that exact label (case doesn't matter), and never appears on ambiguous alternatives.
- Reviewed needs direct evidence from two different owning makers and two different listed stewards. The owning maker is the service's `maker`: Moblin and Moblink share eerimoq, BELABOX and BELABOX Cloud share BELABOX.
- `aliases` matches what `bun run aliases` generates, and evidence names existing services.

**Answers**

- Checks name no products; products are linked instead.

**Services**

- The role fits the kind.
- Class `docs` is for community entries only.
- Bonding and cloud entries set `hosting`, and cloud entries are never `self`.
- Products have chain parts; documentation entries cover products instead.

**Guides**

- The publisher is one of the covered products.
- A guide shares a product or a chain part with each answer it links.
- `title_display` matches what `bun run titles` generates.

**Plans**

- Carrier ids, and plan ids within a carrier, are unique. The file may be empty.
- Country codes are assigned ISO 3166-1 alpha-2 codes.
- An MNO has no host; an MVNO points to an MNO in the same country.

**Standards**

- `service_ids` exist and don't repeat. `other_users` doesn't name a catalogued product.
- An entry may lack a `url` or sources only when its openness is `not-public`.
- An app format needs a named second product. A shared or hardware-and-codecs item in use needs two named products.
- A standard that is also a glossary word shares its id and sets `word` instead of a description. A standard whose id, name or short name matches a word's id, term or alias without that link fails as a duplicate. That `word` equals `id` is checked only by zod and the check, not by the JSON Schema.
- Codec and transport facts need the matching kind, a null top-level `licence`, at least one source and a `checked_on` each. A video codec has hardware facts; an audio codec has none. Efficiency compares only with codec entries of the same media.

Schema `$id`s use the public irl-commons/irl-commons repository. The npm package is `@irl-commons/data`.
