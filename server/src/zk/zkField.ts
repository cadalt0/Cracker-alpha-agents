import { createHash } from "node:crypto";

const R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function modField(x: bigint): bigint {
  const v = x;
  return ((v % R) + R) % R;
}

/** Match circom/snarkjs public signal for `betId` (BN254 scalar). */
export function betIdToFieldString(betId: string | bigint): string {
  return modField(typeof betId === "bigint" ? betId : BigInt(betId)).toString(10);
}

/**
 * Private witness `secret`: decimal integer string, or any UTF-8 string (hashed with SHA-256, then reduced mod r).
 */
export function secretToFieldString(secret: string): string {
  const s = String(secret).trim();
  if (/^\d+$/.test(s)) return modField(BigInt(s)).toString(10);
  const h = createHash("sha256").update(s, "utf8").digest();
  let x = 0n;
  for (let i = 0; i < h.length; i++) x = (x << 8n) | BigInt(h[i]);
  return modField(x).toString(10);
}
