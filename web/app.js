const CONFIG = {
  contractAddress: "0x37a55927e93f31Ba6dC7BE4f6628d115d93B88dF",
  chainId: "0xaa36a7", // Sepolia
  contractAbi: [
    "function projectCount() view returns (uint256)",
    "event ProjectCreated(uint256 indexed projectId, address indexed client, address indexed freelancer, string title)",
    "event MilestoneAdded(uint256 indexed projectId, uint256 indexed milestoneId, string title, uint256 amount)",
    "function createProject(address payable freelancer, string title) returns (uint256 projectId)",
    "function addMilestone(uint256 projectId, string title, uint256 amount) returns (uint256 milestoneId)",
    "function fundMilestone(uint256 projectId, uint256 milestoneId) payable",
    "function submitWork(uint256 projectId, uint256 milestoneId, string workLink)",
    "function approveMilestone(uint256 projectId, uint256 milestoneId)",
    "function raiseDispute(uint256 projectId, uint256 milestoneId)",
    "function resolveDispute(uint256 projectId, uint256 milestoneId, bool payFreelancer)",
    "function getMilestone(uint256 projectId, uint256 milestoneId) view returns (tuple(string title,uint256 amount,bool funded,bool submitted,bool approved,bool paid,bool disputed,string workLink))",
    "function getMilestoneCount(uint256 projectId) view returns (uint256)",
    "function arbitrator() view returns (address)",
    "function projects(uint256) view returns (address client, address freelancer, string title, bool exists)"
  ],
};

const STORAGE_KEY = "fairwork-mvp-v1";
let state = loadState();
let web3 = { provider: null, signer: null, contract: null, address: null };

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && Array.isArray(saved.projects) ? saved : { projects: [] };
  } catch {
    return { projects: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortenAddress(address) {
  if (!address) return "Not connected";
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function totalAmount(project) {
  return project.milestones.reduce((sum, m) => sum + Number(m.amount || 0), 0);
}

function getStatus(m) {
  if (m.disputed) return ["Dispute", "dispute"];
  if (m.paid) return ["Paid", "paid"];
  if (m.submitted) return ["Awaiting review", "review"];
  if (m.funded) return ["Funded", "funded"];
  return ["Awaiting funding", ""];
}

function render() {
  const projectsEl = document.getElementById("projects");
  if (!state.projects.length) {
    projectsEl.innerHTML = `<div class="empty">No projects yet. Create one above or load the sample project.</div>`;
  } else {
    projectsEl.innerHTML = state.projects.map(project => `
      <article class="project-card">
        <div class="project-top">
          <div>
            <h3 class="project-title">${esc(project.title)}</h3>
            <div class="project-meta">Freelancer: ${esc(shortenAddress(project.freelancer))}</div>
          </div>
          <div class="project-total">${totalAmount(project).toFixed(4)} ETH</div>
        </div>
        <div class="milestones">
          ${project.milestones.map((m, index) => {
            const [label, cls] = getStatus(m);
            return `
              <div class="milestone">
                <div class="milestone-head">
                  <div>
                    <div class="milestone-title">${index + 1}. ${esc(m.title)}</div>
                    <div class="project-meta">${Number(m.amount).toFixed(4)} ETH</div>
                  </div>
                  <div class="status ${cls}"><span class="dot"></span>${label}</div>
                </div>
                ${m.workLink ? `<div class="project-meta">Work: <a href="${esc(m.workLink)}" target="_blank" rel="noreferrer">${esc(m.workLink)}</a></div>` : ""}
                ${m.disputeNote ? `<div class="project-meta">Dispute: ${esc(m.disputeNote)}</div>` : ""}
                <div class="milestone-actions">
                  ${!m.funded && !m.paid ? `<button class="dark" onclick="fundMilestone('${project.id}','${m.id}')">Fund Escrow</button>` : ""}
                  ${m.funded && !m.submitted && !m.disputed && !m.paid ? `<button onclick="submitWork('${project.id}','${m.id}')">Submit Work</button>` : ""}
                  ${m.submitted && !m.approved && !m.disputed ? `<button class="dark" onclick="approveMilestone('${project.id}','${m.id}')">Approve & Release</button>` : ""}
                  ${m.submitted && !m.approved && !m.disputed ? `<button onclick="requestChanges('${project.id}','${m.id}')">Request Changes</button>` : ""}
                  ${m.funded && !m.paid && !m.disputed ? `<button onclick="raiseDispute('${project.id}','${m.id}')">Dispute</button>` : ""}
                </div>
              </div>`;
          }).join("")}
        </div>
      </article>`).join("");
  }

  const milestones = state.projects.flatMap(p => p.milestones);
  document.getElementById("statProjects").textContent = state.projects.length;
  document.getElementById("statFunded").textContent = milestones.filter(m => m.funded && !m.paid).length;
  document.getElementById("statReview").textContent = milestones.filter(m => m.submitted && !m.approved && !m.disputed).length;
  document.getElementById("statPaid").textContent = milestones.filter(m => m.paid).length;

  document.getElementById("contractLabel").textContent = CONFIG.contractAddress || "Not configured";
  document.getElementById("modeBadge").textContent = web3.contract ? "Web3 Mode" : "Demo Mode";
  renderArbitration();
}

function notify(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function setError(message) {
  const box = document.getElementById("formError");
  box.textContent = message;
  box.classList.toggle("hidden", !message);
}

function parseMilestones(raw) {
  return raw.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
    const parts = line.split("|").map(x => x.trim());
    if (parts.length !== 2) throw new Error(`Invalid milestone: ${line}`);
    const [title, amount] = parts;
    const number = Number(amount);
    if (!title || !Number.isFinite(number) || number <= 0) throw new Error(`Invalid milestone amount: ${line}`);
    return { id: uid("ms"), title, amount: number, funded: false, submitted: false, approved: false, paid: false, disputed: false, workLink: "", disputeNote: "" };
  });
}

function extractErrorMessage(error) {
  return (
    error?.shortMessage ||
    error?.info?.error?.message ||
    error?.info?.error?.data?.message ||
    error?.reason ||
    error?.message ||
    "Transaction failed."
  );
}

function receiptProjectId(ethers, receipt) {
  for (const log of receipt.logs || []) {
    try {
      const parsed = web3.contract.interface.parseLog(log);
      if (parsed?.name === "ProjectCreated") {
        return Number(parsed.args.projectId);
      }
    } catch (_) {
      // Ignore logs that do not belong to our ABI.
    }
  }
  return null;
}

async function connectWallet() {
  if (!window.ethereum) {
    notify("MetaMask is not available in this browser. Demo Mode is still available.");
    return;
  }

  try {
    const ethers = await loadEthers();
    await window.ethereum.request({ method: "eth_requestAccounts" });
    web3.provider = new ethers.BrowserProvider(window.ethereum);
    const network = await web3.provider.getNetwork();
    if (`0x${network.chainId.toString(16)}` !== CONFIG.chainId) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CONFIG.chainId }]
        });
        web3.provider = new ethers.BrowserProvider(window.ethereum);
      } catch (switchError) {
        notify("Please switch MetaMask to Sepolia and try again.");
        return;
      }
    }
    web3.signer = await web3.provider.getSigner();
    web3.address = await web3.signer.getAddress();
    document.getElementById("walletAddress").textContent = web3.address;

    const finalNetwork = await web3.provider.getNetwork();
    document.getElementById("networkLabel").textContent = `Sepolia (${finalNetwork.chainId})`;
    web3.contract = new ethers.Contract(CONFIG.contractAddress, CONFIG.contractAbi, web3.signer);
    notify(`Wallet connected. Client wallet: ${shortenAddress(web3.address)}. Contract: ${CONFIG.contractAddress}.`);
    render();
  } catch (error) {
    console.error(error);
    notify(error?.shortMessage || error?.message || "Wallet connection failed.");
  }
}

async function loadEthers() {
  if (window.ethers) return window.ethers;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/ethers@6.15.0/dist/ethers.umd.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load ethers.js"));
    document.head.appendChild(script);
  });
  return window.ethers;
}

function deepRevertMessage(error) {
  return (
    error?.shortMessage ||
    error?.info?.error?.data?.message ||
    error?.info?.error?.message ||
    error?.error?.data?.message ||
    error?.reason ||
    error?.message ||
    "Transaction rejected by the smart contract."
  );
}

async function fundMilestone(projectId, milestoneId) {
  const project = state.projects.find(p => p.id === projectId);
  const milestone = project?.milestones.find(m => m.id === milestoneId);
  if (!project || !milestone) return;

  if (web3.contract) {
    if (project.onChainId == null || milestone.onChainId == null) {
      notify("This project is missing its on-chain IDs. Recreate it in Web3 Mode.");
      return;
    }
    try {
      const ethers = await loadEthers();
      const [client, freelancer, , exists] = await web3.contract.projects(project.onChainId);
      if (!exists) throw new Error(`Project #${project.onChainId} does not exist on the deployed contract.`);
      if (client.toLowerCase() !== web3.address.toLowerCase()) {
        throw new Error(`Wrong wallet. This milestone must be funded by the client wallet ${client}.`);
      }

      const onChain = await web3.contract.getMilestone(project.onChainId, milestone.onChainId);
      if (onChain.paid) {
        milestone.paid = true;
        milestone.funded = true;
        saveState();
        render();
        notify("This milestone is already paid on-chain.");
        return;
      }
      if (onChain.funded) {
        milestone.funded = true;
        saveState();
        render();
        notify("This milestone is already funded on-chain.");
        return;
      }
      if (onChain.disputed) throw new Error("This milestone is currently disputed on-chain.");

      const exactAmount = onChain.amount;
      const uiAmount = ethers.parseEther(String(milestone.amount));
      if (exactAmount !== uiAmount) {
        milestone.amount = Number(ethers.formatEther(exactAmount));
        saveState();
        render();
        throw new Error(`The dashboard amount was stale. It has been synced to ${milestone.amount} ETH. Click Fund Escrow again.`);
      }

      notify(`Checking escrow transaction for ${ethers.formatEther(exactAmount)} ETH…`);
      try {
        await web3.contract.fundMilestone.staticCall(project.onChainId, milestone.onChainId, { value: exactAmount });
      } catch (preflightError) {
        throw new Error(`Smart contract rejected funding: ${deepRevertMessage(preflightError)}`);
      }

      const tx = await web3.contract.fundMilestone(project.onChainId, milestone.onChainId, { value: exactAmount });
      notify(`Funding submitted: ${tx.hash.slice(0, 10)}… waiting for confirmation.`);
      await tx.wait();
      notify("Escrow funded on-chain successfully ✅");
    } catch (error) {
      console.error(error);
      notify(deepRevertMessage(error));
      return;
    }
  }

  milestone.funded = true;
  saveState();
  render();
}

async function submitWork(projectId, milestoneId) {
  const project = state.projects.find(p => p.id === projectId);
  const milestone = project?.milestones.find(m => m.id === milestoneId);
  if (!project || !milestone) return;

  const link = prompt("Enter the work link (GitHub, Figma, Drive, website, etc.):", "https://example.com/work");
  if (!link) return;
  try { new URL(link); } catch { notify("Please enter a valid URL."); return; }

  if (web3.contract) {
    try {
      const tx = await web3.contract.submitWork(project.onChainId, milestone.onChainId, link);
      notify(`Transaction submitted: ${tx.hash.slice(0, 10)}…`);
      await tx.wait();
    } catch (error) {
      console.error(error);
      notify(error?.shortMessage || error?.message || "Work submission failed.");
      return;
    }
  }

  milestone.workLink = link;
  milestone.submitted = true;
  saveState();
  render();
  notify("Work submitted for review.");
}

async function approveMilestone(projectId, milestoneId) {
  const project = state.projects.find(p => p.id === projectId);
  const milestone = project?.milestones.find(m => m.id === milestoneId);
  if (!project || !milestone) return;

  if (web3.contract) {
    try {
      const tx = await web3.contract.approveMilestone(project.onChainId, milestone.onChainId);
      notify(`Approval submitted: ${tx.hash.slice(0, 10)}…`);
      await tx.wait();
    } catch (error) {
      console.error(error);
      notify(error?.shortMessage || error?.message || "Approval failed.");
      return;
    }
  }

  milestone.approved = true;
  milestone.paid = true;
  saveState();
  render();
  notify("Milestone approved and payment released in the MVP flow.");
}

function requestChanges(projectId, milestoneId) {
  const project = state.projects.find(p => p.id === projectId);
  const milestone = project?.milestones.find(m => m.id === milestoneId);
  if (!project || !milestone) return;
  milestone.submitted = false;
  milestone.approved = false;
  saveState();
  render();
  notify("Changes requested. Freelancer can resubmit the work.");
}

async function raiseDispute(projectId, milestoneId) {
  const project = state.projects.find(p => p.id === projectId);
  const milestone = project?.milestones.find(m => m.id === milestoneId);
  if (!project || !milestone) return;
  const note = prompt("Why is this milestone disputed?", "Work does not match the agreed deliverables.");
  if (!note) return;

  if (web3.contract) {
    try {
      const tx = await web3.contract.raiseDispute(project.onChainId, milestone.onChainId);
      notify(`Dispute transaction submitted: ${tx.hash.slice(0, 10)}…`);
      await tx.wait();
    } catch (error) {
      console.error(error);
      notify(extractErrorMessage(error));
      return;
    }
  }

  milestone.disputed = true;
  milestone.disputeNote = note;
  saveState();
  render();
  notify(web3.contract ? "Dispute raised on Sepolia. Payment is locked." : "Dispute raised. Payment is shown as locked.");
}

async function resolveDispute(projectId, milestoneId, payFreelancer) {
  const project = state.projects.find(p => p.id === projectId);
  const milestone = project?.milestones.find(m => m.id === milestoneId);
  if (!project || !milestone || !milestone.disputed) return;

  if (web3.contract) {
    try {
      const arbitrator = await web3.contract.arbitrator();
      if (!web3.address || arbitrator.toLowerCase() !== web3.address.toLowerCase()) {
        throw new Error("Only the configured arbitrator wallet can resolve this dispute.");
      }
      const tx = await web3.contract.resolveDispute(project.onChainId, milestone.onChainId, payFreelancer);
      notify(`Resolution submitted: ${tx.hash.slice(0, 10)}…`);
      await tx.wait();
    } catch (error) {
      console.error(error);
      notify(extractErrorMessage(error));
      return;
    }
  }

  milestone.disputed = false;
  milestone.approved = payFreelancer;
  milestone.paid = true;
  milestone.resolution = payFreelancer ? "Paid to freelancer" : "Refunded to client";
  saveState();
  render();
  notify(payFreelancer ? "Arbitration resolved: pay freelancer." : "Arbitration resolved: refund client.");
}

function renderArbitration() {
  const el = document.getElementById("arbitrationCases");
  if (!el) return;
  const cases = state.projects.flatMap(project =>
    project.milestones
      .filter(m => m.disputed)
      .map(m => ({ project, milestone: m }))
  );

  if (!cases.length) {
    el.innerHTML = '<div class="empty">No open disputes.</div>';
    return;
  }

  el.innerHTML = cases.map(({ project, milestone }) => `
    <article class="project-card">
      <div class="project-top">
        <div>
          <h3 class="project-title">${esc(project.title)} — ${esc(milestone.title)}</h3>
          <div class="project-meta">Disputed amount: ${Number(milestone.amount).toFixed(4)} ETH</div>
          <div class="project-meta">Reason: ${esc(milestone.disputeNote || "No reason provided")}</div>
        </div>
        <div class="status dispute"><span class="dot"></span>Dispute open</div>
      </div>
      <div class="milestone-actions">
        <button class="dark" onclick="resolveDispute('${project.id}','${milestone.id}',true)">Pay Freelancer</button>
        <button onclick="resolveDispute('${project.id}','${milestone.id}',false)">Refund Client</button>
      </div>
    </article>`).join("");
}

function seedSample() {
  if (web3.contract) {
    notify("Sample data is Demo Mode only. Use Create Project for an on-chain project.");
    return;
  }
  if (state.projects.some(p => p.title === "E-commerce Website")) {
    notify("Sample project is already loaded.");
    return;
  }
  state.projects.unshift({
    id: uid("project"),
    onChainId: 1,
    title: "E-commerce Website",
    freelancer: "0x71A5A1A1bB4d7f3eB3D2c4A1B7cD2e1F9A8a0C11",
    milestones: [
      { id: uid("ms"), onChainId: 0, title: "Wireframe", amount: 0.01, funded: true, submitted: true, approved: false, paid: false, disputed: false, workLink: "https://example.com/wireframe", disputeNote: "" },
      { id: uid("ms"), onChainId: 1, title: "Frontend", amount: 0.02, funded: true, submitted: false, approved: false, paid: false, disputed: false, workLink: "", disputeNote: "" },
      { id: uid("ms"), onChainId: 2, title: "Final Website", amount: 0.03, funded: false, submitted: false, approved: false, paid: false, disputed: false, workLink: "", disputeNote: "" }
    ]
  });
  saveState();
  render();
  notify("Sample project loaded.");
}

document.getElementById("projectForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("");

  const submitButton = event.target.querySelector('button[type="submit"]');
  if (submitButton?.disabled) return;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = web3.contract ? "Creating on Sepolia…" : "Creating…";
  }

  try {
    const title = document.getElementById("projectTitle").value.trim();
    const freelancer = document.getElementById("freelancerAddress").value.trim();
    const milestones = parseMilestones(document.getElementById("milestonesInput").value);
    if (!title) throw new Error("Project title is required.");
    if (!/^0x[a-fA-F0-9]{40}$/.test(freelancer)) throw new Error("Freelancer wallet must be a valid 42-character 0x address.");
    if (web3.contract && web3.address && freelancer.toLowerCase() === web3.address.toLowerCase()) {
      throw new Error("Client and freelancer must use different wallets.");
    }

    if (web3.contract) {
      const ethers = await loadEthers();
      const network = await web3.provider.getNetwork();
      if (`0x${network.chainId.toString(16)}` !== CONFIG.chainId) {
        throw new Error("Please switch MetaMask to Sepolia before creating the project.");
      }

      notify("Creating project on Sepolia… approve the first MetaMask transaction.");
      const tx = await web3.contract.createProject(freelancer, title);
      notify(`Project transaction submitted: ${tx.hash.slice(0, 10)}… waiting for confirmation.`);
      const receipt = await tx.wait();
      const onChainId = receiptProjectId(ethers, receipt) ?? Number(await web3.contract.projectCount());

      const project = {
        id: uid("project"),
        title,
        freelancer,
        onChainId,
        milestones: [],
      };
      // Save the project immediately after the project transaction succeeds so a later milestone transaction can be resumed safely.
      state.projects.unshift(project);
      saveState();
      render();

      for (let i = 0; i < milestones.length; i++) {
        const milestone = milestones[i];
        notify(`Adding milestone ${i + 1}/${milestones.length}: ${milestone.title}… approve the MetaMask transaction.`);
        const mtx = await web3.contract.addMilestone(
          onChainId,
          milestone.title,
          ethers.parseEther(String(milestone.amount))
        );
        notify(`Milestone transaction submitted: ${mtx.hash.slice(0, 10)}… waiting for confirmation.`);
        const mReceipt = await mtx.wait();
        let onChainMilestoneId = i;
        for (const log of mReceipt.logs || []) {
          try {
            const parsed = web3.contract.interface.parseLog(log);
            if (parsed?.name === "MilestoneAdded") {
              onChainMilestoneId = Number(parsed.args.milestoneId);
              break;
            }
          } catch (_) {}
        }
        milestone.onChainId = onChainMilestoneId;
        project.milestones.push(milestone);
        saveState();
        render();
      }

      event.target.reset();
      notify(`Project #${onChainId} created on Sepolia successfully.`);
      return;
    }

    state.projects.unshift({ id: uid("project"), title, freelancer, onChainId: null, milestones });
    saveState();
    render();
    event.target.reset();
    notify("Project created in Demo Mode.");
  } catch (error) {
    console.error(error);
    setError(extractErrorMessage(error));
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Create Project";
    }
  }
});

document.getElementById("connectBtn").addEventListener("click", connectWallet);
document.getElementById("seedBtn").addEventListener("click", seedSample);

// Reconnect silently if MetaMask is already connected to this site.
async function autoConnectWeb3() {
  if (!window.ethereum) return;
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (!accounts || !accounts.length) return;
    await connectWallet();
  } catch (error) {
    console.warn("Auto-connect skipped:", error);
  }
}

if (window.ethereum?.on) {
  window.ethereum.on("accountsChanged", () => autoConnectWeb3());
  window.ethereum.on("chainChanged", () => autoConnectWeb3());
}

window.fundMilestone = fundMilestone;
window.submitWork = submitWork;
window.approveMilestone = approveMilestone;
window.requestChanges = requestChanges;
window.raiseDispute = raiseDispute;
window.resolveDispute = resolveDispute;

render();
