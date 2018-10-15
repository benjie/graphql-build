export default function pgField(
  build,
  fieldWithHooks,
  fieldName,
  fieldSpec,
  fieldScope = {},
  whereFrom = false,
  options = {}
) {
  const { type: FieldType } = fieldSpec;
  const {
    pgSql: sql,
    pgQueryFromResolveData: queryFromResolveData,
    getSafeAliasFromAlias,
    getSafeAliasFromResolveInfo,
  } = build;
  const nullableType = build.graphql.getNullableType(FieldType);
  const namedType = build.graphql.getNamedType(FieldType);
  const isListType =
    nullableType !== namedType &&
    nullableType.constructor === build.graphql.GraphQLList;
  return fieldWithHooks(
    fieldName,
    fieldContext => {
      const {
        getDataFromParsedResolveInfoFragment,
        addDataGenerator,
      } = fieldContext;
      if (typeof options.withFieldContext === "function") {
        options.withFieldContext(fieldContext);
      }
      addDataGenerator(parsedResolveInfoFragment => {
        const safeAlias = getSafeAliasFromAlias(
          parsedResolveInfoFragment.alias
        );
        const resolveData = getDataFromParsedResolveInfoFragment(
          parsedResolveInfoFragment,
          FieldType
        );
        return {
          ...(options.hoistCursor &&
          resolveData.usesCursor &&
          resolveData.usesCursor.length
            ? { usesCursor: [true] }
            : null),
          pgQuery: queryBuilder => {
            queryBuilder.select(() => {
              const tableAlias =
                whereFrom === false
                  ? queryBuilder.getTableAlias()
                  : sql.identifier(Symbol());
              const query = queryFromResolveData(
                whereFrom ? whereFrom(queryBuilder) : sql.identifier(Symbol()),
                tableAlias,
                resolveData,
                whereFrom === false
                  ? { onlyJsonField: true }
                  : { asJson: true },
                innerQueryBuilder => {
                  innerQueryBuilder.parentQueryBuilder = queryBuilder;
                  if (typeof options.withQueryBuilder === "function") {
                    options.withQueryBuilder(innerQueryBuilder, {
                      parsedResolveInfoFragment,
                    });
                  }
                }
              );
              return sql.fragment`(${query})`;
            }, safeAlias);
          },
        };
      });

      return {
        resolve(data, _args, _context, resolveInfo) {
          const safeAlias = getSafeAliasFromResolveInfo(resolveInfo);
          if (data.data == null) return null;
          if (isListType) {
            return data.data.map(d => (d != null ? d[safeAlias] : null));
          } else {
            return data.data[safeAlias];
          }
        },
        ...fieldSpec,
      };
    },
    fieldScope
  );
}