# Demo Project — Brand Logo and Website Design

Use this scenario for the Fairwork MVP demonstration.

## Project
**Brand Logo and Website Design**

## Freelancer
Use the second MetaMask test account as the freelancer.

## Milestones
- Logo Concepts — 0.001 ETH
- Homepage Design — 0.002 ETH
- Final Brand Kit — 0.003 ETH

## Happy-path demo
1. Client creates the project.
2. Client funds the Logo Concepts milestone.
3. Freelancer submits a work link.
4. Client approves the milestone.
5. Payment is released according to the escrow contract/demo flow.

## Arbitration demo
1. Fund a milestone and submit work.
2. Client raises a dispute with this reason:
   **The submitted logo does not follow the agreed brand requirements.**
3. Open the arbitration panel.
4. Cast three votes:
   - Arbitrator 1 — Pay Freelancer
   - Arbitrator 2 — Refund Client
   - Arbitrator 3 — Refund Client
5. The 2-of-3 majority produces **Refund Client**.

## Demo note
The arbitration voting panel in the current web demo is a UI simulation. The reference Solidity voting contract is in `contracts/FreelanceEscrowVoting.sol`. The currently deployed Sepolia escrow contract remains the single-arbitrator ETH escrow deployment.
