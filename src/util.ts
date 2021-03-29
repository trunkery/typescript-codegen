export type Dict<T> = { [v: string]: T | undefined };

export function nonNull<T>(v: T | undefined | null, msg?: string): T {
  if (!v) throw new Error("expected a non-null value" + (msg ? `: ${msg}` : ""));
  return v;
}
