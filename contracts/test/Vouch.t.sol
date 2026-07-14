// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {Vouch} from "../src/Vouch.sol";

/**
 * @title VouchTest
 * @notice Comprehensive test suite for Vouch contract.
 *         Covers: create+stake, evidence submit, challenge window,
 *         auto-settle, disputed settle, reentrancy protection, access control.
 */
contract VouchTest is Test {
    Vouch public vouch;

    address public creator = makeAddr("creator");
    address public counterparty = makeAddr("counterparty");
    address public adjudicator = makeAddr("adjudicator");
    address public attacker = makeAddr("attacker");

    uint256 constant STAKE = 1 ether;
    uint256 constant DEADLINE_SECONDS = 1 days;
    bytes32 constant SPEC_HASH = keccak256("I will run 5km by Friday");
    bytes32 constant EVIDENCE_HASH = keccak256("photo proof data");

    // Event definitions mirrored from Vouch for vm.expectEmit checks
    event CommitmentCreated(uint256 indexed id, address indexed creator, address indexed counterparty, bytes32 specHash, Vouch.VerificationType vType, uint256 stake, uint256 deadline);
    event EvidenceSubmitted(uint256 indexed id, bytes32 evidenceHash);
    event Challenged(uint256 indexed id, address indexed challenger);
    event Settled(uint256 indexed id, address indexed winner, uint256 amount, bool disputed);

    function setUp() public {
        vouch = new Vouch(adjudicator);
        vm.deal(creator, 10 ether);
        vm.deal(counterparty, 10 ether);
        vm.deal(attacker, 10 ether);
    }

    /*//////////////////////////////////////////////////////////////
                        CREATE COMMITMENT TESTS
    //////////////////////////////////////////////////////////////*/

    function testCreateCommitment_LocksStake() public {
        vm.prank(creator);
        uint256 id = vouch.createCommitment{value: STAKE}(
            SPEC_HASH,
            Vouch.VerificationType.Photo,
            counterparty,
            DEADLINE_SECONDS
        );

        assertEq(id, 1, "first commitment should be id 1");
        assertEq(vouch.nextId(), 2, "nextId should increment");
        assertEq(address(vouch).balance, STAKE, "contract should hold stake");

        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(c.creator, creator);
        assertEq(c.counterparty, counterparty);
        assertEq(c.specHash, SPEC_HASH);
        assertEq(uint256(c.vType), uint256(Vouch.VerificationType.Photo));
        assertEq(c.stake, STAKE);
        assertEq(uint256(c.status), uint256(Vouch.Status.Active));
        assertEq(c.evidenceHash, bytes32(0));
    }

    function testCreateCommitment_EmitsEvent() public {
        vm.prank(creator);
        vm.expectEmit(true, true, true, true);
        emit CommitmentCreated(
            1, creator, counterparty, SPEC_HASH,
            Vouch.VerificationType.Photo, STAKE,
            block.timestamp + DEADLINE_SECONDS
        );
        vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, counterparty, DEADLINE_SECONDS
        );
    }

    function testCreateCommitment_SelfCommitment() public {
        vm.prank(creator);
        uint256 id = vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, address(0), DEADLINE_SECONDS
        );

        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(c.counterparty, address(0), "self-commitment has no counterparty");
    }

    function testRevert_CreateCommitment_ZeroStake() public {
        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__ZeroStake.selector);
        vouch.createCommitment(SPEC_HASH, Vouch.VerificationType.Photo, counterparty, DEADLINE_SECONDS);
    }

    function testRevert_CreateCommitment_ZeroDeadline() public {
        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__InvalidDeadline.selector);
        vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, counterparty, 0
        );
    }

    function testRevert_CreateCommitment_SelfCounterparty() public {
        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__SelfCounterparty.selector);
        vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, creator, DEADLINE_SECONDS
        );
    }

    function testRevert_CreateCommitment_ZeroSpecHash() public {
        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__InvalidCommitment.selector);
        vouch.createCommitment{value: STAKE}(
            bytes32(0), Vouch.VerificationType.Photo, counterparty, DEADLINE_SECONDS
        );
    }

    /*//////////////////////////////////////////////////////////////
                        SUBMIT EVIDENCE TESTS
    //////////////////////////////////////////////////////////////*/

    function testSubmitEvidence_AnchorsHash() public {
        uint256 id = _createCommitment();

        vm.prank(creator);
        vouch.submitEvidence(id, EVIDENCE_HASH);

        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(c.evidenceHash, EVIDENCE_HASH);
    }

    function testSubmitEvidence_EmitsEvent() public {
        uint256 id = _createCommitment();

        vm.prank(creator);
        vm.expectEmit(true, false, false, true);
        emit EvidenceSubmitted(id, EVIDENCE_HASH);
        vouch.submitEvidence(id, EVIDENCE_HASH);
    }

    function testRevert_SubmitEvidence_NotCreator() public {
        uint256 id = _createCommitment();

        vm.prank(attacker);
        vm.expectRevert(Vouch.Vouch__NotCreator.selector);
        vouch.submitEvidence(id, EVIDENCE_HASH);
    }

    function testRevert_SubmitEvidence_DeadlinePassed() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1);

        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__DeadlinePassed.selector);
        vouch.submitEvidence(id, EVIDENCE_HASH);
    }

    function testRevert_SubmitEvidence_AlreadySettled() public {
        uint256 id = _createCommitment();

        // Fast forward past challenge window and settle
        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);
        vouch.settle(id, true);

        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__AlreadySettled.selector);
        vouch.submitEvidence(id, EVIDENCE_HASH);
    }

    /*//////////////////////////////////////////////////////////////
                        CHALLENGE TESTS
    //////////////////////////////////////////////////////////////*/

    function testChallenge_SetsChallengedStatus() public {
        uint256 id = _createCommitment();

        // Warp to after deadline but within challenge window
        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 hours);

        vm.prank(counterparty);
        vouch.challenge(id);

        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(uint256(c.status), uint256(Vouch.Status.Challenged));
    }

    function testChallenge_EmitsEvent() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 hours);

        vm.prank(counterparty);
        vm.expectEmit(true, true, false, false);
        emit Challenged(id, counterparty);
        vouch.challenge(id);
    }

    function testRevert_Challenge_NotCounterparty() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 hours);

        vm.prank(attacker);
        vm.expectRevert(Vouch.Vouch__NotCounterparty.selector);
        vouch.challenge(id);
    }

    function testRevert_Challenge_BeforeDeadline() public {
        uint256 id = _createCommitment();

        vm.prank(counterparty);
        vm.expectRevert(Vouch.Vouch__DeadlineNotPassed.selector);
        vouch.challenge(id);
    }

    function testRevert_Challenge_WindowClosed() public {
        uint256 id = _createCommitment();

        // Warp past deadline + 24h challenge window
        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);

        vm.prank(counterparty);
        vm.expectRevert(Vouch.Vouch__ChallengeWindowClosed.selector);
        vouch.challenge(id);
    }

    function testRevert_Challenge_SelfCommitment() public {
        // Self-commitment (counterparty = address(0)) cannot be challenged
        vm.prank(creator);
        uint256 id = vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, address(0), DEADLINE_SECONDS
        );

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 hours);

        vm.expectRevert(Vouch.Vouch__InvalidCommitment.selector);
        vouch.challenge(id);
    }

    function testRevert_Challenge_AlreadyChallenged() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 hours);

        vm.startPrank(counterparty);
        vouch.challenge(id);
        vm.expectRevert(Vouch.Vouch__AlreadyChallenged.selector);
        vouch.challenge(id);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                        AUTO-SETTLE TESTS
    //////////////////////////////////////////////////////////////*/

    function testAutoSettle_CreatorWinsUnchallenged() public {
        uint256 id = _createCommitment();

        uint256 creatorBalanceBefore = creator.balance;

        // Warp past deadline + challenge window
        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);

        // Anyone can call auto-settle
        vm.prank(attacker);
        vouch.settle(id, false); // bool ignored for unchallenged

        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(uint256(c.status), uint256(Vouch.Status.Settled));
        assertEq(creator.balance, creatorBalanceBefore + STAKE, "creator should receive stake");
        assertEq(address(vouch).balance, 0, "contract should be empty");
    }

    function testAutoSettle_EmitsEvent() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);

        vm.prank(attacker);
        vm.expectEmit(true, true, false, true);
        emit Settled(id, creator, STAKE, false);
        vouch.settle(id, true);
    }

    function testRevert_AutoSettle_WindowStillOpen() public {
        uint256 id = _createCommitment();

        // Warp to after deadline but within challenge window
        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 hours);

        vm.expectRevert(Vouch.Vouch__ChallengeWindowOpen.selector);
        vouch.settle(id, true);
    }

    function testRevert_AutoSettle_AlreadySettled() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);
        vouch.settle(id, true);

        vm.expectRevert(Vouch.Vouch__AlreadySettled.selector);
        vouch.settle(id, true);
    }

    /*//////////////////////////////////////////////////////////////
                    DISPUTED SETTLE TESTS
    //////////////////////////////////////////////////////////////*/

    function testDisputedSettle_CreatorWins() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 hours);
        vm.prank(counterparty);
        vouch.challenge(id);

        uint256 creatorBalanceBefore = creator.balance;

        vm.prank(adjudicator);
        vouch.settle(id, true); // creator wins

        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(uint256(c.status), uint256(Vouch.Status.Settled));
        assertEq(creator.balance, creatorBalanceBefore + STAKE, "creator should receive stake");
        assertEq(address(vouch).balance, 0);
    }

    function testDisputedSettle_CounterpartyWins() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 hours);
        vm.prank(counterparty);
        vouch.challenge(id);

        uint256 counterpartyBalanceBefore = counterparty.balance;

        vm.prank(adjudicator);
        vouch.settle(id, false); // counterparty wins

        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(uint256(c.status), uint256(Vouch.Status.Settled));
        assertEq(counterparty.balance, counterpartyBalanceBefore + STAKE, "counterparty should receive stake");
        assertEq(address(vouch).balance, 0);
    }

    function testDisputedSettle_EmitsEvent() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 hours);
        vm.prank(counterparty);
        vouch.challenge(id);

        vm.prank(adjudicator);
        vm.expectEmit(true, true, false, true);
        emit Settled(id, creator, STAKE, true);
        vouch.settle(id, true);
    }

    function testRevert_DisputedSettle_NotAdjudicator() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 hours);
        vm.prank(counterparty);
        vouch.challenge(id);

        vm.prank(attacker);
        vm.expectRevert(Vouch.Vouch__NotAdjudicator.selector);
        vouch.settle(id, true);
    }

    /*//////////////////////////////////////////////////////////////
                    REENTRANCY PROTECTION TESTS
    //////////////////////////////////////////////////////////////*/

    ReentrancyAttacker public reentrancyAttacker;

    function testReentrancyProtection_OnSettle() public {
        // Deploy attacker contract as creator
        reentrancyAttacker = new ReentrancyAttacker(vouch);
        vm.deal(address(reentrancyAttacker), 10 ether);

        // Attacker creates a commitment with itself as creator
        uint256 id = reentrancyAttacker.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, counterparty, DEADLINE_SECONDS
        );

        // Warp past challenge window
        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);

        // Attacker tries to reenter during settle.
        // The nonReentrant guard blocks the inner settle() call, which makes the
        // attacker's receive() revert, which makes the ETH transfer return false,
        // surfacing as Vouch__TransferFailed. Reentrancy protection is effective.
        vm.expectRevert(Vouch.Vouch__TransferFailed.selector);
        reentrancyAttacker.attemptReentrancy(id);
    }

    /*//////////////////////////////////////////////////////////////
                        HELPER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _createCommitment() internal returns (uint256 id) {
        vm.prank(creator);
        id = vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, counterparty, DEADLINE_SECONDS
        );
    }
}

/**
 * @title ReentrancyAttacker
 * @notice Malicious contract that attempts reentrancy on Vouch.settle().
 *         Its receive() function tries to call settle() again during ETH transfer.
 */
contract ReentrancyAttacker {
    Vouch public vouch;
    uint256 public targetId;

    constructor(Vouch _vouch) {
        vouch = _vouch;
    }

    function createCommitment(
        bytes32 specHash,
        Vouch.VerificationType vType,
        address counterparty,
        uint256 deadlineSeconds
    ) external payable returns (uint256) {
        return vouch.createCommitment{value: msg.value}(specHash, vType, counterparty, deadlineSeconds);
    }

    function attemptReentrancy(uint256 id) external {
        targetId = id;
        vouch.settle(id, true);
    }

    receive() external payable {
        // Reentry attempt: call settle again during ETH transfer
        vouch.settle(targetId, true);
    }
}
