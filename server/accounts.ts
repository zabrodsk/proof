import {
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
type Account = {
  id: string;
  name: string;
  salt: string;
  hash: string;
  inputTokens: number;
  jevUsd: number;
  invitedAt?: string;
};
export const accountContext = new AsyncLocalStorage<{
  charge: (tokens: number, usd: number) => void;
}>();
export function accountStore(
  path = process.env.PROOF_ACCOUNTS_FILE || resolve(".data/accounts.json"),
) {
  let accounts: Account[];
  try {
    accounts = JSON.parse(readFileSync(path, "utf8"));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
    accounts = [];
  }
  const save = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path + ".tmp", JSON.stringify(accounts), { mode: 0o600 });
    renameSync(path + ".tmp", path);
  };
  const find = (name: string) =>
    accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return {
    workos(id: string, name: string) {
      let account = accounts.find((a) => a.id === id);
      if (!account) {
        account = { id, name, salt: "", hash: "", inputTokens: 0, jevUsd: 0 };
        accounts.push(account);
        save();
      } else if (account.name !== name) {
        account.name = name;
        save();
      }
      return account;
    },
    acceptInvite(id: string) {
      const account = accounts.find((a) => a.id === id);
      if (!account) throw Error("Account no longer exists");
      account.invitedAt ||= new Date().toISOString();
      save();
    },
    claimed: (name: string) => !!find(name),
    get: (id: string) => accounts.find((a) => a.id === id),
    create(name: string, password: string) {
      if (find(name)) return undefined;
      const salt = randomBytes(16).toString("hex");
      const account: Account = {
        id: randomUUID(),
        name,
        salt,
        hash: scryptSync(password, salt, 64).toString("hex"),
        inputTokens: 0,
        jevUsd: 0,
      };
      accounts.push(account);
      save();
      return account;
    },
    login(name: string, password: string) {
      const a = find(name);
      const hash = scryptSync(password, a?.salt || "dummy-salt", 64);
      return a &&
        a.hash.length === 128 &&
        timingSafeEqual(hash, Buffer.from(a.hash, "hex"))
        ? a
        : undefined;
    },
    charge(id: string, tokens: number, usd: number) {
      const a = accounts.find((a) => a.id === id);
      if (!a) throw Error("Account no longer exists");
      a.inputTokens += tokens;
      a.jevUsd += usd;
      save();
    },
  };
}
