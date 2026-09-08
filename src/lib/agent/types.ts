import type { Role } from "../constants";

export type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[] };
export type ToolDef = { name: string; description: string; parameters: Schema; kind: "read" | "action"; perm?: string; roles?: Role[] };
export type ToolOutcome = { result: unknown; navigateTo?: string; changed?: boolean };
export type Args = Record<string, unknown>;

export const str = (d: string) => ({ type: "string", description: d });
export const int = (d: string) => ({ type: "integer", description: d });
export const num = (d: string) => ({ type: "number", description: d });
export const bool = (d: string) => ({ type: "boolean", description: d });
export const strArr = (d: string) => ({ type: "array", items: { type: "string" }, description: d });
