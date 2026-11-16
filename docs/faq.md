# FAQ

## Who uses this data?

The glossary, link list and guides on [howtoirl.org](https://howtoirl.org/)
and the standards on [irlcommons.org](https://irlcommons.org/) come from here. No other
product is known to use it yet. If yours does, say so in
[Discussions](https://github.com/irl-commons/irl-commons/discussions).

## Can I use it in a commercial product?

Yes. The data is under CC BY 4.0, which allows commercial use. Show the
credit line from the [guide](getting-started.md#3-give-credit), link the
licence, and say what you changed.

## Can I change the wording?

Yes. Say so in the credit line, after "Changes:". If your wording is better
for everyone, a pull request helps every other app that uses the data.

## Can I translate it?

Yes. Words can carry translations in an `l10n` block per language, such as
`es-419` or `pt-BR`. A translation keeps the scene's English term and
explains it in the language. Before a translation goes in, a native speaker
reads it. None are in yet, so this is a good place to start helping.

## Why is my app missing from the list?

Probably because nobody has added it yet. Open a
[new entry issue](https://github.com/irl-commons/irl-commons/issues/new/choose)
with the maker's own page. If you make the app yourself, use the maker edit
request, so someone who isn't connected to the app checks the entry and
merges it.

## Why is there no ranking, and no "best app"?

Because the right app depends on the phone, the country, the budget and
the show. A ranking would also invite paid places. Each entry says what a
product does, who makes it and where its official help is. Choosing is up
to the streamer, or to your product.

## How old is an entry?

Most entries have a `checked_on` date: the day someone compared the entry
with its public source. A link that still loads doesn't count as a check.
Each file has its own limit, from 6 months for services to 18 months for
words. The [guide](getting-started.md#4-show-how-old-an-entry-is) has the
numbers and a small function.

## Why are `plans.json` and the prices empty?

Because mobile data plans change often, and every number needs an official
source per country. Prices also need three stewards from three different
companies before they go in, so no single company can shape them. The file
is there, so the shape is ready.

## Is there an npm package?

Yes: `npm install @irl-commons/data`. [Getting started](getting-started.md#1-get-the-files)
shows the imports. You can also use the JSON files directly.

## Who decides what goes in?

Sources decide facts. Stewards review changes, and anyone can review a pull
request. Right now there is one steward, so a short bootstrap rule applies
until a second one joins. [GOVERNANCE.md](../GOVERNANCE.md) has the details,
including conflicts of interest.

## What are stream-status and stream-session doing in `standards.json`?

IRL Commons started them, and it also stewards this
repository. So they sit in the `steward-projects` group. They are kept apart from the other standards, so
nobody takes them for something the scene already uses. How they fit together is on
[irlcommons.org/open-standards.html](https://irlcommons.org/open-standards.html).

## Where do I ask, or say what's missing?

In [Discussions](https://github.com/irl-commons/irl-commons/discussions),
or open an issue for a specific entry. If you'd rather not post in public,
write to hello@irlcommons.org.
