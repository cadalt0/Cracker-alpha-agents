// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";
import {IZKVerifier} from "./interfaces/IZKVerifier.sol";

/// @title Bet
/// @notice Register (`join`) → deposit (`fund`) → `vote` (anytime after fund, until `voteDeadline`) → creator `setOutcome` → `distributeWinners`.
/// @dev `join` only until `joinDeadline`. `vote` does not wait for `joinDeadline` (overlap allowed). Creator may `setOutcome` anytime before outcome is set (early resolution closes new joins).
contract Bet {
    enum Outcome {
        Unset,
        Yes,
        No
    }

    struct DeployParams {
        bytes32 betHash;
        bytes betZkProof;
        bytes betHints;
        bytes otherData;
        address creator;
        address token;
        uint64 joinDeadline;
        uint64 voteDeadline;
        address betVerifier;
        bool verifyBetAtDeploy;
    }

    struct VoteRecord {
        uint256 voteIndex;
        bytes proof;
        bytes publicInputs;
        uint64 submittedAt;
    }

    address public immutable factory;
    address public immutable creator;
    IERC20Minimal public immutable token;
    uint256 public immutable betId;
    uint64 public immutable joinDeadline;
    uint64 public immutable voteDeadline;

    IZKVerifier public immutable betVerifier;

    bytes32 public immutable betHash;
    uint64 public immutable createdAt;

    bytes public betZkProof;
    bytes public betHints;
    bytes public otherData;

    /// @dev Address called `join` (registered for this bet).
    mapping(address => bool) public joined;
    /// @dev Address completed `fund` (ERC-20 escrowed once).
    mapping(address => bool) public funded;
    mapping(address => uint256) public escrowed;
    uint256 public totalEscrow;

    address[] private _joiners;

    mapping(address => bool) public hasVoted;
    mapping(address => VoteRecord) public voteByVoter;
    mapping(address => bool) public claimed;

    address[] private _voters;

    Outcome public outcome;
    uint256 public potSnapshot;
    uint256 public winningEscrowTotal;

    event ParticipantJoined(address indexed participant);
    event Funded(address indexed participant, uint256 amount);
    event VoteCast(
        uint256 indexed voteIndex,
        address indexed voter,
        bytes proof,
        bytes publicInputs,
        uint64 submittedAt
    );
    event OutcomeSet(Outcome indexed outcome, uint256 potSnapshot, uint256 winningEscrowTotal);
    event PrizePaid(address indexed recipient, uint256 payout);

    error WrongPhase();
    error NotJoined();
    error AlreadyJoined();
    error NotFunded();
    error AlreadyFunded();
    error AlreadyVoted();
    error AlreadyClaimed();
    error BetProofInvalid();
    error ZeroAmount();
    error InvalidAddress();
    error NotCreator();
    error OutcomeAlreadySet();
    error InvalidWinningEscrowTotal();
    error ZeroPayout();
    error NotVoter(address who);

    modifier onlyCreator() {
        if (msg.sender != creator) revert NotCreator();
        _;
    }

    constructor(uint256 betId_, DeployParams memory p) {
        if (p.creator == address(0) || p.token == address(0)) revert InvalidAddress();
        if (p.joinDeadline >= p.voteDeadline) revert WrongPhase();

        factory = msg.sender;
        creator = p.creator;
        token = IERC20Minimal(p.token);
        betId = betId_;
        joinDeadline = p.joinDeadline;
        voteDeadline = p.voteDeadline;

        betVerifier = IZKVerifier(p.betVerifier);

        betHash = p.betHash;
        createdAt = uint64(block.timestamp);

        betZkProof = p.betZkProof;
        betHints = p.betHints;
        otherData = p.otherData;

        if (p.verifyBetAtDeploy && address(betVerifier) != address(0)) {
            if (!betVerifier.verify(p.betZkProof, abi.encode(p.betHash))) revert BetProofInvalid();
        }
    }

    function joinerCount() external view returns (uint256) {
        return _joiners.length;
    }

    function joinerAt(uint256 index) external view returns (address) {
        return _joiners[index];
    }

    function voterCount() external view returns (uint256) {
        return _voters.length;
    }

    function voterAt(uint256 index) external view returns (address) {
        return _voters[index];
    }

    /// @notice Registration only (no token movement). Smart account opts in before funding.
    function join() external {
        if (block.timestamp > joinDeadline) revert WrongPhase();
        if (outcome != Outcome.Unset) revert WrongPhase();
        if (joined[msg.sender]) revert AlreadyJoined();

        joined[msg.sender] = true;
        _joiners.push(msg.sender);

        emit ParticipantJoined(msg.sender);
    }

    /// @notice Escrows `amount` for `msg.sender` after `join`.
    /// @dev ERC-20 cannot safely attribute a plain `transfer(bet, amount)` to `msg.sender` on a later call (donations / ordering),
    ///      so this uses `transferFrom(msg.sender, this, amount)` — the tokens still move **from the smart account** when it calls
    ///      `fund`. Typical AA flow: one UserOp bundles `approve`/`permit` + `fund` so the user signs once (same UX as “wallet sends”).
    function fund(uint256 amount) external {
        if (outcome != Outcome.Unset) revert WrongPhase();
        if (!joined[msg.sender]) revert NotJoined();
        if (funded[msg.sender]) revert AlreadyFunded();
        if (block.timestamp > voteDeadline) revert WrongPhase();
        if (amount == 0) revert ZeroAmount();

        require(token.transferFrom(msg.sender, address(this), amount), "fund: transferFrom");

        funded[msg.sender] = true;
        escrowed[msg.sender] = amount;
        totalEscrow += amount;

        emit Funded(msg.sender, amount);
    }

    /// @notice Requires `joined` + `funded`; stores proof for off-chain ZK verification.
    /// @dev Voting is allowed as soon as funded, until `voteDeadline` (independent of `joinDeadline`).
    function vote(bytes calldata proof, bytes calldata publicInputs) external {
        if (outcome != Outcome.Unset) revert WrongPhase();
        if (block.timestamp > voteDeadline) revert WrongPhase();
        if (!joined[msg.sender]) revert NotJoined();
        if (!funded[msg.sender]) revert NotFunded();
        if (hasVoted[msg.sender]) revert AlreadyVoted();

        hasVoted[msg.sender] = true;
        uint256 voteIndex = _voters.length;
        _voters.push(msg.sender);
        voteByVoter[msg.sender] = VoteRecord({
            voteIndex: voteIndex,
            proof: proof,
            publicInputs: publicInputs,
            submittedAt: uint64(block.timestamp)
        });

        emit VoteCast(voteIndex, msg.sender, proof, publicInputs, uint64(block.timestamp));
    }

    /// @notice Locks outcome; after this, `join` / `fund` / `vote` revert. Creator can call before `joinDeadline` to end the bet early.
    function setOutcome(bool yesWon, uint256 winningEscrowTotal_) external onlyCreator {
        if (outcome != Outcome.Unset) revert OutcomeAlreadySet();
        if (winningEscrowTotal_ == 0 || winningEscrowTotal_ > totalEscrow) revert InvalidWinningEscrowTotal();

        outcome = yesWon ? Outcome.Yes : Outcome.No;
        potSnapshot = token.balanceOf(address(this));
        winningEscrowTotal = winningEscrowTotal_;

        emit OutcomeSet(outcome, potSnapshot, winningEscrowTotal_);
    }

    function distributeWinners(address[] calldata winners) external onlyCreator {
        if (outcome == Outcome.Unset) revert WrongPhase();
        for (uint256 i = 0; i < winners.length; ) {
            address w = winners[i];
            if (!hasVoted[w]) revert NotVoter(w);
            if (claimed[w]) revert AlreadyClaimed();

            uint256 stake = escrowed[w];
            uint256 payout = _mulDiv(potSnapshot, stake, winningEscrowTotal);
            if (payout == 0) revert ZeroPayout();

            claimed[w] = true;
            require(token.transfer(w, payout), "distribute: transfer");
            emit PrizePaid(w, payout);

            unchecked {
                ++i;
            }
        }
    }

    function _mulDiv(uint256 x, uint256 y, uint256 d) private pure returns (uint256) {
        if (d == 0) return 0;
        unchecked {
            if (x == 0 || y == 0) return 0;
            require(x <= type(uint256).max / y, "mulDiv overflow");
            return (x * y) / d;
        }
    }
}
