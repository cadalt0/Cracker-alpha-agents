import { Router } from "express";
import { isAddress, keccak256, parseUnits, stringToHex } from "viem";
import { z } from "zod";
import { readBetTotalEscrow, setBetOutcomeTx } from "../blockchain/betOutcome.js";
import { createBetWithRelayer } from "../blockchain/betFactory.js";
import {
  participationErrorMessage,
  scwBetFundWithDelegationTx,
  scwBetJoinTx,
  scwBetVoteTx,
} from "../blockchain/betScwParticipation.js";
import { distributeWinnersTx } from "../blockchain/betPrizeDistribution.js";
import { config } from "../config.js";
import { db, type AgentRow } from "../db.js";
import { proveVote } from "../zk/voteProof.js";
import { verifyVoteProof } from "../zk/voteVerify.js";

const router = Router();

function asyncHandler(fn: (...args: any[]) => Promise<any>) {
  return (req: any, res: any, next: any) => {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const listBetsQuerySchema = z
  .object({
    status: z.string().optional(),
    limit: z
      .string()
      .optional()
      .transform((s) => (s === undefined ? undefined : Number(s)))
      .refine((n) => n === undefined || (Number.isFinite(n) && n > 0), {
        message: "limit must be a positive integer",
      })
      .optional(),
  })
  .strict();

const joinWithAgentSchema = z.object({
  agentName: z.string().min(1),
  voteYes: z.boolean(),
  voteSecret: z.string().min(1),
});

/**
 * Get newest bet that is "live" and still within settle window.
 * Matches the selection logic used by `POST /api/bets/join-with-agent`.
 */
router.get(
  "/latest-live",
  asyncHandler(async (_req, res) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const q = await db.query<
      BetRowPick & {
        status: string;
        settle_timestamp_unix: bigint;
        hint: unknown;
        created_at: Date;
        threshold_percent: string;
        duration_minutes: string;
      }
    >(
      `
        SELECT
          b.id,
          b.bet_id::text AS bet_id,
          b.bet_address,
          b.status,
          b.settle_timestamp_unix,
          b.hint,
          b.threshold_percent::text AS threshold_percent,
          b.duration_minutes::text AS duration_minutes,
          b.created_at
        FROM bets b
        WHERE b.status = 'live' AND b.settle_timestamp_unix > $1
        ORDER BY b.id DESC
        LIMIT 1
      `,
      [nowSec],
    );

    if (q.rowCount === 0) {
      return res.status(404).json({ error: "No live bet found" });
    }

    return res.json({
      id: q.rows[0].id,
      betId: q.rows[0].bet_id,
      betAddress: q.rows[0].bet_address,
      status: q.rows[0].status,
      settleTimestampUnix: q.rows[0].settle_timestamp_unix.toString(),
      hint: q.rows[0].hint,
      thresholdPercent: q.rows[0].threshold_percent,
      durationMinutes: q.rows[0].duration_minutes,
      createdAt: q.rows[0].created_at,
    });
  }),
);

/**
 * List bets from DB (optionally filter by `status`).
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = listBetsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const limit = parsed.data.limit ?? 10;
    const status = parsed.data.status;
    const nowSec = Math.floor(Date.now() / 1000);

    const q = await db.query<
      BetRowPick & {
        status: string;
        settle_timestamp_unix: bigint;
        threshold_percent: string;
        duration_minutes: string;
        hint: unknown;
        created_at: Date;
      }
    >(
      `
        SELECT
          b.id,
          b.bet_id::text AS bet_id,
          b.bet_address,
          b.status,
          b.settle_timestamp_unix,
          b.hint,
          b.threshold_percent::text AS threshold_percent,
          b.duration_minutes::text AS duration_minutes,
          b.created_at
        FROM bets b
        WHERE ($1::text IS NULL OR b.status = $1::text)
          AND (b.status <> 'live' OR b.settle_timestamp_unix > $2)
        ORDER BY b.id DESC
        LIMIT $3
      `,
      [status ?? null, nowSec, limit],
    );

    // Avoid returning huge hint/join_fund_audit by default.
    return res.json({
      count: q.rowCount ?? 0,
      nowSec,
      bets: q.rows.map((r) => ({
        id: r.id,
        betId: r.bet_id,
        betAddress: r.bet_address,
        status: r.status,
        settleTimestampUnix: r.settle_timestamp_unix.toString(),
        hint: r.hint,
        thresholdPercent: r.threshold_percent,
        durationMinutes: r.duration_minutes,
        createdAt: r.created_at,
      })),
    });
  }),
);

const setOutcomeBodySchema = z
  .object({
    betRowId: z.number().int().positive().optional(),
    betAddress: z.string().optional(),
    yesWon: z.boolean(),
    winningEscrowTotal: z.string().regex(/^\d+$/).optional(),
    useTotalEscrow: z.boolean().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.betRowId === undefined && (val.betAddress === undefined || val.betAddress.trim() === "")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide betRowId or betAddress" });
    }
    if (val.betAddress !== undefined && val.betAddress.trim() !== "" && !isAddress(val.betAddress.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "betAddress is not a valid address",
        path: ["betAddress"],
      });
    }
    const hasW = val.winningEscrowTotal !== undefined;
    const useT = val.useTotalEscrow === true;
    if (!hasW && !useT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provide winningEscrowTotal (raw token amount, smallest units) or useTotalEscrow: true to use on-chain totalEscrow",
      });
    }
    if (hasW && useT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use only one of winningEscrowTotal or useTotalEscrow",
      });
    }
  });

type BetRowPick = {
  id: number;
  bet_id: string;
  bet_address: string;
};

type JoinStep = {
  name: string;
  ok: boolean;
  at: string;
  detail?: string;
  txHash?: string;
  error?: string;
};

type JoinFundAudit = {
  updatedAt: string;
  agentName: string;
  agentWallet: string | null;
  smartAccountAddress: string | null;
  betInternalId: number | null;
  betId: string | null;
  betAddress: string | null;
  joinTxHash: string | null;
  fundTxHash: string | null;
  voteTxHash: string | null;
  voteYes: boolean | null;
  fundAmountRaw: string | null;
  success: boolean;
  failedAtStep: string | null;
  steps: JoinStep[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

async function fetchEthPriceHintUsd(): Promise<number> {
  const resp = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch ETH price hint: ${resp.status}`);
  }
  const json = (await resp.json()) as { ethereum?: { usd?: number } };
  const price = json.ethereum?.usd;
  if (typeof price !== "number") {
    throw new Error("ETH price hint missing in response");
  }
  return price;
}

router.post("/create", asyncHandler(async (_req, res) => {
  const percent = Number(randomBetween(1, 3).toFixed(1));
  const durationMinutes = Number(randomBetween(0.5, 2).toFixed(1));
  const startTimestampUnix = Math.floor(Date.now() / 1000);
  const settleTimestampUnix = Math.floor(startTimestampUnix + durationMinutes * 60);

  const questionRaw =
    `will eth prices go ${percent}% in next ${durationMinutes} minutes from now ? ` +
    `timestamp ${startTimestampUnix}`;
  const betHash = keccak256(stringToHex(questionRaw));

  const chainResult = await createBetWithRelayer({
    betHash,
    questionRaw,
    startTimestampUnix,
    settleTimestampUnix,
  });

  const ethPriceHintUsd = await fetchEthPriceHintUsd();
  const hint = { ethPriceHintUsd };

  await db.query(
    `
      INSERT INTO bets (
        bet_id,
        bet_address,
        bet_hash,
        question_raw,
        threshold_percent,
        duration_minutes,
        start_timestamp_unix,
        settle_timestamp_unix,
        status,
        hint
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    [
      chainResult.betId.toString(),
      chainResult.betAddress,
      betHash,
      questionRaw,
      percent,
      durationMinutes,
      startTimestampUnix,
      settleTimestampUnix,
      "live",
      hint,
    ],
  );

  return res.status(201).json({ ethPriceHintUsd, status: "live", hint });
}));

/**
 * Creator-only: `Bet.setOutcome(yesWon, winningEscrowTotal_)`. Server `PRIVATE_KEY` must be the bet creator (same as create).
 * `winningEscrowTotal_` must equal the sum of `escrowed` for voters on the winning side (for correct `distributeWinners`).
 */
router.post("/set-outcome", asyncHandler(async (req, res) => {
  const parsed = setOutcomeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  if (!config.privateKey) {
    return res.status(503).json({ error: "PRIVATE_KEY is not configured on the server" });
  }

  let bet: `0x${string}`;
  let betRowId: number | null = null;

  if (parsed.data.betRowId !== undefined) {
    const q = await db.query<{ id: number; bet_address: string }>(
      `SELECT id, bet_address FROM bets WHERE id = $1`,
      [parsed.data.betRowId],
    );
    if (q.rowCount === 0) {
      return res.status(404).json({ error: "betRowId not found" });
    }
    const row = q.rows[0];
    if (!isAddress(row.bet_address)) {
      return res.status(500).json({ error: "Invalid bet_address in database" });
    }
    betRowId = row.id;
    bet = row.bet_address as `0x${string}`;
  } else {
    const addr = parsed.data.betAddress!.trim();
    bet = addr as `0x${string}`;
    const q = await db.query<{ id: number }>(`SELECT id FROM bets WHERE lower(bet_address) = lower($1)`, [bet]);
    if (q.rowCount && q.rowCount > 0) {
      betRowId = q.rows[0].id;
    }
  }

  let winningEscrowTotal: bigint;
  try {
    if (parsed.data.useTotalEscrow) {
      winningEscrowTotal = await readBetTotalEscrow(bet);
    } else {
      winningEscrowTotal = BigInt(parsed.data.winningEscrowTotal!);
    }
  } catch (e) {
    const msg = participationErrorMessage(e);
    return res.status(400).json({ error: msg });
  }

  let txHash: `0x${string}`;
  try {
    txHash = await setBetOutcomeTx({
      bet,
      yesWon: parsed.data.yesWon,
      winningEscrowTotal,
    });
  } catch (e) {
    const msg = participationErrorMessage(e);
    return res.status(502).json({ error: msg, betAddress: bet });
  }

  if (betRowId !== null) {
    await db.query(
      `UPDATE bets SET
        status = 'settled',
        outcome_yes_won = $2,
        outcome_tx_hash = $3,
        outcome_winning_escrow_total_raw = $4
      WHERE id = $1`,
      [betRowId, parsed.data.yesWon, txHash, winningEscrowTotal.toString()],
    );
  }

  return res.status(200).json({
    success: true,
    betAddress: bet,
    betRowId,
    yesWon: parsed.data.yesWon,
    winningEscrowTotal: winningEscrowTotal.toString(),
    txHash,
  });
}));

/**
 * Resolve agent by name, pick newest live bet still in join window, SCW betJoin → (2s) betFundWithDelegation →
 * Groth16 prove vote_yes + vote_no → betVote with the chosen side. Audit in `bets.join_fund_audit`; per-agent row in `agent_bet_participations`.
 */
router.post("/join-with-agent", asyncHandler(async (req, res) => {
  const parsed = joinWithAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  if (!config.privateKey) {
    return res.status(503).json({ error: "PRIVATE_KEY is not configured on the server" });
  }

  const steps: JoinStep[] = [];
  const push = (partial: Omit<JoinStep, "at"> & { at?: string }) => {
    steps.push({ ...partial, at: partial.at ?? new Date().toISOString() });
  };

  let betDbId: number | null = null;
  let participationId: number | null = null;
  const participationDetail: Record<string, unknown> = {
    voteYesRequested: parsed.data.voteYes,
    voteSecretProvided: true,
  };

  const audit: JoinFundAudit = {
    updatedAt: "",
    agentName: parsed.data.agentName.trim(),
    agentWallet: null,
    smartAccountAddress: null,
    betInternalId: null,
    betId: null,
    betAddress: null,
    joinTxHash: null,
    fundTxHash: null,
    voteTxHash: null,
    voteYes: parsed.data.voteYes,
    fundAmountRaw: null,
    success: false,
    failedAtStep: null,
    steps,
  };

  const persistAudit = async () => {
    audit.updatedAt = new Date().toISOString();
    audit.steps = steps;
    if (betDbId === null) return;
    await db.query(`UPDATE bets SET join_fund_audit = $1::jsonb WHERE id = $2`, [audit, betDbId]);
  };

  const persistParticipation = async (status: string) => {
    if (participationId === null) return;
    const detail = { ...participationDetail, steps };
    await db.query(
      `UPDATE agent_bet_participations SET
        status = $2,
        join_tx_hash = $3,
        fund_tx_hash = $4,
        vote_tx_hash = $5,
        vote_yes = $6,
        detail_json = $7::jsonb,
        updated_at = NOW()
      WHERE id = $1`,
      [
        participationId,
        status,
        audit.joinTxHash,
        audit.fundTxHash,
        audit.voteTxHash,
        audit.voteYes,
        JSON.stringify(detail),
      ],
    );
  };

  const agentName = parsed.data.agentName.trim();

  const agents = await db.query<AgentRow>(
    "SELECT * FROM agents WHERE agent_name = $1 ORDER BY id ASC",
    [agentName],
  );
  const nAgents = agents.rowCount ?? 0;
  if (nAgents === 0) {
    push({ name: "resolve_agent", ok: false, error: "Agent not found" });
    audit.failedAtStep = "resolve_agent";
    await persistAudit();
    return res.status(404).json({ success: false, steps });
  }
  if (nAgents > 1) {
    push({
      name: "resolve_agent",
      ok: false,
      error: "Multiple agents share this agent_name",
      detail: agents.rows.map((r) => r.wallet_address).join(","),
    });
    audit.failedAtStep = "resolve_agent";
    await persistAudit();
    return res.status(409).json({ success: false, steps });
  }

  const agent = agents.rows[0];
  push({ name: "resolve_agent", ok: true, detail: agent.wallet_address });
  audit.agentWallet = agent.wallet_address;

  const scwRaw = agent.smart_account_address;
  if (!scwRaw || !isAddress(scwRaw)) {
    push({ name: "smart_account", ok: false, error: "Agent has no smart_account_address" });
    audit.failedAtStep = "smart_account";
    await persistAudit();
    return res.status(400).json({ success: false, steps });
  }
  const scw = scwRaw as `0x${string}`;
  push({ name: "smart_account", ok: true, detail: scw });
  audit.smartAccountAddress = scw;

  const nowSec = Math.floor(Date.now() / 1000);
  const betsQ = await db.query<BetRowPick>(
    `
      SELECT id, bet_id::text AS bet_id, bet_address
      FROM bets
      WHERE status = 'live' AND settle_timestamp_unix > $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [nowSec],
  );
  if (betsQ.rowCount === 0) {
    push({ name: "resolve_live_bet", ok: false, error: "No live bet still in join window" });
    audit.failedAtStep = "resolve_live_bet";
    await persistAudit();
    return res.status(404).json({ success: false, steps });
  }

  const betRow = betsQ.rows[0];
  betDbId = betRow.id;
  const betAddr = betRow.bet_address;
  if (!isAddress(betAddr)) {
    push({ name: "resolve_live_bet", ok: false, error: "Invalid bet_address in database" });
    audit.failedAtStep = "resolve_live_bet";
    await persistAudit();
    return res.status(500).json({ success: false, steps });
  }
  const bet = betAddr as `0x${string}`;
  push({
    name: "resolve_live_bet",
    ok: true,
    detail: `${bet} bet_id=${betRow.bet_id}`,
  });
  audit.betInternalId = betRow.id;
  audit.betId = betRow.bet_id;
  audit.betAddress = bet;

  let fundAmount: bigint;
  try {
    if (config.betFundAmountRaw) {
      fundAmount = BigInt(config.betFundAmountRaw);
    } else {
      fundAmount = parseUnits(config.betFundAmountUsdc, config.betTokenDecimals);
    }
    if (fundAmount <= 0n) {
      throw new Error("Fund amount must be > 0");
    }
  } catch (e) {
    const msg = participationErrorMessage(e);
    push({ name: "fund_amount", ok: false, error: msg });
    audit.failedAtStep = "fund_amount";
    await persistAudit();
    return res.status(400).json({ success: false, error: msg, steps });
  }
  audit.fundAmountRaw = fundAmount.toString();
  push({
    name: "fund_amount",
    ok: true,
    detail: `raw=${fundAmount.toString()} decimals=${config.betTokenDecimals}`,
  });

  const insP = await db.query<{ id: string }>(
    `
      INSERT INTO agent_bet_participations (
        agent_wallet_address, agent_name, bet_row_id, bet_address, onchain_bet_id, status, vote_yes, detail_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      RETURNING id
    `,
    [
      agent.wallet_address,
      agentName,
      betRow.id,
      bet,
      betRow.bet_id,
      "before_join",
      parsed.data.voteYes,
      JSON.stringify({ ...participationDetail, steps: [] }),
    ],
  );
  participationId = Number(insP.rows[0].id);

  try {
    const joinHash = await scwBetJoinTx({ scw, bet });
    push({ name: "bet_join", ok: true, txHash: joinHash });
    audit.joinTxHash = joinHash;
  } catch (e) {
    const msg = participationErrorMessage(e);
    push({ name: "bet_join", ok: false, error: msg });
    audit.failedAtStep = "bet_join";
    await persistParticipation("failed_join");
    await persistAudit();
    return res.status(502).json({ success: false, error: msg, steps });
  }

  await persistParticipation("joined");
  await sleep(2000);
  push({ name: "sleep_before_fund", ok: true, detail: "2000ms" });

  try {
    const fundHash = await scwBetFundWithDelegationTx({ scw, bet, amount: fundAmount });
    push({ name: "bet_fund_with_delegation", ok: true, txHash: fundHash });
    audit.fundTxHash = fundHash;
  } catch (e) {
    const msg = participationErrorMessage(e);
    push({ name: "bet_fund_with_delegation", ok: false, error: msg });
    audit.failedAtStep = "bet_fund_with_delegation";
    await persistParticipation("failed_fund");
    await persistAudit();
    return res.status(502).json({ success: false, error: msg, steps });
  }

  await persistParticipation("funded");

  let proved: Awaited<ReturnType<typeof proveVote>>;
  try {
    proved = await proveVote({
      betId: betRow.bet_id,
      secret: parsed.data.voteSecret,
      voteYes: parsed.data.voteYes,
    });
    participationDetail.zkBuildRoot = proved.buildRoot;
    participationDetail.voteCircuit = proved.circuit;
    participationDetail.voteProof = {
      proof: proved.bundle.proof,
      publicInputs: proved.bundle.publicInputs,
    };
    push({
      name: "zk_prove_vote",
      ok: true,
      detail: `circuit=${proved.circuit} buildRoot=${proved.buildRoot}`,
    });
  } catch (e) {
    const msg = participationErrorMessage(e);
    push({ name: "zk_prove_vote", ok: false, error: msg });
    audit.failedAtStep = "zk_prove_vote";
    await persistParticipation("failed_prove");
    await persistAudit();
    return res.status(502).json({ success: false, error: msg, steps });
  }

  await persistParticipation("proofs_ready");

  try {
    const voteHash = await scwBetVoteTx({
      scw,
      bet,
      proof: proved.bundle.proof,
      publicInputs: proved.bundle.publicInputs,
    });
    push({ name: "bet_vote", ok: true, txHash: voteHash, detail: parsed.data.voteYes ? "yes" : "no" });
    audit.voteTxHash = voteHash;
  } catch (e) {
    const msg = participationErrorMessage(e);
    push({ name: "bet_vote", ok: false, error: msg });
    audit.failedAtStep = "bet_vote";
    await persistParticipation("failed_vote");
    await persistAudit();
    return res.status(502).json({ success: false, error: msg, steps });
  }

  audit.success = true;
  audit.failedAtStep = null;
  await persistParticipation("completed");
  await persistAudit();
  return res.status(200).json({
    success: true,
    betAddress: bet,
    joinTxHash: audit.joinTxHash,
    fundTxHash: audit.fundTxHash,
    voteTxHash: audit.voteTxHash,
    voteYes: audit.voteYes,
    steps,
  });
}));

/**
 * Prize distribution (creator only on-chain):
 * - `betRowId` identifies a row in `bets` (server DB).
 * - For all `agent_bet_participations` with status `completed`, verify the stored Groth16 proof
 *   against the "true verifier" circuit derived from on-chain `outcome_yes_won`.
 * - Verified voters are passed as winners into `Bet.distributeWinners(winners)`.
 */
router.post("/distribute-prizes/:betRowId", asyncHandler(async (req, res) => {
  const betRowIdRaw = req.params.betRowId;
  const betRowId = Number(betRowIdRaw);
  if (!Number.isFinite(betRowId) || !Number.isInteger(betRowId) || betRowId <= 0) {
    return res.status(400).json({ error: "betRowId must be a positive integer" });
  }

  if (!config.privateKey) {
    return res.status(503).json({ error: "PRIVATE_KEY is not configured on the server" });
  }

  const betQ = await db.query<{
    id: number;
    bet_address: string;
    bet_id: bigint | string;
    outcome_yes_won: boolean | null;
    status: string;
  }>(
    `
      SELECT id, bet_address, bet_id, outcome_yes_won, status
      FROM bets
      WHERE id = $1
    `,
    [betRowId],
  );
  if (betQ.rowCount === 0) {
    return res.status(404).json({ error: "betRowId not found" });
  }

  const betRow = betQ.rows[0];
  if (!isAddress(betRow.bet_address)) {
    return res.status(500).json({ error: "Invalid bet_address in database" });
  }

  if (betRow.outcome_yes_won === null) {
    return res.status(400).json({ error: "Bet outcome is not set yet in DB (outcome_yes_won is NULL)" });
  }

  const expectedCircuit: "vote_yes" | "vote_no" = betRow.outcome_yes_won
    ? "vote_yes"
    : "vote_no";

  const participations = await db.query<{
    id: number;
    agent_wallet_address: string;
    agent_name: string;
    smart_account_address: string | null;
    status: string;
    detail_json: any;
  }>(
    `
      SELECT
        abp.id,
        abp.agent_wallet_address,
        abp.agent_name,
        abp.status,
        abp.detail_json,
        a.smart_account_address
      FROM agent_bet_participations abp
      JOIN agents a
        ON a.wallet_address = abp.agent_wallet_address
      WHERE abp.bet_row_id = $1
      ORDER BY abp.id ASC
    `,
    [betRowId],
  );

  const winners = new Set<`0x${string}`>();
  const verificationResults: Array<{
    agentWallet: string;
    scw: string | null;
    ok: boolean;
    error?: string;
  }> = [];

  const completed = participations.rows.filter((p) => p.status === "completed");

  for (const p of completed) {
    let scw: `0x${string}` | null = null;
    if (p.smart_account_address && isAddress(p.smart_account_address)) {
      scw = p.smart_account_address as `0x${string}`;
    }

    const storedVoteProof = p.detail_json?.voteProof;
    if (!storedVoteProof?.proof || !storedVoteProof?.publicInputs) {
      verificationResults.push({
        agentWallet: p.agent_wallet_address,
        scw,
        ok: false,
        error: "Missing voteProof in detail_json",
      });
      await db.query(
        `
          UPDATE agent_bet_participations
          SET status = 'prize_loser_missing_proof',
              detail_json = $2::jsonb,
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          p.id,
          JSON.stringify({
            ...p.detail_json,
            prizeDistribution: { verified: false, expectedCircuit },
          }),
        ],
      );
      continue;
    }

    if (!scw) {
      verificationResults.push({
        agentWallet: p.agent_wallet_address,
        scw: p.smart_account_address ?? null,
        ok: false,
        error: "Missing/invalid smart_account_address for agent",
      });
      await db.query(
        `
          UPDATE agent_bet_participations
          SET status = 'prize_loser_missing_scw',
              detail_json = $2::jsonb,
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          p.id,
          JSON.stringify({
            ...p.detail_json,
            prizeDistribution: { verified: false, expectedCircuit },
          }),
        ],
      );
      continue;
    }

    let ok = false;
    let err: string | undefined = undefined;
    try {
      ok = await verifyVoteProof({
        circuit: expectedCircuit,
        betId: String(betRow.bet_id),
        proof: storedVoteProof,
      });
    } catch (e) {
      err = participationErrorMessage(e);
    }

    verificationResults.push({
      agentWallet: p.agent_wallet_address,
      scw,
      ok: ok === true,
      error: ok ? undefined : err ?? "Proof verification failed",
    });

    if (ok) {
      winners.add(scw);
      await db.query(
        `
          UPDATE agent_bet_participations
          SET status = 'prize_winner_verified',
              detail_json = $2::jsonb,
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          p.id,
          JSON.stringify({
            ...p.detail_json,
            prizeDistribution: { verified: true, expectedCircuit },
          }),
        ],
      );
    } else {
      await db.query(
        `
          UPDATE agent_bet_participations
          SET status = 'prize_loser_invalid_proof',
              detail_json = $2::jsonb,
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          p.id,
          JSON.stringify({
            ...p.detail_json,
            prizeDistribution: { verified: false, expectedCircuit, error: err },
          }),
        ],
      );
    }
  }

  if (winners.size === 0) {
    return res.status(400).json({
      error: "No winners passed ZK proof verification for expected circuit",
      expectedCircuit,
      verifiedCount: completed.length,
    });
  }

  const winnersArr = Array.from(winners);
  let txHash: `0x${string}`;
  try {
    txHash = await distributeWinnersTx({
      bet: betRow.bet_address as `0x${string}`,
      winners: winnersArr,
    });
  } catch (e) {
    const msg = participationErrorMessage(e);
    return res.status(502).json({ error: msg });
  }

  await db.query(
    `
      UPDATE bets
      SET status = 'settled',
          distribute_tx_hash = $2,
          distributed_at = NOW(),
          winners_count = $3
      WHERE id = $1
    `,
    [betRowId, txHash, winnersArr.length],
  );

  return res.status(200).json({
    success: true,
    betRowId,
    expectedCircuit,
    winnersCount: winnersArr.length,
    winners: winnersArr,
    distributeTxHash: txHash,
    verificationResults: verificationResults.slice(0, 50),
  });
}));

export { router as betsRouter };
