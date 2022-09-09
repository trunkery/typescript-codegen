# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning][semantic versioning].

## [Unreleased]

---

## [Released]

## 3.2.0 - 2022-09-09

- Content model type generator will now fetch built-in content models from API server and add them to the output.
  This also adds "--api" option, which allows you to override API server URL (internal usage mainly).

## 3.1.1 - 2022-07-15

### Patch Changes

- Fix graphql codegen case: fragment uses fragment spread of a fragment which in turns also contains fragment spread.
  In internal codegen type system this generates an intersection with intersection type.

## 3.1.0 - 2022-06-10

### Minor Changes

- Add "color" string kind to content model.
- Export more content model schema components.

## 3.0.0 - 2022-06-08

### Major Changes

- Content Model generator: change the interface and output, it generates types
  and checkers for multiple schemas at once now. The idea is to make the path from
  content model name to content model type shorter.

## 2.1.0 - 2022-06-08

### Minor Changes

- Content Model generator: generate proper type for enums.

## 2.0.0 - 2022-05-31

### Major Changes

- Refactor the CLI interface to two subcommands: graphql, content-model.
- Add "content-model" codegen functionality.
- Use a slightly different changelog format.
- Bump third-party deps.

## 1.1.3 - 2021-09-21

### Patch Changes

- Fix minification producing broken GraphQL operations.

## 1.1.2 - 2021-09-21

### Patch Changes

- Minify graphql operations and fragments before writing them out.

## 1.1.1 - 2021-09-15

### Patch Changes

- Add typescript type definitions (.d.ts files).

## 1.1.0 - 2021-09-15

### Minor Changes

- Make it possible to use this project as a library.

## 1.0.1 - 2021-09-02

### Patch Changes

- Fix codegen for top level "intersection" types.

## 1.0.0 - 2021-03-29

### Major Changes

- Initial release.

---

<!-- Links -->

[semantic versioning]: https://semver.org/
