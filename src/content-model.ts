import * as ss from "superstruct";

const ContentModelStringKind = ss.enums([
  "string",
  "textarea",
  "image_file_id",
  "file_id",
  "product_id",
  "variant_id",
  "category_id",
  "brand_id",
  "content_block_id",
  "web_url",
  "dropdown",
  "radio",
]);

const ContentModelNumberKind = ss.enums(["number", "percentage", "rating"]);

const ContentModelBooleanKind = ss.enums(["checkbox", "toggle"]);

const ContentModelDatetimeKind = ss.enums(["date", "datetime"]);

const ContentModelEnumValue = ss.type({
  label: ss.string(),
  value: ss.string(),
});

const ContentModelStringValidation = ss.type({
  minLength: ss.optional(ss.number()),
  minLengthError: ss.optional(ss.string()),
  maxLength: ss.optional(ss.number()),
  maxLengthError: ss.optional(ss.string()),
  pattern: ss.optional(ss.string()),
  patternError: ss.optional(ss.string()),
  enum: ss.optional(ss.array(ContentModelEnumValue)),
  defaultValue: ss.optional(ss.string()),
});

const ContentModelNumberValidation = ss.type({
  min: ss.optional(ss.number()),
  minError: ss.optional(ss.string()),
  max: ss.optional(ss.number()),
  maxError: ss.optional(ss.string()),
  integer: ss.optional(ss.boolean()),
});

const ContentModelTypeFieldProps = ss.type({
  name: ss.string(),
  label: ss.optional(ss.string()),
});

const ContentModelType_String = ss.type({
  type: ss.literal("string"),
  kind: ContentModelStringKind,
  validation: ss.optional(ContentModelStringValidation),
  help: ss.optional(ss.string()),
});

const ContentModelType_Datetime = ss.type({
  type: ss.literal("datetime"),
  kind: ContentModelDatetimeKind,
  help: ss.optional(ss.string()),
});

const ContentModelType_Boolean = ss.type({
  type: ss.literal("boolean"),
  kind: ContentModelBooleanKind,
  help: ss.optional(ss.string()),
});

const ContentModelType_Number = ss.type({
  type: ss.literal("number"),
  kind: ContentModelNumberKind,
  validation: ContentModelNumberValidation,
  help: ss.optional(ss.string()),
});

const NonObjectContentModelType = ss.union([
  ContentModelType_String,
  ContentModelType_Datetime,
  ContentModelType_Boolean,
  ContentModelType_Number,
]);

const ContentModelObjectField = ss.intersection([NonObjectContentModelType, ContentModelTypeFieldProps]);

const ContentModelType_Object = ss.type({
  type: ss.literal("object"),
  fields: ss.array(ContentModelObjectField),
  help: ss.optional(ss.string()),
});

const ContentModelType = ss.union([ContentModelType_Object, NonObjectContentModelType]);

const ContentModelSchema = ss.type({
  label: ss.optional(ss.string()),
  name: ss.string(),
  json: ContentModelType,
});

type ContentModelSchemaType = ss.Infer<typeof ContentModelSchema>;

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

export function generateContentModelTypescriptCode(schema: ContentModelSchemaType): string {
  let out = "";

  out += `import * as ss from "superstruct";\n`;
  out += `export const ContentModel = ${generateTypeFor(schema.json)};\n`;

  return out;
}
