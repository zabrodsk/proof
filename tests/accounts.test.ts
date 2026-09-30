import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountStore, accountContext } from "../server/accounts.js";
import { withUsage, recordJevUsage } from "../server/usage.js";
test("accounts hash passwords, isolate costs, and retain balances after restart", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "proof-account-test-")),
    "accounts.json",
  );
  const store = accountStore(path);
  const alice = store.create("Alice", "secret-password-a")!;
  const bob = store.create("Bob", "secret-password-b")!;
  assert.equal(store.create("ALICE", "different-password"), undefined);
  assert.equal(store.login("alice", "wrong-password"), undefined);
  assert.equal(store.login("alice", "secret-password-a")?.id, alice.id);
  assert.equal(readFileSync(path, "utf8").includes("secret-password"), false);
  await Promise.all(
    [alice, bob].map((a, i) =>
      accountContext.run({ charge: (t, u) => store.charge(a.id, t, u) }, () =>
        withUsage(async () => {
          await Promise.resolve();
          recordJevUsage({ input_tokens: (i + 1) * 1000, output_tokens: 900 });
        }),
      ),
    ),
  );
  // Calls outside withUsage, including the original evidence workspace, still count.
  accountContext.run({ charge: (t, u) => store.charge(alice.id, t, u) }, () =>
    recordJevUsage({ input_tokens: 500, output_tokens: 10000 }),
  );
  const reopened = accountStore(path);
  assert.equal(reopened.get(alice.id)?.inputTokens, 1500);
  assert.equal(reopened.get(bob.id)?.inputTokens, 2000);
  assert.ok(Math.abs(reopened.get(alice.id)!.jevUsd - 0.000063) < 1e-12);
});

test("WorkOS identities retain usage and cannot use legacy password login", () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "proof-workos-account-")),
    "accounts.json",
  );
  const store = accountStore(path);
  const first = store.workos("user_workos_1", "Alice");
  store.charge(first.id, 500, 0.002);
  const renamed = store.workos("user_workos_1", "Alice Updated");
  assert.equal(renamed.id, first.id);
  assert.equal(renamed.inputTokens, 500);
  assert.equal(renamed.jevUsd, 0.002);
  assert.equal(store.login("Alice Updated", "any-password"), undefined);
  assert.equal(accountStore(path).get(first.id)?.name, "Alice Updated");
  assert.equal(store.workos("user_workos_2", "Alice Updated").jevUsd, 0);
});
