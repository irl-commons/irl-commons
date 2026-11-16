# Use the data

This guide is for people who make an IRL streaming app, a help page, a bot
or a website. In about ten minutes you show an entry from irl-commons in
your own product, with the credit the licence asks for, and you know how to
tell when an entry is old.

The data is plain JSON. You don't need an account or a server.

## 1. Get the files

Pick one:

- **Install the npm package**:

  ```sh
  npm install @irl-commons/data
  ```

  ```js
  import words from "@irl-commons/data/data/words.json" with { type: "json" };
  import wordsSchema from "@irl-commons/data/schema/json/words.schema.json" with { type: "json" };
  ```

  `@irl-commons/data/schema` exports the Zod definitions for runtimes that
  support TypeScript. Other languages can use the JSON Schemas in
  `schema/json/`; the extra cross-reference rules are in
  [`schema/README.md`](../schema/README.md).

- **Clone the repository** and read `data/*.json` from disk:

  ```sh
  git clone https://github.com/irl-commons/irl-commons
  ```

- **Fetch one file** over HTTPS. Pin a commit instead of `main`, so the data
  only changes when you choose:

  ```
  https://raw.githubusercontent.com/irl-commons/irl-commons/<commit>/data/words.json
  ```

## 2. Show a word

Each file has an `about` text and one list. `words.json` has `words`:

```js
const res = await fetch("https://raw.githubusercontent.com/irl-commons/irl-commons/main/data/words.json");
const { words } = await res.json();

const bonding = words.find((w) => w.id === "bonding");
console.log(bonding.term);   // "Bonding"
console.log(bonding.plain);  // a short, plain explanation
```

Ids are permanent. You can link to them, store them and use them as
anchors. A term, or its explanation, may get better wording later. The id
stays.

## 3. Give credit

The data is under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Show this line near the data, for example under your glossary or in your
app's credits:

> Data from IRL Commons contributors — https://github.com/irl-commons/irl-commons — CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Changes: none.

If you changed the wording, say so after "Changes:". For example:
"Changes: shortened the explanations".

The code in `schema/` and `scripts/` is MIT.

## 4. Show how old an entry is

Most entries have a `checked_on` date: the day someone compared the entry
with its public source. Show it, and treat an entry as old when the date is
too far back:

| File | Old after |
| --- | --- |
| `words.json` | 18 months |
| `answers.json` | 12 months |
| `guides.json` | 9 months |
| `services.json`, `standards.json` | 6 months |

```js
// The day an entry becomes old. Months clamp to the end of the month:
// 2026-08-31 plus 6 months is 2027-02-28.
function dueDate(checkedOn, months) {
  const [y, m, d] = checkedOn.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay)));
}

function isOld(checkedOn, months, today = new Date()) {
  if (!checkedOn) return null;              // no date: freshness unknown
  return today >= dueDate(checkedOn, months);
}
```

An entry with no date has unknown freshness. Don't show it as fresh. The
[data README](../data/README.md#freshness) has the full rule, and
`bun scripts/stale.ts` prints a report of every old entry.

## 5. Report a mistake

If an entry is wrong, missing or old, open an
[issue](https://github.com/irl-commons/irl-commons/issues/new/choose) or a
pull request. Give the public source you read, and the day you read it. The
[contributing guide](../CONTRIBUTING.md) says what each kind of change
needs.

Before you send a pull request, run the checks:

```sh
bun install --frozen-lockfile
bun run check
```

## Next

- [Worked examples](examples.md): a glossary, quick checks, a list of apps
  and the standards an app speaks.
- [FAQ](faq.md)
- [`data/README.md`](../data/README.md): what each file holds.
- Questions or ideas: [Discussions](https://github.com/irl-commons/irl-commons/discussions).
