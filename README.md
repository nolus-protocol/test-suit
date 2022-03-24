# Integration tests

## Prerequisites

You need Node v14+ and npm installed on your machine.
You also need to install [jq](https://stedolan.github.io/jq/download/) and the project's dependencies via:

```sh
yarn
```

## Starting integration tests

For running on dev-net:

```sh
yarn prepare-env-dev <your-gitlab-access-token>
```

```sh
yarn test
```
