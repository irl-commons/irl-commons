// Write the JSON Schema for each data file to ../schema/json, from the zod schemas.
import { z } from "zod";
import { writeFileSync } from "node:fs";
import { files, Part, PartTask, Role, RolesByKind } from "../schema/src/schema.ts";

export function exported(name: keyof typeof files): string {
  const schema = z.toJSONSchema(files[name], { target: "draft-2020-12" });
  return JSON.stringify({ ...schema, $id: `https://raw.githubusercontent.com/irl-commons/irl-commons/main/schema/json/${name}.schema.json`, title: `${name}.json` }, null, 2) + "\n";
}

/** The chain parts and their tasks, for validators in other languages that rebuild `title_display`. */
export function partsJson(): string {
  return JSON.stringify({ parts: Part.options, task: PartTask, roles: Role.options, roles_by_kind: RolesByKind }, null, 2) + "\n";
}

if (import.meta.main) {
  writeFileSync(new URL("../schema/json/parts.json", import.meta.url), partsJson());
  console.log("wrote json/parts.json");
  for (const name of Object.keys(files) as (keyof typeof files)[]) {
    writeFileSync(new URL(`../schema/json/${name}.schema.json`, import.meta.url), exported(name));
    console.log(`wrote json/${name}.schema.json`);
  }
}
