#!/usr/bin/env node

import { Command } from "commander";
import _ from "lodash";
import { graphqlTypescriptCodegen } from "./lib";

const program = new Command()
  .version("1.1.0", "-v, --version")
  .arguments("<directory>")
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

async function main() {
  await program.parseAsync(process.argv);
}

main();
