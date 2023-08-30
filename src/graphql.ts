import _ from "lodash";
import fs from "fs";
import glob from "glob";
import path from "path";
import {
  DefinitionNode,
  DocumentNode,
  FragmentDefinitionNode,
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLError,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLSchema,
  GraphQLString,
  GraphQLType,
  Kind,
  KnownDirectivesRule,
  NameNode,
  NoUnusedFragmentsRule,
  OperationDefinitionNode,
  OperationTypeNode,
  SelectionSetNode,
  Source,
  TypeNode,
  UniqueOperationNamesRule,
  ValidationContext,
  ValidationRule,
  isEnumType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  parse,
  specifiedRules,
  validate,
  visit,
} from "graphql";
import { concatAST } from "graphql/utilities";

import { Dict, nonNull } from "./util";

type ImportData = { kind: "all" } | { kind: "some"; names: string[] };

export function loadGraphQLFromFile(path: string) {
  const data = fs.readFileSync(path, "utf-8");
  return new Source(data, path);
}

export interface ImportedFragment {
  name: string;
  path: string;
  fragment: { type: TSType; node: FragmentDefinitionNode };
  context: ReturnType<typeof resolveTypesSorted>;
}

export interface ImportsRawData {
  usedNamedTypes: Dict<boolean>;
  fragmentDeps: Dict<string[]>;
  fragments: Dict<{
    type: TSType;
    node: FragmentDefinitionNode;
  }>;
}

export interface Imports {
  loadedImports: ImportedFragment[];
  loadedImportsMap: Dict<ImportedFragment>;
  rawImportData: ImportsRawData[];
  prefixMap: Dict<string>;
  embedImports: boolean;
}

export function loadImports(
  specs: ImportSpec[],
  includes: string[],
  schema: GraphQLSchema,
  embedImports: boolean
): Imports {
  const uniqueDirs = _.uniq(_.map(specs, (s) => s.from));
  const importedData: Dict<ReturnType<typeof resolveTypesSorted>> = {};
  const fragmentWhitelistPerDir: Dict<Dict<boolean> | "all"> = {};
  const prefixMap: Dict<string> = {};
  const includeAbbrevs = _.compact(
    _.map(includes, (inc) => {
      const [keyName, val, prefix] = _.split(inc, "=", 3);
      if (keyName && val && prefix) {
        const key = `@${keyName}`;
        prefixMap[key] = prefix;
        return { key, val };
      } else {
        return undefined;
      }
    })
  );

  if (embedImports) {
    // when embedding imports, collect fragment whitelists for each dir
    for (const d of uniqueDirs) {
      for (const s of specs) {
        if (s.from !== d) continue;
        if (s.what.kind === "all") {
          fragmentWhitelistPerDir[d] = "all";
          break;
        } else {
          let dd = fragmentWhitelistPerDir[d];
          if (!dd || _.isString(dd)) dd = {};
          for (const name of s.what.names) {
            dd[name] = true;
          }
          fragmentWhitelistPerDir[d] = dd;
        }
      }
    }
  }

  const rawImportData: ImportsRawData[] = [];
  for (const d of uniqueDirs) {
    let foundSome = false;

    let dd = d;
    for (const ia of includeAbbrevs) {
      dd = dd.replace(ia.key, ia.val);
    }
    const files = glob.sync(path.join(dd, "**", "*.graphql"));

    if (files.length > 0) {
      // found some files in some dir, let's consider it a match
      const sources: Source[] = [];
      for (const file of files) {
        const src = loadGraphQLFromFile(file);
        const imports = extractImportSpecs(src.body);
        if (imports.length > 0)
          throw new Error(
            `importing file ${JSON.stringify(file)} which itself has imports, nested imports are not allowed`
          );
        if (src) sources.push(src);
      }

      const doc = concatAST(_.map(sources, (src) => parse(src)));
      const data = resolveTypesSorted(schema, doc, undefined);

      if (embedImports) {
        // when embedding imports, we only need those fragments which were explicitly requested and their deps
        // let's remove unused things here
        data.operations = {};
        data.operationsSorted = [];

        const whitelist = fragmentWhitelistPerDir[d];
        if (whitelist && whitelist !== "all") {
          const newUsedNamedTypes: typeof data.usedNamedTypes = {};
          const newFragments: typeof data.fragments = {};
          for (const key in whitelist) {
            const visited: Dict<boolean> = {};
            recursiveCopyFragments(
              schema,
              newUsedNamedTypes,
              newFragments,
              data.fragments,
              visited,
              key,
              data.fragmentDeps
            );
          }

          data.fragments = newFragments;
          data.fragmentsSorted = sortDictValues(newFragments);
          data.usedNamedTypes = newUsedNamedTypes;
          data.usedNamedTypesSorted = sortDictValues(newUsedNamedTypes);
        }
      }

      rawImportData.push({
        fragmentDeps: data.fragmentDeps,
        fragments: data.fragments,
        usedNamedTypes: data.usedNamedTypes,
      });
      importedData[d] = data;
      foundSome = true;
      break;
    }
    if (!foundSome) {
      throw new Error(`failed resolving ${JSON.stringify(d)} import path`);
    }
  }

  // all import files are loaded and resolved, let's sort out imports
  const importedFragments: Dict<Dict<boolean>> = {};
  for (const s of specs) {
    const d = importedFragments[s.from] || (importedFragments[s.from] = {});
    const data = nonNull(importedData[s.from], "imported data");
    if (s.what.kind === "all") {
      _.extend(d, _.fromPairs(_.map(data.fragmentsSorted, (f) => [f.name, true])));
    } else if (s.what.kind === "some") {
      for (const name of s.what.names) {
        const f = data.fragments[name];
        if (!f) throw new Error(`fragment ${JSON.stringify(name)} not found in ${JSON.stringify(s.from)}`);
        d[name] = true;
      }
    }
  }

  const outMap: Dict<ImportedFragment> = {};
  _.forEach(importedFragments, (d, path) => {
    const data = nonNull(importedData[path], "imported data");
    _.forEach(d, (_b, name) => {
      const alreadyImported = outMap[name];
      if (alreadyImported) {
        const argName = JSON.stringify(name);
        const argPath = JSON.stringify(path);
        const argSecondPath = JSON.stringify(alreadyImported.path);
        throw new Error(`fragment ${argName} import from ${argPath} and from ${argSecondPath}`);
      }
      const fragment = nonNull(data.fragments[name], `fragment: ${name}`);
      outMap[name] = {
        name,
        path,
        fragment,
        context: data,
      };
    });
  });

  return {
    loadedImports: _.sortBy(_.compact(_.values(outMap)), (v) => v.name),
    loadedImportsMap: outMap,
    rawImportData,
    embedImports,
    prefixMap,
  };
}

export interface ImportSpec {
  from: string;
  what: ImportData;
}

export function extractImportSpecs(data: string): ImportSpec[] {
  const out: ImportSpec[] = [];
  const importAllFromRegexp = /import\s+\*\s+from\s+"([^"]+)"/g;
  const importSomeFromRegexp = /import\s+\{\s*([a-zA-Z0-9_]+)((?:\s*,\s*[a-zA-Z0-9_]+)*)\s*\}\s+from\s+"([^"]+)"/g;
  while (true) {
    const m = importAllFromRegexp.exec(data);
    if (!m) {
      break;
    }
    out.push({
      from: m[1],
      what: { kind: "all" },
    });
  }
  while (true) {
    const m = importSomeFromRegexp.exec(data);
    if (!m) {
      break;
    }
    const names = [m[1], ..._.compact(_.map(_.split(m[2], ","), _.trim))];
    out.push({
      from: m[3],
      what: { kind: "some", names },
    });
  }
  return out;
}

function NoAnonymousQueries(context: ValidationContext) {
  return {
    OperationDefinition(node: OperationDefinitionNode) {
      if (!node.name) {
        context.reportError(new GraphQLError("Script does not support anonymous operations", [node]));
      }
      return false;
    },
  };
}

function logGraphQLError(error: GraphQLError) {
  const fileName = error.source ? error.source.name : "<unknown>";
  if (error.locations) {
    for (const location of error.locations) {
      logErrorMessage(error.message, fileName, location.line);
    }
  }
}

export function logErrorMessage(message: string, fileName: string, lineNumber: number) {
  console.error(`${fileName}:${lineNumber}: ${message}`);
}

export function validateDocument(schema: GraphQLSchema, document: DocumentNode, allowUnusedFragments: boolean) {
  const specifiedRulesToBeRemoved: ValidationRule[] = [UniqueOperationNamesRule, KnownDirectivesRule];
  if (allowUnusedFragments) {
    specifiedRulesToBeRemoved.push(NoUnusedFragmentsRule);
  }

  const rules = [
    NoAnonymousQueries,
    ..._.filter(specifiedRules, (rule) => !_.includes(specifiedRulesToBeRemoved, rule)),
  ];

  const validationErrors = validate(schema, document, rules);
  if (validationErrors.length > 0) {
    for (const error of validationErrors) {
      logGraphQLError(error);
    }
    throw new Error("Validation of GraphQL query document failed");
  }
}

export type TSType = TSObject | TSNamed | TSArray | TSIntersection;

export interface TSIntersection {
  type: "intersection";
  types: TSType[];
  nullable?: boolean;
}

export interface TSObject {
  type: "object";
  fields: Dict<TSType>;
  nullable?: boolean;
  asNamed?: string;
}

export interface TSNamed {
  type: "named";
  name: string;
  nullable?: boolean;
}

export interface TSArray {
  type: "array";
  element: TSType;
  nullable?: boolean;
}

function walkType(t: GraphQLType, ss: SelectionSetNode | undefined, cb: (t: GraphQLType) => void) {
  cb(t);
  if (isNonNullType(t) || isListType(t)) {
    walkType(t.ofType, ss, cb);
    return;
  }

  if (isInputObjectType(t)) {
    const fields = t.getFields();
    _.forEach(fields, (f) => {
      walkType(f.type, undefined, cb);
    });
    return;
  }

  if (isObjectType(t)) {
    if (!ss) throw new Error("should not be undefined");

    const fieldTypes = t.getFields();
    for (const sel of ss.selections) {
      switch (sel.kind) {
        case Kind.FIELD:
          walkType(fieldTypes[sel.name.value].type, sel.selectionSet, cb);
          break;
      }
    }
    return;
  }
}

function walkTypeNode(t: TypeNode, cb: (t: TypeNode) => void) {
  cb(t);
  if (t.kind === Kind.LIST_TYPE || t.kind === Kind.NON_NULL_TYPE) {
    walkTypeNode(t.type, cb);
  }
}

function identString(ident: number) {
  let result = "";
  for (let i = 0; i < ident; i++) {
    result += "  ";
  }
  return result;
}

export function enumToString(t: GraphQLEnumType, ident: number = 0) {
  let result = "";
  const values = _.map(t.getValues(), (v) => v.name).sort();
  for (let i = 0; i < values.length; i++) {
    result += `\n${identString(ident + 1)}"${values[i]}"`;
    if (i != values.length - 1) {
      result += " |";
    }
  }
  return result;
}

export function typeToString(t: TSType, ident: number = 0, useUndefined = false): string {
  switch (t.type) {
    case "object":
      let result = "{";
      const fields = _.keys(t.fields).sort();
      if (fields.length !== 0) result += "\n";
      for (let i = 0; i < fields.length; i++) {
        const ft = t.fields[fields[i]];
        if (!ft) continue;
        result += `${identString(ident + 1)}${fields[i]}${ft.nullable && useUndefined ? "?" : ""}: `;
        result += `${typeToString(ft, ident + 1, useUndefined)};\n`;
      }
      result += `${identString(ident)}}`;
      return result + (t.nullable ? " | null" : "");
    case "named":
      return t.name + (t.nullable ? " | null" : "");
    case "array":
      return `Array<${typeToString(t.element, ident, useUndefined)}>` + (t.nullable ? " | null" : "");
    case "intersection":
      const tstrs = _.map(t.types, (t) => typeToString(t, ident, useUndefined));
      return `(${_.join(tstrs, " & ")})` + (t.nullable ? " | null" : "");
  }
}

function convertTypeNode(t: TypeNode, nullable: boolean = true): TSType {
  switch (t.kind) {
    case Kind.LIST_TYPE:
      return { type: "array", element: convertTypeNode(t.type), nullable };
    case Kind.NAMED_TYPE:
      const name = builtInScalarMap[t.name.value];
      return { type: "named", name: name || t.name.value, nullable };
    case Kind.NON_NULL_TYPE:
      return convertTypeNode(t.type, false);
  }
}

function aliasOrName(v: { name: NameNode; alias?: NameNode }) {
  return v.alias ? v.alias.value : v.name.value;
}

const builtInScalarMap = {
  [GraphQLString.name]: "string",
  [GraphQLInt.name]: "number",
  [GraphQLFloat.name]: "number",
  [GraphQLBoolean.name]: "boolean",
  [GraphQLID.name]: "string",
};

export function convertType(
  t: GraphQLType,
  ss: SelectionSetNode | undefined,
  fragments: Dict<{ type: TSType }>,
  imports: Dict<ImportedFragment>,
  nullable: boolean = true,
  expandNamedInput: boolean = false
): TSType {
  if (isNonNullType(t)) return convertType(t.ofType, ss, fragments, imports, false);

  if (isEnumType(t)) return { type: "named", name: t.name, nullable };

  if (isScalarType(t)) {
    const name = builtInScalarMap[t.name];
    if (!name) return { type: "named", name: "ArbitraryObjectType", nullable };
    return { type: "named", name, nullable };
  }

  if (isListType(t)) {
    const element = convertType(t.ofType, ss, fragments, imports);
    return { type: "array", element, nullable };
  }

  if (isInputObjectType(t)) {
    if (!expandNamedInput) return { type: "named", name: t.name, nullable };

    const fields = {} as Dict<TSType>;
    const inputFields = t.getFields();
    _.forEach(inputFields, (f) => {
      fields[f.name] = convertType(f.type, undefined, fragments, imports, true, false);
    });
    return { type: "object", fields, nullable };
  }

  if (isObjectType(t)) {
    // common case, if there is only one selection and it's a fragment spread,
    // use fragment named type
    if (!ss) throw new Error("should not be undefined");

    if (ss.selections.length === 1) {
      const sel = ss.selections[0];
      if (sel.kind === Kind.FRAGMENT_SPREAD) {
        return { type: "named", name: `${sel.name.value}Fragment`, nullable };
      }
    }

    const obj: TSObject = { type: "object", fields: {} as Dict<TSType>, nullable };
    let out = obj as TSType;

    // otherwise convert things normally
    const fieldTypes = t.getFields();
    for (const sel of ss.selections) {
      switch (sel.kind) {
        case Kind.FIELD:
          const name = aliasOrName(sel);
          obj.fields[name] = convertType(fieldTypes[sel.name.value].type, sel.selectionSet, fragments, imports);
          break;
        case Kind.FRAGMENT_SPREAD:
          const fragment = fragments[sel.name.value] || imports[sel.name.value]?.fragment;
          if (fragment && (fragment.type.type === "intersection" || fragment.type.type === "object")) {
            // once we reach the point where we use intersection, remove nullable flag from its members
            // intersection itself becomes nullable and that's enough
            obj.nullable = undefined;
            const isect: TSIntersection =
              out.type === "intersection" ? out : { type: "intersection", types: [obj], nullable };
            isect.types.splice(0, 0, { type: "named", name: `${sel.name.value}Fragment` });
            out = isect;
          } else {
            // what do we do here?
            const reason = !fragment ? "non-existent fragment" : `invalid type: ${JSON.stringify(fragment.type)}`;
            throw new Error(`invalid fragment reference: ${sel.name.value} (${reason})`);
          }
          break;
        case Kind.INLINE_FRAGMENT:
          // TODO: embed it into fields
          throw new Error("not implemented yet");
      }
    }
    return out;
  }

  return { type: "named", name: "<unknown>" };
}

export function sortDictValues<T>(d: Dict<T>): { name: string; value: T }[] {
  const out: { name: string; value: T }[] = [];
  for (const k of _.keys(d).sort()) {
    out.push({
      name: k,
      value: nonNull(d[k]),
    });
  }
  return out;
}

export function resolveTypesSorted(schema: GraphQLSchema, doc: DocumentNode, imports: Imports | undefined) {
  const vals = resolveTypes(schema, doc, imports);
  const { usedNamedTypes, fragments, operations } = vals;
  return {
    usedNamedTypesSorted: sortDictValues(usedNamedTypes),
    fragmentsSorted: sortDictValues(fragments),
    operationsSorted: sortDictValues(operations),
    ...vals,
  };
}

export function walkTSType(t: TSType, cb: (v: TSType) => boolean) {
  switch (t.type) {
    case "named":
      return cb(t);
    case "array":
      if (!cb(t)) return;
      walkTSType(t.element, cb);
      break;
    case "object":
      if (!cb(t)) return;
      for (const key of _.keys(t.fields).sort()) {
        const f = nonNull(t.fields[key]);
        walkTSType(f, cb);
      }
      break;
  }
}

export function extractNamedTypes(t: TSType, namedTypes: Dict<TSType>) {
  walkTSType(t, (t) => {
    if (t.type === "object" && t.asNamed) {
      const name = t.asNamed;
      namedTypes[name] = { ...t };
      delete (t as any)["fields"];
      delete (t as any)["asNamed"];
      (t as any).type = "named";
      (t as any).name = name;
      return false;
    } else {
      return true;
    }
  });
}

export function addFragmentDepsRecursive(
  deps: Dict<boolean>,
  frags: string[],
  fragsMap: Dict<string[]>,
  imports: Dict<ImportedFragment>,
  path = ".."
) {
  const addKeyOrContinue = (key: string) => {
    if (deps[key]) return true;
    deps[key] = true;
    return false;
  };
  for (const frag of frags) {
    const moreDeps = fragsMap[frag];
    if (moreDeps) {
      if (addKeyOrContinue(`${path}:${frag}`)) continue;
      addFragmentDepsRecursive(deps, moreDeps, fragsMap, imports, path);
    } else {
      const imp = imports[frag];
      if (imp) {
        if (addKeyOrContinue(`${imp.path}:${frag}`)) continue;
        addFragmentDepsRecursive(
          deps,
          imp.context.fragmentDeps[frag] || [],
          imp.context.fragmentDeps,
          imports,
          imp.path
        );
      } else {
        if (addKeyOrContinue(`${path}:${frag}`)) continue;
        addFragmentDepsRecursive(deps, [], fragsMap, imports, path);
      }
    }
  }
}

export function extractFragmentDeps(ss: SelectionSetNode | undefined, deps: Dict<boolean>) {
  if (!ss) {
    return;
  }

  for (const sel of ss.selections) {
    switch (sel.kind) {
      case Kind.FIELD:
        extractFragmentDeps(sel.selectionSet, deps);
        break;
      case Kind.FRAGMENT_SPREAD:
        deps[sel.name.value] = true;
        break;
      case Kind.INLINE_FRAGMENT:
        throw new Error("not implemented yet");
    }
  }
}

export function recursiveCopyFragments(
  schema: GraphQLSchema,
  usedNamedTypes: Dict<boolean>,
  dst: Dict<{ type: TSType; node: FragmentDefinitionNode }>,
  src: Dict<{ type: TSType; node: FragmentDefinitionNode }>,
  visited: Dict<boolean>,
  key: string,
  deps: Dict<string[]>
) {
  if (visited[key]) return;
  visited[key] = true;

  const f = src[key];
  if (!f) return;
  dst[key] = f;
  const t = schema.getType(f.node.typeCondition.name.value);
  if (t) {
    walkType(t, f.node.selectionSet, (t) => {
      if (isEnumType(t)) usedNamedTypes[t.name] = true;
    });
  }

  for (const dep of deps[key] || []) {
    recursiveCopyFragments(schema, usedNamedTypes, dst, src, visited, dep, deps);
  }
}

export function resolveTypes(schema: GraphQLSchema, doc: DocumentNode, imports: Imports | undefined) {
  const usedNamedTypes: Dict<boolean> = {};
  const fragmentDeps: Dict<string[]> = {};
  const fragments: Dict<{
    type: TSType;
    node: FragmentDefinitionNode;
  }> = {};
  const operations: Dict<{
    operation: TSType;
    variables: TSType;
    node: OperationDefinitionNode;
  }> = {};

  const nameDedup = {} as Dict<boolean>;
  const namedDefinitions: { name: string; def: DefinitionNode; resolved: boolean }[] = [];
  for (const def of doc.definitions) {
    if (def.kind === Kind.OPERATION_DEFINITION || def.kind === Kind.FRAGMENT_DEFINITION) {
      const name = def.name!.value;
      if (nameDedup[name]) throw new Error(`definition "${name}" (${def.kind}) already exists`);
      nameDedup[name] = true;
      namedDefinitions.push({ name, def, resolved: false });
    }
  }

  let importedFragments = imports?.loadedImportsMap || {};
  if (imports && imports.embedImports) {
    importedFragments = {};
    for (const data of imports.rawImportData) {
      _.extend(usedNamedTypes, data.usedNamedTypes);
      _.extend(fragmentDeps, data.fragmentDeps);
      _.extend(fragments, data.fragments);
    }
  }

  while (true) {
    const numUnresolvedBefore = _.sumBy(namedDefinitions, (d) => (d.resolved ? 0 : 1));
    const errors: string[] = [];

    for (const ndef of namedDefinitions) {
      if (ndef.resolved) continue;
      const { def } = ndef;

      try {
        switch (def.kind) {
          case Kind.OPERATION_DEFINITION:
            // when fragment whitelist is given, we're only interested in fragments
            let name = "";
            let type: GraphQLType | null | undefined;
            switch (def.operation) {
              case OperationTypeNode.MUTATION:
                type = schema.getMutationType();
                name = `${def.name!.value}Mutation`;
                break;
              case OperationTypeNode.QUERY:
                type = schema.getQueryType();
                name = `${def.name!.value}Query`;
                break;
              case OperationTypeNode.SUBSCRIPTION:
                type = schema.getSubscriptionType();
                name = `${def.name!.value}Subscription`;
                break;
            }

            if (!type) throw new Error(`missing ${def.operation} type`);

            walkType(type, def.selectionSet, (t) => {
              if (isEnumType(t)) usedNamedTypes[t.name] = true;
            });

            const varFields = {} as Dict<TSType>;
            _.forEach(def.variableDefinitions, (vd) => {
              varFields[vd.variable.name.value] = convertTypeNode(vd.type);
              walkTypeNode(vd.type, (t) => {
                if (t.kind === Kind.NAMED_TYPE) usedNamedTypes[t.name.value] = true;
              });
            });
            const variables = { type: "object", fields: varFields } as TSObject;
            const operation = convertType(type, def.selectionSet, fragments, importedFragments);
            operation.nullable = false; // hack: top level types are not nullable
            operations[name] = {
              operation,
              variables,
              node: def,
            };
            break;
          case Kind.FRAGMENT_DEFINITION:
            // skipping this fragment?
            const t = schema.getType(def.typeCondition.name.value);
            if (t) {
              walkType(t, def.selectionSet, (t) => {
                if (isEnumType(t)) usedNamedTypes[t.name] = true;
              });

              const type = convertType(t, def.selectionSet, fragments, importedFragments);
              type.nullable = false; // hack: top level types are not nullable
              fragments[def.name.value] = { type, node: def };

              const deps: Dict<boolean> = {};
              extractFragmentDeps(def.selectionSet, deps);
              fragmentDeps[def.name.value] = _.keys(deps).sort();
            }
            break;
        }
        ndef.resolved = true;
      } catch (err: any) {
        if (def.loc) {
          errors.push(`${def.loc.source.name}:${JSON.stringify(def.loc)} ${err.toString()}`);
        } else {
          throw err;
        }
        ndef.resolved = false;
      }
    }

    const numUnresolvedAfter = _.sumBy(namedDefinitions, (d) => (d.resolved ? 0 : 1));
    if (numUnresolvedBefore === numUnresolvedAfter && numUnresolvedBefore !== 0) {
      throw new Error("failed to resolve types: " + _.join(errors, "\n"));
    }
    if (numUnresolvedAfter === 0) break;
  }

  // additional pass on used named types to get their dependencies in as well
  for (const name of _.keys(usedNamedTypes)) {
    const t = schema.getType(name);
    if (t) {
      walkType(t, undefined, (t) => {
        if (isInputObjectType(t) || isEnumType(t)) {
          usedNamedTypes[t.name] = true;
        }
      });
    }
  }

  return {
    usedNamedTypes,
    operations,
    fragments,
    fragmentDeps,
  };
}

export function ensureOperationNamesAreUnique(doc: DocumentNode): DocumentNode {
  let counter = 0;
  return visit(doc, {
    OperationDefinition: (node) => {
      return {
        ...node,
        name: {
          ...node.name,
          value: (node.name ? node.name.value : "") + `${counter++}`,
        },
      };
    },
  });
}
