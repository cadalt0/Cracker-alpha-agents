import { config as loadEnv } from "dotenv";
import { isAddress } from "viem";

loadEnv();

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizePrivateKey(pkRaw: string): `0x${string}` {
  const trimmed = pkRaw.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("PRIVATE_KEY must be 32-byte hex string");
  }
  return `0x${trimmed.toLowerCase()}` as `0x${string}`;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: getEnv("DATABASE_URL"),
  rpcUrl: getEnv("RPC_URL", "https://base-sepolia.infura.io/v3/6e5b83467bda453f8be428db073b2c6f"),
  chainId: Number(process.env.CHAIN_ID ?? 84532),
  privateKey: (() => {
    const raw = process.env.PRIVATE_KEY;
    if (!raw) return null;
    try {
      return normalizePrivateKey(raw);
    } catch {
      return null;
    }
  })(),
  smartAccountFactoryAddress: (() => {
    const addr = process.env.SMART_ACCOUNT_FACTORY_ADDRESS;
    if (!addr) return null;
    if (!isAddress(addr)) {
      throw new Error("SMART_ACCOUNT_FACTORY_ADDRESS is not a valid EVM address");
    }
    return addr as `0x${string}`;
  })(),
  betFactoryAddress: (() => {
    const addr = process.env.BET_FACTORY_ADDRESS;
    if (!addr) return null;
    if (!isAddress(addr)) {
      throw new Error("BET_FACTORY_ADDRESS is not a valid EVM address");
    }
    return addr as `0x${string}`;
  })(),
  betTokenAddress: (() => {
    const addr =
      process.env.BET_TOKEN_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    if (!isAddress(addr)) {
      throw new Error("BET_TOKEN_ADDRESS is not a valid EVM address");
    }
    return addr as `0x${string}`;
  })(),
  betVerifierAddress: (() => {
    const addr =
      process.env.BET_VERIFIER_ADDRESS ?? "0x0000000000000000000000000000000000000000";
    if (!isAddress(addr)) {
      throw new Error("BET_VERIFIER_ADDRESS is not a valid EVM address");
    }
    return addr as `0x${string}`;
  })(),
  /** Human USDC amount for POST /api/bets/join-with-agent fund step (6 decimals default). */
  betFundAmountUsdc: process.env.BET_FUND_AMOUNT_USDC?.trim() ?? "0.00001",
  /** If set, raw token units override `betFundAmountUsdc`. */
  betFundAmountRaw: process.env.BET_FUND_AMOUNT_RAW?.trim() ?? null,
  betTokenDecimals: Number(process.env.TOKEN_DECIMALS ?? 6),
  /** Override absolute path to vote circuit build root (wasm/zkey/vkey). Default: `<server>/zk/build`. */
  zkproofBuildPath: (() => {
    const p = process.env.ZKPROOF_BUILD_PATH?.trim();
    return p && p.length > 0 ? p : null;
  })(),
};
