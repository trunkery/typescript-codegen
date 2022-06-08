#!/usr/bin/env node

import { Command } from "commander";
import _ from "lodash";
import { contentModelTypescriptCodegen, graphqlTypescriptCodegen } from "./lib";

const program = new Command().version("2.0.0", "-v, --version");

program
  .command("graphql <directory>")
  .option("-I, --include <directory...>", "consider the following directories when importing fragments")
  .option("-t, --token <token>", "jwt token for authorization")
  .option("-q, --quiet", "don't print anything but errors, don't ask for input")
  .option("--allow-unused-fragments", "allow and generate code for unused fragments")
  .option(
    "--schema <path-or-url>",
    "graphql schema, url if starts with https://, otherwise file path",
    "https://api.trunkery.com/storefront.json"
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
  .action(async (opts) => {
    await contentModelTypescriptCodegen({
      input: opts.input,
      output: opts.output,
      quiet: !!opts.quiet,
    });
  });

async function main() {
  await program.parseAsync(process.argv);
}

main();
