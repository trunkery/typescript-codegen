#!/usr/bin/env node

import { Command } from "commander";
import _ from "lodash";
import { contentModelTypescriptCodegen, graphqlTypescriptCodegen } from "./lib";

const program = new Command().version("3.3.0", "-v, --version");

program
  .command("graphql <directory>")
  .option("-I, --include <directory...>", "consider the following directories when importing fragments")
  .option("-t, --token <token>", "jwt token for authorization")
  .option("-q, --quiet", "don't print anything but errors, don't ask for input")
  .option("--allow-unused-fragments", "allow and generate code for unused fragments")
  .option(
    "--schema <path-or-url>",
    "graphql schema, url if starts with https://, otherwise file path",
    "https://docs.trunkery.com/api/commerce-schema.graphql"
  )
  .action(async (directory, opts) => {
    await graphqlTypescriptCodegen({
      directory,
      includes: opts.include,
      quiet: !!opts.quiet,
      allowUnusedFragments: !!opts.allowUnusedFragments,
      embedImports: false,
      schemaPathOrURL: opts.schema,
      schema: undefined,
      token: opts.token,
    });
  });

program
  .command("content-model")
  .requiredOption("-i, --input <files...>", "input content model json file")
  .requiredOption("-o, --output <file>", "output typescript file to generate")
  .option("-q, --quiet", "don't print anything but errors, don't ask for input")
  .option("--api <url>", "json api url", "https://api.trunkery.com/relay.json")
  .action(async (opts) => {
    await contentModelTypescriptCodegen({
      input: opts.input,
      output: opts.output,
      quiet: !!opts.quiet,
      api: opts.api,
    });
  });

async function main() {
  await program.parseAsync(process.argv);
}

main();
