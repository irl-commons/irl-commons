// A small robots.txt reader shared by the steward tools that fetch public pages: groups by
// user agent, Allow and Disallow with * and $, the longest matching rule wins and Allow wins
// a tie. Crawl-delay is kept as seconds.

export type Robots = { rules: { allow: boolean; pattern: string }[]; delay: number | null };

export function parseRobots(text: string, agent: string): Robots {
  type Group = { agents: string[]; rules: Robots["rules"]; delay: number | null };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [], delay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      // An empty Disallow allows everything; it adds no rule.
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n)) current.delay = n;
    }
  }
  const me = agent.toLowerCase();
  // The most specific named group that matches our product token, else the * group.
  let best: Group[] = [];
  let bestLength = 0;
  for (const g of groups) for (const a of g.agents) {
    if (a === "*" || !me.includes(a)) continue;
    if (a.length > bestLength) { best = [g]; bestLength = a.length; } else if (a.length === bestLength && !best.includes(g)) best.push(g);
  }
  if (!best.length) best = groups.filter(g => g.agents.includes("*"));
  return {
    rules: best.flatMap(g => g.rules),
    delay: best.map(g => g.delay).find(d => d !== null) ?? null,
  };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path);
}

/** pathAndQuery is the URL path plus its query string, as robots rules are written. */
export function robotsAllows(robots: Robots, pathAndQuery: string): boolean {
  let winner: { allow: boolean; length: number } | null = null;
  for (const rule of robots.rules) {
    if (!matches(rule.pattern, pathAndQuery)) continue;
    const length = rule.pattern.length;
    if (!winner || length > winner.length || (length === winner.length && rule.allow)) winner = { allow: rule.allow, length };
  }
  return winner ? winner.allow : true;
}
