#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_dir="$repo_dir/apps/macos/ModelPicker"
bundle_dir=${1:-"$repo_dir/dist/Model Picker.app"}
build_dir="$repo_dir/.build/model-picker"

mkdir -p "$build_dir" "$bundle_dir/Contents/MacOS" "$bundle_dir/Contents/Resources"
clang -fobjc-arc -O2 -mmacosx-version-min=13.0 \
  -framework Cocoa \
  "$source_dir/main.m" \
  -o "$build_dir/ModelPicker"

cp "$build_dir/ModelPicker" "$bundle_dir/Contents/MacOS/ModelPicker"
cp "$source_dir/Resources/Info.plist" "$bundle_dir/Contents/Info.plist"
printf '%s\n' "$repo_dir" > "$bundle_dir/Contents/Resources/router-root"
xattr -cr "$bundle_dir"
codesign --force --sign - "$bundle_dir" >/dev/null
printf '%s\n' "$bundle_dir"
