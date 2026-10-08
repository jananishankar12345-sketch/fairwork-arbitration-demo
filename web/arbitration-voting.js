(() => {
  const KEY = "fairwork-arbitration-voting-demo-v1";
  const caseData = {
    projectTitle: "E-commerce Website — Arbitration Demo",
    milestoneTitle: "Final Website",
    amount: "0.003 ETH",
    freelancer: "0xB899343994105eDF1F950323D67ee62436efA700",
    reason: "The final delivery does not match the agreed requirements.",
  };

  function loadVotes() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && typeof saved === "object") return saved;
    } catch (_) {}
    return { arbitrator1: null, arbitrator2: null, arbitrator3: null };
  }

  let votes = loadVotes();

  function saveVotes() { localStorage.setItem(KEY, JSON.stringify(votes)); }

  function counts() {
    const values = Object.values(votes);
    return {
      pay: values.filter(v => v === "pay").length,
      refund: values.filter(v => v === "refund").length,
      total: values.filter(Boolean).length,
    };
  }

  function decision() {
    const c = counts();
    if (c.pay >= 2) return "Pay Freelancer";
    if (c.refund >= 2) return "Refund Client";
    return null;
  }

  function esc(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function render() {
    const el = document.getElementById("arbitrationCases");
    if (!el) return;
    const c = counts();
    const result = decision();
    const arbitrators = [
      ["arbitrator1", "Arbitrator 1"],
      ["arbitrator2", "Arbitrator 2"],
      ["arbitrator3", "Arbitrator 3"],
    ];

    el.innerHTML = `
      <article class="project-card voting-case">
        <div class="project-top">
          <div>
            <h3 class="project-title">${esc(caseData.projectTitle)} — ${esc(caseData.milestoneTitle)}</h3>
            <div class="project-meta">Disputed amount: ${esc(caseData.amount)}</div>
            <div class="project-meta">Freelancer: ${esc(caseData.freelancer)}</div>
            <div class="project-meta">Reason: ${esc(caseData.reason)}</div>
          </div>
          <div class="status dispute"><span class="dot"></span>${result ? "Resolved" : "Dispute open"}</div>
        </div>
        <div class="vote-summary">
          <span>Panel vote: ${c.pay} Pay / ${c.refund} Refund</span>
          <span>${c.total}/3 votes</span>
        </div>
        <div class="vote-grid">
          ${arbitrators.map(([key, name]) => `
            <div class="vote-card">
              <div class="vote-name">${name}</div>
              <div class="vote-choice">Current vote: ${votes[key] === "pay" ? "Pay Freelancer" : votes[key] === "refund" ? "Refund Client" : "No vote"}</div>
              <div class="vote-actions">
                <button class="${votes[key] === "pay" ? "active" : ""}" data-vote="pay" data-arbitrator="${key}">Pay Freelancer</button>
                <button class="${votes[key] === "refund" ? "active" : ""}" data-vote="refund" data-arbitrator="${key}">Refund Client</button>
              </div>
            </div>`).join("")}
        </div>
        <div class="vote-rule">Rule: <strong>2 of 3 votes</strong> resolves the dispute.</div>
        ${result ? `<div class="decision">✅ Majority decision: ${esc(result)}</div>` : `<div class="pending-vote">Waiting for a 2-of-3 majority…</div>`}
        <div class="vote-footer-actions">
          <button id="resetVotingDemo" class="secondary">Reset voting demo</button>
        </div>
      </article>`;

    el.querySelectorAll("[data-vote]").forEach(button => {
      button.addEventListener("click", () => {
        votes[button.dataset.arbitrator] = button.dataset.vote;
        saveVotes();
        render();
        const resultNow = decision();
        if (resultNow) {
          const toast = document.getElementById("toast");
          if (toast) {
            toast.textContent = `Arbitration majority reached: ${resultNow}.`;
            toast.classList.remove("hidden");
            clearTimeout(window.__fairworkVoteToast);
            window.__fairworkVoteToast = setTimeout(() => toast.classList.add("hidden"), 3200);
          }
        }
      });
    });

    document.getElementById("resetVotingDemo")?.addEventListener("click", () => {
      votes = { arbitrator1: null, arbitrator2: null, arbitrator3: null };
      saveVotes();
      render();
    });
  }

  function loadDemo() {
    votes = { arbitrator1: null, arbitrator2: null, arbitrator3: null };
    saveVotes();
    render();
    const toast = document.getElementById("toast");
    if (toast) {
      toast.textContent = "Arbitration voting demo loaded — cast two matching votes.";
      toast.classList.remove("hidden");
      clearTimeout(window.__fairworkVoteToast);
      window.__fairworkVoteToast = setTimeout(() => toast.classList.add("hidden"), 3200);
    }
    document.getElementById("arbitrationPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("voteDemoBtn")?.addEventListener("click", loadDemo);
    render();
  });
})();