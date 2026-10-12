/**
 * Zod schemas as the JSON Schema Claude's strict tool use and structured outputs accept.
 *
 * Why not the SDK's own `zodOutputFormat` / the schema `betaZodTool` writes: in the pinned SDK
 * (0.133.0) `zodOutputFormat` folds `enum` and `const` into the description text instead of
 * keeping them in the schema, and `betaZodTool` sends `z.toJSONSchema`'s output as it stands, with
 * `$schema` and numeric `minimum` / `maximum` that strict mode does not accept. So the schema is
 * written here: `additionalProperties: false` on every object, `enum`, `const` and `anyOf` kept,
 * and the keywords strict mode rejects moved into the description, where the model still reads
 * them. The values are still checked, by Zod, on the way back in.
 *
 * The limits strict mode documents (no numeric or string constraints, no recursion) are checked
 * by `strictSchemaProblems`, which the tests run over every tool and output schema.
 */
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';

type Json = Record<string, unknown>;

/** Keywords strict mode refuses; each is folded into the description. */
const MOVED_TO_DESCRIPTION = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'maxItems'];
/** Keywords dropped without a trace: they carry nothing the model needs. */
const DROPPED = ['$schema', 'default', 'examples', 'title', '$id'];
/** Zod writes these for a bare `.int()`; they are not a constraint anyone asked for. */
const SAFE_INT = 9007199254740991;

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!isRecord(node)) return node;
  const out: Json = {};
  const notes: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED.includes(key)) continue;
    if (MOVED_TO_DESCRIPTION.includes(key)) {
      if (typeof value === 'number' && Math.abs(value) >= SAFE_INT) continue;
      notes.push(`${key} ${JSON.stringify(value)}`);
      continue;
    }
    if (key === 'minItems') {
      if (value === 0 || value === 1) out[key] = value;
      else notes.push(`minItems ${JSON.stringify(value)}`);
      continue;
    }
    if (key === 'oneOf') {
      out.anyOf = clean(value);
      continue;
    }
    if (key === 'properties' && isRecord(value)) {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
      continue;
    }
    out[key] = key === 'items' || key === 'anyOf' || key === 'allOf' || key === '$defs' ? clean(value) : value;
  }
  if (out.type === 'object' || isRecord(out.properties)) {
    out.additionalProperties = false;
    // An object with nothing required has no `required` at all: an empty list is not valid in every draft.
    if (Array.isArray(out.required) && out.required.length === 0) delete out.required;
  }
  if (notes.length > 0) {
    const was = typeof out.description === 'string' ? `${out.description} ` : '';
    out.description = `${was}(${notes.join(', ')})`;
  }
  return out;
}

/** The JSON Schema for a Zod type, in the form strict tool use and `output_config.format` accept. */
export function toStrictJsonSchema(schema: z.ZodType): Json {
  return clean(z.toJSONSchema(schema)) as Json;
}

export interface SchemaStats {
  /** Properties not listed as required, across the whole schema. Strict mode allows 24 in a request, summed over its strict tools. */
  optional: number;
  /** Properties whose type is a union (`anyOf`, or a `type` array such as nullable). Strict mode allows 16 in a request. */
  unions: number;
}

const FORBIDDEN = ['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'maxItems', '$ref', '$defs'];

/** What is wrong with a schema for strict mode, as readable lines (none = fine), with its optional and union counts. */
export function strictSchemaProblems(schema: unknown): { problems: string[]; stats: SchemaStats } {
  const problems: string[] = [];
  const stats: SchemaStats = { optional: 0, unions: 0 };
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((n, i) => walk(n, `${path}[${i}]`));
      return;
    }
    if (!isRecord(node)) return;
    for (const key of FORBIDDEN) if (key in node) problems.push(`${path}: ${key} is not allowed`);
    if (typeof node.minItems === 'number' && node.minItems > 1) problems.push(`${path}: minItems above 1 is not allowed`);
    if (node.type === 'object' || isRecord(node.properties)) {
      if (node.additionalProperties !== false) problems.push(`${path}: object without additionalProperties: false`);
      const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
      const props = isRecord(node.properties) ? node.properties : {};
      for (const [name, prop] of Object.entries(props)) {
        if (!required.has(name)) stats.optional++;
        if (isRecord(prop) && (Array.isArray(prop.anyOf) || Array.isArray(prop.type))) stats.unions++;
        walk(prop, `${path}.${name}`);
      }
      return;
    }
    if (isRecord(node.items)) walk(node.items, `${path}[]`);
    if (Array.isArray(node.anyOf)) walk(node.anyOf, `${path}.anyOf`);
  };
  walk(schema, '$');
  return { problems, stats };
}

type ToolOptions<S extends z.ZodType> = Parameters<typeof betaZodTool<S>>[0];

/**
 * A runnable tool from a Zod schema, declared `strict`. Same `run` / `parse` as `betaZodTool` (the
 * input is validated by Zod before `run` is called), with the schema written by `toStrictJsonSchema`.
 * `tool_choice` stays automatic everywhere: Sonnet 5.5 rejects a forced one.
 */
export function strictTool<S extends z.ZodType>(options: ToolOptions<S>): ReturnType<typeof betaZodTool<S>> {
  const tool = betaZodTool(options);
  // `BetaRunnableTool` is a union over every kind of tool; this one is always the custom kind.
  return { ...tool, input_schema: toStrictJsonSchema(options.inputSchema), strict: true } as unknown as typeof tool;
}
