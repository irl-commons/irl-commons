# Plans v2

A plan can allow phone tethering while restricting routers or continuous video.
Upload and download may also have different limits. These are separate facts,
each checked against a carrier page on its own date.

Every fact has `value`, `source` (an https URL) and `checked_on` (YYYY-MM-DD).
`source_quote` is an optional short excerpt, limited to 300 characters; `note`
records scope or uncertainty in original words. Null means the cited page did
not establish the value. It never means permission or an unlimited allowance.
A rule can also explicitly say `unknown`. Required fact objects prevent an
omitted field from silently becoming permission.

`data_cap_gb` is the monthly domestic allowance in decimal GB, or the literal
`"unlimited"` when the carrier explicitly says so. That does not promise full
speed forever: read its note and priority terms. `max_down_mbps` and
`max_up_mbps` are plan ceilings. `throttle_down_kbps` and `throttle_up_kbps`
are domestic on-device speeds after the allowance. Do not copy a hotspot,
video-only or network-specific limit into a plan-wide speed field, or assign
an unspecified direction to upload or download. `hotspot_gb` describes the
included monthly high-speed allowance, not a separately purchased add-on.

`hotspot` covers phone sharing including USB; `router_or_modem` covers moving
the SIM to another device; `continuous_video` covers uploading or broadcasting,
not watching video. Each rule accepts `allowed`, `limited`, `banned`, `unknown`
or null. Roaming routing accepts `home-routed`, `hub-breakout`,
`local-breakout` or null. Measured routing needs country-pair, visited network
and exit ASN evidence; the current examples make no routing claim.

## Migrating from v1

This is a breaking schema change. The shipped v1 carrier list was empty, so
there are no published plan rows to rewrite. Existing validation examples have
been migrated and the exported JSON Schema is regenerated. Consumers with
local rows should use these rules, then validate and recheck their sources:

| Old field | V2 field and treatment |
| --- | --- |
| `data_cap_gb` | Wrap in a fact; v1 null meant unlimited, so use `value: "unlimited"` only if the source supports it. Otherwise null. |
| `throttle_after_cap_kbps` | Recheck its direction before filling `throttle_down_kbps`; never invent an upload value. |
| `tethering_allowed` | Map true/false/null to `hotspot` allowed/banned/unknown. This establishes neither router nor broadcast permission. |
| `roaming_routing` | Wrap a known value; old unknown becomes null. Hub breakout is now distinct. |
| `source_url`, plan `checked_on` | Copy to each fact only where that source and date actually support the fact. Remove the old plan-level fields. |
| New ceiling, priority, hotspot allowance and use-rule fields | Read an official source. Use null with that source and the actual check date where it establishes no value. |

Carrier shape and ids stay stable. Carrier `checked_on` is the last full pass;
plan freshness uses each fact's date independently (90 days). Rechecking the
carrier or another fact must not refresh old plan terms. Consumers hide stale
plan facts and retain their source and date for inspection.

## Initial examples

The two examples are a small, unranked source sample, not a market survey or
buying recommendation. Sources were read on 2026-11-16; no prices are recorded.

- Telekom MagentaMobil L: the linked product sheet is version 2025-04-01 and
  states 100 GB, ceilings of 300/50 Mbit/s and post-allowance speeds of 64/16
  kbit/s (download/upload). It establishes none of the three use permissions.
  This describes that sheet, not every promotion or account variant.
- Verizon Unlimited Welcome: the plan-information page restricts unlimited
  data to smartphones and offers hotspot separately. Its network-dependent
  hotspot and 5G Ultra Wideband limits are not plan-wide ceilings. After
  500 GB/month it states up to 4 Mbps without separating direction; both
  throttle numbers remain unknown. Video viewing resolution establishes no
  continuous-broadcast permission. Roaming routing remains unknown.

The `sim` word uses 3GPP TR 21.905 V19.2.0: clause 3 distinguishes UICC
and USIM, and clause 4 expands SIM. The plain explanation preserves that
distinction without implying the removable card and its application are the
same thing.
