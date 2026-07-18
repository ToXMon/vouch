// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title VouchDemo
 * @notice Demo variant of Vouch with a 60-second challenge window for hackathon demos.
 *         Identical to Vouch.sol except CHALLENGE_WINDOW is reduced from 1 day to 1 minute.
 */
contract VouchDemo {
    enum VerificationType { Photo, Web, Location, PeerSign, API }
    enum Status { Active, Challenged, Settled, Expired }

    struct Commitment {
        address creator;
        address counterparty;
        bytes32 specHash;
        VerificationType vType;
        uint256 stake;
        uint256 deadline;
        Status status;
        bytes32 evidenceHash;
    }

    address public immutable adjudicator;
    uint256 public constant CHALLENGE_WINDOW = 1 minutes; // Demo: 60 seconds instead of 1 day
    uint256 public nextId;
    mapping(uint256 => Commitment) private commitments;

    event CommitmentCreated(uint256 indexed id, address indexed creator, address indexed counterparty, bytes32 specHash, VerificationType vType, uint256 stake, uint256 deadline);
    event EvidenceSubmitted(uint256 indexed id, bytes32 evidenceHash);
    event Challenged(uint256 indexed id, address indexed challenger);
    event Settled(uint256 indexed id, address indexed winner, uint256 amount, bool disputed);

    error Vouch__NotCreator();
    error Vouch__NotCounterparty();
    error Vouch__NotAdjudicator();
    error Vouch__InvalidDeadline();
    error Vouch__ZeroStake();
    error Vouch__SelfCounterparty();
    error Vouch__DeadlineNotPassed();
    error Vouch__DeadlinePassed();
    error Vouch__ChallengeWindowClosed();
    error Vouch__ChallengeWindowOpen();
    error Vouch__AlreadyChallenged();
    error Vouch__AlreadySettled();
    error Vouch__InvalidCommitment();
    error Vouch__TransferFailed();
    error Vouch__ReentrantCall();

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus;

    constructor(address _adjudicator) {
        if (_adjudicator == address(0)) revert Vouch__InvalidCommitment();
        adjudicator = _adjudicator;
        _reentrancyStatus = _NOT_ENTERED;
        nextId = 1;
    }

    function createCommitment(
        bytes32 specHash,
        VerificationType vType,
        address counterparty,
        uint256 deadlineSeconds
    ) external payable returns (uint256 id) {
        if (msg.value == 0) revert Vouch__ZeroStake();
        if (deadlineSeconds == 0) revert Vouch__InvalidDeadline();
        if (counterparty == msg.sender) revert Vouch__SelfCounterparty();
        if (specHash == bytes32(0)) revert Vouch__InvalidCommitment();

        id = nextId++;
        uint256 deadline = block.timestamp + deadlineSeconds;

        commitments[id] = Commitment({
            creator: msg.sender,
            counterparty: counterparty,
            specHash: specHash,
            vType: vType,
            stake: msg.value,
            deadline: deadline,
            status: Status.Active,
            evidenceHash: bytes32(0)
        });

        emit CommitmentCreated(id, msg.sender, counterparty, specHash, vType, msg.value, deadline);
    }

    function submitEvidence(uint256 id, bytes32 evidenceHash) external {
        Commitment storage c = commitments[id];
        if (c.creator == address(0)) revert Vouch__InvalidCommitment();
        if (c.creator != msg.sender) revert Vouch__NotCreator();
        if (c.status != Status.Active) revert Vouch__AlreadySettled();
        if (block.timestamp >= c.deadline) revert Vouch__DeadlinePassed();
        if (evidenceHash == bytes32(0)) revert Vouch__InvalidCommitment();

        c.evidenceHash = evidenceHash;
        emit EvidenceSubmitted(id, evidenceHash);
    }

    function challenge(uint256 id) external {
        Commitment storage c = commitments[id];
        if (c.creator == address(0)) revert Vouch__InvalidCommitment();
        if (c.counterparty == address(0)) revert Vouch__InvalidCommitment();
        if (c.counterparty != msg.sender) revert Vouch__NotCounterparty();
        if (c.status != Status.Active) revert Vouch__AlreadyChallenged();
        if (block.timestamp < c.deadline) revert Vouch__DeadlineNotPassed();
        if (block.timestamp > c.deadline + CHALLENGE_WINDOW) revert Vouch__ChallengeWindowClosed();

        c.status = Status.Challenged;
        emit Challenged(id, msg.sender);
    }

    function settle(uint256 id, bool creatorWins) external {
        Commitment storage c = commitments[id];
        if (c.creator == address(0)) revert Vouch__InvalidCommitment();
        if (c.status == Status.Settled) revert Vouch__AlreadySettled();

        if (c.status == Status.Challenged) {
            if (msg.sender != adjudicator) revert Vouch__NotAdjudicator();
            _settle(c, id, creatorWins, true);
        } else {
            if (block.timestamp < c.deadline + CHALLENGE_WINDOW) revert Vouch__ChallengeWindowOpen();
            _settle(c, id, true, false);
        }
    }

    function getCommitment(uint256 id) external view returns (Commitment memory) {
        return commitments[id];
    }

    function isInChallengeWindow(uint256 id) external view returns (bool) {
        Commitment storage c = commitments[id];
        if (c.creator == address(0)) return false;
        return block.timestamp >= c.deadline && block.timestamp <= c.deadline + CHALLENGE_WINDOW;
    }

    function _settle(
        Commitment storage c,
        uint256 id,
        bool creatorWins,
        bool disputed
    ) internal {
        c.status = Status.Settled;
        address winner = creatorWins ? c.creator : c.counterparty;
        uint256 amount = c.stake;
        emit Settled(id, winner, amount, disputed);
        (bool success, ) = winner.call{value: amount}("");
        if (!success) revert Vouch__TransferFailed();
    }
}
