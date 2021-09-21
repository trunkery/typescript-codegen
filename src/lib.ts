#!/usr/bin/env node

import { Command } from "commander";
import _ from "lodash";
import fs from "fs";
import glob from "glob";
import path from "path";
import superagent from "superagent";
import {
  getIntrospectionQuery,
  concatAST,
  DocumentNode,
  GraphQLSchema,
  isEnumType,
  isInputObjectType,
  parse,
  Source,
  print,
  buildClientSchema,
  buildSchema,
} from "graphql";
import { stripIgnoredCharacters } from "graphql/utilities";
import {
  validateDocument,
  convertType,
  typeToString,
  enumToString,
  resolveTypesSorted,
  extractImportSpecs,
  ImportSpec,
  addFragmentDepsRecursive,
  loadGraphQLFromFile,
  loadImports,
  extractFragmentDeps,
  Imports,
} from "./typescript";
import { Dict, nonNull } from "./util";
import chalk from "chalk";
import prompts from "prompts";

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

function generate(schema: GraphQLSchema, doc: DocumentNode, imports: Imports) {
  const { usedNamedTypesSorted, fragmentsSorted, operationsSorted, fragments, fragmentDeps } = resolveTypesSorted(
    schema,
    doc,
    imports
  );

  let types = "";
  let files: GeneratedFile[] = [];

  if (imports.embedImports) {
    imports.loadedImportsMap = {};
  } else {
    for (const impName of _.keys(imports.loadedImportsMap).sort()) {
      const imp = nonNull(imports.loadedImportsMap[impName], "import");
      types += `import { ${imp.name}Fragment } from "${mapPrefix(imports.prefixMap, imp.path)}/types";\n\n`;
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
        allDepImports[`import ${name} from "${mapPrefix(imports.prefixMap, path)}/fragments/${name}";`] = true;
      }
    }

    const depNames = _.keys(allDepNames).sort();
    const depImports = _.join([..._.keys(allDepImports).sort(), `import { ${op.name}Meta } from "../types";`], "\n");
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
  } else {
    writeLog(`loading schema from file "${pathOrURL}"`);
    const data = fs.readFileSync(pathOrURL, "utf8");
    return buildSchema(data);
  }
}

export interface Config {
  directory: string;
  includes: string[];
  quiet: boolean;
  allowUnusedFragments: boolean;
  embedImports: boolean;
  schemaPathOrURL: string;
  schema: GraphQLSchema | undefined;
  token: string | undefined;
}

export async function graphqlTypescriptCodegen(config: Config) {
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
        kind: "Document",
        definitions: [frag.node],
      };
    }
  }

  validateDocument(schema, concatAST([doc, ..._.compact(_.values(additionalFragments))]), config.allowUnusedFragments);
  const data = generate(schema, doc, imports);
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
