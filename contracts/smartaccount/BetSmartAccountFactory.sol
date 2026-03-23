// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {BetSmartAccount} from "./BetSmartAccount.sol";

/// @title BetSmartAccountFactory
/// @notice Deploys `BetSmartAccount` instances; pass the EOA (or owner) that will control the account.
contract BetSmartAccountFactory {
    event SmartAccountCreated(address indexed account, address indexed owner);

    error InvalidOwner();

    /// @notice Deploy a new smart account whose `owner` is `owner_`.
    function createSmartAccount(address owner_) external returns (address account) {
        if (owner_ == address(0)) revert InvalidOwner();
        BetSmartAccount deployed = new BetSmartAccount(owner_);
        account = address(deployed);
        emit SmartAccountCreated(account, owner_);
    }
}
