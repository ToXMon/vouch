// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {Vouch} from "../src/Vouch.sol";

/**
 * @title DeployVouch
 * @notice Deployment script for Vouch contract on Monad testnet.
 * @dev Usage:
 *      forge script script/DeployVouch.s.sol:DeployVouch \
 *          --rpc-url monad_testnet \
 *          --broadcast \
 *          --private-key $PRIVATE_KEY
 *
 *      Set ADJUDICATOR env var to specify the AI agent wallet address.
 *      If unset, defaults to the deployer (msg.sender) — replace with multisig for production.
 */
contract DeployVouch is Script {
    function run() external returns (Vouch vouch) {
        // Read adjudicator from env, default to deployer for testnet
        address adjudicator = vm.envOr("ADJUDICATOR", msg.sender);

        if (adjudicator == address(0)) {
            revert("ADJUDICATOR cannot be zero address");
        }

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        vouch = new Vouch(adjudicator);

        vm.stopBroadcast();

        console2.log("Vouch deployed at:", address(vouch));
        console2.log("Adjudicator:", adjudicator);
    }
}
