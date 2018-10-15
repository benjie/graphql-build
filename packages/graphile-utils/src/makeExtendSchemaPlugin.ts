import { SchemaBuilder, Build, Context, Plugin, Options } from "graphile-build";
import { QueryBuilder, SQL, PgClass } from "graphile-build-pg";
import {
  // ONLY import types here, not values
  // Misc:
  GraphQLIsTypeOfFn,

  // Resolvers:
  GraphQLFieldResolver,
  GraphQLTypeResolver,
  GraphQLResolveInfo,

  // Union types:
  GraphQLType,
  GraphQLNamedType,

  // Config:
  GraphQLEnumValueConfigMap,
  GraphQLFieldConfigMap,
  GraphQLInputFieldConfigMap,

  // Nodes:
  DirectiveNode,
  DocumentNode,
  EnumValueDefinitionNode,
  FieldDefinitionNode,
  InputValueDefinitionNode,
  NameNode,
  NamedTypeNode,
  ObjectTypeExtensionNode,
  StringValueNode,
  TypeNode,
  ValueNode,
} from "graphql";
import { GraphileEmbed } from "./gql";
// tslint:disable-next-line
import { InputObjectTypeExtensionNode } from "graphql/language/ast";

export type AugmentedGraphQLFieldResolver<
  TSource,
  TContext,
  TArgs = { [argName: string]: any }
> = (
  parent: TSource,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo,
  graphileHelpers: GraphileHelpers<TSource>
) => any;

export interface ObjectFieldResolver<TSource = any, TContext = any> {
  resolve?: AugmentedGraphQLFieldResolver<TSource, TContext>;
  subscribe?: AugmentedGraphQLFieldResolver<TSource, TContext>;
  __resolveType?: GraphQLTypeResolver<TSource, TContext>;
  __isTypeOf?: GraphQLIsTypeOfFn<TSource, TContext>;
}

export interface ObjectResolver<TSource = any, TContext = any> {
  [key: string]:
    | AugmentedGraphQLFieldResolver<TSource, TContext>
    | ObjectFieldResolver<TSource, TContext>;
}

export interface EnumResolver {
  [key: string]: string | number | Array<any> | object | symbol;
}

export interface Resolvers<TSource = any, TContext = any> {
  [key: string]: ObjectResolver<TSource, TContext> | EnumResolver;
}

export interface ExtensionDefinition {
  typeDefs: DocumentNode;
  resolvers: Resolvers;
}

interface NewTypeDef {
  type: GraphQLType;
  definition: any;
}

export default function makeExtendSchemaPlugin(
  generator: ((build: Build, schemaOptions: Options) => ExtensionDefinition),
  uniqueId = String(Math.random()).substr(2)
): Plugin {
  return (builder: SchemaBuilder, schemaOptions: Options): void => {
    // Add stuff to the schema
    builder.hook("build", build => {
      const {
        graphql: { GraphQLEnumType, GraphQLInputObjectType, GraphQLObjectType },
      } = build;
      const { typeDefs, resolvers } = generator(build, schemaOptions);
      if (!(typeDefs as any) || (typeDefs as any).kind !== "Document") {
        throw new Error(
          "The first argument to makeExtendSchemaPlugin must be generated by the `gql` helper"
        );
      }
      const typeExtensions = {
        GraphQLInputObjectType: {},
        GraphQLObjectType: {},
      };
      const newTypes: Array<NewTypeDef> = [];
      typeDefs.definitions.forEach(definition => {
        if (definition.kind === "EnumTypeDefinition") {
          newTypes.push({
            type: GraphQLEnumType,
            definition,
          });
        } else if (definition.kind === "ObjectTypeExtension") {
          const name = getName(definition.name);
          if (!typeExtensions.GraphQLObjectType[name]) {
            typeExtensions.GraphQLObjectType[name] = [];
          }
          typeExtensions.GraphQLObjectType[name].push(definition);
        } else if (definition.kind === "InputObjectTypeExtension") {
          const name = getName(definition.name);
          if (!typeExtensions.GraphQLInputObjectType[name]) {
            typeExtensions.GraphQLInputObjectType[name] = [];
          }
          typeExtensions.GraphQLInputObjectType[name].push(definition);
        } else if (definition.kind === "ObjectTypeDefinition") {
          newTypes.push({
            type: GraphQLObjectType,
            definition,
          });
        } else if (definition.kind === "InputObjectTypeDefinition") {
          newTypes.push({
            type: GraphQLInputObjectType,
            definition,
          });
        } else {
          if ((definition.kind as any) === "TypeExtensionDefinition") {
            throw new Error(
              `You appear to be using a GraphQL version prior to v0.12.0 which has different syntax for schema extensions (e.g. 'TypeExtensionDefinition' instead of 'ObjectTypeExtension'). Sadly makeExtendSchemaPlugin does not support versions of graphql prior to 0.12.0, please update your version of graphql.`
            );
          }
          throw new Error(
            `Unexpected '${
              definition.kind
            }' definition; we were expecting 'GraphQLEnumType', 'ObjectTypeExtension', 'InputObjectTypeExtension', 'ObjectTypeDefinition' or 'InputObjectTypeDefinition', i.e. something like 'extend type Foo { ... }'`
          );
        }
      });
      return build.extend(build, {
        [`ExtendSchemaPlugin_${uniqueId}_typeExtensions`]: typeExtensions,
        [`ExtendSchemaPlugin_${uniqueId}_newTypes`]: newTypes,
        [`ExtendSchemaPlugin_${uniqueId}_resolvers`]: resolvers,
      });
    });

    builder.hook("init", (_, build, _context) => {
      const {
        newWithHooks,
        [`ExtendSchemaPlugin_${uniqueId}_newTypes`]: newTypes,
        [`ExtendSchemaPlugin_${uniqueId}_resolvers`]: resolvers,
        graphql: { GraphQLEnumType, GraphQLObjectType, GraphQLInputObjectType },
      } = build;
      newTypes.forEach(({ type, definition }: NewTypeDef) => {
        if (type === GraphQLEnumType) {
          // https://graphql.org/graphql-js/type/#graphqlenumtype
          const name = getName(definition.name);
          const description = getDescription(definition.description);
          const directives = getDirectives(definition.directives);
          const relevantResolver = resolvers[name] || {};
          const values: GraphQLEnumValueConfigMap = definition.values.reduce(
            (
              memo: GraphQLEnumValueConfigMap,
              value: EnumValueDefinitionNode
            ) => {
              const valueName = getName(value.name);
              const valueDescription = getDescription(value.description);
              const valueDirectives = getDirectives(value.directives);

              // Value cannot be expressed via SDL, so we grab the value from the resolvers instead.
              // resolvers = {
              //   MyEnum: {
              //     MY_ENUM_VALUE1: 'value1',
              //     MY_ENUM_VALUE2: 'value2',
              //   }
              // }
              // Ref: https://github.com/graphql/graphql-js/issues/525#issuecomment-255834625
              const valueValue =
                relevantResolver[valueName] !== undefined
                  ? relevantResolver[valueName]
                  : valueName;

              const valueDeprecationReason =
                valueDirectives.deprecated && valueDirectives.deprecated.reason;
              return {
                ...memo,
                [valueName]: {
                  value: valueValue,
                  deprecationReason: valueDeprecationReason,
                  description: valueDescription,
                  directives: valueDirectives,
                },
              };
            },
            {}
          );
          const scope = {
            directives,
            ...(directives.scope || {}),
          };
          newWithHooks(type, { name, values, description }, scope);
        } else if (type === GraphQLObjectType) {
          // https://graphql.org/graphql-js/type/#graphqlobjecttype
          const name = getName(definition.name);
          const description = getDescription(definition.description);
          const interfaces = getInterfaces(definition.interfaces, build);
          const directives = getDirectives(definition.directives);
          const scope = {
            __origin: `makeExtendSchemaPlugin`,
            directives,
            ...(directives.scope || {}),
          };
          newWithHooks(
            type,
            {
              name,
              interfaces,
              fields: (fieldsContext: {
                Self: typeof type;
                fieldWithHooks: any;
              }) =>
                getFields(
                  fieldsContext.Self,
                  definition.fields,
                  resolvers,
                  fieldsContext,
                  build
                ),
              ...(description
                ? {
                    description,
                  }
                : null),
            },
            scope
          );
        } else if (type === GraphQLInputObjectType) {
          // https://graphql.org/graphql-js/type/#graphqlinputobjecttype
          const name = getName(definition.name);
          const description = getDescription(definition.description);
          const directives = getDirectives(definition.directives);
          const scope = {
            __origin: `makeExtendSchemaPlugin`,
            directives,
            ...(directives.scope || {}),
          };
          newWithHooks(
            type,
            {
              name,
              fields: ({ Self }: { Self: typeof type }) =>
                getInputFields(Self, definition.fields, build),
              ...(description
                ? {
                    description,
                  }
                : null),
            },
            scope
          );
        } else {
          throw new Error(
            `We have no code to build an object of type '${type}'; it should not have reached this area of the code.`
          );
        }
      });
      return _;
    });

    builder.hook("GraphQLObjectType:fields", (fields, build, context: any) => {
      const {
        extend,
        [`ExtendSchemaPlugin_${uniqueId}_typeExtensions`]: typeExtensions,
        [`ExtendSchemaPlugin_${uniqueId}_resolvers`]: resolvers,
      } = build;
      const { Self } = context;
      if (typeExtensions.GraphQLObjectType[Self.name]) {
        const newFields = typeExtensions.GraphQLObjectType[Self.name].reduce(
          (
            memo: GraphQLFieldConfigMap<any, any>,
            extension: ObjectTypeExtensionNode
          ) => {
            const moreFields = getFields(
              Self,
              extension.fields,
              resolvers,
              context,
              build
            );
            return extend(memo, moreFields);
          },
          {}
        );
        return extend(fields, newFields);
      } else {
        return fields;
      }
    });

    builder.hook("GraphQLInputObjectType:fields", (fields, build, context) => {
      const {
        extend,
        [`ExtendSchemaPlugin_${uniqueId}_typeExtensions`]: typeExtensions,
      } = build;
      const { Self } = context;
      if (typeExtensions.GraphQLInputObjectType[Self.name]) {
        const newFields = typeExtensions.GraphQLInputObjectType[
          Self.name
        ].reduce(
          (
            memo: GraphQLInputFieldConfigMap,
            extension: InputObjectTypeExtensionNode
          ) => {
            const moreFields = getInputFields(Self, extension.fields, build);
            return extend(memo, moreFields);
          },
          {}
        );
        return extend(fields, newFields);
      } else {
        return fields;
      }
    });
  };
}

function getName(name: NameNode) {
  if (name && name.kind === "Name" && name.value) {
    return name.value;
  }
  throw new Error("Could not extract name from AST");
}

function getDescription(desc: StringValueNode | void) {
  if (!desc) {
    return null;
  } else if (desc.kind === "StringValue") {
    return desc.value;
  } else {
    throw new Error(
      `AST issue, we weren't expecting a description of kind '${
        desc.kind
      }' - PRs welcome!`
    );
  }
}

function getType(type: TypeNode, build: Build): GraphQLType {
  if (type.kind === "NamedType") {
    const Type = build.getTypeByName(getName(type.name));
    if (!Type) {
      throw new Error(`Could not find type named '${getName(type.name)}'.`);
    }
    return Type;
  } else if (type.kind === "NonNullType") {
    return new build.graphql.GraphQLNonNull(getType(type.type, build));
  } else if (type.kind === "ListType") {
    return new build.graphql.GraphQLList(getType(type.type, build));
  } else {
    throw new Error(
      `We don't support AST type definition of kind '${
        (type as any).kind
      }' yet... PRs welcome!`
    );
  }
}

function getInterfaces(
  interfaces: ReadonlyArray<NamedTypeNode>,
  _build: Build
) {
  if (interfaces.length) {
    throw new Error(
      `We don't support interfaces via makeExtendSchemaPlugin yet; PRs welcome!`
    );
  }
  return [];
}

function getValue(
  value: ValueNode | GraphileEmbed
):
  | boolean
  | string
  | number
  | null
  | Array<boolean | string | number | null>
  | any {
  if (value.kind === "BooleanValue") {
    return !!value.value;
  } else if (value.kind === "StringValue") {
    return value.value;
  } else if (value.kind === "IntValue") {
    return parseInt(value.value, 10);
  } else if (value.kind === "FloatValue") {
    return parseFloat(value.value);
  } else if (value.kind === "NullValue") {
    return null;
  } else if (value.kind === "ListValue") {
    return value.values.map(getValue);
  } else if (value.kind === "GraphileEmbed") {
    // RAW!
    return value.value;
  } else {
    throw new Error(
      `Value kind '${value.kind}' not supported yet. PRs welcome!`
    );
  }
}

interface DirectiveMap {
  [directiveName: string]: {
    [directiveArgument: string]: any;
  };
}

function getDirectives(
  directives: ReadonlyArray<DirectiveNode> | void
): DirectiveMap {
  return (directives || []).reduce((directivesList, directive) => {
    if (directive.kind === "Directive") {
      const name = getName(directive.name);
      const value = (directive.arguments || []).reduce(
        (argumentValues, arg) => {
          if (arg.kind === "Argument") {
            const argName = getName(arg.name);
            const argValue = getValue(arg.value);
            if (argumentValues[name]) {
              throw new Error(
                `Argument '${argName}' of directive '${name}' must only be used once.`
              );
            }
            argumentValues[argName] = argValue;
          } else {
            throw new Error(
              `Unexpected '${arg.kind}', we were expecting 'Argument'`
            );
          }
          return argumentValues;
        },
        {}
      );
      if (directivesList[name]) {
        throw new Error(
          `Directive '${name}' must only be used once per field.`
        );
      }
      directivesList[name] = value;
    } else {
      throw new Error(
        `Unexpected '${directive.kind}', we were expecting 'Directive'`
      );
    }
    return directivesList;
  }, {});
}

function getArguments(
  args: ReadonlyArray<InputValueDefinitionNode> | void,
  build: Build
) {
  if (args && args.length) {
    return args.reduce((memo, arg) => {
      if (arg.kind === "InputValueDefinition") {
        const name = getName(arg.name);
        const type = getType(arg.type, build);
        const description = getDescription(arg.description);
        let defaultValue;
        if (arg.defaultValue) {
          defaultValue = getValue(arg.defaultValue);
        }
        memo[name] = {
          type,
          ...(defaultValue ? { defaultValue } : null),
          ...(description ? { description } : null),
        };
      } else {
        throw new Error(
          `Unexpected '${
            arg.kind
          }', we were expecting an 'InputValueDefinition'`
        );
      }
      return memo;
    }, {});
  }
  return {};
}

export type SelectGraphQLResultFromTable = (
  tableFragment: SQL,
  builderCallback: (alias: SQL, sqlBuilder: QueryBuilder) => void
) => Promise<any>;

export type GraphileHelpers<TSource> = Context<TSource> & {
  selectGraphQLResultFromTable: SelectGraphQLResultFromTable;
};

function getFields<TSource>(
  SelfGeneric: TSource,
  fields: ReadonlyArray<FieldDefinitionNode> | void,
  resolvers: Resolvers,
  {
    fieldWithHooks,
  }: {
    fieldWithHooks: any;
  },
  build: Build
) {
  if (!build.graphql.isNamedType(SelfGeneric)) {
    throw new Error("getFields only supports named types");
  }
  const Self: GraphQLNamedType = SelfGeneric as any;
  const { parseResolveInfo, pgQueryFromResolveData, pgSql: sql } = build;
  function augmentResolver(
    resolver: AugmentedGraphQLFieldResolver<TSource, any>,
    fieldContext: Context<TSource>
  ) {
    const { getDataFromParsedResolveInfoFragment } = fieldContext;
    const newResolver: GraphQLFieldResolver<TSource, any> = (
      parent,
      args,
      context,
      resolveInfo
    ) => {
      const selectGraphQLResultFromTable: SelectGraphQLResultFromTable = async (
        tableFragment: SQL,
        builderCallback: (alias: SQL, sqlBuilder: QueryBuilder) => void
      ) => {
        const { pgClient } = context;
        const parsedResolveInfoFragment = parseResolveInfo(resolveInfo);
        const PayloadType = resolveInfo.returnType;
        const resolveData = getDataFromParsedResolveInfoFragment(
          parsedResolveInfoFragment,
          PayloadType
        );
        const tableAlias = sql.identifier(Symbol());
        const query = pgQueryFromResolveData(
          tableFragment,
          tableAlias,
          resolveData,
          {},
          (sqlBuilder: QueryBuilder) => builderCallback(tableAlias, sqlBuilder)
        );
        const { text, values } = sql.compile(query);
        const { rows } = await pgClient.query(text, values);
        return rows;
      };
      return resolver(parent, args, context, resolveInfo, {
        ...fieldContext,
        selectGraphQLResultFromTable,
      });
    };
    return newResolver;
  }
  if (fields && fields.length) {
    return fields.reduce((memo, field) => {
      if (field.kind === "FieldDefinition") {
        const description = getDescription(field.description);
        const fieldName = getName(field.name);
        const args = getArguments(field.arguments, build);
        const type = getType(field.type, build);
        const directives = getDirectives(field.directives);
        const scope = {
          fieldDirectives: directives,
          ...(directives.scope || {}),
        };
        const deprecationReason =
          directives.deprecated && directives.deprecated.reason;
        const functionToResolveObject = <TContext>(
          functionOrResolveObject:
            | AugmentedGraphQLFieldResolver<TSource, TContext>
            | ObjectFieldResolver<TSource, TContext>
        ): ObjectFieldResolver<TSource, TContext> =>
          typeof functionOrResolveObject === "function"
            ? { resolve: functionOrResolveObject }
            : functionOrResolveObject;
        /*
         * We accept a resolver function directly, or an object which can
         * define 'resolve', 'subscribe' and other relevant methods.
         */
        const possibleResolver = resolvers[Self.name]
          ? resolvers[Self.name][fieldName]
          : null;
        const resolver =
          possibleResolver &&
          (typeof possibleResolver === "object" ||
            typeof possibleResolver === "function")
            ? possibleResolver
            : null;
        const rawResolversSpec = resolver
          ? functionToResolveObject(resolver)
          : null;
        if (directives.recurseDataGenerators) {
          // tslint:disable-next-line no-console
          console.warn(
            "DEPRECATION: `recurseDataGenerators` is mislead, please use `pgField` instead"
          );
          if (!directives.pgField) {
            directives.pgField = directives.recurseDataGenerators;
          }
        }
        const withFieldContext = (fieldContext: Context<TSource>) => {
          const { pgIntrospection } = fieldContext.scope;
          // @requires directive: pulls down necessary columns from table.
          //
          //   e.g. `@requires(columns: ["id", "name"])`
          //
          if (directives.requires && pgIntrospection.kind === "class") {
            if (Array.isArray(directives.requires.columns)) {
              const table: PgClass = pgIntrospection;
              const attrs = table.attributes.filter(
                attr => directives.requires.columns.indexOf(attr.name) >= 0
              );
              const fieldNames = attrs.map(attr =>
                build.inflection.column(attr)
              );
              const ReturnTypes = attrs.map(
                attr =>
                  build.pgGetGqlTypeByTypeIdAndModifier(
                    attr.typeId,
                    attr.typeModifier
                  ) || build.graphql.GraphQLString
              );
              fieldContext.addDataGenerator(
                (parsedResolveInfoFragment: any) => ({
                  pgQuery: (queryBuilder: QueryBuilder) => {
                    attrs.forEach((attr, i) => {
                      const columnFieldName = fieldNames[i];
                      const ReturnType = ReturnTypes[i];
                      queryBuilder.select(
                        build.pgGetSelectValueForFieldAndTypeAndModifier(
                          ReturnType,
                          fieldContext,
                          parsedResolveInfoFragment,
                          sql.fragment`(${queryBuilder.getTableAlias()}.${sql.identifier(
                            attr.name
                          )})`, // The brackets are necessary to stop the parser getting confused, ref: https://www.postgresql.org/docs/9.6/static/rowtypes.html#ROWTYPES-ACCESSING
                          attr.type,
                          attr.typeModifier
                        ),
                        columnFieldName
                      );
                    });
                  },
                })
              );
            } else {
              throw new Error(
                `@requires(columns: ["...", ...]) directive called with invalid arguments`
              );
            }
          }

          const resolversSpec = rawResolversSpec
            ? Object.keys(rawResolversSpec).reduce((newResolversSpec, key) => {
                if (typeof rawResolversSpec[key] === "function") {
                  newResolversSpec[key] = augmentResolver(
                    rawResolversSpec[key],
                    fieldContext
                  );
                }
                return newResolversSpec;
              }, {})
            : {};
          return {
            type,
            args,
            ...(deprecationReason
              ? {
                  deprecationReason,
                }
              : null),
            ...(description
              ? {
                  description,
                }
              : null),
            ...resolversSpec,
          };
        };
        if (directives.pgField) {
          return build.extend(memo, {
            [fieldName]: build.pgField(
              build,
              fieldWithHooks,
              fieldName,
              withFieldContext,
              scope,
              false
            ),
          });
        } else {
          return build.extend(memo, {
            [fieldName]: fieldWithHooks(fieldName, withFieldContext, scope),
          });
        }
      } else {
        throw new Error(
          `AST issue: expected 'FieldDefinition', instead received '${
            field.kind
          }'`
        );
      }
    }, {});
  }
  return {};
}

function getInputFields<TSource>(
  _Self: TSource,
  fields: ReadonlyArray<InputValueDefinitionNode> | void,
  build: Build
) {
  if (fields && fields.length) {
    return fields.reduce((memo, field) => {
      if (field.kind === "InputValueDefinition") {
        const description = getDescription(field.description);
        const fieldName = getName(field.name);
        const type = getType(field.type, build);
        memo[fieldName] = {
          type,
          // defaultValue
          ...(description
            ? {
                description,
              }
            : null),
        };
      } else {
        throw new Error(
          `AST issue: expected 'FieldDefinition', instead received '${
            field.kind
          }'`
        );
      }
      return memo;
    }, {});
  }
  return {};
}
