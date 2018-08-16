// @flow
import * as fs from "fs";
import {
  defaultPlugins,
  getBuilder,
  Plugin,
  Options,
  SchemaListener,
  Build,
  Context,
  SchemaBuilder
} from "graphile-build";
import { GraphQLSchema } from "graphql";
import {
  defaultPlugins as pgDefaultPlugins,
  inflections,
  Inflector,
  PgAttribute
} from "graphile-build-pg";
import { Pool, Client } from "pg";

type mixed = {} | string | number | boolean | undefined | null;

const ensureValidPlugins = (name: string, arr: Array<Plugin>) => {
  if (!Array.isArray(arr)) {
    throw new Error(`Option '${name}' should be an array`);
  }
  for (let i = 0, l = arr.length; i < l; i++) {
    const fn = arr[i];
    if (typeof fn !== "function") {
      throw new Error(
        `Option '${name}' should be an array of functions, found '${
          fn == null ? String(fn) : typeof fn
        }' at index ${i}`
      );
    }
  }
};

type PostGraphileOptions = {
  dynamicJson?: boolean;
  classicIds?: boolean;
  disableDefaultMutations?: string;
  nodeIdFieldName?: string;
  graphileBuildOptions?: Options;
  graphqlBuildOptions?: Options; // DEPRECATED!
  replaceAllPlugins?: Array<Plugin>;
  appendPlugins?: Array<Plugin>;
  prependPlugins?: Array<Plugin>;
  skipPlugins?: Array<Plugin>;
  jwtPgTypeIdentifier?: string;
  jwtSecret?: string;
  inflector?: Inflector; // NO LONGER SUPPORTED!
  pgColumnFilter?: <TSource>(
    attr: mixed,
    build: Build,
    context: Context<TSource>
  ) => boolean;
  viewUniqueKey?: string;
  enableTags?: boolean;
  readCache?: string;
  writeCache?: string;
  setWriteCacheCallback?: (fn: () => Promise<void>) => void;
  legacyRelations?: "only" | "deprecated" | "omit";
  setofFunctionsContainNulls?: boolean;
  legacyJsonUuid?: boolean;
  simpleCollections?: "only" | "both" | "omit";
  includeExtensionResources?: boolean;
  ignoreRBAC?: boolean;
};

type PgConfig = Client | Pool | string;

/*
 * BELOW HERE IS DEPRECATED!!
 */
export { inflections };

export const postGraphileBaseOverrides = {
  enumName(value: string) {
    return inflections.defaultUtils.constantCase(
      inflections.defaultInflection.enumName(value)
    );
  }
};

export const postGraphileClassicIdsOverrides = {
  column(name: string, _table: string, _schema?: string) {
    return name === "id" ? "rowId" : inflections.defaultUtils.camelCase(name);
  }
};

export const postGraphileInflection = inflections.newInflector(
  postGraphileBaseOverrides
);

export const postGraphileClassicIdsInflection = inflections.newInflector(
  Object.assign({}, postGraphileBaseOverrides, postGraphileClassicIdsOverrides)
);
/*
 * ABOVE HERE IS DEPRECATED.
 */

export const PostGraphileInflectionPlugin = function(builder: SchemaBuilder) {
  builder.hook("inflection", (inflection: object) => {
    const previous = inflection["enumName"];
    return {
      ...inflection,
      enumName(value: string) {
        return this.constantCase(previous.call(this, value));
      }
    };
  });
} as Plugin;

export const PostGraphileClassicIdsInflectionPlugin = function(
  builder: SchemaBuilder
) {
  builder.hook("inflection", (inflection: object) => {
    const previous = inflection["_columnName"];
    return {
      ...inflection,
      _columnName(attr: PgAttribute, options: { skipRowId?: boolean }) {
        const previousValue = previous.call(this, attr, options);
        return (options && options.skipRowId) || previousValue !== "id"
          ? previousValue
          : this.camelCase("rowId");
      }
    };
  });
} as Plugin;

const awaitKeys = async (obj: { [key: string]: Promise<any> }) => {
  const result = {};
  for (const k in obj) {
    result[k] = await obj[k];
  }
  return result;
};

const getPostGraphileBuilder = async (
  pgConfig: PgConfig,
  schemas: string | Array<string>,
  options: PostGraphileOptions = {}
) => {
  const {
    dynamicJson,
    classicIds,
    nodeIdFieldName,
    replaceAllPlugins,
    appendPlugins = [],
    prependPlugins = [],
    skipPlugins = [],
    jwtPgTypeIdentifier,
    jwtSecret,
    disableDefaultMutations,
    graphileBuildOptions,
    graphqlBuildOptions, // DEPRECATED!
    inflector, // NO LONGER SUPPORTED!
    pgColumnFilter,
    viewUniqueKey,
    enableTags = true,
    readCache,
    writeCache,
    setWriteCacheCallback,
    legacyRelations = "deprecated", // TODO: Change to 'omit' in v5
    setofFunctionsContainNulls = true,
    legacyJsonUuid = false,
    simpleCollections = "omit",
    includeExtensionResources = false,
    ignoreRBAC = true // TODO: Change to 'false' in v5
  } = options;

  if (
    legacyRelations &&
    ["only", "deprecated", "omit"].indexOf(legacyRelations) < 0
  ) {
    throw new Error(
      "Invalid configuration for legacy relations: " +
        JSON.stringify(legacyRelations)
    );
  }
  if (
    simpleCollections &&
    ["only", "both", "omit"].indexOf(simpleCollections) < 0
  ) {
    throw new Error(
      "Invalid configuration for simple collections: " +
        JSON.stringify(simpleCollections)
    );
  }
  if (replaceAllPlugins) {
    ensureValidPlugins("replaceAllPlugins", replaceAllPlugins);
    if (
      (prependPlugins && prependPlugins.length) ||
      (appendPlugins && appendPlugins.length)
    ) {
      throw new Error(
        "When using 'replaceAllPlugins' you must not specify 'appendPlugins'/'prependPlugins'"
      );
    }
  }
  if (readCache && writeCache) {
    throw new Error("Use `readCache` or `writeCache` - not both.");
  }

  let persistentMemoizeWithKey = undefined; // NOT null, otherwise it won't default correctly.
  let memoizeCache = {};

  if (readCache) {
    const cacheString: string = await new Promise<string>((resolve, reject) => {
      fs.readFile(readCache, "utf8", (err?: Error, data?: string) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
    memoizeCache = JSON.parse(cacheString);
  }
  if (readCache || writeCache) {
    persistentMemoizeWithKey = (key: string, fn: () => any) => {
      if (!(key in memoizeCache)) {
        if (readCache) {
          throw new Error(`Expected cache to contain key: ${key}`);
        }
        memoizeCache[key] = fn();
        if (memoizeCache[key] === undefined) {
          throw new Error(`Cannot memoize 'undefined' - use 'null' instead`);
        }
      }
      return memoizeCache[key];
    };
  }

  if (writeCache && setWriteCacheCallback) {
    setWriteCacheCallback(() =>
      awaitKeys(memoizeCache).then(
        obj =>
          new Promise<void>((resolve, reject) => {
            fs.writeFile(writeCache, JSON.stringify(obj), err => {
              memoizeCache = {};
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          })
      )
    );
  } else if (writeCache) {
    throw new Error("Cannot write cache without 'setWriteCacheCallback'");
  } else if (setWriteCacheCallback) {
    setWriteCacheCallback(() => Promise.resolve());
  }

  ensureValidPlugins("prependPlugins", prependPlugins);
  ensureValidPlugins("appendPlugins", appendPlugins);
  ensureValidPlugins("skipPlugins", skipPlugins);
  if (inflector) {
    throw new Error(
      "Custom inflector arguments are no longer supported, please use the inflector plugin API instead"
    );
  }
  const inflectionOverridePlugins = classicIds
    ? [PostGraphileInflectionPlugin, PostGraphileClassicIdsInflectionPlugin]
    : [PostGraphileInflectionPlugin];
  return getBuilder(
    (replaceAllPlugins
      ? [
          ...prependPlugins,
          ...replaceAllPlugins,
          ...inflectionOverridePlugins,
          ...appendPlugins
        ]
      : [
          ...prependPlugins,
          ...defaultPlugins,
          ...pgDefaultPlugins,
          ...inflectionOverridePlugins,
          ...appendPlugins
        ]
    ).filter(p => skipPlugins.indexOf(p) === -1),
    Object.assign(
      {
        pgConfig: pgConfig,
        pgSchemas: Array.isArray(schemas) ? schemas : [schemas],
        pgExtendedTypes: !!dynamicJson,
        pgColumnFilter: pgColumnFilter || (() => true),
        pgInflection:
          inflector ||
          (classicIds
            ? postGraphileClassicIdsInflection
            : postGraphileInflection),
        nodeIdFieldName: nodeIdFieldName || (classicIds ? "id" : "nodeId"),
        pgJwtTypeIdentifier: jwtPgTypeIdentifier,
        pgJwtSecret: jwtSecret,
        pgDisableDefaultMutations: disableDefaultMutations,
        pgViewUniqueKey: viewUniqueKey,
        pgEnableTags: enableTags,
        pgLegacyRelations: legacyRelations,
        pgLegacyJsonUuid: legacyJsonUuid,
        persistentMemoizeWithKey,
        pgForbidSetofFunctionsToReturnNull: !setofFunctionsContainNulls,
        pgSimpleCollections: simpleCollections,
        pgIncludeExtensionResources: includeExtensionResources,
        pgIgnoreRBAC: ignoreRBAC
      },
      graphileBuildOptions,
      graphqlBuildOptions // DEPRECATED!
    )
  );
};

function abort(e: Error) {
  /* eslint-disable no-console */
  console.error("Error occured whilst writing cache");
  console.error(e);
  process.exit(1);
  /* eslint-enable */
}

export const createPostGraphileSchema = async (
  pgConfig: PgConfig,
  schemas: Array<string> | string,
  options: PostGraphileOptions = {}
) => {
  let writeCache: undefined | (() => Promise<void>);
  const builder = await getPostGraphileBuilder(
    pgConfig,
    schemas,
    Object.assign({}, options, {
      setWriteCacheCallback(fn: () => Promise<void>) {
        writeCache = fn;
      }
    })
  );
  const schema = builder.buildSchema();
  if (writeCache) writeCache().catch(abort);
  return schema;
};

/*
 * Unless an error occurs, `onNewSchema` is guaranteed to be called before this promise resolves
 */
export const watchPostGraphileSchema = async (
  pgConfig: PgConfig,
  schemas: Array<string> | string,
  options: PostGraphileOptions = {},
  onNewSchema: SchemaListener
) => {
  if (typeof onNewSchema !== "function") {
    throw new Error(
      "You cannot call watchPostGraphileSchema without a function to pass new schemas to"
    );
  }
  if (options.readCache) {
    throw new Error("Using readCache in watch mode does not make sense.");
  }
  let writeCache: undefined | (() => Promise<void>);
  const builder = await getPostGraphileBuilder(
    pgConfig,
    schemas,
    Object.assign({}, options, {
      setWriteCacheCallback(fn: () => Promise<void>) {
        writeCache = fn;
      }
    })
  );
  let released = false;
  function handleNewSchema(schema: GraphQLSchema) {
    if (writeCache) writeCache().catch(abort);
    onNewSchema(schema);
  }
  await builder.watchSchema(handleNewSchema);

  return async function release() {
    if (released) return;
    released = true;
    await builder.unwatchSchema();
  };
};

// Backwards compat
export const postGraphQLBaseOverrides = postGraphileBaseOverrides;
export const postGraphQLClassicIdsOverrides = postGraphileClassicIdsOverrides;
export const postGraphQLInflection = postGraphileInflection;
export const postGraphQLClassicIdsInflection = postGraphileClassicIdsInflection;
export const createPostGraphQLSchema = createPostGraphileSchema;
export const watchPostGraphQLSchema = watchPostGraphileSchema;
