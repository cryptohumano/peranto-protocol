import { Plus, Trash2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FieldHint } from "@/components/HelpCallout";

export type FieldDataType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "date-time";

export const FIELD_DATA_TYPES: { value: FieldDataType; label: string }[] = [
  { value: "string", label: "string (texto)" },
  { value: "integer", label: "integer (entero)" },
  { value: "number", label: "number (decimal)" },
  { value: "boolean", label: "boolean (sí/no)" },
  { value: "date-time", label: "date-time (ISO)" },
];

export type TemplateField = {
  id: string;
  key: string;
  value: string;
  required: boolean;
  dataType: FieldDataType;
};

export type FieldSpec = {
  key: string;
  dataType?: FieldDataType;
  required?: boolean;
};

function guessType(key: string, value?: unknown): FieldDataType {
  if (key.endsWith("At") || key.includes("Date") || key.includes("Time")) {
    return "date-time";
  }
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return "string";
}

export function fieldsFromSpecs(
  specs: FieldSpec[],
  defaults: Record<string, string> = {}
): TemplateField[] {
  return specs.map((spec, i) => {
    const key = spec.key;
    const dataType = spec.dataType ?? guessType(key);
    const autoDate =
      dataType === "date-time" &&
      (key === "enrolledAt" ||
        key === "testedAt" ||
        key === "workedAt" ||
        key === "contributedAt");
    return {
      id: `${key}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      key,
      value: defaults[key] ?? (autoDate ? new Date().toISOString() : ""),
      required: Boolean(spec.required),
      dataType,
    };
  });
}

/** @deprecated prefer fieldsFromSpecs */
export function fieldsFromKeys(
  keys: string[],
  required: string[] = [],
  defaults: Record<string, string> = {}
): TemplateField[] {
  return fieldsFromSpecs(
    keys.map((key) => ({
      key,
      required: required.includes(key),
      dataType: guessType(key),
    })),
    defaults
  );
}

export function fieldsToClaims(fields: TemplateField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const k = f.key.trim();
    if (!k) continue;
    const v = f.value.trim();
    if (v === "" && !f.required) continue;
    switch (f.dataType) {
      case "integer": {
        const n = Number.parseInt(v, 10);
        if (Number.isNaN(n)) throw new Error(`Campo ${k} debe ser entero`);
        out[k] = n;
        break;
      }
      case "number": {
        const n = Number(v);
        if (Number.isNaN(n)) throw new Error(`Campo ${k} debe ser número`);
        out[k] = n;
        break;
      }
      case "boolean":
        out[k] = v === "true" || v === "1" || v.toLowerCase() === "sí" || v.toLowerCase() === "si";
        break;
      case "date-time":
      case "string":
      default:
        out[k] = v;
        break;
    }
  }
  return out;
}

export function fieldsFromClaims(
  claims: Record<string, unknown>,
  required: string[] = [],
  typeHints: Record<string, FieldDataType> = {}
): TemplateField[] {
  return Object.keys(claims).map((key, i) => {
    const raw = claims[key];
    const dataType = typeHints[key] ?? guessType(key, raw);
    const value =
      raw == null
        ? ""
        : typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
          ? String(raw)
          : JSON.stringify(raw);
    return {
      id: `${key}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      key,
      value,
      required: required.includes(key),
      dataType,
    };
  });
}

export function fieldsToSchemaBody(
  schemaKey: string,
  fields: TemplateField[]
): string {
  const properties: Record<string, { type: string; format?: string }> = {};
  const required: string[] = [];
  for (const f of fields) {
    const k = f.key.trim();
    if (!k) continue;
    if (f.dataType === "date-time") {
      properties[k] = { type: "string", format: "date-time" };
    } else if (f.dataType === "integer") {
      properties[k] = { type: "integer" };
    } else {
      properties[k] = { type: f.dataType };
    }
    if (f.required) required.push(k);
  }
  return JSON.stringify({
    $id: schemaKey,
    type: "object",
    required,
    properties,
    additionalProperties: false,
  });
}

type Mode = "schema" | "values" | "free";

type Props = {
  fields: TemplateField[];
  onChange: (next: TemplateField[]) => void;
  valueLabel?: string;
  /**
   * schema — diseñar plantilla (nombre, tipo, req)
   * values — schema fijo del registry: solo rellenar valores
   * free — todo editable (rara)
   */
  mode?: Mode;
};

export function FieldTemplateEditor({
  fields,
  onChange,
  valueLabel = "Valor",
  mode = "free",
}: Props) {
  const locked = mode === "values";
  const showValues = mode !== "schema";
  const showTypes = mode === "schema" || mode === "free";
  const canMutateStructure = mode === "schema" || mode === "free";

  function update(id: string, patch: Partial<TemplateField>) {
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function remove(id: string) {
    if (!canMutateStructure) return;
    onChange(fields.filter((f) => f.id !== id));
  }

  function add() {
    if (!canMutateStructure) return;
    onChange([
      ...fields,
      {
        id: `f-${Date.now()}`,
        key: "",
        value: "",
        required: false,
        dataType: "string",
      },
    ]);
  }

  return (
    <div className="space-y-3">
      {locked ? (
        <FieldHint>
          <span className="inline-flex items-center gap-1">
            <Lock className="size-3" />
            Campos del schema fijados en el registry — solo editas valores.
          </span>
        </FieldHint>
      ) : mode === "schema" ? (
        <FieldHint>
          Elige nombre, tipo de dato y si es obligatorio. On-chain solo se
          registra el hash del schema; los valores de cada persona van en el JWT.
        </FieldHint>
      ) : (
        <FieldHint>
          Añade o quita campos. El contenido (valores) viaja en el JWT, no al
          contrato.
        </FieldHint>
      )}

      {fields.map((f) => (
        <div
          key={f.id}
          className="grid gap-2 rounded-xl border border-[var(--color-moss)]/12 p-3 sm:grid-cols-[1fr_minmax(7rem,8rem)_1fr_auto_auto] sm:items-end"
        >
          <div>
            <Label>Campo</Label>
            {locked ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-sm font-medium">
                {f.key}
                <Badge variant="outline" className="text-[10px] font-normal">
                  {f.dataType}
                </Badge>
              </p>
            ) : (
              <Input
                value={f.key}
                onChange={(e) => update(f.id, { key: e.target.value })}
                placeholder="fullName"
              />
            )}
          </div>

          {showTypes && !locked && (
            <div>
              <Label>Tipo</Label>
              <select
                className="mt-0 flex h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={f.dataType}
                onChange={(e) =>
                  update(f.id, { dataType: e.target.value as FieldDataType })
                }
              >
                {FIELD_DATA_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {showValues ? (
            <div className={locked && !showTypes ? "sm:col-span-2" : undefined}>
              <Label>{valueLabel}</Label>
              {f.dataType === "boolean" ? (
                <select
                  className="mt-0 flex h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={f.value === "true" ? "true" : f.value === "false" ? "false" : ""}
                  onChange={(e) => update(f.id, { value: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <Input
                  type={
                    f.dataType === "integer" || f.dataType === "number"
                      ? "number"
                      : "text"
                  }
                  step={f.dataType === "integer" ? 1 : undefined}
                  value={f.value}
                  onChange={(e) => update(f.id, { value: e.target.value })}
                  placeholder={
                    f.dataType === "date-time"
                      ? "2026-07-15T12:00:00.000Z"
                      : "…"
                  }
                />
              )}
            </div>
          ) : (
            <div className="hidden sm:block" aria-hidden />
          )}

          {canMutateStructure ? (
            <label className="flex items-center gap-1.5 pb-2 text-xs text-[var(--color-ink)]/70">
              <input
                type="checkbox"
                checked={f.required}
                onChange={(e) => update(f.id, { required: e.target.checked })}
              />
              req
            </label>
          ) : (
            <span className="pb-2 text-[10px] text-muted-foreground">
              {f.required ? "req" : "opc"}
            </span>
          )}

          {canMutateStructure ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => remove(f.id)}
              aria-label="Eliminar campo"
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : (
            <span className="pb-2 text-[var(--color-moss)]/40" aria-hidden>
              <Lock className="size-3.5" />
            </span>
          )}
        </div>
      ))}

      {canMutateStructure && (
        <Button type="button" size="sm" variant="secondary" onClick={add}>
          <Plus className="size-3.5" />
          Añadir campo
        </Button>
      )}
    </div>
  );
}
