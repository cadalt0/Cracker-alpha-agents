// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IERC20Minimal} from "../../interfaces/IERC20Minimal.sol";

/// @notice ERC-20 used by `BetSmartAccount` (approve for `Bet.fund` pull).
interface IERC20Approve is IERC20Minimal {
    function approve(address spender, uint256 value) external returns (bool);
}
