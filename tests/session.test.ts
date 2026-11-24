import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("web owns product session dialogs built on generic @compose-market/theme/shell primitives", () => {
  const source = readFileSync(resolve(root, "src/components/session.tsx"), "utf8");
  assert.match(source, /export function SessionBudgetDialog/);
  assert.match(source, /export function SessionIndicator/);
  assert.match(source, /from "@compose-market\/theme\/shell"/);
  assert.doesNotMatch(source, /@compose-market\/theme\/session/);
});
