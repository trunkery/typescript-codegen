import * as ss from "superstruct";

export const ContentModelStringKind = ss.enums([
  "brand_id" as const,
  "category_id" as const,
  "color" as const,
  "content_block_id" as const,
  "dropdown" as const,
  "file_id" as const,
  "image_file_id" as const,
  "product_id" as const,
  "radio" as const,
  "string" as const,
  "textarea" as const,
  "variant_id" as const,
  "web_url" as const,
]);

export const ContentModelNumberKind = ss.enums(["number" as const, "percentage" as const, "rating" as const]);

export const ContentModelBooleanKind = ss.enums(["checkbox" as const, "toggle" as const]);

export const ContentModelDatetimeKind = ss.enums(["date" as const, "datetime" as const]);

export const ContentModelEnumValue = ss.type({
  label: ss.string(),
  value: ss.string(),
});

export const ContentModelStringValidation = ss.type({
  minLength: ss.optional(ss.number()),
  minLengthError: ss.optional(ss.string()),
  maxLength: ss.optional(ss.number()),
  maxLengthError: ss.optional(ss.string()),
  pattern: ss.optional(ss.string()),
  patternError: ss.optional(ss.string()),
  enum: ss.optional(ss.array(ContentModelEnumValue)),
  defaultValue: ss.optional(ss.string()),
});

export const ContentModelNumberValidation = ss.type({
  min: ss.optional(ss.number()),
  minError: ss.optional(ss.string()),
  max: ss.optional(ss.number()),
  maxError: ss.optional(ss.string()),
  integer: ss.optional(ss.boolean()),
});

export const ContentModelTypeFieldProps = ss.type({
  name: ss.string(),
  label: ss.optional(ss.string()),
});

export const ContentModelType_String = ss.type({
  type: ss.literal("string"),
  kind: ContentModelStringKind,
  validation: ss.optional(ContentModelStringValidation),
  help: ss.optional(ss.string()),
});

export const ContentModelType_Datetime = ss.type({
  type: ss.literal("datetime"),
  kind: ContentModelDatetimeKind,
  help: ss.optional(ss.string()),
});

export const ContentModelType_Boolean = ss.type({
  type: ss.literal("boolean"),
  kind: ContentModelBooleanKind,
  help: ss.optional(ss.string()),
});

export const ContentModelType_Number = ss.type({
  type: ss.literal("number"),
  kind: ContentModelNumberKind,
  validation: ss.optional(ContentModelNumberValidation),
  help: ss.optional(ss.string()),
});

export const NonObjectContentModelType = ss.union([
  ContentModelType_String,
  ContentModelType_Datetime,
  ContentModelType_Boolean,
  ContentModelType_Number,
]);

export const ContentModelObjectField = ss.intersection([NonObjectContentModelType, ContentModelTypeFieldProps]);

export const ContentModelType_Object = ss.type({
  type: ss.literal("object"),
  fields: ss.array(ContentModelObjectField),
  help: ss.optional(ss.string()),
});

export const ContentModelType = ss.union([ContentModelType_Object, NonObjectContentModelType]);

export const ContentModelSchema = ss.type({
  label: ss.optional(ss.string()),
  name: ss.string(),
  json: ContentModelType,
});

export type ContentModelSchemaType = ss.Infer<typeof ContentModelSchema>;

export function parseContentModelSchema(data: string): ContentModelSchemaType {
  let j: any;
  try {
    j = JSON.parse(data);
  } catch (err) {
    throw new Error("failed parsing content model schema: invalid json");
  }
  const r = ss.validate(j, ContentModelSchema);
  if (!r[0]) {
    return r[1];
  } else {
    const additionalInfo = r[0]
      .failures()
      .map((f) => `  ${f.message}`)
      .join("\n");
    throw new Error(`failed parsing content model schema: ${r[0].message}\ndetailed report:\n${additionalInfo}`);
  }
}

function generateTypeFor(v: ContentModelSchemaType["json"]): string {
  switch (v.type) {
    case "boolean":
      return "ss.boolean()";
    case "string":
      const e = v.validation?.enum;
      if (e) {
        return `ss.enums([${e.map((v) => `${JSON.stringify(v.value)} as const`).join(",")}])`;
      }
    case "datetime":
      return "ss.string()";
    case "number":
      return "ss.number()";
    case "object":
      const fields: string[] = [];
      for (const f of v.fields) {
        fields.push(`${JSON.stringify(f.name)}: ${generateTypeFor(f)}`);
      }
      return `ss.type({${fields.join(",")}})`;
  }
}

export function generateContentModelTypescriptCode(schemas: ContentModelSchemaType[]): string {
  let out = "";
  out += `import * as ss from "superstruct";\n`;
  out += `export const schemas = {\n`;
  for (const schema of schemas) {
    out += `${JSON.stringify(schema.name)}: ${generateTypeFor(schema.json)},\n`;
  }
  out += `};\n`;
  return out;
}
