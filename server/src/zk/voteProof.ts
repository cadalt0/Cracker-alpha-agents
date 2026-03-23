/**
 * Groth16 vote proof for one side (`vote_yes` or `vote_no`) — same logic as repo `zkproof/scripts/prove.mjs`,
 * using snarkjs in-process. Artifacts: wasm + zkey + vkey under build root.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Server package root (…/server), whether code runs from `src/zk/` or `dist/zk/`. */
function serverPackageRoot(fromThisFile: string): string {
  return dirname(dirname(dirname(fromThisFile)));
}
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { betIdToFieldString, secretToFieldString } from "./zkField.js";

export type VoteProofBundle = {
  proof: `0x${string}`;
  publicInputs: `0x${string}`;
};

function u256be(x: bigint): Uint8Array {
  let v = x;
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function proofToEvmBytes(proof: {
  pi_a: [string, string];
  pi_b: [[string, string], [string, string]];
  pi_c: [string, string];
}): `0x${string}` {
  const p = proof;
  const parts = [
    u256be(BigInt(p.pi_a[0])),
    u256be(BigInt(p.pi_a[1])),
    u256be(BigInt(p.pi_b[0][1])),
    u256be(BigInt(p.pi_b[0][0])),
    u256be(BigInt(p.pi_b[1][1])),
    u256be(BigInt(p.pi_b[1][0])),
    u256be(BigInt(p.pi_c[0])),
    u256be(BigInt(p.pi_c[1])),
  ];
  const buf = new Uint8Array(256);
  let o = 0;
  for (const b of parts) {
    buf.set(b, o);
    o += 32;
  }
  return (`0x${Buffer.from(buf).toString("hex")}`) as `0x${string}`;
}

function resolveBuildRoot(): string {
  if (config.zkproofBuildPath) return config.zkproofBuildPath;
  const here = fileURLToPath(import.meta.url);
  return join(serverPackageRoot(here), "zk", "build");
}

async function proveOne(
  name: "vote_yes" | "vote_no",
  betId: string,
  secret: string,
  buildRoot: string,
): Promise<VoteProofBundle> {
  const wasm = join(buildRoot, name, `${name}_js`, `${name}.wasm`);
  const zkey = join(buildRoot, name, `${name}.zkey`);
  const vkeyPath = join(buildRoot, name, `${name}_vkey.json`);
  if (!existsSync(wasm) || !existsSync(zkey) || !existsSync(vkeyPath)) {
    throw new Error(
      `Missing ZK artifacts for ${name} under ${buildRoot}. Populate server/zk/build (vote_yes / vote_no) or set ZKPROOF_BUILD_PATH.`,
    );
  }

  const input = {
    betId: betIdToFieldString(betId),
    secret: secretToFieldString(secret),
  };

  const snarkjs = await import("snarkjs");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);

  const vkey = JSON.parse(readFileSync(vkeyPath, "utf8")) as object;
  const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  if (!ok) throw new Error(`Local groth16 verify failed for ${name}`);

  const pubField = BigInt(publicSignals[0] as string);
  const publicInputs = (`0x${Buffer.from(u256be(pubField)).toString("hex")}`) as `0x${string}`;
  const proofBytes = proofToEvmBytes(proof as Parameters<typeof proofToEvmBytes>[0]);

  return { proof: proofBytes, publicInputs };
}

/** Single Groth16 proof for the side the voter chose (`vote_yes` vs `vote_no` are different verifying keys on-chain). */
export async function proveVote(params: {
  betId: string;
  secret: string;
  voteYes: boolean;
}): Promise<{ bundle: VoteProofBundle; buildRoot: string; circuit: "vote_yes" | "vote_no" }> {
  const buildRoot = resolveBuildRoot();
  const circuit = params.voteYes ? "vote_yes" : "vote_no";
  const bundle = await proveOne(circuit, params.betId, params.secret, buildRoot);
  return { bundle, buildRoot, circuit };
}
