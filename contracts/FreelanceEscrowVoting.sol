// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Fairwork voting-arbitration extension.
 * 3 arbitrators, 2-of-3 majority. Reference contract for an on-chain voting deployment.
 */
contract FreelanceEscrowVoting {
    struct Vote { bool voted; bool payFreelancer; }
    struct CaseState {
        uint256 payVotes;
        uint256 refundVotes;
        bool resolved;
        bool payFreelancer;
        mapping(address => Vote) votes;
    }

    address[3] public arbitrators;
    mapping(uint256 => mapping(uint256 => CaseState)) private cases;

    event VoteCast(uint256 indexed projectId, uint256 indexed milestoneId, address indexed arbitrator, bool payFreelancer);
    event ArbitrationResolved(uint256 indexed projectId, uint256 indexed milestoneId, bool payFreelancer);

    constructor(address[3] memory _arbitrators) {
        require(
            _arbitrators[0] != _arbitrators[1] &&
            _arbitrators[0] != _arbitrators[2] &&
            _arbitrators[1] != _arbitrators[2],
            "Arbitrators must be unique"
        );
        arbitrators = _arbitrators;
    }

    modifier onlyArbitrator() {
        require(isArbitrator(msg.sender), "Not an arbitrator");
        _;
    }

    function isArbitrator(address account) public view returns (bool) {
        return account == arbitrators[0] || account == arbitrators[1] || account == arbitrators[2];
    }

    function castVote(uint256 projectId, uint256 milestoneId, bool payFreelancer) external onlyArbitrator {
        CaseState storage c = cases[projectId][milestoneId];
        require(!c.resolved, "Already resolved");
        require(!c.votes[msg.sender].voted, "Already voted");

        c.votes[msg.sender] = Vote(true, payFreelancer);
        if (payFreelancer) c.payVotes += 1;
        else c.refundVotes += 1;

        emit VoteCast(projectId, milestoneId, msg.sender, payFreelancer);

        if (c.payVotes >= 2) {
            c.resolved = true;
            c.payFreelancer = true;
            emit ArbitrationResolved(projectId, milestoneId, true);
        } else if (c.refundVotes >= 2) {
            c.resolved = true;
            c.payFreelancer = false;
            emit ArbitrationResolved(projectId, milestoneId, false);
        }
    }

    function getCase(uint256 projectId, uint256 milestoneId)
        external
        view
        returns (uint256 payVotes, uint256 refundVotes, bool resolved, bool payFreelancer)
    {
        CaseState storage c = cases[projectId][milestoneId];
        return (c.payVotes, c.refundVotes, c.resolved, c.payFreelancer);
    }
}