# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning][semantic versioning].

## [Unreleased]

---

## [Released]

## 3.4.0 - 2023-08-31

### Minor Changes

- Generating import statements ending with ".js" is now hidden behind a flag/option. I rushed to make it a default, but
  it breaks some projects.

---

## 3.3.3 - 2023-08-31

### Patch Changes

- GraphQL code generator now generates type imports as "import type", to be friendlier with stricter typescript configs.

---

## 3.3.2 - 2023-08-31

### Patch Changes

- GraphQL code generator now generates .ts files with import statements ending with ".js", to make things compatible
  with ESM style output.

---

## 3.3.1 - 2023-08-30

### Patch Changes

- Commerce API schema file became the default by accident. Corrected the URL. Storefront API schema file is the default
  now.

---

## 3.3.0 - 2023-08-30

### Minor Changes

- Since recently we disabled introspection queries on our API servers. And this was the main source of the graphql
  schemas for this tool. This patch adds support for raw remote .graphql files. Our docs website host those files with
  up-to-date schemas. Thus this patch also changes the default schema URL.

---

## 3.2.0 - 2022-09-09

### Minor Changes

- Content model type generator will now fetch built-in content models from API server and add them to the output.
  This also adds "--api" option, which allows you to override API server URL (internal usage mainly).

---

## 3.1.1 - 2022-07-15

### Patch Changes

- Fix graphql codegen case: fragment uses fragment spread of a fragment which in turns also contains fragment spread.
  In internal codegen type system this generates an intersection with intersection type.

---

## 3.1.0 - 2022-06-10

### Minor Changes

- Add "color" string kind to content model.
- Export more content model schema components.

---

## 3.0.0 - 2022-06-08

### Major Changes

- Content Model generator: change the interface and output, it generates types
  and checkers for multiple schemas at once now. The idea is to make the path from
  content model name to content model type shorter.

---

## 2.1.0 - 2022-06-08

### Minor Changes

- Content Model generator: generate proper type for enums.

---

## 2.0.0 - 2022-05-31

### Major Changes

- Refactor the CLI interface to two subcommands: graphql, content-model.
- Add "content-model" codegen functionality.
- Use a slightly different changelog format.
- Bump third-party deps.

---

## 1.1.3 - 2021-09-21

### Patch Changes

- Fix minification producing broken GraphQL operations.

---

## 1.1.2 - 2021-09-21

### Patch Changes

- Minify graphql operations and fragments before writing them out.

---

## 1.1.1 - 2021-09-15

### Patch Changes

- Add typescript type definitions (.d.ts files).

---

## 1.1.0 - 2021-09-15

### Minor Changes

- Make it possible to use this project as a library.

---

## 1.0.1 - 2021-09-02

### Patch Changes

- Fix codegen for top level "intersection" types.

---

## 1.0.0 - 2021-03-29

### Major Changes

- Initial release.

---

<!-- Links -->

[semantic versioning]: https://semver.org/
