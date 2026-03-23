// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IDelegationManager} from "./interfaces/IDelegationManager.sol";
import {IBet} from "./interfaces/IBet.sol";
import {IERC20Approve} from "./interfaces/IERC20Approve.sol";

/// @title BetSmartAccount
/// @notice Dedicated account for a bettor: calls `Bet.join` / `fund` / `vote`, stores ERC-7715 delegation fields (updatable on re-grant).
/// @dev `betFundWithDelegation` mirrors the Circle example: `redeemDelegations` runs `token.transfer(this, amount)` under the delegated
///      permission, then this contract `approve`s the bet and calls `bet.fund(amount)`.
contract BetSmartAccount {
    address public owner;

    /// @dev All fields replaceable via `setDelegation` when the user re-grants in MetaMask.
    struct DelegationConfig {
        string tokenName;
        address token;
        bytes permissionsContext;
        address delegationManager;
        /// @dev 0 = no per-tx cap.
        uint256 maxAmountPerTx;
        /// @dev 0 = no expiry.
        uint64 expiry;
        bool enabled;
    }

    DelegationConfig public delegation;

    /// @dev If set, `bet*` targets must equal this address. address(0) = allow any `bet` param.
    address public allowedBet;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AllowedBetSet(address indexed bet);
    event DelegationUpdated(
        string tokenName,
        address indexed token,
        address indexed delegationManager,
        uint256 maxAmountPerTx,
        uint64 expiry,
        bool enabled
    );
    event BetJoined(address indexed bet);
    event BetFunded(address indexed bet, uint256 amount, bool usedDelegation);
    event BetVoted(address indexed bet);

    error OnlyOwner();
    error InvalidAddress();
    error DelegationDisabled();
    error DelegationExpired();
    error AmountAboveMax();
    error BetNotAllowed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert InvalidAddress();
        owner = owner_;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Pin optional single bet contract; pass address(0) to clear.
    function setAllowedBet(address bet) external onlyOwner {
        allowedBet = bet;
        emit AllowedBetSet(bet);
    }

    /// @notice Overwrites delegation metadata when user re-signs / updates MM permission.
    function setDelegation(
        string calldata tokenName_,
        address token_,
        bytes calldata permissionsContext_,
        address delegationManager_,
        uint256 maxAmountPerTx_,
        uint64 expiry_,
        bool enabled_
    ) external onlyOwner {
        if (token_ == address(0) || delegationManager_ == address(0)) revert InvalidAddress();
        delegation.tokenName = tokenName_;
        delegation.token = token_;
        delegation.permissionsContext = permissionsContext_;
        delegation.delegationManager = delegationManager_;
        delegation.maxAmountPerTx = maxAmountPerTx_;
        delegation.expiry = expiry_;
        delegation.enabled = enabled_;
        emit DelegationUpdated(
            tokenName_, token_, delegationManager_, maxAmountPerTx_, expiry_, enabled_
        );
    }

    function _requireAllowedBet(address bet) internal view {
        if (allowedBet != address(0) && bet != allowedBet) revert BetNotAllowed();
    }

    function _requireDelegationLimits(uint256 amount) internal view {
        if (!delegation.enabled) revert DelegationDisabled();
        if (delegation.expiry != 0 && block.timestamp > delegation.expiry) revert DelegationExpired();
        if (delegation.maxAmountPerTx != 0 && amount > delegation.maxAmountPerTx) revert AmountAboveMax();
    }

    function betJoin(address bet) external onlyOwner {
        _requireAllowedBet(bet);
        IBet(bet).join();
        emit BetJoined(bet);
    }

    function betFund(address bet, uint256 amount) external onlyOwner {
        _requireAllowedBet(bet);
        IBet(bet).fund(amount);
        emit BetFunded(bet, amount, false);
    }

    function betVote(address bet, bytes calldata proof, bytes calldata publicInputs) external onlyOwner {
        _requireAllowedBet(bet);
        IBet(bet).vote(proof, publicInputs);
        emit BetVoted(bet);
    }

    /// @notice Delegated ERC-20 `transfer` into this SCW, then `approve` + `Bet.fund`.
    /// @dev `redeemDelegations` encoding matches `Circle.transferToken` in
    ///      `delegationexample/erc-7715-advanced-payments/contracts/Circle.sol` (lines 319–348):
    ///      `transfer(address,uint256)` calldata, `encodePacked(token, 0, transferCalldata)`,
    ///      single `bytes32(0)` execution mode. Only deliberate difference: recipient is `address(this)` not a free-form address.
    function betFundWithDelegation(address bet, uint256 amount) external onlyOwner {
        _requireAllowedBet(bet);
        _requireDelegationLimits(amount);

        address tokenAddr = delegation.token;
        bytes memory ctx = delegation.permissionsContext;
        address dmAddr = delegation.delegationManager;

        bytes memory transferCalldata =
            abi.encodeWithSignature("transfer(address,uint256)", address(this), amount);

        bytes memory executionCalldata =
            abi.encodePacked(tokenAddr, uint256(0), transferCalldata);

        bytes[] memory permissionContexts = new bytes[](1);
        permissionContexts[0] = ctx;

        bytes32[] memory executionModes = new bytes32[](1);
        executionModes[0] = bytes32(0);

        bytes[] memory executionCalldatas = new bytes[](1);
        executionCalldatas[0] = executionCalldata;

        IDelegationManager(dmAddr).redeemDelegations(permissionContexts, executionModes, executionCalldatas);

        IERC20Approve erc20 = IERC20Approve(tokenAddr);
        require(erc20.approve(bet, amount), "BetSmartAccount: approve");

        IBet(bet).fund(amount);

        emit BetFunded(bet, amount, true);
    }

    receive() external payable {}
}
