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

## Download contracts json schemas

```sh
curl --output schemas.zip --header "PRIVATE-TOKEN: <your_gitlab_access_token>" "https://gitlab-nomo.credissimo.net/api/v4/projects/8/jobs/artifacts/<contracts_version>/download?job=schema:cargo"
```

## Linting the code

We use the [TypeScript-Eslint](https://github.com/typescript-eslint) and [Prettier](https://prettier.io/).

```sh
yarn lint
```

This will show you the results of the ESLint analysis.

Ref: [Using ESLint and Prettier in a TypeScript Project, ROBERT COOPER](https://robertcooper.me/post/using-eslint-and-prettier-in-a-typescript-project).

## Run integration tests

1. On dev-net:

    ```sh
    yarn prepare-env-dev <your_gitlab_access_token>
    ```

    ```sh
    yarn test-dev
    ```

2. On local-net:

    ```sh
    yarn prepare-env-local --contracts-result-file-path <path_to_contracts_info_file>
    ```

    * **--contracts-result-file-path** - you must pass the path to the directory where the smart contracts information file  is located (thе file produced by **smart-contract/scripts/deploy-contracts-local-net.sh**)

    More flags:

    * **--nolus-local-network <nolus-local-net-url>**, by default this is: http://localhost:26612

    * **--ibc-token <ibc-denom>**, by default this is: ibc/8A34AF0C1943FD0DFCDE9ADBF0B2C9959C45E87E6088EA2FC6ADACD59261B8A2

    * **--stable-denom <stable-denom>**, by default this is: ibc/8A34AF0C1943FD0DFCDE9ADBF0B2C9959C45E87E6088EA2FC6ADACD59261B8A2

    * **--home-dir <nolus_accounts_dir>**, by default this is: home/.nolus

    ```sh
    yarn test-local
    ```
