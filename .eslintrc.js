module.exports = {
  parser: "babel-eslint",
  parserOptions: {
    sourceType: "module",
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended",
    "prettier/@typescript-eslint",
  ],
  plugins: ["jest", "flowtype", "graphql"],
  env: {
    jest: true,
    node: true,
    es6: true,
  },
  globals: {
    jasmine: false,
  },
  rules: {
    "prettier/prettier": "warn",

    "@typescript-eslint/ban-ts-ignore": "off",
    "@typescript-eslint/camelcase": "off",
    "@typescript-eslint/no-var-requires": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        args: "after-used",
        ignoreRestSiblings: true,
      },
    ],

    "no-confusing-arrow": 0,
    "no-else-return": 0,
    "no-underscore-dangle": 0,
    "no-restricted-syntax": 0,
    "no-await-in-loop": 0,
    "jest/no-focused-tests": 2,
    "jest/no-identical-title": 2,
    "flowtype/boolean-style": [2, "boolean"],
    "flowtype/delimiter-dangle": [2, "always-multiline"],
    "flowtype/no-primitive-constructor-types": 2,
    "flowtype/no-types-missing-file-annotation": 2,
    "flowtype/no-weak-types": 2,
    "flowtype/object-type-delimiter": [2, "comma"],
    "flowtype/require-valid-file-annotation": 2,
    "flowtype/semi": [2, "always"],
    "flowtype/define-flow-type": 1,
    "flowtype/use-flow-type": 1,

    // Rules that we should enable:
    "@typescript-eslint/no-use-before-define": "warn",
    "@typescript-eslint/no-inferrable-types": "warn",
    "no-inner-declarations": "warn",
    "prefer-const": "warn",
  },
  settings: {
    flowtype: {
      onlyFilesWithFlowAnnotation: false,
    },
  },
  overrides: [
    {
      files: ["*.ts", "*.tsx"],
      parser: "@typescript-eslint/parser",
      rules: {
        "no-dupe-class-members": "off",
        "no-undef": "off",
      },
    },
    {
      files: ["**/__tests__/**/*.{ts,js}"],
      rules: {
        "prefer-const": "off",
        "@typescript-eslint/no-unused-vars": "off",
      },
    },
  ],
};
