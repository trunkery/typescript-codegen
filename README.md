# Lana Typescript Codegen

A CLI tool for generating typescript code based on graphql fragments/operations. It does not support all GraphQL features, in particular support for subscriptions is missing.

## How it works?

The tool works on a target directory. It scans the directory for \*.graphql files, then based on fragments/operations defined in those files it generates a bunch of typescript files. The resulting directory structure looks like this (in addition to \*.graphql files):

```
<target directory>
├── fragments
│   └── <fragment-name>.ts
├── operations
│   └── <operation-name>.ts
└── types.ts

```

- **types.ts** - Contains all type definitions, tool doesn't use the .d.ts file, because all type definitions are scoped to that file.
- **fragments/&lt;fragment-name&gt;.ts** - Contains a definition for a single graphql fragment as a default exported string. Example:
  ```typescript
  export default "fragment MenuShort on StorefrontMenu {\n  id\n  name\n}\n";
  ```
- **operations/&lt;operation-name&gt;.ts** - Contains a definition for a sngle graphql operation as a default exported string, but with a type overload. The file includes and prepends all used fragments as well. Example:
  ```typescript
  import MenuShort from "../fragments/MenuShort";
  import { GetMenuQueryMeta } from "../types";
  export default ((MenuShort +
    "query GetMenu($shopID: String!, $id: String!) {\n  storefrontMenus(shop_id: $shopID, ids: [$id]) {\n    ...MenuShort\n  }\n}") as unknown) as GetMenuQueryMeta;
  ```

This structure makes it webpack friendly. You only include what you use, and every fragment body is included exactly once.

The **types.ts** file mentioned above in addition to fragment type definitions contains meta types for operation definitions of the following form:

```typescript
export interface GetMenuQuery {
  storefrontMenus: Array<MenuShortFragment> | null;
}

export interface GetMenuQueryVariables {
  id: string;
  shopID: string;
}

export interface GetMenuQueryMeta {
  __opType: GetMenuQuery;
  __opVariablesType: GetMenuQueryVariables;
  __tag: "graphql-operation";
}
```

The operation itself is type casted to its \*Meta type. This allows you to build request handlers which are aware of both: the result of the operation and the variables the operation expects as input.

## Usage

1. Install the tool locally or globally:

   ```shell
   # local installation:
   npm install -D @lana-commerce/typescript-codegen

   # global installation:
   npm install -g @lana-commerce/typescript-codegen
   ```

2. Create a directory with some \*.graphql files in it.

   ```shell
   mkdir -p src/graphql
   ```

   Write down some graphql fragments/queries to `src/graphql/all.graphql`. It's up to you how you want to organize your graphql files. It could be `all.graphql` or `fragments.graphql`/`operations.graphql` or something else. The tool will load all graphql files.

   ```graphql
   fragment MenuShort on StorefrontMenu {
     id
     name
   }

   query GetMenu($shopID: String!, $id: String!) {
     storefrontMenus(shop_id: $shopID, ids: [$id]) {
       ...MenuShort
     }
   }
   ```

3. Run the tool! (example assumes global installation and proper PATH configuration)

   ```sh
   lana-commerce-typescript-codegen src/graphql
   ```

   You should see something like this:

   ```
   [14:06:01.051] loading graphql file "src/graphql/all.graphql"
   [14:06:01.055] fetching schema via introspection query from "https://api.lana.dev/storefront.json"
   [14:06:01.534] writing data to file "src/graphql/types.ts"
   [14:06:01.535] writing data to file "src/graphql/fragments/MenuShort.ts"
   [14:06:01.535] writing data to file "src/graphql/operations/GetMenuQuery.ts"
   ```

## Include fragments from other packages

To boost data reuse even further, the tool allows you to import fragment definitions from other packages.

TODO: how to include packages from other files?
