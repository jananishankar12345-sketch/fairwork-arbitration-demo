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
let connectionVersion = 0;

function visibleProjects() {
  return state.projects.filter(p => p.mode === (web3.contract ? "web3" : "demo"));
}

function resetConnection() {
  connectionVersion++;
  web3 = { provider: null, signer: null, contract: null, address: null };
  document.getElementById("walletAddress").textContent = "Not connected";
  document.getElementById("networkLabel").textContent = "Demo / Not connected";
  render();
}

function assertSession(session) {
  if (session !== web3 || !session.contract) {
    throw new Error("Wallet connection changed. Reconnect and try again.");
  }
}

function actionAllowed(project, milestone) {
  if (project.mode !== (web3.contract ? "web3" : "demo")) {
    notify("Switch to the project's mode before using its actions.");
    return false;
  }
  if (project.mode === "web3" && (
    project.chainId !== CONFIG.chainId ||
    project.contractAddress?.toLowerCase() !== CONFIG.contractAddress.toLowerCase() ||
    !Number.isSafeInteger(project.onChainId) || project.onChainId < 1 ||
    !Number.isSafeInteger(milestone.onChainId) || milestone.onChainId < 0
  )) {
    notify("This project is missing a valid connection to the configured escrow.");
    return false;
  }
  return true;
}

async function prepareWeb3Action(project, session, role) {
  const network = await session.provider.getNetwork();
  assertSession(session);
  if (`0x${network.chainId.toString(16)}` !== CONFIG.chainId) throw new Error("Switch to Sepolia first.");
  const [client, freelancer, title, exists] = await session.contract.projects(project.onChainId);
  assertSession(session);
  if (!exists || title !== project.title || freelancer.toLowerCase() !== project.freelancer.toLowerCase()) {
    throw new Error("The saved project does not match this escrow's on-chain project.");
  }
  const address = session.address.toLowerCase();
  if (role === "client" && address !== client.toLowerCase()) throw new Error("Only the client wallet can perform this action.");
  if (role === "freelancer" && address !== freelancer.toLowerCase()) throw new Error("Only the freelancer wallet can perform this action.");
  if (role === "party" && address !== client.toLowerCase() && address !== freelancer.toLowerCase()) throw new Error("Only a project party can raise a dispute.");
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.projects)) return { projects: [] };
    // Migrate the old sample's fabricated chain IDs without discarding real projects.
    saved.projects = saved.projects.filter(p => p && Array.isArray(p.milestones)).map(p => {
      const oldSample = !p.mode && p.title === "E-commerce Website" &&
        p.freelancer?.toLowerCase() === "0x71a5a1a1bb4d7f3eb3d2c4a1b7cd2e1f9a8a0c11";
      const mode = p.mode || (p.onChainId != null && !oldSample ? "web3" : "demo");
      return { ...p, mode,
        onChainId: mode === "demo" ? null : p.onChainId,
        chainId: mode === "web3" ? (p.chainId || CONFIG.chainId) : null,
        contractAddress: mode === "web3" ? (p.contractAddress || CONFIG.contractAddress) : null,
        milestones: p.milestones.map(m => ({ ...m, onChainId: mode === "demo" ? null : m.onChainId })) };
    });
    return saved;
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
  const projects = visibleProjects();
  if (!projects.length) {
    projectsEl.innerHTML = `<div class="empty">${web3.contract ? "No saved Web3 projects in this browser. Create a project above." : "No demo projects yet. Create one above or load the sample project."}</div>`;
  } else {
    projectsEl.innerHTML = projects.map(project => `
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
                  ${m.submitted && !m.approved && !m.disputed && !m.paid ? `<button class="dark" onclick="approveMilestone('${project.id}','${m.id}')">Approve & Release</button>` : ""}
                  ${m.submitted && !m.approved && !m.disputed && !m.paid ? (project.mode === "demo" ? `<button onclick="requestChanges('${project.id}','${m.id}')">Request Changes (demo)</button>` : `<span class="note">Revision requests are not supported by this deployed contract. Contact the freelancer before approving.</span>`) : ""}
                  ${m.funded && !m.paid && !m.disputed ? `<button onclick="raiseDispute('${project.id}','${m.id}')">Dispute</button>` : ""}
                </div>
              </div>`;
          }).join("")}
        </div>
      </article>`).join("");
  }

  const milestones = projects.flatMap(p => p.milestones);
  document.getElementById("statProjects").textContent = projects.length;
  document.getElementById("statFunded").textContent = milestones.filter(m => m.funded && !m.paid).length;
  document.getElementById("statReview").textContent = milestones.filter(m => m.submitted && !m.approved && !m.disputed).length;
  document.getElementById("statPaid").textContent = milestones.filter(m => m.paid).length;

  document.getElementById("contractLabel").textContent = CONFIG.contractAddress || "Not configured";
  document.getElementById("modeBadge").textContent = web3.contract ? "Web3 Mode" : "Demo Mode";
  document.getElementById("votingDemoPanel").hidden = !!web3.contract;
  document.getElementById("voteDemoBtn").disabled = !!web3.contract;
  document.getElementById("seedBtn").disabled = !!web3.contract;
  document.getElementById("disconnectBtn").hidden = !web3.contract;
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

function receiptProjectId(contract, receipt) {
  for (const log of receipt.logs || []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "ProjectCreated") {
        return Number(parsed.args.projectId);
      }
    } catch (_) {
      // Ignore logs that do not belong to our ABI.
    }
  }
  return null;
}

async function connectWallet({ interactive = true } = {}) {
  resetConnection();
  const version = connectionVersion;
  if (!window.ethereum) {
    if (interactive) notify("MetaMask is not available in this browser. Demo Mode is still available.");
    return;
  }

  try {
    const ethers = await loadEthers();
    const accounts = await window.ethereum.request({ method: interactive ? "eth_requestAccounts" : "eth_accounts" });
    if (version !== connectionVersion || !accounts?.length) return;
    let provider = new ethers.BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    if (version !== connectionVersion) return;
    if (`0x${network.chainId.toString(16)}` !== CONFIG.chainId) {
      try {
        if (!interactive) throw new Error("Switch to Sepolia and reconnect.");
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CONFIG.chainId }]
        });
        provider = new ethers.BrowserProvider(window.ethereum);
      } catch (switchError) {
        notify("Please switch MetaMask to Sepolia and try again.");
        return;
      }
    }
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    const finalNetwork = await provider.getNetwork();
    if (version !== connectionVersion) return;
    if (`0x${finalNetwork.chainId.toString(16)}` !== CONFIG.chainId) throw new Error("Switch to Sepolia and reconnect.");
    web3 = { provider, signer, address, contract: new ethers.Contract(CONFIG.contractAddress, CONFIG.contractAbi, signer) };
    document.getElementById("walletAddress").textContent = address;
    document.getElementById("networkLabel").textContent = `Sepolia (${finalNetwork.chainId})`;
    notify(`Wallet connected. Client wallet: ${shortenAddress(web3.address)}. Contract: ${CONFIG.contractAddress}.`);
    render();
  } catch (error) {
    if (version !== connectionVersion) return;
    resetConnection();
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
  if (!actionAllowed(project, milestone)) return;
  const session = web3;

  if (session.contract) {
    try {
      await prepareWeb3Action(project, session, "client");
      const ethers = await loadEthers();

      const onChain = await session.contract.getMilestone(project.onChainId, milestone.onChainId);
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
        await session.contract.fundMilestone.staticCall(project.onChainId, milestone.onChainId, { value: exactAmount });
      } catch (preflightError) {
        throw new Error(`Smart contract rejected funding: ${deepRevertMessage(preflightError)}`);
      }

      assertSession(session);
      const tx = await session.contract.fundMilestone(project.onChainId, milestone.onChainId, { value: exactAmount });
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
  if (!actionAllowed(project, milestone)) return;
  const session = web3;

  const link = prompt("Enter the work link (GitHub, Figma, Drive, website, etc.):", "https://example.com/work");
  if (!link) return;
  try { new URL(link); } catch { notify("Please enter a valid URL."); return; }

  if (session.contract) {
    try {
      await prepareWeb3Action(project, session, "freelancer");
      assertSession(session);
      const tx = await session.contract.submitWork(project.onChainId, milestone.onChainId, link);
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
  if (!actionAllowed(project, milestone)) return;
  const session = web3;

  if (session.contract) {
    try {
      await prepareWeb3Action(project, session, "client");
      assertSession(session);
      const tx = await session.contract.approveMilestone(project.onChainId, milestone.onChainId);
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
  if (project.mode !== "demo" || web3.contract) {
    notify("The deployed escrow does not support revision requests. No on-chain state was changed.");
    return;
  }
  if (!milestone.funded || !milestone.submitted || milestone.paid || milestone.disputed || milestone.approved) return;
  milestone.submitted = false;
  milestone.approved = false;
  saveState();
  render();
  notify("Demo revision requested. Freelancer can resubmit the work.");
}

async function raiseDispute(projectId, milestoneId) {
  const project = state.projects.find(p => p.id === projectId);
  const milestone = project?.milestones.find(m => m.id === milestoneId);
  if (!project || !milestone) return;
  if (!actionAllowed(project, milestone)) return;
  const session = web3;
  const note = prompt("Why is this milestone disputed?", "Work does not match the agreed deliverables.");
  if (!note) return;

  if (session.contract) {
    try {
      await prepareWeb3Action(project, session, "party");
      assertSession(session);
      const tx = await session.contract.raiseDispute(project.onChainId, milestone.onChainId);
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
  notify(session.contract ? "Dispute raised on Sepolia. Payment is locked." : "Dispute raised. Payment is shown as locked.");
}

async function resolveDispute(projectId, milestoneId, payFreelancer) {
  const project = state.projects.find(p => p.id === projectId);
  const milestone = project?.milestones.find(m => m.id === milestoneId);
  if (!project || !milestone || !milestone.disputed) return;
  if (!actionAllowed(project, milestone)) return;
  const session = web3;

  if (session.contract) {
    try {
      await prepareWeb3Action(project, session, null);
      const arbitrator = await session.contract.arbitrator();
      if (!session.address || arbitrator.toLowerCase() !== session.address.toLowerCase()) {
        throw new Error("Only the configured arbitrator wallet can resolve this dispute.");
      }
      assertSession(session);
      const tx = await session.contract.resolveDispute(project.onChainId, milestone.onChainId, payFreelancer);
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
  const cases = visibleProjects().flatMap(project =>
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
  if (state.projects.some(p => p.mode === "demo" && p.title === "E-commerce Website")) {
    notify("Sample project is already loaded.");
    return;
  }
  state.projects.unshift({
    id: uid("project"),
    mode: "demo",
    onChainId: null,
    title: "E-commerce Website",
    freelancer: "0x71A5A1A1bB4d7f3eB3D2c4A1B7cD2e1F9A8a0C11",
    milestones: [
      { id: uid("ms"), onChainId: null, title: "Wireframe", amount: 0.01, funded: true, submitted: true, approved: false, paid: false, disputed: false, workLink: "https://example.com/wireframe", disputeNote: "" },
      { id: uid("ms"), onChainId: null, title: "Frontend", amount: 0.02, funded: true, submitted: false, approved: false, paid: false, disputed: false, workLink: "", disputeNote: "" },
      { id: uid("ms"), onChainId: null, title: "Final Website", amount: 0.03, funded: false, submitted: false, approved: false, paid: false, disputed: false, workLink: "", disputeNote: "" }
    ]
  });
  saveState();
  render();
  notify("Sample project loaded.");
}

document.getElementById("projectForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("");
  const session = web3;

  const submitButton = event.target.querySelector('button[type="submit"]');
  if (submitButton?.disabled) return;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = session.contract ? "Creating on Sepolia…" : "Creating…";
  }

  try {
    const title = document.getElementById("projectTitle").value.trim();
    const freelancer = document.getElementById("freelancerAddress").value.trim();
    const milestones = parseMilestones(document.getElementById("milestonesInput").value);
    if (!title) throw new Error("Project title is required.");
    if (!/^0x[a-fA-F0-9]{40}$/.test(freelancer)) throw new Error("Freelancer wallet must be a valid 42-character 0x address.");
    if (session.contract && session.address && freelancer.toLowerCase() === session.address.toLowerCase()) {
      throw new Error("Client and freelancer must use different wallets.");
    }

    if (session.contract) {
      const ethers = await loadEthers();
      const network = await session.provider.getNetwork();
      if (`0x${network.chainId.toString(16)}` !== CONFIG.chainId) {
        throw new Error("Please switch MetaMask to Sepolia before creating the project.");
      }

      notify("Creating project on Sepolia… approve the first MetaMask transaction.");
      assertSession(session);
      const tx = await session.contract.createProject(freelancer, title);
      notify(`Project transaction submitted: ${tx.hash.slice(0, 10)}… waiting for confirmation.`);
      const receipt = await tx.wait();
      const onChainId = receiptProjectId(session.contract, receipt);

      if (onChainId == null) throw new Error("Project confirmed but its ID could not be read from the receipt. Do not create a duplicate project.");

      const project = {
        mode: "web3",
        chainId: CONFIG.chainId,
        contractAddress: CONFIG.contractAddress,
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
        assertSession(session);
        const mtx = await session.contract.addMilestone(
          onChainId,
          milestone.title,
          ethers.parseEther(String(milestone.amount))
        );
        notify(`Milestone transaction submitted: ${mtx.hash.slice(0, 10)}… waiting for confirmation.`);
        const mReceipt = await mtx.wait();
        let onChainMilestoneId = i;
        for (const log of mReceipt.logs || []) {
          try {
            const parsed = session.contract.interface.parseLog(log);
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

    state.projects.unshift({ id: uid("project"), mode: "demo", title, freelancer, onChainId: null, milestones });
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

// Invalidate immediately on wallet events, then reconnect without permission prompts.
async function autoConnectWeb3() {
  await connectWallet({ interactive: false });
}

if (window.ethereum?.on) {
  window.ethereum.on("accountsChanged", () => { void autoConnectWeb3(); });
  window.ethereum.on("chainChanged", () => { void autoConnectWeb3(); });
  window.ethereum.on("disconnect", () => resetConnection());
}
document.getElementById("disconnectBtn").addEventListener("click", resetConnection);

window.fundMilestone = fundMilestone;
window.submitWork = submitWork;
window.approveMilestone = approveMilestone;
window.requestChanges = requestChanges;
window.raiseDispute = raiseDispute;
window.resolveDispute = resolveDispute;

render();
void autoConnectWeb3();
