import _ from "lodash";
import chalk from "chalk";
import fs from "fs";
import glob from "glob";
import path from "path";
import prompts from "prompts";
import superagent from "superagent";
import {
  DocumentNode,
  GraphQLSchema,
  Kind,
  Source,
  buildClientSchema,
  buildSchema,
  concatAST,
  getIntrospectionQuery,
  isEnumType,
  isInputObjectType,
  parse,
  print,
} from "graphql";
import { stripIgnoredCharacters } from "graphql/utilities";

import { ContentModelSchemaType, generateContentModelTypescriptCode, parseContentModelSchema } from "./content-model";
import { Dict, nonNull } from "./util";
import {
  ImportSpec,
  Imports,
  addFragmentDepsRecursive,
  convertType,
  enumToString,
  extractFragmentDeps,
  extractImportSpecs,
  loadGraphQLFromFile,
  loadImports,
  resolveTypesSorted,
  typeToString,
  validateDocument,
} from "./graphql";

interface GeneratedFile {
  name: string;
  text: string;
}

type WriteLogFunc = (message: string) => void;

function writeLogFunc(quiet: boolean): WriteLogFunc {
  if (quiet) return _.noop;
  return function (message: string) {
    const ts = new Date();
    const h = _.padStart(`${ts.getHours()}`, 2, "0");
    const m = _.padStart(`${ts.getMinutes()}`, 2, "0");
    const s = _.padStart(`${ts.getSeconds()}`, 2, "0");
    const mi = _.padStart(`${ts.getMilliseconds()}`, 3, "0");
    console.log(`[${chalk.gray(`${h}:${m}:${s}.${mi}`)}] ${message}`);
  };
}

function mapPrefix(prefixMap: Dict<string>, v: string): string {
  for (const key in prefixMap) {
    const val = prefixMap[key] || "";
    v = v.replace(key, val);
  }
  return v;
}

function exportInterfaceOrType(name: string, type: string) {
  if (type.startsWith("{")) {
    return `export interface ${name} ${type}`;
  } else {
    return `export type ${name} = ${type};`;
  }
}

function generate(schema: GraphQLSchema, doc: DocumentNode, imports: Imports, config: GraphQLTypescriptCodegenConfig) {
  const { usedNamedTypesSorted, fragmentsSorted, operationsSorted, fragments, fragmentDeps } = resolveTypesSorted(
    schema,
    doc,
    imports
  );

  const jss = config.jsSuffix ? ".js" : "";

  let types = "";
  let files: GeneratedFile[] = [];

  if (imports.embedImports) {
    imports.loadedImportsMap = {};
  } else {
    for (const impName of _.keys(imports.loadedImportsMap).sort()) {
      const imp = nonNull(imports.loadedImportsMap[impName], "import");
      types += `import type { ${imp.name}Fragment } from "${mapPrefix(imports.prefixMap, imp.path)}/types${jss}";\n\n`;
    }
  }

  types += `export type ArbitraryObjectType = any;\n\n`;
  for (const nt of usedNamedTypesSorted) {
    const t = schema.getType(nt.name);
    if (isEnumType(t)) {
      types += `export type ${nt.name} = ${enumToString(t)};\n\n`;
    } else if (isInputObjectType(t)) {
      const tt = convertType(t, undefined, fragments, imports.loadedImportsMap, true, true);
      tt.nullable = false; // hack: top level types are not nullable
      types += `${exportInterfaceOrType(nt.name, typeToString(tt, 0, true))}\n\n`;
    } else {
      // must be a scalar type, skip it
    }
  }

  for (const frag of fragmentsSorted) {
    types += `${exportInterfaceOrType(`${frag.name}Fragment`, typeToString(frag.value.type))}\n\n`;
    files.push({
      name: `fragments/${frag.name}.ts`,
      text: `export default ${JSON.stringify(stripIgnoredCharacters(print(frag.value.node)) + "\n")};`,
    });
  }

  for (const op of operationsSorted) {
    types += `${exportInterfaceOrType(op.name, typeToString(op.value.operation, 0, false))}\n\n`;
    types += `${exportInterfaceOrType(`${op.name}Variables`, typeToString(op.value.variables, 0, true))}\n\n`;
    types += `export interface ${op.name}Meta {\n`;
    types += `  __opType: ${op.name}, __opVariablesType: ${op.name}Variables, __tag: 'graphql-operation'\n`;
    types += `}\n\n`;
  }

  for (const op of operationsSorted) {
    const fragsFromOp: Dict<boolean> = {};
    extractFragmentDeps(op.value.node.selectionSet, fragsFromOp);
    const fragNames = _.keys(fragsFromOp).sort();
    const allDepImports: Dict<boolean> = {};
    const allDepNames: Dict<boolean> = {};
    for (const fragName of fragNames) {
      const deps: Dict<boolean> = {};
      addFragmentDepsRecursive(deps, [fragName], fragmentDeps, imports.loadedImportsMap);
      for (const dep of _.keys(deps).sort()) {
        const [path, name] = _.split(dep, ":", 2);
        allDepNames[name] = true;
        allDepImports[`import ${name} from "${mapPrefix(imports.prefixMap, path)}/fragments/${name}${jss}";`] = true;
      }
    }

    const depNames = _.keys(allDepNames).sort();
    const depImports = _.join(
      [..._.keys(allDepImports).sort(), `import type { ${op.name}Meta } from "../types${jss}";`],
      "\n"
    );
    const strings = _.join([...depNames, JSON.stringify(stripIgnoredCharacters(print(op.value.node)))], " + ");
    files.push({
      name: `operations/${op.name}.ts`,
      text: `${depImports}\nexport default (${strings}) as unknown as ${op.name}Meta;`,
    });
  }

  return {
    types,
    files,
  };
}

function writeFileIfChanged(writeLog: WriteLogFunc, path: string, content: string) {
  try {
    const data = fs.readFileSync(path, "utf8");
    if (data === content) {
      writeLog(`no changes in file "${path}"`);
      return;
    }
  } catch {}

  fs.writeFileSync(path, content, "utf8");
  writeLog(`writing data to file "${path}"`);
}

function addTokenMaybe(token: string | undefined) {
  return (req: superagent.SuperAgentRequest) => {
    if (token) req.set("Authorization", `Bearer ${token}`);
  };
}

async function fetchSchema(
  writeLog: WriteLogFunc,
  pathOrURL: string,
  token: string | undefined
): Promise<GraphQLSchema> {
  if (_.startsWith(pathOrURL, "https://")) {
    if (_.endsWith(pathOrURL, ".graphql")) {
      writeLog(`fetching schema from remote file "${pathOrURL}"`);
      const resp = await superagent.get(pathOrURL).http2().responseType("arraybuffer").send();
      const buf = resp.body as ArrayBuffer;
      return buildSchema(new TextDecoder().decode(buf));
    } else {
      writeLog(`fetching schema via introspection query from "${pathOrURL}"`);
      const introspectionQuery = getIntrospectionQuery({ descriptions: false, inputValueDeprecation: false });
      const resp = await superagent
        .post(pathOrURL)
        .http2()
        .accept("json")
        .use(addTokenMaybe(token))
        .send({ query: introspectionQuery });
      if (resp.body.errors) throw new Error(`failed fetching schema: ${resp.body.errors}`);
      return buildClientSchema(resp.body.data);
    }
  } else {
    writeLog(`loading schema from file "${pathOrURL}"`);
    const data = fs.readFileSync(pathOrURL, "utf8");
    return buildSchema(data);
  }
}

export interface GraphQLTypescriptCodegenConfig {
  directory: string;
  includes: string[];
  quiet: boolean;
  allowUnusedFragments: boolean;
  embedImports: boolean;
  schemaPathOrURL: string;
  schema: GraphQLSchema | undefined;
  token: string | undefined;
  jsSuffix?: boolean;
}

export async function graphqlTypescriptCodegen(config: GraphQLTypescriptCodegenConfig) {
  const writeLog = writeLogFunc(config.quiet);
  const tsPattern = path.join(config.directory, "**", "*.ts");
  const tsFilePaths = glob.sync(tsPattern);
  const tsFilePathsMap = _.fromPairs(_.map(tsFilePaths, (p) => [p, true]));
  const graphqlPattern = path.join(config.directory, "**", "*.graphql");
  const graphqlFilePaths = glob.sync(graphqlPattern);

  const sources: Source[] = [];
  const allImports: ImportSpec[] = [];
  for (const input of graphqlFilePaths) {
    writeLog(`loading graphql file "${input}"`);
    const src = loadGraphQLFromFile(input);
    allImports.push(...extractImportSpecs(src.body));
    if (src) sources.push(src);
  }

  const doc = concatAST(_.map(sources, (src) => parse(src)));
  const schema = config.schema || (await fetchSchema(writeLog, config.schemaPathOrURL, config.token));

  const imports = loadImports(allImports, config.includes, schema, config.embedImports);

  const additionalFragments: Dict<DocumentNode> = {};
  for (const imp of imports.loadedImports) {
    const deps: Dict<boolean> = {};
    addFragmentDepsRecursive(deps, [imp.name], imp.context.fragmentDeps, {});
    for (const dep in deps) {
      const [, name] = _.split(dep, ":", 2);
      const frag = nonNull(imp.context.fragments[name], `fragment: ${name}`);
      additionalFragments[name] = {
        kind: Kind.DOCUMENT,
        definitions: [frag.node],
      };
    }
  }

  validateDocument(schema, concatAST([doc, ..._.compact(_.values(additionalFragments))]), config.allowUnusedFragments);
  const data = generate(schema, doc, imports, config);
  for (const dir of [path.join(config.directory, "fragments"), path.join(config.directory, "operations")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  writeFileIfChanged(writeLog, path.join(config.directory, "types.ts"), data.types);
  delete tsFilePathsMap[`${config.directory}/types.ts`];
  for (const f of data.files) {
    writeFileIfChanged(writeLog, `${config.directory}/${f.name}`, f.text);
    delete tsFilePathsMap[`${config.directory}/${f.name}`];
  }
  const unusedFiles = _.keys(tsFilePathsMap).sort();
  if (unusedFiles.length > 0) {
    if (config.quiet) {
      for (const f of unusedFiles) {
        fs.renameSync(f, f + ".unused");
      }
    } else {
      writeLog(`the following files are no longer used:\n${_.join(unusedFiles, "\n")}`);
      const { confirmed } = await prompts({
        type: "confirm",
        name: "confirmed",
        message: `delete them?`,
        initial: false,
      });
      if (confirmed) {
        for (const f of unusedFiles) {
          writeLog(`deleting "${f}"`);
          fs.unlinkSync(f);
        }
      } else {
        for (const f of unusedFiles) {
          writeLog(`renaming "${f}" to "${f}.unused"`);
          fs.renameSync(f, f + ".unused");
        }
      }
    }
  }
}

export interface ContentModelTypescriptCodegenConfig {
  input: string[];
  output: string;
  quiet: boolean;
  api: string;
}

export async function contentModelTypescriptCodegen(config: ContentModelTypescriptCodegenConfig) {
  const writeLog = writeLogFunc(config.quiet);
  const schemas: ContentModelSchemaType[] = [];
  writeLog(`loading built-in content models from api: ${config.api}`);
  const resp = await superagent
    .post(config.api)
    .http2()
    .accept("json")
    .send([{ method: "GET", url: "info/content_models.json" }]);

  try {
    for (const data of resp.body[0].response) {
      const schema = parseContentModelSchema(data.json);
      writeLog(` - ${schema.name}`);
      schemas.push(schema);
    }
  } catch {
    // do nothing
  }

  for (const input of config.input) {
    writeLog(`loading content model schema from "${input}"`);
    const data = fs.readFileSync(input, "utf-8");
    const schema = parseContentModelSchema(data);
    schemas.push(schema);
  }
  writeLog(`generating typescript code`);
  const r = generateContentModelTypescriptCode(schemas);
  if (config.output === "-") {
    console.log(r);
  } else {
    writeFileIfChanged(writeLog, config.output, r);
  }
}
