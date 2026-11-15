# Worked examples

Four small things you can build with the data. Each example loads one or
two files, like this:

```js
const base = "https://raw.githubusercontent.com/irl-commons/irl-commons/main/data/";
const load = async (name) => (await fetch(base + name + ".json")).json();
```

Pin a commit instead of `main` in your own product. And show the credit
line from the [guide](getting-started.md#3-give-credit) wherever the data
appears.

## 1. A glossary with search

Streamers search for the word they heard, and that is often another name
for the same thing. So search the `aliases` too:

```js
const { words } = await load("words");

function findWords(query) {
  const q = query.trim().toLowerCase();
  return words.filter((w) =>
    [w.term, ...(w.aliases ?? [])].some((name) => name.toLowerCase().includes(q)));
}

findWords("link aggregation").map((w) => w.term);  // ["Bonding", "SRTLA"]
```

Each word also has `heard_when` (when people meet the word) and `related`
(ids of other words). Use `related` for "See also" links. Each word has a
`tier`, `core` or `more`, if you want to show a short list first.

## 2. Quick checks for a problem

`answers.json` holds the questions that come up most, with one to three
checks in the order worth trying. Each check may say which part of the
chain it looks at: camera and mic, sender, connections, receiver, OBS,
platform.

```js
const { answers } = await load("answers");
const a = answers.find((x) => x.id === "live-not-on-platform");

console.log(a.question);   // "My app says I'm live, but the platform shows me offline"
console.log(a.summary);    // which part most likely broke
a.checks.forEach((c, i) => console.log(`${i + 1}. ${c.text}`));
```

The checks don't name products. If you want to point people to the
makers' own help, `services` lists the related products by id, and each
product in `services.json` has its official `support` links.

## 3. Apps for one phone

Say you want the open-source streaming apps for Android:

```js
const { services } = await load("services");

const apps = services.filter((s) =>
  s.role === "streaming-app" && s.platforms.includes("android") && s.open_source);

apps.map((s) => `${s.name} by ${s.maker}: ${s.url}`);
```

Other roles are `extra-connections`, `relay`, `hub`, `remote-control`,
`camera-capture`, `chat-overlays`, `production`, `hardware` and
`community`. The list has no ranking and no paid places. Keep it that way
in your product, or say clearly that the order is yours.

## 4. What an app speaks

`standards.json` lists shared formats and protocols, and which products
write or read them. To list what one app speaks:

```js
const { standards } = await load("standards");

standards
  .filter((s) => s.service_ids.includes("irl-pro"))
  .map((s) => s.name);
// ["SRT (Secure Reliable Transport)", "SRTLA (SRT link aggregation)", "Larix Grove (larix://set/v1)"]
```

Each standard credits its `maker`, says how open it is (`openness`) and how
far along it is (`status`). Codecs and transports also carry comparison
facts, each with its own sources and `checked_on` date.

The `steward-projects` group holds drafts that the OpenStreamBox Initiative
started, such as stream-status and stream-session. The initiative also
stewards this repository, so they are kept apart, and nobody takes them for
established standards.

## Check your own copy

If you keep a changed copy of the data, run the same checks the repository
runs:

```sh
bun install --frozen-lockfile
bun run check
```

Other languages can use the JSON Schemas in `schema/json/`. A few rules
across files, such as ids that must exist in another file, are only in the
check script. [`schema/README.md`](../schema/README.md) lists them.
