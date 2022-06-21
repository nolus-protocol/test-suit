#!/bin/bash
verify_mandatory() {
  local value="$1"
  local description="$2"

  if [ "$value" = "" ]; then
    echo >&2 "$description was not set"
    exit 1
  fi
}

verify_dir_exist() {
  local -r dir="$1"
  local -r description="$2"
  if ! [ -d "$dir" ]
  then
    echo "The required $description '$dir' does not point to an existing directory."
    exit 1
  fi
}
