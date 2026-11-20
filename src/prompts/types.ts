export interface PromptDef {
  id: string;
  version: number;
  maxTokens: number;
  temperature: number;
  schema: string | null;
  /** Variable names ({{name}}) the template requires. */
  vars: string[];
  template: string;
  source: string;
}

/** Fill {{var}} placeholders; throws if any required var is missing. */
export function renderPrompt(def: PromptDef, vars: Record<string, string>): string {
  const missing = def.vars.filter((v) => !(v in vars));
  if (missing.length) {
    throw new Error(`prompt ${def.id}@${def.version} missing vars: ${missing.join(", ")}`);
  }
  return def.template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? "");
}
