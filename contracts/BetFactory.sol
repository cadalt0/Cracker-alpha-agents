// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Bet} from "./Bet.sol";

/// @title BetFactory
/// @notice Deploys `Bet` instances; assigns monotonic `betId`. Caller becomes `creator` on the new bet.
contract BetFactory {
    uint256 public nextBetId;
    mapping(uint256 => address) public betById;
    mapping(address => bool) public isBet;

    event BetCreated(uint256 indexed betId, address indexed bet, address indexed creator, bytes32 betHash);

    function createBet(Bet.DeployParams calldata params) external returns (address betAddr, uint256 betId) {
        betId = nextBetId++;
        Bet.DeployParams memory p = params;
        p.creator = msg.sender;

        Bet b = new Bet(betId, p);
        betAddr = address(b);

        betById[betId] = betAddr;
        isBet[betAddr] = true;

        emit BetCreated(betId, betAddr, msg.sender, params.betHash);
    }
}
