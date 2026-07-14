// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title Vouch
 * @notice Polymarket-for-personal-claims: AI-verified personal bets onchain.
 *         Users create commitments, lock stakes, submit evidence, and settle
 *         via AI adjudication with a 24h optimistic challenge window.
 *         Events serve as onchain attestations (no EAS dependency).
 * @custom:security-contact security@vouch.xyz
 */
contract Vouch {
    /*//////////////////////////////////////////////////////////////
                                ENUMS
    //////////////////////////////////////////////////////////////*/

    enum VerificationType {
        Photo,
        Web,
        Location,
        PeerSign,
        API
    }

    enum Status {
        Active,
        Challenged,
        Settled,
        Expired
    }

    /*//////////////////////////////////////////////////////////////
                        TYPE DECLARATIONS
    //////////////////////////////////////////////////////////////*/

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

    /*//////////////////////////////////////////////////////////////
                          STATE VARIABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice Adjudicator authorized to settle challenged commitments (AI agent wallet).
    address public immutable adjudicator;

    /// @notice Duration of the optimistic challenge window after deadline.
    uint256 public constant CHALLENGE_WINDOW = 1 days;

    /// @notice Counter for commitment IDs (first valid ID is 1).
    uint256 public nextId;

    /// @dev Mapping from commitment ID to Commitment data.
    mapping(uint256 => Commitment) private commitments;

    /*//////////////////////////////////////////////////////////////
                              EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when a new commitment is created and stake is locked.
    event CommitmentCreated(
        uint256 indexed id,
        address indexed creator,
        address indexed counterparty,
        bytes32 specHash,
        VerificationType vType,
        uint256 stake,
        uint256 deadline
    );

    /// @notice Emitted when evidence is submitted for a commitment. Serves as attestation.
    event EvidenceSubmitted(uint256 indexed id, bytes32 evidenceHash);

    /// @notice Emitted when a commitment is challenged during the optimistic window.
    event Challenged(uint256 indexed id, address indexed challenger);

    /// @notice Emitted when a commitment is settled and stake is distributed.
    event Settled(uint256 indexed id, address indexed winner, uint256 amount, bool disputed);

    /*//////////////////////////////////////////////////////////////
                              ERRORS
    //////////////////////////////////////////////////////////////*/

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

    /*//////////////////////////////////////////////////////////////
                         REENTRANCY GUARD
    //////////////////////////////////////////////////////////////*/

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus;

    modifier nonReentrant() {
        if (_reentrancyStatus == _ENTERED) revert Vouch__ReentrantCall();
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    /*//////////////////////////////////////////////////////////////
                             CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @param _adjudicator Address authorized to settle challenged commitments.
     */
    constructor(address _adjudicator) {
        if (_adjudicator == address(0)) revert Vouch__InvalidCommitment();
        adjudicator = _adjudicator;
        _reentrancyStatus = _NOT_ENTERED;
        nextId = 1;
    }

    /*//////////////////////////////////////////////////////////////
                  EXTERNAL STATE-CHANGING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Create a new commitment and lock stake.
     * @param specHash Hash of the commitment specification (terms, evidence requirements).
     * @param vType Type of verification required.
     * @param counterparty Counterparty address. Use address(0) for self-commitments (cannot be challenged).
     * @param deadlineSeconds Duration from now until the commitment deadline.
     * @return id The newly created commitment ID.
     */
    function createCommitment(
        bytes32 specHash,
        VerificationType vType,
        address counterparty,
        uint256 deadlineSeconds
    ) external payable nonReentrant returns (uint256 id) {
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

    /**
     * @notice Submit evidence hash for a commitment. Only creator, before deadline.
     * @param id Commitment ID.
     * @param evidenceHash keccak256 hash of the off-chain evidence data.
     */
    function submitEvidence(uint256 id, bytes32 evidenceHash) external nonReentrant {
        Commitment storage c = commitments[id];
        if (c.creator == address(0)) revert Vouch__InvalidCommitment();
        if (c.creator != msg.sender) revert Vouch__NotCreator();
        if (c.status != Status.Active) revert Vouch__AlreadySettled();
        if (block.timestamp >= c.deadline) revert Vouch__DeadlinePassed();
        if (evidenceHash == bytes32(0)) revert Vouch__InvalidCommitment();

        c.evidenceHash = evidenceHash;

        emit EvidenceSubmitted(id, evidenceHash);
    }

    /**
     * @notice Challenge a commitment within the 24h optimistic window.
     *         Only the counterparty can challenge. Self-commitments cannot be challenged.
     * @param id Commitment ID.
     */
    function challenge(uint256 id) external nonReentrant {
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

    /**
     * @notice Settle a commitment and distribute the stake.
     *         - Unchallenged + window closed: auto creator wins (anyone can call, bool ignored).
     *         - Challenged: adjudicator passes AI ruling via creatorWins.
     * @param id Commitment ID.
     * @param creatorWins AI ruling result (only used for challenged settlements).
     */
    function settle(uint256 id, bool creatorWins) external nonReentrant {
        Commitment storage c = commitments[id];
        if (c.creator == address(0)) revert Vouch__InvalidCommitment();
        if (c.status == Status.Settled) revert Vouch__AlreadySettled();

        if (c.status == Status.Challenged) {
            if (msg.sender != adjudicator) revert Vouch__NotAdjudicator();
            _settle(c, id, creatorWins, true);
        } else {
            // Active: auto-settle only after challenge window closes
            if (block.timestamp < c.deadline + CHALLENGE_WINDOW) revert Vouch__ChallengeWindowOpen();
            _settle(c, id, true, false);
        }
    }

    /*//////////////////////////////////////////////////////////////
                  EXTERNAL READ-ONLY FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Get full commitment data by ID.
     */
    function getCommitment(uint256 id) external view returns (Commitment memory) {
        return commitments[id];
    }

    /**
     * @notice Check if a commitment is currently in its challenge window.
     */
    function isInChallengeWindow(uint256 id) external view returns (bool) {
        Commitment storage c = commitments[id];
        if (c.creator == address(0)) return false;
        return block.timestamp >= c.deadline && block.timestamp <= c.deadline + CHALLENGE_WINDOW;
    }

    /*//////////////////////////////////////////////////////////////
                  INTERNAL STATE-CHANGING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Internal settle: sets status, emits event, transfers stake.
     *      CEI: status update before external call.
     */
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
