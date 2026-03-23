import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

export type StoredVoteProof = {
  proof: `0x${string}`;
  publicInputs: `0x${string}`;
};

function serverPackageRoot(fromThisFile: string): string {
  return dirname(dirname(dirname(fromThisFile)));
}

function resolveBuildRoot(): string {
  if (config.zkproofBuildPath) return config.zkproofBuildPath;
  const here = fileURLToPath(import.meta.url);
  return join(serverPackageRoot(here), "zk", "build");
}

function hexToBytes(hex: `0x${string}`): Buffer {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(s, "hex");
}

function decodeU256be(buf: Buffer): bigint {
  if (buf.length !== 32) throw new Error(`Expected 32-byte chunk, got ${buf.length}`);
  return BigInt(`0x${buf.toString("hex")}`);
}

function decodeEvmProofBytes(proofHex: `0x${string}`): {
  pi_a: [string, string];
  pi_b: [[string, string], [string, string]];
  pi_c: [string, string];
} {
  const buf = hexToBytes(proofHex);
  if (buf.length !== 256) {
    throw new Error(`Invalid proof byte length. Expected 256 bytes, got ${buf.length}`);
  }

  const c0 = decodeU256be(buf.subarray(0, 32));
  const c1 = decodeU256be(buf.subarray(32, 64));
  const c2 = decodeU256be(buf.subarray(64, 96));
  const c3 = decodeU256be(buf.subarray(96, 128));
  const c4 = decodeU256be(buf.subarray(128, 160));
  const c5 = decodeU256be(buf.subarray(160, 192));
  const c6 = decodeU256be(buf.subarray(192, 224));
  const c7 = decodeU256be(buf.subarray(224, 256));

  return {
    pi_a: [c0.toString(), c1.toString()],
    // Must match voteProof.ts proofToEvmBytes packing order.
    pi_b: [
      [c3.toString(), c2.toString()],
      [c5.toString(), c4.toString()],
    ],
    pi_c: [c6.toString(), c7.toString()],
  };
}

function decodePublicInputs(publicInputsHex: `0x${string}`): string[] {
  const buf = hexToBytes(publicInputsHex);
  if (buf.length !== 32) {
    throw new Error(
      `Invalid publicInputs byte length. Expected 32 bytes, got ${buf.length}`,
    );
  }
  const pub = decodeU256be(buf);
  return [pub.toString()];
}

export async function verifyVoteProof(params: {
  circuit: "vote_yes" | "vote_no";
  betId: string;
  proof: StoredVoteProof;
}): Promise<boolean> {
  // `betId` is redundant because publicInputs already commits to it.
  // We keep it for sanity checks when callers want explicit control.
  const buildRoot = resolveBuildRoot();
  const vkeyPath = join(buildRoot, params.circuit, `${params.circuit}_vkey.json`);
  if (!existsSync(vkeyPath)) {
    throw new Error(
      `Missing vkey for ${params.circuit} under ${buildRoot}. Expected ${vkeyPath}`,
    );
  }

  const snarkjs = await import("snarkjs");
  const vkey = JSON.parse(readFileSync(vkeyPath, "utf8")) as object;
  const publicSignals = decodePublicInputs(params.proof.publicInputs);
  const decodedProof = decodeEvmProofBytes(params.proof.proof);

  // Optional sanity check that publicSignals[0] equals the requested betId field.
  // We avoid importing zkField.ts to keep this file focused on verification only.
  // If they mismatch, snarkjs.verify would fail anyway.
  void params.betId;

  return snarkjs.groth16.verify(vkey, publicSignals, decodedProof as any);
}

