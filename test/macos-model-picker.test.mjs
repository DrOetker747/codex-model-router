import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Model Picker delegates the complete safe restart to router control", () => {
  const source = readFileSync(path.join(repoRoot, "apps/macos/ModelPicker/main.m"), "utf8");
  assert.match(source, /@\[\s*@"model-set",\s*slug,\s*restart \? @"--restart=true" : @"--restart=false"\s*\]/);
  assert.doesNotMatch(source, /- \(void\)restartCodex:/);
});

test("Model Picker drains a catalog larger than the macOS pipe buffer", {
  skip: process.platform !== "darwin",
}, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "model-picker-pipe-"));
  try {
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    const control = path.join(bin, "control");
    writeFileSync(control, "#!/bin/sh\n/bin/dd if=/dev/zero bs=4096 count=512 2>/dev/null\n");
    chmodSync(control, 0o700);

    const source = path.join(root, "probe.m");
    writeFileSync(source, `
#define main ModelPickerApplicationMain
#include "${path.join(repoRoot, "apps/macos/ModelPicker/main.m")}" 
#undef main
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    PickerViewController *picker = [[PickerViewController alloc] init];
    picker.sourceRoot = [NSString stringWithUTF8String:argv[1]];
    NSError *error = nil;
    NSData *data = [(id)picker runControl:@[@"--json"] error:&error];
    if (error || data.length != 2097152) return 2;
  }
  return 0;
}
`);
    const executable = path.join(root, "probe");
    const compile = spawnSync("clang", [
      "-fobjc-arc", "-mmacosx-version-min=13.0", "-framework", "Cocoa",
      source, "-o", executable,
    ], { encoding: "utf8" });
    assert.equal(compile.status, 0, compile.stderr);

    const run = spawnSync(executable, [root], { encoding: "buffer", timeout: 4_000 });
    assert.equal(run.status, 0, run.error?.message || run.stderr?.toString() || "probe failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
