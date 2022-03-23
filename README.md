# Integration tests

## Prerequisites

You need Node v14+ and npm installed on your machine.
You also need to install the project's dependencies via:

```sh
yarn
```

## Starting integration tests

For running on dev-net:

```sh
make prepare-test-integration-dev
```

```sh
yarn test
```

For running on local net:

```sh
make prepare-test-integration-local
```

```sh
yarn test
```
