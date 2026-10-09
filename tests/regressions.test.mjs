import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const voting = fs.readFileSync(new URL('../web/arbitration-voting.js', import.meta.url), 'utf8');
const client = '0x1111111111111111111111111111111111111111';
const freelancer = '0x2222222222222222222222222222222222222222';
const tick = () => new Promise(resolve => setImmediate(resolve));

// A small DOM fixture runs the actual browser scripts without a wallet or network.
function harness(saved = {}, wallet = {}) {
  const storage = new Map(Object.entries(saved));
  const elements = new Map();
  class Element {
    constructor() { this.listeners = {}; this.innerHTML = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.value = ''; this.dataset = {}; }
    classList = { add() {}, remove() {}, toggle() {} };
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
    async fire(type, event = {}) { for (const fn of [...(this.listeners[type] || [])]) await fn(event); }
    querySelector() { return get('submitButton'); }
    querySelectorAll() {
      return [...this.innerHTML.matchAll(/<button\s+([^>]*data-vote="(pay|refund)"[^>]*)>/g)].map(match => {
        const button = new Element();
        button.dataset = { vote: match[2], arbitrator: /data-arbitrator="([^"]+)"/.exec(match[1])[1] };
        button.disabled = /\bdisabled\b/.test(match[1]);
        return button;
      });
    }
    scrollIntoView() {}
    reset() {}
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  // Retain buttons created by each render so tests fire real registered handlers.
  const voteEl = get('votingDemoCases');
  const query = voteEl.querySelectorAll.bind(voteEl);
  voteEl.querySelectorAll = () => { elements.set('resetVotingDemo',new Element()); return (voteEl.buttons = query()); };
  const document = { getElementById: get, listeners: {}, addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); } };
  const context = vm.createContext({ document, window: wallet, console: { error() {}, warn() {} }, URL,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) },
    setTimeout: () => 1, clearTimeout() {}, prompt: () => 'https://example.com/delivery' });
  vm.runInContext(app, context);
  vm.runInContext(voting, context);
  for (const fn of document.listeners.DOMContentLoaded || []) fn();
  return { context, storage, get, run: code => vm.runInContext(code, context),
    async vote(arbitrator, vote) { const b = voteEl.buttons.find(b => b.dataset.arbitrator === arbitrator && b.dataset.vote === vote); await b.fire('click'); },
    votes() { return JSON.parse(storage.get('fairwork-arbitration-voting-demo-v1')); } };
}

function chainProject() { return { id:'chain', title:'Real project', freelancer, onChainId:7, milestones:[{ id:'m', onChainId:0, title:'Delivery', amount:1, funded:true, submitted:true, approved:false, paid:false, disputed:false }] }; }
function addChain(h) {
  h.context.fixture = chainProject();
  h.run('fixture.mode="web3"; fixture.chainId=CONFIG.chainId; fixture.contractAddress=CONFIG.contractAddress; state.projects.push(fixture)');
}
function connect(h, overrides = {}) {
  const sent = [];
  const contract = { projects: async () => [client,freelancer,'Real project',true], arbitrator: async () => client };
  for (const name of ['approveMilestone','submitWork','raiseDispute','resolveDispute','fundMilestone']) {
    contract[name] = async (...args) => { sent.push({ name,args }); return { hash:'0x123456789abcdef', wait:async()=>({logs:[]}) }; };
  }
  Object.assign(contract, overrides);
  h.context.sessionFixture = { address:client, signer:{}, provider:{ getNetwork:async()=>({chainId:11155111n}) }, contract };
  h.run('web3 = sessionFixture; render()');
  return { sent, contract };
}

test('old demo sample loses fake chain IDs while real saved projects survive', () => {
  const sample = { id:'sample',title:'E-commerce Website',freelancer:'0x71A5A1A1bB4d7f3eB3D2c4A1B7cD2e1F9A8a0C11',onChainId:1,milestones:[{id:'s',onChainId:0}] };
  const h=harness({'fairwork-mvp-v1':JSON.stringify({projects:[sample,chainProject()]})});
  assert.equal(h.run('state.projects[0].mode'), 'demo');
  assert.equal(h.run('state.projects[0].onChainId'), null);
  assert.equal(h.run('state.projects[0].milestones[0].onChainId'), null);
  assert.equal(h.run('state.projects[1].mode'), 'web3');
  assert.equal(h.run('state.projects[1].onChainId'), 7);
});

test('all milestone actions block demo projects after wallet connection', async () => {
  const h=harness();h.run('seedSample(); state.projects[0].milestones[0].disputed=true');
  const before=h.run('JSON.stringify(state.projects[0])');
  const {sent}=connect(h);
  for(const fn of ['fundMilestone','submitWork','approveMilestone','raiseDispute','resolveDispute','requestChanges']) {
    await h.run(`${fn}(state.projects[0].id,state.projects[0].milestones[0].id,true)`);
  }
  assert.equal(sent.length,0);assert.equal(h.run('JSON.stringify(state.projects[0])'),before);
  assert.doesNotMatch(h.get('projects').innerHTML,/E-commerce Website/);
});

test('disconnected Web3 projects cannot be mutated as simulated projects', async () => {
  const h=harness();addChain(h);connect(h);h.run('resetConnection()');
  const before=h.run('JSON.stringify(fixture)');
  await h.run('approveMilestone("chain","m")');
  assert.equal(h.run('JSON.stringify(fixture)'),before);
  assert.doesNotMatch(h.get('projects').innerHTML,/Real project/);
});

test('client approval still submits a valid Web3 transaction', async () => {
  const h=harness();addChain(h);const {sent}=connect(h);
  await h.run('approveMilestone("chain","m")');
  assert.equal(sent.length,1);assert.equal(sent[0].name,'approveMilestone');
  assert.deepEqual(sent[0].args,[7,0]);assert.equal(h.run('fixture.milestones[0].paid'),true);
});

test('wrong wallet and mismatched project identity cannot submit approval', async () => {
  for(const mismatch of ['wallet','project']) {
    const h=harness();addChain(h);const {sent}=connect(h, mismatch==='project'?{projects:async()=>[client,freelancer,'Unrelated project',true]}:{});
    if(mismatch==='wallet') h.run('web3.address=fixture.freelancer');
    await h.run('approveMilestone("chain","m")');
    assert.equal(sent.length,0);assert.equal(h.run('fixture.milestones[0].paid'),false);
  }
});

test('account changes during preflight cancel the action', async () => {
  let resume;
  const h=harness();addChain(h);
  const {sent}=connect(h,{projects:()=>new Promise(r=>{resume=r;})});
  const pending=h.run('approveMilestone("chain","m")');await tick();
  h.run('resetConnection()');resume([client,freelancer,'Real project',true]);await pending;
  assert.equal(sent.length,0);assert.equal(h.run('fixture.milestones[0].paid'),false);
});

test('revision requests stay demo-only and leave Web3 state untouched', () => {
  const h=harness();addChain(h);connect(h);
  h.run('requestChanges("chain","m")');
  assert.equal(h.run('fixture.milestones[0].submitted'),true);
  assert.match(h.get('toast').textContent,/does not support revision/);
  assert.doesNotMatch(h.get('projects').innerHTML,/onclick="requestChanges/);
  h.run('resetConnection(); seedSample(); requestChanges(state.projects[0].id,state.projects[0].milestones[0].id)');
  assert.equal(h.run('state.projects[0].milestones[0].submitted'),false);
});

test('an arbitrator cannot replace a vote, even through a stale handler', async () => {
  const h=harness();const old=h.get('votingDemoCases').buttons.find(b=>b.dataset.arbitrator==='arbitrator1'&&b.dataset.vote==='pay');
  await h.vote('arbitrator1','refund');await old.fire('click');
  assert.equal(h.votes().arbitrator1,'refund');
});

test('majority finalizes votes and survives reload until explicit reset', async () => {
  const h=harness();await h.vote('arbitrator1','refund');await h.vote('arbitrator2','refund');await h.vote('arbitrator3','pay');
  assert.equal(h.votes().arbitrator3,null);
  assert.ok(h.get('votingDemoCases').buttons.every(b=>b.disabled));
  const restored=harness(Object.fromEntries(h.storage));await restored.vote('arbitrator1','pay');
  assert.match(restored.get('votingDemoCases').innerHTML,/Majority decision: Refund Client/);
  await restored.get('resetVotingDemo').fire('click');
  assert.deepEqual(restored.votes(),{arbitrator1:null,arbitrator2:null,arbitrator3:null});
});

test('unknown saved voters cannot manufacture a majority', () => {
  const h=harness({'fairwork-arbitration-voting-demo-v1':JSON.stringify({arbitrator1:'refund',attacker:'refund',arbitrator2:'invalid'})});
  assert.match(h.get('votingDemoCases').innerHTML,/Waiting for a 2-of-3 majority/);
});

test('dashboard and voting renders never overwrite each other', async () => {
  const h=harness();h.run('seedSample(); state.projects[0].milestones[0].disputed=true; render()');
  const actual=h.get('arbitrationCases').innerHTML;
  await h.get('voteDemoBtn').fire('click');await h.vote('arbitrator1','refund');
  assert.equal(h.get('arbitrationCases').innerHTML,actual);
  const panel=h.get('votingDemoCases').innerHTML;h.run('render()');
  assert.equal(h.get('votingDemoCases').innerHTML,panel);
  connect(h);await h.vote('arbitrator2','refund');
  assert.equal(h.get('votingDemoPanel').hidden,true);assert.equal(h.votes().arbitrator2,null);
});

test('empty wallet accounts clear contract, signer and displayed address', async () => {
  const h=harness();connect(h);
  h.context.window.ethereum={request:async()=>[]};h.context.window.ethers={};
  await h.run('autoConnectWeb3()');
  assert.equal(h.run('web3.contract'),null);assert.equal(h.run('web3.signer'),null);
  assert.equal(h.get('walletAddress').textContent,'Not connected');
  assert.equal(h.get('modeBadge').textContent,'Demo Mode');
});

test('silent reconnect on the wrong network clears stale state without permission prompts', async () => {
  const h=harness();connect(h);const calls=[];
  h.context.window.ethereum={request:async q=>{calls.push(q.method);return [client];}};
  h.context.window.ethers={BrowserProvider:class {async getNetwork(){return {chainId:1n};}}};
  await h.run('autoConnectWeb3()');
  assert.equal(h.run('web3.contract'),null);assert.deepEqual(calls,['eth_accounts']);
});

test('a slow old connection cannot resurrect a disconnected session', async () => {
  const h=harness();let resume;
  h.context.window.ethereum={request:()=>new Promise(r=>{resume=r;})};h.context.window.ethers={};
  const pending=h.run('autoConnectWeb3()');await tick();h.run('resetConnection()');resume([client]);await pending;
  assert.equal(h.run('web3.contract'),null);assert.equal(h.get('walletAddress').textContent,'Not connected');
});

test('initial authorized connection and wallet event listeners update the visible session', async () => {
  const listeners={};let accounts=[client];const calls=[];
  const ethereum={on:(event,fn)=>{listeners[event]=fn;},request:async({method})=>{calls.push(method);return accounts;}};
  const ethers={BrowserProvider:class {
    async getNetwork(){return {chainId:11155111n};}
    async getSigner(){return {getAddress:async()=>accounts[0]};}
  },Contract:class {}};
  const h=harness({}, {ethereum,ethers});await tick();
  assert.equal(h.get('modeBadge').textContent,'Web3 Mode');
  assert.equal(h.get('walletAddress').textContent,client);
  assert.deepEqual(calls,['eth_accounts']);
  accounts=[freelancer];listeners.accountsChanged(accounts);
  assert.equal(h.run('web3.contract'),null);
  await tick();assert.equal(h.get('walletAddress').textContent,freelancer);
  listeners.disconnect();assert.equal(h.run('web3.signer'),null);
  assert.equal(h.get('modeBadge').textContent,'Demo Mode');
});

test('a transaction already confirmed after disconnect updates only its original Web3 project', async () => {
  const h=harness();addChain(h);let confirmed;
  connect(h,{approveMilestone:async()=>({hash:'0x123456789abcdef',wait:()=>new Promise(r=>{confirmed=r;})})});
  const pending=h.run('approveMilestone("chain","m")');await tick();
  h.run('resetConnection(); seedSample()');confirmed({logs:[]});await pending;
  assert.equal(h.run('fixture.milestones[0].paid'),true);
  assert.equal(h.run('state.projects[0].mode'),'demo');
  assert.equal(h.run('state.projects[0].milestones[0].paid'),false);
});
