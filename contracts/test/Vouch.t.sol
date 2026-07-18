// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Vouch} from "../src/Vouch.sol";

/**
 * @title VouchTest
 * @notice Comprehensive test suite for Vouch contract (post audit-417 + audit-pashov P1-P5 + L1-L3).
 *         Tests grouped by lifecycle phase. Each test verifies one concept.
 *         All tests prefixed test_ or test_RevertIf_ per convention.
 */
contract VouchTest is Test {
    Vouch public vouch;

    address public creator = makeAddr("creator");
    address public counterparty = makeAddr("counterparty");
    address public adjudicator = makeAddr("adjudicator");
    address public attacker = makeAddr("attacker");
    address public bystander = makeAddr("bystander");

    uint256 constant STAKE = 1 ether;
    uint256 constant BOND = STAKE / 10; // 10% minimum challenge bond (audit-pashov P3)
    uint256 constant DEADLINE_SECONDS = 1 days;
    bytes32 constant SPEC_HASH = keccak256("I will run 5km by Friday");
    bytes32 constant EVIDENCE_HASH = keccak256("photo proof data");

    // Event mirrors for vm.expectEmit checks
    event CommitmentCreated(
        uint256 indexed id,
        address indexed creator,
        address indexed counterparty,
        bytes32 specHash,
        Vouch.VerificationType vType,
        uint256 stake,
        uint256 deadline
    );
    event EvidenceSubmitted(uint256 indexed id, bytes32 evidenceHash);
    // audit-pashov: Challenged now has 3 params (id, challenger, bond)
    event Challenged(uint256 indexed id, address indexed challenger, uint256 bond);
    event Settled(uint256 indexed id, address indexed winner, uint256 amount, bool disputed);
    event ForceSettled(uint256 indexed id, address indexed caller);
    // audit-pashov P4: new Withdrawn event
    event Withdrawn(address indexed user, uint256 amount);

    function setUp() public {
        vouch = new Vouch(adjudicator);
        vm.deal(creator, 100 ether);
        vm.deal(counterparty, 100 ether);
        vm.deal(attacker, 100 ether);
        vm.deal(bystander, 100 ether);
        vm.deal(adjudicator, 100 ether);
    }

    /*//////////////////////////////////////////////////////////////
                          CONSTRUCTOR TESTS
    //////////////////////////////////////////////////////////////*/

    function test_Constructor_SetsAdjudicatorAndNextId() public {
        Vouch v = new Vouch(adjudicator);
        assertEq(v.adjudicator(), adjudicator, "adjudicator set");
        assertEq(v.nextId(), 1, "nextId starts at 1");
    }

    function test_RevertIf_ConstructorZeroAdjudicator() public {
        vm.expectRevert(Vouch.Vouch__InvalidCommitment.selector);
        new Vouch(address(0));
    }

    /*//////////////////////////////////////////////////////////////
                       createCommitment TESTS
    //////////////////////////////////////////////////////////////*/

    function test_CreateCommitment_HappyPath() public {
        vm.prank(creator);
        uint256 id = vouch.createCommitment{value: STAKE}(
            SPEC_HASH,
            Vouch.VerificationType.Photo,
            counterparty,
            DEADLINE_SECONDS
        );

        assertEq(id, 1, "first id is 1");
        assertEq(vouch.nextId(), 2, "nextId incremented");
        assertEq(address(vouch).balance, STAKE, "stake locked in contract");

        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(c.creator, creator);
        assertEq(c.counterparty, counterparty);
        assertEq(c.specHash, SPEC_HASH);
        assertEq(uint256(c.vType), uint256(Vouch.VerificationType.Photo));
        assertEq(c.stake, STAKE);
        assertEq(c.deadline, block.timestamp + DEADLINE_SECONDS);
        assertEq(uint256(c.status), uint256(Vouch.Status.Active));
        assertEq(c.evidenceHash, bytes32(0));
        assertEq(c.challengeBond, 0, "no bond until challenge");
    }

    function test_CreateCommitment_EmitsCommitmentCreated() public {
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

    function test_CreateCommitment_SelfCommitmentWithZeroCounterparty() public {
        vm.prank(creator);
        uint256 id = vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, address(0), DEADLINE_SECONDS
        );
        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(c.counterparty, address(0), "self-commitment has zero counterparty");
    }

    function test_RevertIf_CreateCommitment_ZeroStake() public {
        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__ZeroStake.selector);
        vouch.createCommitment(SPEC_HASH, Vouch.VerificationType.Photo, counterparty, DEADLINE_SECONDS);
    }

    function test_RevertIf_CreateCommitment_ZeroDeadline() public {
        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__InvalidDeadline.selector);
        vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, counterparty, 0
        );
    }

    function test_RevertIf_F6_CreateCommitment_DeadlineOver3650Days() public {
        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__InvalidDeadline.selector);
        vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, counterparty, 3650 days + 1
        );
    }

    function test_F6_CreateCommitment_DeadlineExactly3650DaysSucceeds() public {
        vm.prank(creator);
        uint256 id = vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, counterparty, 3650 days
        );
        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(c.deadline, block.timestamp + 3650 days, "boundary value valid");
    }

    function test_RevertIf_CreateCommitment_SelfCounterparty() public {
        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__SelfCounterparty.selector);
        vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, creator, DEADLINE_SECONDS
        );
    }

    function test_RevertIf_F1_CreateCommitment_AdjudicatorAsCounterparty() public {
        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__InvalidCommitment.selector);
        vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, adjudicator, DEADLINE_SECONDS
        );
    }

    function test_RevertIf_F1_CreateCommitment_AdjudicatorAsCreator() public {
        vm.prank(adjudicator);
        vm.expectRevert(Vouch.Vouch__InvalidCommitment.selector);
        vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, counterparty, DEADLINE_SECONDS
        );
    }

    function test_RevertIf_CreateCommitment_ZeroSpecHash() public {
        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__InvalidCommitment.selector);
        vouch.createCommitment{value: STAKE}(
            bytes32(0), Vouch.VerificationType.Photo, counterparty, DEADLINE_SECONDS
        );
    }

    /*//////////////////////////////////////////////////////////////
                        submitEvidence TESTS
    //////////////////////////////////////////////////////////////*/

    function test_SubmitEvidence_HappyPathSetsHash() public {
        uint256 id = _createCommitment();

        vm.prank(creator);
        vouch.submitEvidence(id, EVIDENCE_HASH);

        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(c.evidenceHash, EVIDENCE_HASH, "evidence hash anchored");
    }

    function test_SubmitEvidence_EmitsEvidenceSubmitted() public {
        uint256 id = _createCommitment();

        vm.prank(creator);
        vm.expectEmit(true, false, false, true);
        emit EvidenceSubmitted(id, EVIDENCE_HASH);
        vouch.submitEvidence(id, EVIDENCE_HASH);
    }

    function test_RevertIf_SubmitEvidence_NotCreator() public {
        uint256 id = _createCommitment();

        vm.prank(attacker);
        vm.expectRevert(Vouch.Vouch__NotCreator.selector);
        vouch.submitEvidence(id, EVIDENCE_HASH);
    }

    function test_RevertIf_SubmitEvidence_NonExistentId() public {
        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__InvalidCommitment.selector);
        vouch.submitEvidence(999, EVIDENCE_HASH);
    }

    function test_RevertIf_SubmitEvidence_AfterDeadline() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1);

        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__DeadlinePassed.selector);
        vouch.submitEvidence(id, EVIDENCE_HASH);
    }

    function test_RevertIf_SubmitEvidence_ZeroHash() public {
        uint256 id = _createCommitment();

        vm.prank(creator);
        vm.expectRevert(Vouch.Vouch__InvalidCommitment.selector);
        vouch.submitEvidence(id, bytes32(0));
    }

    function test_RevertIf_L3_SubmitEvidence_SecondSubmission() public {
        // audit-pashov L3: evidence is immutable once set (prevents bait-and-switch).
        uint256 id = _createCommitment();

        vm.startPrank(creator);
        vouch.submitEvidence(id, EVIDENCE_HASH);

        vm.expectRevert(Vouch.Vouch__EvidenceAlreadySubmitted.selector);
        vouch.submitEvidence(id, keccak256("different evidence"));
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                           challenge TESTS
    //////////////////////////////////////////////////////////////*/

    function test_Challenge_HappyPathWithBond() public {
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);

        vm.prank(counterparty);
        vouch.challenge{value: BOND}(id);

        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(uint256(c.status), uint256(Vouch.Status.Challenged), "status Challenged");
        assertEq(c.challengeBond, BOND, "bond stored in commitment");
        assertEq(address(vouch).balance, STAKE + BOND, "stake + bond locked");
    }

    function test_Challenge_EmitsChallengedWithBond() public {
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);

        vm.prank(counterparty);
        vm.expectEmit(true, true, false, true);
        emit Challenged(id, counterparty, BOND);
        vouch.challenge{value: BOND}(id);
    }

    function test_RevertIf_Challenge_NonCounterparty() public {
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);

        vm.prank(attacker);
        vm.expectRevert(Vouch.Vouch__NotCounterparty.selector);
        vouch.challenge{value: BOND}(id);
    }

    function test_RevertIf_Challenge_SelfCommitment() public {
        // Self-commitment (counterparty = address(0)) cannot be challenged.
        vm.prank(creator);
        uint256 id = vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, address(0), DEADLINE_SECONDS
        );

        _warpToChallengeWindow(id);

        vm.expectRevert(Vouch.Vouch__InvalidCommitment.selector);
        vouch.challenge{value: BOND}(id);
    }

    function test_RevertIf_Challenge_BeforeDeadline() public {
        uint256 id = _createCommitment();
        // No warp — still before deadline.

        vm.prank(counterparty);
        vm.expectRevert(Vouch.Vouch__DeadlineNotPassed.selector);
        vouch.challenge{value: BOND}(id);
    }

    function test_RevertIf_Challenge_WindowClosed() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);

        vm.prank(counterparty);
        vm.expectRevert(Vouch.Vouch__ChallengeWindowClosed.selector);
        vouch.challenge{value: BOND}(id);
    }

    function test_RevertIf_P3_Challenge_InsufficientBond() public {
        // audit-pashov P3: bond must be >= 10% of stake.
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);

        vm.prank(counterparty);
        vm.expectRevert(Vouch.Vouch__InsufficientChallengeBond.selector);
        vouch.challenge{value: BOND - 1}(id);
    }

    function test_RevertIf_Challenge_AlreadyChallenged() public {
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);

        vm.startPrank(counterparty);
        vouch.challenge{value: BOND}(id);

        vm.expectRevert(Vouch.Vouch__AlreadyChallenged.selector);
        vouch.challenge{value: BOND}(id);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                             settle TESTS
    //////////////////////////////////////////////////////////////*/

    function test_Settle_ActiveAutoSettleCreatorWinsFullStake() public {
        uint256 id = _createCommitment();
        uint256 creatorBefore = creator.balance;

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);

        // Anyone can call auto-settle; bool is ignored for unchallenged.
        vm.prank(attacker);
        vouch.settle(id, false);

        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(uint256(c.status), uint256(Vouch.Status.Settled));

        // Pull-payment: stake credited, not pushed.
        assertEq(vouch.withdrawable(creator), STAKE, "creator credited full stake");
        assertEq(address(vouch).balance, STAKE, "ETH still in contract until withdraw");

        vm.prank(creator);
        vouch.withdraw();
        assertEq(creator.balance, creatorBefore + STAKE, "creator receives stake back after withdraw");
        assertEq(address(vouch).balance, 0, "contract drained");
    }

    function test_Settle_ChallengedCreatorWins_GetsStakeAndBond() public {
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);
        vm.prank(counterparty);
        vouch.challenge{value: BOND}(id);

        vm.prank(adjudicator);
        vouch.settle(id, true);

        assertEq(vouch.withdrawable(creator), STAKE + BOND, "creator gets stake + forfeited bond");
        assertEq(vouch.withdrawable(counterparty), 0, "counterparty gets nothing");
    }

    function test_Settle_ChallengedCounterpartyWins_GetsStakeAndBondBack() public {
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);
        vm.prank(counterparty);
        vouch.challenge{value: BOND}(id);

        vm.prank(adjudicator);
        vouch.settle(id, false);

        assertEq(vouch.withdrawable(counterparty), STAKE + BOND, "counterparty gets stake + bond back");
        assertEq(vouch.withdrawable(creator), 0, "creator gets nothing");
    }

    function test_RevertIf_Settle_ChallengedNotAdjudicator() public {
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);
        vm.prank(counterparty);
        vouch.challenge{value: BOND}(id);

        vm.prank(attacker);
        vm.expectRevert(Vouch.Vouch__NotAdjudicator.selector);
        vouch.settle(id, true);
    }

    function test_RevertIf_P1_Settle_ChallengedAfterTimeout() public {
        // audit-pashov P1: adjudicator authority expires after deadline + CHALLENGE_WINDOW + ADJUDICATOR_TIMEOUT.
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);
        vm.prank(counterparty);
        vouch.challenge{value: BOND}(id);

        Vouch.Commitment memory c = vouch.getCommitment(id);
        vm.warp(c.deadline + 1 days + 7 days + 1);

        vm.prank(adjudicator);
        vm.expectRevert(Vouch.Vouch__AdjudicatorTimeoutExpired.selector);
        vouch.settle(id, true);
    }

    function test_RevertIf_F4_Settle_ActiveBeforeWindowCloses() public {
        // audit-417 F4: closed interval — at exactly deadline + CHALLENGE_WINDOW, settle still reverts.
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days);

        vm.expectRevert(Vouch.Vouch__ChallengeWindowOpen.selector);
        vouch.settle(id, true);
    }

    function test_RevertIf_Settle_AlreadySettled() public {
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);
        vouch.settle(id, true);

        vm.expectRevert(Vouch.Vouch__AlreadySettled.selector);
        vouch.settle(id, true);
    }

    /*//////////////////////////////////////////////////////////////
                          forceSettle TESTS
    //////////////////////////////////////////////////////////////*/

    function test_P2_ForceSettle_SplitsStakeFiftyFiftyAndReturnsBond() public {
        // audit-pashov P2: stake split 50/50 (no longer creator-wins) removes DOS incentive.
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);
        vm.prank(counterparty);
        vouch.challenge{value: BOND}(id);

        Vouch.Commitment memory c = vouch.getCommitment(id);
        vm.warp(c.deadline + 1 days + 7 days + 1);

        vm.prank(bystander);
        vouch.forceSettle(id);

        Vouch.Commitment memory afterSettle = vouch.getCommitment(id);
        assertEq(uint256(afterSettle.status), uint256(Vouch.Status.Settled));

        uint256 half = STAKE / 2;
        assertEq(vouch.withdrawable(creator), half, "creator gets half stake");
        assertEq(vouch.withdrawable(counterparty), (STAKE - half) + BOND, "counterparty gets half + bond returned");
    }

    function test_P5_ForceSettle_EmitsForceSettledBeforeSettled() public {
        // audit-pashov P5: ForceSettled emitted BEFORE Settled so integrators can distinguish.
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);
        vm.prank(counterparty);
        vouch.challenge{value: BOND}(id);

        Vouch.Commitment memory c = vouch.getCommitment(id);
        vm.warp(c.deadline + 1 days + 7 days + 1);

        // Stacked expects — Foundry asserts events fire in the order declared.
        vm.expectEmit(true, true, false, false);
        emit ForceSettled(id, bystander);
        vm.expectEmit(true, true, false, true);
        emit Settled(id, creator, STAKE, true);

        vm.prank(bystander);
        vouch.forceSettle(id);
    }

    function test_ForceSettle_AnyoneCanCall() public {
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);
        vm.prank(counterparty);
        vouch.challenge{value: BOND}(id);

        Vouch.Commitment memory c = vouch.getCommitment(id);
        vm.warp(c.deadline + 1 days + 7 days + 1);

        vm.prank(attacker);
        vouch.forceSettle(id);

        assertEq(uint256(vouch.getCommitment(id).status), uint256(Vouch.Status.Settled));
    }

    function test_RevertIf_L2_ForceSettle_NotChallenged() public {
        // audit-pashov L2: dedicated error instead of reusing AlreadySettled.
        uint256 id = _createCommitment();
        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 8 days);

        vm.expectRevert(Vouch.Vouch__NotChallenged.selector);
        vouch.forceSettle(id);
    }

    function test_RevertIf_L2_ForceSettle_WithinTimeout() public {
        // audit-pashov L2: dedicated error instead of reusing ChallengeWindowOpen.
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);
        vm.prank(counterparty);
        vouch.challenge{value: BOND}(id);

        // Exact boundary — `<=` means still pending.
        Vouch.Commitment memory c = vouch.getCommitment(id);
        vm.warp(c.deadline + 1 days + 7 days);

        vm.expectRevert(Vouch.Vouch__AdjudicatorTimeoutPending.selector);
        vouch.forceSettle(id);
    }

    /*//////////////////////////////////////////////////////////////
                            withdraw TESTS
    //////////////////////////////////////////////////////////////*/

    function test_P4_Withdraw_HappyPathEmitsWithdrawn() public {
        // audit-pashov P4: withdraw emits Withdrawn so indexers can track actual payouts.
        uint256 id = _createCommitment();
        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);
        vouch.settle(id, true);

        uint256 creatorBefore = creator.balance;

        vm.expectEmit(true, false, false, true);
        emit Withdrawn(creator, STAKE);

        vm.prank(creator);
        vouch.withdraw();

        assertEq(creator.balance, creatorBefore + STAKE, "ETH transferred");
        assertEq(vouch.withdrawable(creator), 0, "credit zeroed");
        assertEq(address(vouch).balance, 0, "contract drained");
    }

    function test_Withdraw_ZeroBalanceNoRevertNoEmitNoTransfer() public {
        uint256 attackerBefore = attacker.balance;

        // Record logs to assert Withdrawn was NOT emitted.
        vm.recordLogs();

        vm.prank(attacker);
        vouch.withdraw(); // attacker has 0 credit

        assertEq(attacker.balance, attackerBefore, "nothing transferred");
        assertEq(vouch.withdrawable(attacker), 0, "still zero");

        // Assert no Withdrawn event was emitted.
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 withdrawnTopic = keccak256("Withdrawn(address,uint256)");
        for (uint256 i = 0; i < entries.length; i++) {
            assertNotEq(entries[i].topics[0], withdrawnTopic, "must not emit Withdrawn for 0 amount");
        }
    }

    function test_Withdraw_ReentrancyProtected() public {
        // audit-417 F2: reentrancy surface moved from settle to withdraw.
        ReentrancyAttacker ra = new ReentrancyAttacker(vouch);
        vm.deal(address(ra), 100 ether);

        uint256 id = ra.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, counterparty, DEADLINE_SECONDS
        );

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);
        ra.settle(id);

        // ra.receive() tries to re-enter withdraw(); nonReentrant blocks the inner call,
        // making the outer ETH transfer fail → Vouch__TransferFailed.
        vm.expectRevert(Vouch.Vouch__TransferFailed.selector);
        ra.attackWithdraw();
    }

    /*//////////////////////////////////////////////////////////////
                         getCommitment TESTS
    //////////////////////////////////////////////////////////////*/

    function test_GetCommitment_HappyPath() public {
        uint256 id = _createCommitment();
        Vouch.Commitment memory c = vouch.getCommitment(id);
        assertEq(c.creator, creator);
        assertEq(c.stake, STAKE);
        assertEq(c.specHash, SPEC_HASH);
    }

    function test_RevertIf_F7_GetCommitment_NonExistentId() public {
        // audit-417 F7: getCommitment reverts for never-created ids.
        vm.expectRevert(Vouch.Vouch__InvalidCommitment.selector);
        vouch.getCommitment(999);
    }

    function test_RevertIf_F7_GetCommitment_IdZero() public {
        vm.expectRevert(Vouch.Vouch__InvalidCommitment.selector);
        vouch.getCommitment(0);
    }

    /*//////////////////////////////////////////////////////////////
                      isInChallengeWindow TESTS
    //////////////////////////////////////////////////////////////*/

    function test_IsInChallengeWindow_ActiveAndInWindow_True() public {
        uint256 id = _createCommitment();
        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 hours);
        assertTrue(vouch.isInChallengeWindow(id), "Active + in range = true");
    }

    function test_IsInChallengeWindow_BeforeDeadline_False() public {
        uint256 id = _createCommitment();
        // No warp — before deadline.
        assertFalse(vouch.isInChallengeWindow(id), "before deadline = false");
    }

    function test_IsInChallengeWindow_AfterWindow_False() public {
        uint256 id = _createCommitment();
        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);
        assertFalse(vouch.isInChallengeWindow(id), "after window = false");
    }

    function test_F5_IsInChallengeWindow_Challenged_False() public {
        // audit-417 F5: Challenged commitments must not report actionable window.
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);
        vm.prank(counterparty);
        vouch.challenge{value: BOND}(id);

        assertFalse(vouch.isInChallengeWindow(id), "Challenged = false even in time range");
    }

    function test_IsInChallengeWindow_NonExistent_False() public {
        assertFalse(vouch.isInChallengeWindow(999), "non-existent = false");
    }

    /*//////////////////////////////////////////////////////////////
                AUDIT-417 REGRESSION — F2 (Pull-payment)
    //////////////////////////////////////////////////////////////*/

    function test_F2_SettleCreditsWithdrawableNotPush() public {
        uint256 id = _createCommitment();
        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);
        vouch.settle(id, true);

        assertEq(vouch.withdrawable(creator), STAKE, "winner credited");
        assertEq(address(vouch).balance, STAKE, "ETH still in contract");
    }

    function test_F2_WithdrawTransfersAndZeroesCredit() public {
        uint256 id = _createCommitment();
        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days + 1);
        vouch.settle(id, true);

        uint256 before = creator.balance;
        vm.prank(creator);
        vouch.withdraw();

        assertEq(creator.balance, before + STAKE, "ETH transferred");
        assertEq(vouch.withdrawable(creator), 0, "credit zeroed");
    }

    function test_F2_NonPayableRecipientCanStillSettle() public {
        // Core F2 PoC: a contract with no receive() used to permanently lock stake.
        NonPayableRecipient recipient = new NonPayableRecipient();
        vm.prank(creator);
        uint256 id = vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, address(recipient), DEADLINE_SECONDS
        );

        _warpToChallengeWindow(id);
        recipient.challenge{value: BOND}(vouch, id);

        vm.prank(adjudicator);
        vouch.settle(id, false);

        assertEq(vouch.withdrawable(address(recipient)), STAKE + BOND, "credited despite no receive()");
        assertEq(uint256(vouch.getCommitment(id).status), uint256(Vouch.Status.Settled));
    }

    /*//////////////////////////////////////////////////////////////
                AUDIT-417 REGRESSION — F3 (Liveness fallback)
    //////////////////////////////////////////////////////////////*/

    function test_F3_ForceSettleAfterTimeout() public {
        uint256 id = _createCommitment();
        _warpToChallengeWindow(id);
        vm.prank(counterparty);
        vouch.challenge{value: BOND}(id);

        Vouch.Commitment memory c = vouch.getCommitment(id);
        vm.warp(c.deadline + 1 days + 7 days + 1);

        vouch.forceSettle(id);
        assertEq(uint256(vouch.getCommitment(id).status), uint256(Vouch.Status.Settled));
    }

    /*//////////////////////////////////////////////////////////////
                AUDIT-417 REGRESSION — F4 (Boundary race)
    //////////////////////////////////////////////////////////////*/

    function test_F4_ChallengeAtExactBoundarySucceeds() public {
        // At exactly deadline + CHALLENGE_WINDOW, challenge() is still legal (inclusive).
        uint256 id = _createCommitment();

        vm.warp(block.timestamp + DEADLINE_SECONDS + 1 days);

        vm.prank(counterparty);
        vouch.challenge{value: BOND}(id);

        assertEq(uint256(vouch.getCommitment(id).status), uint256(Vouch.Status.Challenged));
    }

    /*//////////////////////////////////////////////////////////////
                            HELPERS
    //////////////////////////////////////////////////////////////*/

    function _createCommitment() internal returns (uint256 id) {
        vm.prank(creator);
        id = vouch.createCommitment{value: STAKE}(
            SPEC_HASH, Vouch.VerificationType.Photo, counterparty, DEADLINE_SECONDS
        );
    }

    function _warpToChallengeWindow(uint256 id) internal {
        Vouch.Commitment memory c = vouch.getCommitment(id);
        // 1 hour past deadline, well within 1-day challenge window.
        vm.warp(c.deadline + 1 hours);
    }
}

/**
 * @title VouchInvariantTest
 * @notice Handler-based invariant fuzzing. Run with: forge test --match-contract VouchInvariantTest
 *
 * INV-1 (Stake + bond conservation):
 *   address(vouch).balance == Σ(unsettled stakes + bonds) + Σ(withdrawable credits)
 *
 * INV-2 (Settled is terminal):
 *   For every Settled commitment, no state-changing function can transition it out of Settled.
 */
contract VouchInvariantTest is Test {
    Vouch public vouch;
    Handler public handler;
    address public adjudicator;

    function setUp() public {
        adjudicator = makeAddr("adjudicator");
        vouch = new Vouch(adjudicator);
        handler = new Handler(vouch, adjudicator);
        // Handler funds its own actors in its constructor.
        vm.deal(adjudicator, 100 ether);

        // CRITICAL: target only the Handler so the fuzzer never calls Vouch
        // functions directly. Without this, Foundry calls Vouch.settle/withdraw
        // directly, changing contract state without the handler's ghost tracking,
        // which breaks the conservation invariant.
        targetContract(address(handler));
    }

    /// @dev INV-1: stake + bond conservation across all unsettled + withdrawable.
    function invariant_StakeAndBondConservation() public {
        // Compute unsettled locked directly from contract state — no ghost counters
        // (avoids accounting drift through try/catch paths).
        uint256 unsettledLocked;
        uint256[] memory ids = handler.getCreatedIds();
        for (uint256 i = 0; i < ids.length; i++) {
            if (!handler.wasSettled(ids[i])) {
                Vouch.Commitment memory c = vouch.getCommitment(ids[i]);
                unsettledLocked += c.stake + c.challengeBond;
            }
        }

        uint256 sumWithdrawable;
        address[] memory actors = handler.getActors();
        for (uint256 i = 0; i < actors.length; i++) {
            sumWithdrawable += vouch.withdrawable(actors[i]);
        }

        assertEq(
            address(vouch).balance,
            unsettledLocked + sumWithdrawable,
            "INV-1: stake + bond conservation violated"
        );
    }

    /// @dev INV-2: Settled status is terminal — no function can move a commitment out of Settled.
    function invariant_SettledIsTerminal() public {
        uint256[] memory ids = handler.getCreatedIds();
        for (uint256 i = 0; i < ids.length; i++) {
            if (handler.wasSettled(ids[i])) {
                Vouch.Status s = vouch.getCommitment(ids[i]).status;
                assertEq(uint256(s), uint256(Vouch.Status.Settled), "INV-2: settled commitment transitioned away");
            }
        }
    }
}

/**
 * @title Handler
 * @notice Ghost-state tracker for invariant fuzzing. Calls Vouch with randomized
 *         actions and tracks what should be true so the invariant contract can verify.
 *         All 6 state-changing entry points are exercised: createCommitment,
 *         submitEvidence, challenge{value}, settle, forceSettle, withdraw.
 */
contract Handler {
    Vouch public vouch;
    address public adjudicator;

    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address[] public actors;
    mapping(address => bool) public isActor;
    uint256[] public createdIds;
    mapping(uint256 => bool) public wasSettled;


    constructor(Vouch _vouch, address _adjudicator) {
        vouch = _vouch;
        adjudicator = _adjudicator;

        // Pre-register actors and fund them so vm.prank + value works.
        for (uint256 i = 0; i < 4; i++) {
            address a = address(uint160(0xA000 + i));
            actors.push(a);
            isActor[a] = true;
            vm.deal(a, 100 ether);
        }
    }

    function getActors() external view returns (address[] memory) {
        return actors;
    }

    function getCreatedIds() external view returns (uint256[] memory) {
        return createdIds;
    }

    function createCommitment(uint256 actorSeed, uint256 counterpartySeed, uint256 deadlineSeed, uint256 stakeSeed)
        external
    {
        address creator_ = actors[actorSeed % actors.length];
        address counterparty_ = actors[counterpartySeed % actors.length];

        // Avoid invalid combinations — silently skip.
        if (counterparty_ == creator_) counterparty_ = address(0);
        if (counterparty_ == adjudicator || creator_ == adjudicator) return;

        uint256 deadlineSeconds = (deadlineSeed % 3650 days) + 1;
        uint256 stake = ((stakeSeed % 5) + 1) * 0.1 ether;

        vm.prank(creator_);
        try vouch.createCommitment{value: stake}(
            keccak256(abi.encodePacked(block.timestamp, createdIds.length)),
            Vouch.VerificationType.Photo,
            counterparty_,
            deadlineSeconds
        ) returns (uint256 id) {
            createdIds.push(id);
        } catch {}
    }

    function submitEvidence(uint256 idSeed, uint256 evidenceSeed) external {
        if (createdIds.length == 0) return;
        uint256 id = createdIds[idSeed % createdIds.length];
        if (wasSettled[id]) return;

        Vouch.Commitment memory c = vouch.getCommitment(id);
        if (c.status != Vouch.Status.Active) return;
        if (block.timestamp >= c.deadline) return;
        if (c.evidenceHash != bytes32(0)) return; // L3: evidence is immutable

        bytes32 evidenceHash = keccak256(abi.encodePacked(evidenceSeed));
        vm.prank(c.creator);
        try vouch.submitEvidence(id, evidenceHash) {} catch {}
    }

    function challenge(uint256 idSeed, uint256 bondSeed) external {
        if (createdIds.length == 0) return;
        uint256 id = createdIds[idSeed % createdIds.length];
        if (wasSettled[id]) return;

        Vouch.Commitment memory c = vouch.getCommitment(id);
        if (c.status != Vouch.Status.Active) return;
        if (c.counterparty == address(0)) return; // self-commitment cannot be challenged

        // Move into the challenge window if not already there.
        if (block.timestamp < c.deadline) {
            vm.warp(c.deadline + 1);
        }
        if (block.timestamp > c.deadline + 1 days) return; // window already closed

        uint256 minBond = (c.stake * 10) / 100;
        uint256 bond = minBond + (bondSeed % 0.5 ether);

        vm.prank(c.counterparty);
        try vouch.challenge{value: bond}(id) {} catch {}
    }

    function settle(uint256 idSeed, bool creatorWins) external {
        if (createdIds.length == 0) return;
        uint256 id = createdIds[idSeed % createdIds.length];
        if (wasSettled[id]) return;

        Vouch.Commitment memory c = vouch.getCommitment(id);

        if (c.status == Vouch.Status.Active) {
            // Anyone can call auto-settle once window is closed.
            if (block.timestamp <= c.deadline + 1 days) {
                vm.warp(c.deadline + 1 days + 1);
            }
            try vouch.settle(id, true) {
                _markSettled(id);
            } catch {}
        } else if (c.status == Vouch.Status.Challenged) {
            // Adjudicator-only; must be within ADJUDICATOR_TIMEOUT.
            if (block.timestamp > c.deadline + 1 days + 7 days) return; // P1: expired
            vm.prank(adjudicator);
            try vouch.settle(id, creatorWins) {
                _markSettled(id);
            } catch {}
        }
    }

    function forceSettle(uint256 idSeed) external {
        if (createdIds.length == 0) return;
        uint256 id = createdIds[idSeed % createdIds.length];
        if (wasSettled[id]) return;

        Vouch.Commitment memory c = vouch.getCommitment(id);
        if (c.status != Vouch.Status.Challenged) return;

        // Must be strictly past the timeout.
        if (block.timestamp <= c.deadline + 1 days + 7 days) {
            vm.warp(c.deadline + 1 days + 7 days + 1);
        }

        try vouch.forceSettle(id) {
            _markSettled(id);
        } catch {}
    }

    function withdraw(uint256 actorSeed) external {
        address a = actors[actorSeed % actors.length];
        uint256 credit = vouch.withdrawable(a);
        if (credit == 0) return;

        vm.prank(a);
        try vouch.withdraw() {} catch {}
    }

    function _markSettled(uint256 id) internal {
        wasSettled[id] = true;
    }
}

/**
 * @title ReentrancyAttacker
 * @notice Malicious contract that attempts reentrancy on Vouch.withdraw().
 *         (audit-417 F2 moved the ETH-pushing surface from settle to withdraw.)
 */
contract ReentrancyAttacker {
    Vouch public vouch;

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

    function settle(uint256 id) external {
        vouch.settle(id, true);
    }

    function attackWithdraw() external {
        vouch.withdraw();
    }

    receive() external payable {
        // Reentry attempt: call withdraw again during the ETH transfer.
        vouch.withdraw();
    }
}

/**
 * @title NonPayableRecipient
 * @notice Contract with no receive()/fallback() — proves F2's pull-payment fix
 *         lets settlement succeed even when the winner cannot receive ETH.
 */
contract NonPayableRecipient {
    function challenge(Vouch vouch, uint256 id) external payable {
        vouch.challenge{value: msg.value}(id);
    }
}
