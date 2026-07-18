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
        Settled
        // audit-pashov L1: Status.Expired removed — was dead code (5-agent convergence).
        //   Every commitment's terminal status is Settled; no path ever assigned Expired.
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
        uint256 challengeBond; // audit-pashov P3: counterparty bond, prevents free griefing
    }

    /*//////////////////////////////////////////////////////////////
                          STATE VARIABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice Adjudicator authorized to settle challenged commitments (AI agent wallet).
    address public immutable adjudicator;

    /// @notice Duration of the optimistic challenge window after deadline.
    uint256 public constant CHALLENGE_WINDOW = 1 days;

    /// @notice Liveness fallback timeout for stuck Challenged commitments (audit-417 F3).
    uint256 public constant ADJUDICATOR_TIMEOUT = 7 days;

    /// @notice Minimum challenge bond numerator (10% of stake) — prevents free griefing.
    ///         audit-pashov P3: counterparty must post bond to challenge.
    uint256 public constant MIN_CHALLENGE_BOND_NUMERATOR = 10;
    uint256 public constant MIN_CHALLENGE_BOND_DENOMINATOR = 100;

    /// @notice Counter for commitment IDs (first valid ID is 1).
    uint256 public nextId;

    /// @dev Mapping from commitment ID to Commitment data.
    mapping(uint256 => Commitment) private commitments;

    /// @notice Pull-payment balances credited by _settle; winners call withdraw() (audit-417 F2).
    mapping(address => uint256) public withdrawable;

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
    event Challenged(uint256 indexed id, address indexed challenger, uint256 bond);

    /// @notice Emitted when a commitment is settled and stake is distributed.
    event Settled(uint256 indexed id, address indexed winner, uint256 amount, bool disputed);

    /// @notice Emitted when a stuck Challenged commitment is force-settled via liveness fallback (audit-417 F3).
    ///         audit-pashov P5: emitted BEFORE the Settled event so integrators can distinguish.
    event ForceSettled(uint256 indexed id, address indexed caller);

    /// @notice Emitted when a winner withdraws their credited pull-payment balance.
    ///         audit-pashov P4: gives integrators a signal that actual ETH moved.
    event Withdrawn(address indexed user, uint256 amount);

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

    // audit-pashov L2: dedicated errors instead of reusing generic ones.
    error Vouch__AdjudicatorTimeoutExpired();
    error Vouch__AdjudicatorTimeoutPending();
    error Vouch__NotChallenged();
    error Vouch__InsufficientChallengeBond();
    error Vouch__EvidenceAlreadySubmitted();

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
        if (deadlineSeconds > 3650 days) revert Vouch__InvalidDeadline(); // @audit-417 F6
        if (counterparty == msg.sender) revert Vouch__SelfCounterparty();
        if (counterparty == adjudicator || msg.sender == adjudicator) revert Vouch__InvalidCommitment(); // @audit-417 F1
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
            evidenceHash: bytes32(0),
            challengeBond: 0
        });

        emit CommitmentCreated(id, msg.sender, counterparty, specHash, vType, msg.value, deadline);
    }

    /**
     * @notice Submit evidence hash for a commitment. Only creator, before deadline.
     *         Evidence hash is immutable once set (audit-pashov L3).
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
        // audit-pashov L3: prevent evidence bait-and-switch.
        if (c.evidenceHash != bytes32(0)) revert Vouch__EvidenceAlreadySubmitted();

        c.evidenceHash = evidenceHash;

        emit EvidenceSubmitted(id, evidenceHash);
    }

    /**
     * @notice Challenge a commitment within the 24h optimistic window.
     *         Only the counterparty can challenge. Self-commitments cannot be challenged.
     *         Counterparty must post a challenge bond (≥10% of stake) to prevent free griefing
     *         (audit-pashov P3). Bond is returned if counterparty wins, forfeited to creator
     *         if counterparty loses, returned on forceSettle timeout split.
     * @param id Commitment ID.
     */
    function challenge(uint256 id) external payable nonReentrant {
        Commitment storage c = commitments[id];
        if (c.creator == address(0)) revert Vouch__InvalidCommitment();
        if (c.counterparty == address(0)) revert Vouch__InvalidCommitment();
        if (c.counterparty != msg.sender) revert Vouch__NotCounterparty();
        if (c.status != Status.Active) revert Vouch__AlreadyChallenged();

        if (block.timestamp < c.deadline) revert Vouch__DeadlineNotPassed();
        if (block.timestamp > c.deadline + CHALLENGE_WINDOW) revert Vouch__ChallengeWindowClosed();

        // audit-pashov P3: require challenge bond to prevent free griefing.
        uint256 minBond = (c.stake * MIN_CHALLENGE_BOND_NUMERATOR) / MIN_CHALLENGE_BOND_DENOMINATOR;
        if (msg.value < minBond) revert Vouch__InsufficientChallengeBond();

        c.status = Status.Challenged;
        c.challengeBond = msg.value;

        emit Challenged(id, msg.sender, msg.value);
    }

    /**
     * @notice Settle a commitment and credit the winner's pull-payment balance.
     *
     *         Settlement paths:
     *         - Active + window closed (block.timestamp > deadline + CHALLENGE_WINDOW):
     *           auto-settle to creator; anyone may call; creatorWins arg is ignored.
     *         - Challenged (within deadline + CHALLENGE_WINDOW + ADJUDICATOR_TIMEOUT):
     *           only adjudicator may call; creatorWins reflects the AI ruling.
     *           Bond goes to winner (creator if creatorWins, counterparty if !creatorWins).
     *         - Challenged + adjudicator timeout expired: only forceSettle() is valid.
     *
     *         Stake is never pushed here; winners withdraw via withdraw() (audit-417 F2).
     *
     * audit-pashov P1: adjudicator authority now expires after ADJUDICATOR_TIMEOUT.
     * @param id Commitment ID.
     * @param creatorWins AI ruling result (only used for challenged settlements).
     */
    function settle(uint256 id, bool creatorWins) external nonReentrant {
        Commitment storage c = commitments[id];
        if (c.creator == address(0)) revert Vouch__InvalidCommitment();
        if (c.status == Status.Settled) revert Vouch__AlreadySettled();

        if (c.status == Status.Challenged) {
            if (msg.sender != adjudicator) revert Vouch__NotAdjudicator();
            // audit-pashov P1: adjudicator authority expires after timeout.
            //   Previously, adjudicator could front-run forceSettle forever.
            if (block.timestamp > c.deadline + CHALLENGE_WINDOW + ADJUDICATOR_TIMEOUT) {
                revert Vouch__AdjudicatorTimeoutExpired();
            }
            _settle(c, id, creatorWins, true);
        } else {
            // Active: auto-settle only strictly after the challenge window closes.
            // audit-417 F4: closed-interval boundary — `<=` closes the same-instant race.
            if (block.timestamp <= c.deadline + CHALLENGE_WINDOW) revert Vouch__ChallengeWindowOpen();
            _settle(c, id, true, false);
        }
    }

    /**
     * @notice Liveness fallback: force-settle a stuck Challenged commitment once
     *         block.timestamp > deadline + CHALLENGE_WINDOW + ADJUDICATOR_TIMEOUT.
     *
     *         Resolves by splitting the stake 50/50 between creator and counterparty
     *         to remove the DOS incentive (audit-pashov P2). The counterparty's
     *         challenge bond is returned. Anyone may call.
     *
     * audit-pashov P2: stake split removes the creator-favoring DOS incentive.
     * audit-pashov P5: ForceSettled emitted BEFORE Settled for integrator clarity.
     * @param id Commitment ID.
     */
    function forceSettle(uint256 id) external nonReentrant {
        Commitment storage c = commitments[id];
        if (c.creator == address(0)) revert Vouch__InvalidCommitment();
        // audit-pashov L2: dedicated error instead of reusing AlreadySettled.
        if (c.status != Status.Challenged) revert Vouch__NotChallenged();
        // audit-pashov L2: dedicated error instead of reusing ChallengeWindowOpen.
        if (block.timestamp <= c.deadline + CHALLENGE_WINDOW + ADJUDICATOR_TIMEOUT) {
            revert Vouch__AdjudicatorTimeoutPending();
        }

        // audit-pashov P5: emit ForceSettled BEFORE state transition so integrators
        //   can distinguish timeout-forced resolution from adjudicated ruling.
        emit ForceSettled(id, msg.sender);

        c.status = Status.Settled;

        // audit-pashov P2: split stake 50/50 to remove DOS incentive.
        uint256 half = c.stake / 2;
        withdrawable[c.creator] += half;
        withdrawable[c.counterparty] += c.stake - half;

        // Return counterparty's challenge bond on timeout split.
        if (c.challengeBond > 0) {
            withdrawable[c.counterparty] += c.challengeBond;
        }

        emit Settled(id, c.creator, c.stake, true);
    }

    /**
     * @notice Withdraw credited pull-payment balance to msg.sender (audit-417 F2).
     *         Credited by _settle or forceSettle when a commitment is resolved.
     * audit-pashov P4: emits Withdrawn event so integrators can track actual payouts.
     */
    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        withdrawable[msg.sender] = 0;
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert Vouch__TransferFailed();

        // audit-pashov P4: emit event so indexers know actual ETH moved.
        if (amount > 0) {
            emit Withdrawn(msg.sender, amount);
        }
    }

    /*//////////////////////////////////////////////////////////////
                  EXTERNAL READ-ONLY FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Get full commitment data by ID.
     */
    function getCommitment(uint256 id) external view returns (Commitment memory) {
        Commitment storage c = commitments[id];
        if (c.creator == address(0)) revert Vouch__InvalidCommitment(); // @audit-417 F7
        return c;
    }

    /**
     * @notice Check if a commitment is currently in its challenge window.
     */
    function isInChallengeWindow(uint256 id) external view returns (bool) {
        Commitment storage c = commitments[id];
        if (c.creator == address(0)) return false;
        // audit-417 F5: also require Active — a Challenged/Settled commitment must not
        // report a still-actionable window to off-chain integrators.
        return c.status == Status.Active
            && block.timestamp >= c.deadline
            && block.timestamp <= c.deadline + CHALLENGE_WINDOW;
    }

    /*//////////////////////////////////////////////////////////////
                  INTERNAL STATE-CHANGING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Internal settle: sets status, emits event, credits winner's withdrawable
     *      balance (pull-payment) and distributes challenge bond. CEI: status update
     *      before crediting. The actual ETH transfer is deferred to withdraw() (audit-417 F2).
     *
     *      Bond distribution (audit-pashov P3):
     *        - creatorWins=true:  creator gets stake + counterparty's bond
     *        - creatorWins=false: counterparty gets stake + their bond back
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

        // audit-417 F2: pull-payment — credit the winner.
        withdrawable[winner] += amount;

        // audit-pashov P3: distribute challenge bond.
        //   Winner of adjudication also receives the bond.
        if (c.challengeBond > 0) {
            withdrawable[winner] += c.challengeBond;
        }
    }
}
