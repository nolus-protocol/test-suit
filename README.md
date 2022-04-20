# Integration tests

## Prerequisites

You need Node v14+ installed on your machine.
You also need to install:

* [yarn](https://classic.yarnpkg.com/lang/en/docs/install/#debian-stable)

```sh
npm install --global yarn
```

* [jest](https://jestjs.io/docs/getting-started)

You can run Jest directly from the CLI if it's globally available in your PATH:

```sh
yarn global add jest
```

* [jq](https://stedolan.github.io/jq/download/):

```sh
sudo apt-get install jq
```

* the project's dependencies:

```sh
yarn
```

## Linting the code

We use the [TypeScript-Eslint](https://github.com/typescript-eslint) and [Prettier](https://prettier.io/).

```sh
yarn lint
```

This will show you the results of the ESLint analysis.

Ref: [Using ESLint and Prettier in a TypeScript Project, ROBERT COOPER](https://robertcooper.me/post/using-eslint-and-prettier-in-a-typescript-project).

## Starting integration tests

For running on dev-net:

```sh
yarn prepare-env-dev <your-gitlab-access-token>
```

```sh
yarn test
```
