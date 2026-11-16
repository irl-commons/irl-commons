# Data files

Six files. Each has a short `about` and one list. The JSON Schemas in [`../schema/json/`](../schema/json/) describe every field.

## Primary data

- `words.json`: IRL streaming terms, explained in simple language, with other names, related words and a source. Some words also have a naming guide for app makers: a recommended label for one screen or setting, other names with a status, and dated evidence from apps' own settings. The guide is advice, not the only right name.
- `answers.json`: quick checks for common problems, along the chain a stream takes: camera and mic, sender, connections, receiver, OBS, platform. Each answer says which part most likely broke and gives up to three checks. Checks name no products; products are linked instead.
- `plans.json`: mobile carriers and their data plans. Empty until official sources back every field.

## Directories

- `services.json`: apps, relays and receivers, hosted services, hardware, production tools and docs. One entry per product, with the maker's own page and official support channels.
- `guides.json`: links to public tutorials, with the products they cover and the part of the chain they help with.
- `standards.json`: formats and protocols that IRL streaming products share, such as SRT, SRTLA, codecs and camera interfaces. Each entry credits its maker, says how open it is and names the products that use it. Codecs and transports carry comparison facts, each with its own sources and date. Items made by stewards of this repository are listed apart. Being listed doesn't mean IRL Commons makes, runs or endorses it.

## Rules for every file

Descriptions are written for this list. Sources are public pages: the makers' own pages, standards and platform help. No chat invites, private links or community posts. Ids never change.

All JSON data here is CC BY 4.0; see `../LICENSE-DATA` and the credit line in [Getting started](../docs/getting-started.md#3-give-credit). Retain supplied attribution and modification notices, link the source and licence, and identify your changes. Data is supplied without warranties. Links do not license the linked third-party material or imply endorsement.

## Freshness

Entries have a `checked_on` date: the day someone compared the entry with its public source. A link that loads is not a check, and dates are never guessed. Words and answers may leave the date out. Their freshness is then unknown, and they must not be shown as fresh.

| Dataset or field | Stale after |
| --- | --- |
| Words | 18 calendar months |
| Answers | 12 calendar months |
| Guides | 9 calendar months |
| Services | 6 calendar months |
| Standards | 6 calendar months |
| Standards comparison facts (each by its own `checked_on`) | 6 calendar months |
| Carrier records | 6 calendar months |
| Plan prices, caps and fair-use rules; service `status` | 90 days |

Work out staleness from `checked_on` and today's UTC date; the data stores only dates. An entry is stale on its due date. Months end at the last day of the month: 2026-08-31 plus 6 months is 2027-02-28. Show stale entries with their date. Hide stale plan prices, caps, fair-use figures and service status, but keep the carrier or service and its source visible. Each plan uses its own date. `bun scripts/stale.ts [YYYY-MM-DD]` prints a report. A weekly job checks the links and updates one freshness issue; it never edits data.

## Source-check provenance

A content review on **2026-11-14** opened and read public primary sources for
these words: relay, srt, srtla, encoder, cloud-obs, brb, noalbs, drop-protection,
bitrate, adaptive-bitrate, packet-loss, srt-latency, latency,
maximize-compatibility, mic-override, dns-lookup-strategy, browser-source,
big-packets, scene, upload-speed and data-cap. It also checked feed-into-obs,
second-link-idle, sound-missing and camera-switch-drop against their cited
project documentation and platform guidance. Corrections made after that review retain that day.

The two OBS Knowledge Base sources for picture-frozen were read on 2026-11-14:
[Video Capture Sources](https://obsproject.com/kb/video-capture-sources) backs
selecting a capture device and supported resolution/frame rate;
[Stream Connection Troubleshooting](https://obsproject.com/kb/stream-connection-troubleshooting)
backs reducing bitrate when OBS reports dropped network frames. The answer is
limited to those checks; neither page is evidence for phone-preview, cable
seating or 5 GHz advice.

Every `standards.json` entry was compared with its listed sources on
**2026-11-14**. Where a note says support "follows the services.json entries",
the per-product claim rests on those catalogue entries (checked the same day)
rather than a separate read of each product's page.

The codec and interface entries, NDI, and every comparison fact were checked on
**2026-11-15** against the pages each one cites. Twitch's help pages need
JavaScript, so Twitch facts rest on OBS's `services.json` (pinned to a commit)
and Twitch's own blog, and say so. Facts marked `unverified` say what the
makers' pages leave open, such as whether an Android encoder runs in hardware.
VP9 isn't listed: YouTube takes it only over DASH, which IRL senders don't use.

Other words and answers omit `checked_on`: a source link without a recorded
content check is insufficient. Omission means unknown freshness, not a fresh or
recently checked claim. Uncertainty flags remain independent of review dates.
