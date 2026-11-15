# IRL streaming data

Six reviewed data files about streaming live from outside (IRL streaming):

- `words.json`: a word list, one entry per term: a plain explanation, other names, who meets it, when it comes up, related terms, a public primary source, and an `uncertain` flag. Entries define; they don't give fix instructions. Optional `l10n` blocks hold translations by language tag (for example `es-419`, `pt-BR`); translations keep the scene's English terms as the term.
- `answers.json`: quick checks for the questions that come up most, written along the chain a stream takes: camera and mic, sender, connections, receiver, OBS, platform. Each answer says which part most likely broke and gives 1 to 3 short checks in plain words, in the order worth trying, each optionally tagged with its part. Checks name no product and no product setting; products are linked as `services` (the makers' own docs and support) and through `guides.json`. Also related word ids and the public primary sources behind the checks.
- `services.json`: a catalogue of apps, relays and receivers, hosted hubs, hardware, production tools and communities: the maker's own page, licence or open-source flag, status, platforms, official support channels (help centres, docs, issue trackers, contact pages), related words and the date each entry was last checked. `part` says where along the chain the product sits (camera, sender, connections, receiver, obs, platform; the main one first); community entries (docs, wikis) have no part and name the products they document in `covers` instead. Ids are permanent.
- `guides.json`: public tutorials from the makers' own docs and channels, as links only. Each has the page's own `title`; the products it `covers` (service ids, at least one); the chain `part` it helps with; the `publisher` when the maker who wrote it is one of the covered products; creator, language, kind (article or video), published date when the page states one, the date it was checked, and the words and quick checks it helps with. `title_display` is generated from covers, publisher and part ("Moblin with IRLhosting: set up the sender", "OBS Studio: set up OBS and switching") by `../scripts/titles.ts`, so it never drifts from the data.

Descriptions and definitions are written in our own words. Sources and links point to public primary pages only (makers' own pages, standards, platform help); no chat invites, private links or community posts. The schemas in `../schema` (zod, with exported JSON Schema) validate every file; see that folder's README.

- `plans.json`: carrier and optional plan records; initially empty pending primary-source verification. See the root README for field conventions and attribution.
- `standards.json`: formats and protocols that IRL streaming products share, such as SRT, SRTLA, Moblink, RIST, WHIP and OBS WebSocket. Each entry credits its maker, says how open it is (a public spec, documented by a closed product, code only, or not public yet), and names the products that write or read it: catalogued ones by `service_ids`, the rest in `other_users`. Entries sit in one of three groups. `shared` is for items several makers' products use. `app-formats` is for one app's own export or setup format, listed only when a named second product writes or reads it. `hardware-codecs` holds the video and audio codecs (H.264, HEVC, AV1, AAC, Opus) and the camera interfaces (UVC, HDMI, SDI). `steward-projects` holds items made by people who steward this repository, kept apart so they're never mistaken for established standards. Codec and transport entries also carry comparison facts: how they're licensed (as the licensors put it), efficiency only from a published comparison, hardware encode and decode on common IRL gear, bonding, latency, loss recovery, and ingest on Twitch, YouTube and Kick. Every fact names its own sources and `checked_on` date. An entry that is also a glossary word (SRT, SRTLA) uses the same id, points at it with `word`, and leaves the definition to `words.json`. Listing an item doesn't mean this project makes, runs or endorses it.

All JSON data here is CC BY 4.0; see `../LICENSE-DATA` and the attribution format in `../README.md`.

## Source-check provenance

A content review on **2026-11-14** opened and read public primary sources for
these words: relay, srt, srtla, encoder, cloud-obs, brb, noalbs, drop-protection,
bitrate, adaptive-bitrate, packet-loss, srt-latency, latency,
maximize-compatibility, mic-override, dns-lookup-strategy, browser-source,
big-packets, scene, upload-speed and data-cap. It also checked feed-into-obs,
second-link-idle, sound-missing and camera-switch-drop against their cited
project documentation and platform guidance. This was a content review, not
merely HTTP status checking. Corrections made after that review retain that day.

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
