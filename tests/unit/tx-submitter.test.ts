import { describe, expect, it, vi } from "vitest";

import {
  TxSubmitter,
  type TxSubmitterRedisClient,
} from "../../src/infra/tx/submitter";

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

class FakeRedisClient implements TxSubmitterRedisClient {
  private readonly store = new Map<
    string,
    { value: string; expiresAtMs: number }
  >();

  private prune(key: string): void {
    const entry = this.store.get(key);
    if (!entry) {
      return;
    }

    if (entry.expiresAtMs <= Date.now()) {
      this.store.delete(key);
    }
  }

  async set(
    key: string,
    value: string,
    mode: "PX",
    durationMs: number,
    setMode?: "NX",
  ): Promise<"OK" | null> {
    if (mode !== "PX") {
      return null;
    }

    this.prune(key);
    if (setMode === "NX" && this.store.has(key)) {
      return null;
    }

    this.store.set(key, {
      value,
      expiresAtMs: Date.now() + durationMs,
    });
    return "OK";
  }

  async eval(
    _script: string,
    _numKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    const lockKey = String(args[0]);
    const expectedValue = String(args[1]);
    this.prune(lockKey);
    const entry = this.store.get(lockKey);
    if (!entry || entry.value !== expectedValue) {
      return 0;
    }

    if (args.length >= 3) {
      const ttlMs = Number(args[2]);
      this.store.set(lockKey, {
        value: entry.value,
        expiresAtMs: Date.now() + ttlMs,
      });
      return 1;
    }

    this.store.delete(lockKey);
    return 1;
  }
}

describe("tx submitter", () => {
  it("retries once on nonce errors with refreshed pending nonce", async () => {
    const getTransactionCount = vi
      .fn()
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(8);
    const writeContract = vi
      .fn()
      .mockRejectedValueOnce(new Error("nonce too low"))
      .mockResolvedValueOnce(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );

    const chain = {
      chainId: 84532,
      publicClient: {
        getTransactionCount,
      },
      walletClient: {
        account: { address: "0x1111111111111111111111111111111111111111" },
        writeContract,
      },
    } as any;

    const submitter = new TxSubmitter();
    const txHash = await submitter.submitCreateTx({
      chain,
      request: { to: "0x2222222222222222222222222222222222222222" },
    });

    expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(getTransactionCount).toHaveBeenCalledTimes(2);
    expect(writeContract).toHaveBeenCalledTimes(2);
    expect(writeContract.mock.calls[0][0].nonce).toBe(7);
    expect(writeContract.mock.calls[1][0].nonce).toBe(8);
  });

  it("serializes nonce submission across submitter instances with shared redis lock", async () => {
    const redis = new FakeRedisClient();
    const firstSubmitter = new TxSubmitter({
      redis,
      redisKeyPrefix: "test",
      lockTtlMs: 250,
      lockRefreshMs: 50,
      lockPollIntervalMs: 5,
    });
    const secondSubmitter = new TxSubmitter({
      redis,
      redisKeyPrefix: "test",
      lockTtlMs: 250,
      lockRefreshMs: 50,
      lockPollIntervalMs: 5,
    });

    let nextNonce = 7;
    let writeInFlight = false;
    const getTransactionCount = vi.fn(async () => {
      await sleep(5);
      return nextNonce;
    });
    const writeContract = vi.fn(async (_args: { nonce: number }) => {
      if (writeInFlight) {
        throw new Error("concurrent nonce write");
      }

      writeInFlight = true;
      await sleep(30);
      const txHash = `0x${String(nextNonce).padStart(64, "a")}`;
      nextNonce += 1;
      writeInFlight = false;
      return txHash;
    });

    const buildChain = () =>
      ({
        chainId: 84532,
        publicClient: {
          getTransactionCount,
        },
        walletClient: {
          account: { address: "0x1111111111111111111111111111111111111111" },
          writeContract,
        },
      }) as any;

    const [firstTxHash, secondTxHash] = await Promise.all([
      firstSubmitter.submitCreateTx({
        chain: buildChain(),
        request: { to: "0x2222222222222222222222222222222222222222" },
      }),
      secondSubmitter.submitCreateTx({
        chain: buildChain(),
        request: { to: "0x2222222222222222222222222222222222222222" },
      }),
    ]);

    expect(writeContract).toHaveBeenCalledTimes(2);
    expect(firstTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(secondTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });
});
