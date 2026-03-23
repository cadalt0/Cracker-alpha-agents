import { Router } from "express";
import { isAddress } from "viem";
import { z } from "zod";
import { db, type AgentRow } from "../db.js";
import { createSmartAccountForOwner } from "../blockchain/smartAccountFactory.js";
import { publishDelegationOnchain } from "../blockchain/delegationPublisher.js";

const router = Router();

const createAgentSchema = z.object({
  walletAddress: z.string().min(1),
  agentName: z.string().min(1).optional(),
});

const updateAgentSchema = z.object({
  agentName: z.string().min(1).optional(),
  smartAccountAddress: z.string().optional().nullable(),
  delegationJson: z.unknown().optional().nullable(),
});

/** ERC-7715 context must be full hex — pasted examples with "..." break signing (invalid byte sequence). */
const permissionsContextHex = z
  .string()
  .min(4, "permissionsContext too short")
  .refine((s) => /^0x[0-9a-fA-F]+$/.test(s), {
    message:
      "permissionsContext must be 0x + hex only (no spaces or ellipsis; paste the full value from MetaMask, not a shortened example)",
  })
  .refine((s) => ((s.length - 2) & 1) === 0, {
    message: "permissionsContext must have an even number of hex nibbles (full bytes)",
  });

const publishDelegationSchema = z
  .object({
    permissionsContext: permissionsContextHex,
    delegationManager: z.string().min(1),
    config: z
      .object({
        tokenAddress: z.string().min(1),
        tokenDecimals: z.number().int().min(0).max(18),
        maxAmount: z.string().min(1),
        expiry: z.number().int().positive(),
      })
      .passthrough(),
    tokenName: z.string().min(1).optional(),
  })
  .passthrough();

function normalizeAddress(raw: string): `0x${string}` {
  if (!isAddress(raw)) {
    throw new Error("Invalid EVM address");
  }
  return raw as `0x${string}`;
}

function toAgentDto(row: AgentRow) {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    agentName: row.agent_name,
    smartAccountAddress: row.smart_account_address,
    delegationJson: row.delegation_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.post("/", async (req, res) => {
  const parsed = createAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  let walletAddress: `0x${string}`;
  try {
    walletAddress = normalizeAddress(parsed.data.walletAddress);
  } catch {
    return res.status(400).json({ error: "walletAddress is invalid" });
  }

  const agentName = parsed.data.agentName?.trim() || walletAddress;

  const result = await db.query<AgentRow>(
    `
      INSERT INTO agents (wallet_address, agent_name)
      VALUES ($1, $2)
      ON CONFLICT (wallet_address) DO UPDATE
      SET agent_name = EXCLUDED.agent_name,
          updated_at = NOW()
      RETURNING *
    `,
    [walletAddress, agentName],
  );

  return res.status(201).json(toAgentDto(result.rows[0]));
});

/** Lookup full agent row by `agent_name` (exact match). Must be registered before `GET /:walletAddress`. */
router.get("/by-name/:agentName", async (req, res) => {
  let agentName: string;
  try {
    agentName = decodeURIComponent(req.params.agentName).trim();
  } catch {
    return res.status(400).json({ error: "agentName is invalid" });
  }
  if (!agentName) {
    return res.status(400).json({ error: "agentName is required" });
  }

  const result = await db.query<AgentRow>(
    "SELECT * FROM agents WHERE agent_name = $1 ORDER BY id ASC",
    [agentName],
  );

  const n = result.rowCount ?? 0;
  if (n === 0) {
    return res.status(404).json({ error: "Agent not found" });
  }
  if (n > 1) {
    return res.status(409).json({
      error: "Multiple agents share this agent_name; use GET /api/agents/:walletAddress",
      walletAddresses: result.rows.map((r) => r.wallet_address),
    });
  }
  return res.json(toAgentDto(result.rows[0]));
});

router.get("/:walletAddress", async (req, res) => {
  let walletAddress: `0x${string}`;
  try {
    walletAddress = normalizeAddress(req.params.walletAddress);
  } catch {
    return res.status(400).json({ error: "walletAddress is invalid" });
  }

  const result = await db.query<AgentRow>(
    "SELECT * FROM agents WHERE wallet_address = $1",
    [walletAddress],
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Agent not found" });
  }
  return res.json(toAgentDto(result.rows[0]));
});

router.patch("/:walletAddress", async (req, res) => {
  const parsed = updateAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  let walletAddress: `0x${string}`;
  try {
    walletAddress = normalizeAddress(req.params.walletAddress);
  } catch {
    return res.status(400).json({ error: "walletAddress is invalid" });
  }

  const current = await db.query<AgentRow>(
    "SELECT * FROM agents WHERE wallet_address = $1",
    [walletAddress],
  );
  if (current.rowCount === 0) {
    return res.status(404).json({ error: "Agent not found" });
  }

  const update = parsed.data;
  const nextAgentName = update.agentName?.trim() ?? current.rows[0].agent_name;
  let nextSmartAccount = current.rows[0].smart_account_address;
  if (update.smartAccountAddress !== undefined) {
    if (update.smartAccountAddress === null) {
      nextSmartAccount = null;
    } else if (isAddress(update.smartAccountAddress)) {
      nextSmartAccount = update.smartAccountAddress;
    } else {
      return res.status(400).json({ error: "smartAccountAddress is invalid" });
    }
  }
  const nextDelegation =
    update.delegationJson !== undefined ? update.delegationJson : current.rows[0].delegation_json;

  const result = await db.query<AgentRow>(
    `
      UPDATE agents
      SET agent_name = $2,
          smart_account_address = $3,
          delegation_json = $4,
          updated_at = NOW()
      WHERE wallet_address = $1
      RETURNING *
    `,
    [walletAddress, nextAgentName, nextSmartAccount, nextDelegation],
  );

  return res.json(toAgentDto(result.rows[0]));
});

router.post("/:walletAddress/smart-account", async (req, res) => {
  let walletAddress: `0x${string}`;
  try {
    walletAddress = normalizeAddress(req.params.walletAddress);
  } catch {
    return res.status(400).json({ error: "walletAddress is invalid" });
  }

  const existing = await db.query<AgentRow>(
    "SELECT * FROM agents WHERE wallet_address = $1",
    [walletAddress],
  );
  if (existing.rowCount === 0) {
    return res.status(404).json({ error: "Agent not found. Create the agent first." });
  }
  if (existing.rows[0].smart_account_address) {
    return res.status(409).json({
      error: "SMART_ACCOUNT_ADDRESS already exists for this agent",
      smartAccountAddress: existing.rows[0].smart_account_address,
    });
  }

  const { smartAccountAddress, txHash } = await createSmartAccountForOwner(walletAddress);

  const updated = await db.query<AgentRow>(
    `
      UPDATE agents
      SET smart_account_address = $2,
          updated_at = NOW()
      WHERE wallet_address = $1
      RETURNING *
    `,
    [walletAddress, smartAccountAddress],
  );

  return res.status(201).json({
    agent: toAgentDto(updated.rows[0]),
    blockchain: { txHash, smartAccountAddress },
  });
});

router.post("/:walletAddress/delegation/publish", async (req, res) => {
  const parsed = publishDelegationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  let walletAddress: `0x${string}`;
  try {
    walletAddress = normalizeAddress(req.params.walletAddress);
  } catch {
    return res.status(400).json({ error: "walletAddress is invalid" });
  }

  let delegationManager: `0x${string}`;
  let tokenAddress: `0x${string}`;
  try {
    delegationManager = normalizeAddress(parsed.data.delegationManager);
    tokenAddress = normalizeAddress(parsed.data.config.tokenAddress);
  } catch {
    return res.status(400).json({ error: "delegationManager or tokenAddress is invalid" });
  }

  const agent = await db.query<AgentRow>(
    "SELECT * FROM agents WHERE wallet_address = $1",
    [walletAddress],
  );
  if (agent.rowCount === 0) {
    return res.status(404).json({ error: "Agent not found. Create agent first." });
  }
  const smartAccountAddress = agent.rows[0].smart_account_address;
  if (!smartAccountAddress || !isAddress(smartAccountAddress)) {
    return res.status(400).json({ error: "SMART_ACCOUNT_ADDRESS missing for this agent" });
  }

  const requestJson = parsed.data;
  const jobInsert = await db.query<{ id: number }>(
    `
      INSERT INTO delegation_publish_jobs (
        wallet_address, smart_account_address, request_json, status
      ) VALUES ($1, $2, $3, 'pending')
      RETURNING id
    `,
    [walletAddress, smartAccountAddress, requestJson],
  );
  const jobId = jobInsert.rows[0].id;

  // fire-and-forget background publish
  setImmediate(async () => {
    try {
      const txHash = await publishDelegationOnchain({
        smartAccountAddress: smartAccountAddress as `0x${string}`,
        permissionsContext: parsed.data.permissionsContext as `0x${string}`,
        delegationManager,
        tokenAddress,
        tokenDecimals: parsed.data.config.tokenDecimals,
        maxAmount: parsed.data.config.maxAmount,
        expiry: parsed.data.config.expiry,
        tokenName: parsed.data.tokenName,
      });

      await db.query(
        `
          UPDATE agents
          SET delegation_json = $2, updated_at = NOW()
          WHERE wallet_address = $1
        `,
        [walletAddress, requestJson],
      );
      await db.query(
        `
          UPDATE delegation_publish_jobs
          SET status = 'success', tx_hash = $2, updated_at = NOW()
          WHERE id = $1
        `,
        [jobId, txHash],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown publish error";
      await db.query(
        `
          UPDATE delegation_publish_jobs
          SET status = 'failed', error_message = $2, updated_at = NOW()
          WHERE id = $1
        `,
        [jobId, message],
      );
    }
  });

  return res.status(202).json({
    jobId,
    status: "pending",
    walletAddress,
    smartAccountAddress,
  });
});

router.get("/:walletAddress/delegation/jobs/:jobId", async (req, res) => {
  let walletAddress: `0x${string}`;
  try {
    walletAddress = normalizeAddress(req.params.walletAddress);
  } catch {
    return res.status(400).json({ error: "walletAddress is invalid" });
  }
  const jobId = Number(req.params.jobId);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return res.status(400).json({ error: "jobId is invalid" });
  }

  const row = await db.query<{
    id: number;
    wallet_address: string;
    smart_account_address: string;
    status: string;
    tx_hash: string | null;
    error_message: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `
      SELECT id, wallet_address, smart_account_address, status, tx_hash, error_message, created_at, updated_at
      FROM delegation_publish_jobs
      WHERE id = $1 AND wallet_address = $2
    `,
    [jobId, walletAddress],
  );

  if (row.rowCount === 0) {
    return res.status(404).json({ error: "Job not found" });
  }
  return res.json({
    id: row.rows[0].id,
    walletAddress: row.rows[0].wallet_address,
    smartAccountAddress: row.rows[0].smart_account_address,
    status: row.rows[0].status,
    txHash: row.rows[0].tx_hash,
    errorMessage: row.rows[0].error_message,
    createdAt: row.rows[0].created_at,
    updatedAt: row.rows[0].updated_at,
  });
});

export { router as agentsRouter };
