// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FreelanceEscrow
 * @notice Minimal ETH-based milestone escrow for a freelance marketplace MVP.
 *
 * Production hardening should add: role management, reentrancy protection,
 * timeout/refund policy, richer dispute arbitration, emergency controls,
 * event indexing, and a pull-payment pattern.
 */
contract FreelanceEscrow {
    struct Milestone {
        string title;
        uint256 amount;
        bool funded;
        bool submitted;
        bool approved;
        bool paid;
        bool disputed;
        string workLink;
    }

    struct Project {
        address payable client;
        address payable freelancer;
        string title;
        bool exists;
    }

    struct DisputeResolution {
        bool resolved;
        bool payFreelancer;
    }

    uint256 public projectCount;
    mapping(uint256 => Project) public projects;
    mapping(uint256 => Milestone[]) private projectMilestones;
    mapping(uint256 => mapping(uint256 => DisputeResolution)) public disputes;
    address public immutable arbitrator;

    event ProjectCreated(uint256 indexed projectId, address indexed client, address indexed freelancer, string title);
    event MilestoneAdded(uint256 indexed projectId, uint256 indexed milestoneId, string title, uint256 amount);
    event MilestoneFunded(uint256 indexed projectId, uint256 indexed milestoneId, uint256 amount);
    event WorkSubmitted(uint256 indexed projectId, uint256 indexed milestoneId, string workLink);
    event MilestoneApproved(uint256 indexed projectId, uint256 indexed milestoneId);
    event PaymentReleased(uint256 indexed projectId, uint256 indexed milestoneId, address indexed freelancer, uint256 amount);
    event DisputeRaised(uint256 indexed projectId, uint256 indexed milestoneId, address indexed raisedBy);
    event DisputeResolved(uint256 indexed projectId, uint256 indexed milestoneId, bool payFreelancer);

    modifier onlyClient(uint256 projectId) {
        require(projects[projectId].exists, "Project does not exist");
        require(msg.sender == projects[projectId].client, "Only client");
        _;
    }

    modifier onlyFreelancer(uint256 projectId) {
        require(projects[projectId].exists, "Project does not exist");
        require(msg.sender == projects[projectId].freelancer, "Only freelancer");
        _;
    }

    modifier validMilestone(uint256 projectId, uint256 milestoneId) {
        require(projects[projectId].exists, "Project does not exist");
        require(milestoneId < projectMilestones[projectId].length, "Invalid milestone");
        _;
    }

    constructor(address _arbitrator) {
        require(_arbitrator != address(0), "Invalid arbitrator");
        arbitrator = _arbitrator;
    }

    function createProject(address payable freelancer, string calldata title) external returns (uint256 projectId) {
        require(freelancer != address(0), "Invalid freelancer");
        require(freelancer != msg.sender, "Client and freelancer must differ");
        require(bytes(title).length > 0, "Title required");

        projectId = ++projectCount;
        projects[projectId] = Project(payable(msg.sender), freelancer, title, true);
        emit ProjectCreated(projectId, msg.sender, freelancer, title);
    }

    function addMilestone(uint256 projectId, string calldata title, uint256 amount) external onlyClient(projectId) returns (uint256 milestoneId) {
        require(amount > 0, "Amount must be positive");
        require(bytes(title).length > 0, "Title required");
        projectMilestones[projectId].push(Milestone(title, amount, false, false, false, false, false, ""));
        milestoneId = projectMilestones[projectId].length - 1;
        emit MilestoneAdded(projectId, milestoneId, title, amount);
    }

    function fundMilestone(uint256 projectId, uint256 milestoneId)
        external
        payable
        onlyClient(projectId)
        validMilestone(projectId, milestoneId)
    {
        Milestone storage m = projectMilestones[projectId][milestoneId];
        require(!m.funded, "Already funded");
        require(!m.paid, "Already paid");
        require(!m.disputed, "Disputed");
        require(msg.value == m.amount, "Incorrect ETH amount");

        m.funded = true;
        emit MilestoneFunded(projectId, milestoneId, msg.value);
    }

    function submitWork(uint256 projectId, uint256 milestoneId, string calldata workLink)
        external
        onlyFreelancer(projectId)
        validMilestone(projectId, milestoneId)
    {
        Milestone storage m = projectMilestones[projectId][milestoneId];
        require(m.funded, "Milestone not funded");
        require(!m.paid, "Already paid");
        require(!m.disputed, "Disputed");
        require(bytes(workLink).length > 0, "Work link required");

        m.submitted = true;
        m.workLink = workLink;
        emit WorkSubmitted(projectId, milestoneId, workLink);
    }

    function approveMilestone(uint256 projectId, uint256 milestoneId)
        external
        onlyClient(projectId)
        validMilestone(projectId, milestoneId)
    {
        Milestone storage m = projectMilestones[projectId][milestoneId];
        require(m.funded, "Milestone not funded");
        require(m.submitted, "Work not submitted");
        require(!m.paid, "Already paid");
        require(!m.disputed, "Disputed");

        m.approved = true;
        emit MilestoneApproved(projectId, milestoneId);

        // MVP settlement. Production code should prefer a pull-payment design.
        m.paid = true;
        (bool ok, ) = projects[projectId].freelancer.call{value: m.amount}("");
        require(ok, "Payment failed");
        emit PaymentReleased(projectId, milestoneId, projects[projectId].freelancer, m.amount);
    }

    function raiseDispute(uint256 projectId, uint256 milestoneId)
        external
        validMilestone(projectId, milestoneId)
    {
        require(msg.sender == projects[projectId].client || msg.sender == projects[projectId].freelancer, "Not a party");
        Milestone storage m = projectMilestones[projectId][milestoneId];
        require(m.funded, "Milestone not funded");
        require(!m.paid, "Already paid");
        require(!m.disputed, "Already disputed");

        m.disputed = true;
        emit DisputeRaised(projectId, milestoneId, msg.sender);
    }

    function resolveDispute(uint256 projectId, uint256 milestoneId, bool payFreelancer)
        external
        validMilestone(projectId, milestoneId)
    {
        require(msg.sender == arbitrator, "Only arbitrator");
        Milestone storage m = projectMilestones[projectId][milestoneId];
        require(m.disputed, "No dispute");
        require(!disputes[projectId][milestoneId].resolved, "Already resolved");

        disputes[projectId][milestoneId] = DisputeResolution(true, payFreelancer);
        emit DisputeResolved(projectId, milestoneId, payFreelancer);

        m.disputed = false;
        m.paid = true;

        address payable recipient = payFreelancer ? projects[projectId].freelancer : projects[projectId].client;
        (bool ok, ) = recipient.call{value: m.amount}("");
        require(ok, "Resolution payment failed");

        emit PaymentReleased(projectId, milestoneId, recipient, m.amount);
    }

    function getMilestoneCount(uint256 projectId) external view returns (uint256) {
        return projectMilestones[projectId].length;
    }

    function getMilestone(uint256 projectId, uint256 milestoneId) external view returns (Milestone memory) {
        require(milestoneId < projectMilestones[projectId].length, "Invalid milestone");
        return projectMilestones[projectId][milestoneId];
    }

    function getMilestones(uint256 projectId) external view returns (Milestone[] memory) {
        return projectMilestones[projectId];
    }
}
