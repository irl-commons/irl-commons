// What the discovery reports read and how they sort it. Everything here is a plain list
// so a reviewer can see why a question landed where it did. Patterns are case-insensitive.
//
// Sources, in order of preference: an official API (GitHub, Stack Exchange), a feed (RSS or
// Atom), a sitemap. An HTML index page is read for its links only when a site has none of
// these. Forum threads come from feeds, never from their HTML pages. Every fetch follows
// robots.txt; a source that blocks crawlers goes in NOT_READ with the reason.

export type Part = "camera" | "sender" | "connections" | "receiver" | "obs" | "platform";

// ---------- Questions: sources ----------

/** Repositories read in full (issues and discussions) besides those linked from services.json. */
export const EXTRA_REPOS = ["BELABOX/belaUI", "CERALIVE/CeraUI", "irlserver/srtla", "Eyevinn/open-live-studio"];

/** Large general projects: only threads that pass the IRL relevance test are kept,
 *  and reading stops after `GENERIC_REPO_LIMIT` threads per list. */
export const GENERIC_REPOS = new Set(["OpenRTMP/librtmp2-server", "bluenviron/mediamtx", "Haivision/srt", "steveseguin/vdo.ninja", "Eyevinn/open-live", "Eyevinn/open-live-studio", "EyevinnOSC/community"]);
export const GENERIC_REPO_LIMIT = 400;

/** Repositories that hold no user threads worth reading. */
export const SKIP_REPOS = new Set(["sponsors/eerimoq"]);

/** GitHub-wide searches for threads in repositories not listed above (forks, plugins, tools). */
export const GITHUB_SEARCHES = ["srtla", "moblin", "belabox", "noalbs", "\"irl stream\"", "\"irl streaming\"", "\"bonded stream\"", "lifestreamer", "\"irl pro\" stream"];
export const GITHUB_SEARCH_LIMIT = 150;

/** Stack Exchange sites and tags. Threads still need to pass the IRL relevance test. */
export const STACK_EXCHANGE = [
  { site: "video", tags: ["streaming", "obs", "rtmp", "live-streaming"] },
  { site: "superuser", tags: ["obs-studio"] },
];

/** RSS feeds of public forum boards (robots.txt allows /forum/list/). */
export const FORUM_FEEDS = [
  { name: "OBS forum: Windows support", url: "https://obsproject.com/forum/list/windows-support.32/index.rss" },
  { name: "OBS forum: Mac support", url: "https://obsproject.com/forum/list/mac-support.33/index.rss" },
  { name: "OBS forum: Linux support", url: "https://obsproject.com/forum/list/linux-support.34/index.rss" },
];

/** Sources considered and not read, with the reason. Shown in every report. */
export const NOT_READ = [
  { source: "Reddit", reason: "robots.txt disallows all paths for every user agent; reading it would need Reddit's Data API under its own terms." },
  { source: "YouTube channel RSS", reason: "robots.txt disallows /feeds/videos.xml; the YouTube Data API needs a key." },
  { source: "Discord servers", reason: "behind a login, out of scope." },
];

/** Signs of IRL streaming. A thread from a general source needs one strong sign, a second sign
 *  of either kind, and at least one sign in its title. Threads in IRL projects' own trackers are all kept. */
export const RELEVANCE_STRONG = [
  "srtla", "\\birl\\b", "bond(ed|ing)\\b", "moblin\\b", "moblink", "belabox", "ceralive", "lifestreamer", "larix", "noalbs", "irl.?pro\\b",
  "cellular", "\\b[45]g\\b", "\\blte\\b", "hotspot", "sim card", "backpack", "on the go", "while (walking|biking|driving|travel\\w*)",
  "(phone|iphone|android|mobile)\\b.{0,40}\\b(stream\\w*|broadcast\\w*|live)\\b", "\\b(stream\\w*|broadcast\\w*|live)\\b.{0,40}\\b(phone|iphone|android|mobile)",
  "\\b(dji|gopro|osmo|insta360)\\b",
];
export const RELEVANCE_CONTEXT = [
  "srt://", "\\bsrt\\b.{0,30}\\b(stream\\w*|latency|caller|listener|obs|ingest|relay|server)", "\\bobs\\b", "\\brtmps?\\b", "\\b(twitch|kick\\.com|youtube live)\\b",
];

// ---------- Questions: matching ----------

/** Glossary names too common to show that a word is meant. They never count alone. */
export const GENERIC_NAMES = new Set([
  "setup", "kit", "gear", "rig", "tech stack", "irl setup", "source", "sources", "output", "destination", "kind", "loss", "upload",
  "upstream", "delay", "irl", "in real life", "scene", "scenes", "hub", "hubs", "video format", "mbps", "kbps", "sim", "sims",
  "encoder", "codec", "latency", "bitrate", "speed test", "ingest", "ingests", "receiver", "relay", "uicc",
]);

/** Extra names people use for catalogued products, by service id. */
export const PRODUCT_ALIASES: Record<string, string[]> = {
  "obs-studio": ["OBS"],
  belabox: ["belaUI", "belabox"],
  "noalbs-tool": ["NOALBS", "nginx-obs-automatic-low-bitrate-switching"],
  "larix-broadcaster": ["Larix"],
  "irl-pro": ["IRLPro"],
  "liveu-solo": ["LiveU"],
  "tvu-go": ["TVU"],
  "openirl-srtla-receiver": ["srtla-receiver", "srtla_rec"],
  "vdo-ninja": ["vdo.ninja", "VDON"],
  "obs-blade": ["obs_blade"],
};
/** Service names too general to identify a product in free text. */
export const PRODUCT_NAME_SKIP = new Set(["srt", "twitch", "starlink"]);

/** Symptom phrases that tie a thread to an existing quick check, by answers.json id.
 *  An answer without hints is matched by shared words instead (see classify.ts). */
export const ANSWER_HINTS: Record<string, string[]> = {
  "live-not-on-platform": [
    "(says|shows|showing) (i'?m |i am |we'?re |it'?s )?live.{0,60}(offline|not live|nothing)",
    "(offline|not (showing|appearing|live)) on (twitch|kick|youtube)",
    "live (in|on) (the )?app.{0,40}(not|offline)",
  ],
  "feed-into-obs": [
    "(srtla?|rtmp|feed|stream|receiver|relay|moblin|belabox|phone).{0,40}\\b(into|to|in) obs\\b",
    "obs.{0,30}(media source|vlc source|ffmpeg source)",
    "(receive|receiving|play|playing).{0,30}(srtla?|bonded).{0,30}obs",
  ],
  "switcher-no-stats": [
    "(noalbs|switcher|belabot|scene switch\\w*).{0,80}stats? (url|page|api|endpoint|address)",
    "stats? (url|page|api|endpoint|address).{0,80}(noalbs|switcher|belabot|scene switch\\w*)",
    "(noalbs|switcher|belabot).{0,80}(no (bitrate|stats)|bitrate (is )?(0|zero)|stats (not|don'?t))",
    "(bitrate|stats).{0,30}(not (shown|showing|detected|updating)|always (0|zero)|shows? (0|zero))",
  ],
  "frozen-after-live": [
    "(frozen|freez\\w*|stuck|black).{0,60}(after|when|once).{0,30}(reconnect\\w*|switch\\w* back|back to live|comes back)",
    "(media source|source in obs|obs source).{0,40}(doesn'?t|does not|won'?t|not|never) (reconnect|recover|resume)",
    "(reconnect\\w*|dropout|drop).{0,40}(frozen|freez\\w*|stuck) (in|on) obs",
  ],
  "second-link-idle": [
    "second (phone|connection|sim|modem|link|network|device)",
    "\\bmoblink\\b",
    "(not|isn'?t|doesn'?t|won'?t|never).{0,30}(bond\\w*|use (the )?(second|other|both|all))",
    "(only|just) (one|1|a single) (connection|link|network|modem|interface)",
    "(link|connection|modem|interface).{0,30}\\bidle\\b",
  ],
  "picture-frozen": [
    "(camera|picture|video|image|preview|feed)\\W+(\\w+\\W+){0,4}(freez\\w*|frozen|stutter\\w*)",
    "(dji|gopro|osmo|action ?\\d|insta360).{0,60}(freez\\w*|frozen|drop\\w*|disconnect\\w*|lag\\w*)",
  ],
  "camera-black-preview": [
    "(camera|preview|feed).{0,40}\\bblack\\b",
    "(rtmp|wi-?fi|network) camera.{0,40}(no (video|image|picture)|not (show|work))",
  ],
  "sound-missing": [
    "(no|missing|lost|wrong) (audio|sound|mic\\b|microphone)",
    "(audio|sound).{0,30}(missing|gone|not working|out of sync|drift\\w*|desync\\w*|cut\\w* out)",
    "(audio|a/v|av) (sync|desync|drift)",
    "\\bmic\\b.{0,30}(not (work|detect)|wrong|switch\\w*)",
  ],
  "camera-switch-drop": [
    "(switch|switching|change|changing) (the )?(camera|cameras|lens|lenses).{0,40}(drop\\w*|disconnect\\w*|black|freez\\w*|crash\\w*)",
  ],
  "destination-turns-off": [
    "destination.{0,40}(turns?|switch\\w*|disabl\\w*|goes) off",
    "(output|restream\\w*).{0,30}(turns? off|disabled|stops by itself)",
  ],
};

/** Themes for grouping threads. The theme with the most pattern hits wins (title hits count
 *  twice); ties go to the earlier theme. `part` is where along the chain it sits. */
export const THEMES: { id: string; label: string; part: Part; patterns: string[] }[] = [
  { id: "second-connection", label: "Second connection, bonding and link use", part: "connections", patterns: [
    "second (phone|connection|sim|modem|link|network)", "\\bmoblink\\b", "\\bbond\\w*", "\\bsrtla\\b", "multiple (connections|networks|links|modems)",
    "\\bidle\\b", "tether\\w*", "usb modem", "\\bmodems?\\b", "link aggregation", "speedify", "cellular", "wi-?fi and (cellular|mobile|lte|5g)",
  ]},
  { id: "receiver-server", label: "Receiver, relay and self-hosting", part: "receiver", patterns: [
    "receiver", "\\brelay\\b", "self.?host\\w*", "\\bvps\\b", "docker", "\\bports?\\b", "firewall", "srtla_rec", "\\bsls\\b",
    "srt.?live.?server", "(srt|srtla|rtmp|own|home|cloud|media) server", "server setup", "stream ?id", "public ip", "\\bnat\\b", "listener", "caller",
  ]},
  { id: "obs-feed-switching", label: "Feed into OBS, BRB and scene switching", part: "obs", patterns: [
    "\\bobs\\b", "media source", "vlc source", "\\bbrb\\b", "scene switch\\w*", "auto.?switch\\w*", "low bitrate", "noalbs", "fallback",
    "\\bstuck\\b", "reconnect\\w*",
  ]},
  { id: "wifi-camera", label: "Wi-Fi and action cameras into the phone or box", part: "camera", patterns: [
    "\\bdji\\b", "gopro", "osmo", "insta360", "action ?cam\\w*", "action ?\\d", "(wifi|wi-fi|network) camera", "local ingest", "network ingest",
    "rtmp server", "camera.{0,20}(rtmp|srt)", "mediasrvr",
  ]},
  { id: "wired-camera", label: "USB, UVC and HDMI cameras and capture", part: "camera", patterns: [
    "\\buvc\\b", "usb (camera|cam|capture|video)", "\\bhdmi\\b", "capture card", "external camera", "webcam", "cam ?link", "\\bmirrorless\\b", "\\bdslr\\b",
  ]},
  { id: "audio", label: "Audio missing, wrong mic or out of sync", part: "camera", patterns: [
    "\\baudio\\b", "\\bsound\\b", "\\bvolume\\b", "\\bmic\\b", "microphone", "\\bsync\\b", "desync", "drift", "\\becho\\b", "crackl\\w*", "\\bmuted?\\b", "\\baac\\b", "\\bopus\\b",
  ]},
  { id: "alerts-overlays-chat", label: "Alerts, overlays, widgets and chat", part: "obs", patterns: [
    "\\balerts?\\b", "overlay", "widget", "browser source", "\\bchat\\b", "\\btts\\b", "text to speech", "streamelements", "streamlabs", "emote", "\\bbot\\b",
  ]},
  { id: "platform-ingest", label: "Platform ingest, keys and going live", part: "platform", patterns: [
    "twitch", "\\bkick\\b", "youtube", "stream key", "\\bingest\\b", "\\brtmps?\\b", "multistream\\w*", "restream\\w*", "go(ing)? live", "black screen", "offline",
    "facebook", "tiktok",
  ]},
  { id: "bitrate-quality", label: "Bitrate, quality and encoder settings", part: "sender", patterns: [
    "bitrate", "quality", "pixelat\\w*", "resolution", "\\bfps\\b", "frame ?rate", "dropped frames", "stutter\\w*", "\\blag\\w*", "choppy", "\\bencod\\w*",
    "\\bhevc\\b", "h\\.?26[45]", "b-?frames", "\\bcbr\\b", "\\bvbr\\b", "\\bav1\\b", "keyframe", "\\b(1080|720|4k)p?\\b",
  ]},
  { id: "latency-delay", label: "Latency and delay", part: "connections", patterns: ["latency", "\\bdelay\\w*", "\\bbuffer\\w*", "\\blate\\b"] },
  { id: "connection-drops", label: "Disconnects and unstable connections", part: "connections", patterns: [
    "disconnect\\w*", "\\bdrops?\\b", "dropping", "unstable", "packet loss", "time ?out", "connection (lost|failed|refused|reset)", "can'?t connect", "cannot connect",
    "unable to connect", "keeps? (dropping|disconnecting)", "\\bvpn\\b", "\\bdns\\b", "\\bipv[46]\\b",
  ]},
  { id: "heat-battery-power", label: "Heat, battery and power", part: "sender", patterns: [
    "overheat\\w*", "\\bheat\\b", "\\bcool(ing|er)?\\b", "\\bhot\\b", "thermal", "battery", "power ?bank", "charg\\w*", "\\bdrain\\w*", "throttl\\w*", "\\bpower\\b",
  ]},
  { id: "remote-control", label: "Remote control and second-device control", part: "obs", patterns: [
    "remote", "websocket", "assistant", "control (from|via|with)", "obs blade", "stream ?deck", "web ?ui", "dashboard",
  ]},
  { id: "data-sim-carrier", label: "Mobile data, SIMs and carriers", part: "connections", patterns: [
    "data (usage|cap|plan|limit)", "\\bsim\\b", "\\besim\\b", "carrier", "roaming", "\\bgb\\b", "unlimited", "\\bapn\\b", "\\bbands?\\b",
  ]},
  { id: "recording-replay", label: "Recording, replays and clips", part: "sender", patterns: ["\\brecord\\w*", "replay", "\\bclips?\\b", "save (locally|to)"] },
  { id: "location-maps", label: "Location, maps and speed overlays", part: "obs", patterns: ["\\bgps\\b", "location", "\\bmaps?\\b", "\\bspeed\\b", "rtirl", "realtimeirl"] },
  { id: "box-install", label: "Box hardware, images and updates", part: "sender", patterns: [
    "jetson", "orange ?pi", "rock ?5", "rk3588", "\\bsd ?card\\b", "\\bemmc\\b", "flash\\w*", "\\bimage\\b", "install\\w*", "\\bupdate\\w*", "\\bboot\\w*",
  ]},
  { id: "app-crash-device", label: "App crashes, permissions and device support", part: "sender", patterns: [
    "crash\\w*", "permission", "testflight", "app store", "play store", "\\bios ?\\d+", "android ?\\d+", "iphone ?\\d+", "\\bipad\\b", "pixel ?\\d", "samsung",
    "\\blogin\\b", "sign.?in", "\\baccount\\b",
  ]},
];
