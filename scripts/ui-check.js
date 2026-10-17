// Exercises the real interface in a real browser against a real server that uses the scripted test model
// (STEBULA_FAKE_LLM=1). Not part of `npm test` because it needs Chrome or Edge: run `npm run ui-check`.
// It checks behavior: the two-area Agent screen, the closed-by-default detail drawer, the three overview
// questions, empty, loading, success, incomplete, failed and cancelled states, history, switching agents,
// keyboard use, the Lab, and narrow screens. Screenshots go to SHOTS (default: a temp folder) for inspection.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, findChrome } from './browser.js';

if (!findChrome()) { console.log('SKIPPED: no Chrome or Edge found (set CHROME to the executable). Browser checks were NOT run.'); process.exit(0); }
const SHOTS = process.env.SHOTS || join(tmpdir(), 'stebula-shots');
await mkdir(SHOTS, { recursive: true });
const data = await mkdtemp(join(tmpdir(), 'ui-'));
const port = 5600 + Math.floor(Math.random() * 300), base = `http://localhost:${port}`;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), STEBULA_DATA: data, STEBULA_FAKE_LLM: '1' }, stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
await new Promise((res, rej) => { server.stdout.on('data', b => /STEBULA at/.test(String(b)) && res()); server.once('exit', c => rej(new Error(`server exited ${c}`))); setTimeout(() => rej(new Error('server did not start')), 8000); });
const shot = (p, name) => p.screenshot(join(SHOTS, `${name}.png`));
let step = 0;
const ok = msg => console.log(`ok ${++step}. ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const agentMsgs = 'document.querySelectorAll(".msg.agent[data-turn]").length';
const open = id => `#ovBody [data-open*='"id":"${id}"']`;
const drawerOpen = 'document.querySelector("#drawer") && !document.querySelector("#drawer").hidden';
const drawerClosed = '!document.querySelector("#drawer") || document.querySelector("#drawer").hidden';

async function sendAndWait(p, text, expectTurns) {
  await p.type('#talkInput', text);
  await p.mouse('#talkSend');
  await p.waitFor('document.querySelector("#talkSend") && !document.querySelector("#talkSend").hidden', 15000, 'send finished');
  if (expectTurns != null) await p.waitFor(`${agentMsgs} === ${expectTurns}`, 8000, `${expectTurns} agent messages`);
}
const jobs = async () => (await (await fetch(`${base}/api/jobs`)).json()).jobs;
const dtext = p => p.q('#drawerBody', 'innerText');
const otext = p => p.q('#ovBody', 'innerText');

let p;
try {
  // ================= desktop: agent screen =================
  p = await launch({ width: 1366, height: 850 });
  await p.goto(`${base}/#agent`);
  await p.waitFor('document.querySelector("#modelChip").textContent.length > 0');
  assert.match(await p.q('#modelChip'), /Scripted test model/); ok('loads, labels the scripted test model');
  // ten-second test: who, what it is doing, where to type; two primary areas; nothing else open
  assert.match(await p.q('#sumName', 'innerText'), /Agent A \(empiricist\)/); assert.match(await p.q('#sumStatus', 'innerText'), /Waiting for your message/);
  assert(await p.visible('#talkInput') && await p.visible('#sumName') && await p.visible('#sumStatus'));
  assert(await p.visible('.convo') && await p.visible('#overview'), 'the two primary areas are visible');
  assert(await p.evaluate(drawerClosed), 'the detail drawer is closed by default'); assert(!(await p.exists('#inspector')), 'there is no permanent inspector');
  assert.match(await p.q('#chatLog', 'innerText'), /Nothing here yet/); assert(await p.exists('[data-act=example]'));
  assert.match(await otext(p), /Nothing selected yet/);
  ok('first screen: the agent, what it is doing and where to type; exactly two areas; the drawer is closed; the empty overview says nothing is selected');
  await shot(p, '01-agent-empty');

  // recorded example
  await p.mouse('[data-act=example]');
  await p.waitFor(`${agentMsgs} >= 3`);
  assert.match(await p.q('#banner', 'innerText'), /Scripted example/); assert(await p.evaluate('document.querySelector("#talkInput").disabled'));
  assert.match(await p.q('#sumStatus', 'innerText'), /recorded example/i); ok('scripted example is labelled, read-only, and the status says nothing is running');
  // an older turn shows its own record in the overview and never opens the drawer by itself
  await p.mouse('.msg.agent[data-turn="1"]');
  await p.waitFor('document.querySelector("#ovTurn").innerText.includes("viewing history")');
  assert.match(await p.q('#banner', 'innerText'), /Viewing history/); assert(await p.evaluate(drawerClosed), 'choosing a turn does not open the drawer');
  assert.deepEqual(await p.evaluate('[...document.querySelectorAll("#ovBody .osec h3")].map(e => e.innerText)'), ['What went into this response?', 'What did it consider?', 'What changed afterward?']);
  const reply1 = await p.evaluate('document.querySelector(".msg.agent[data-turn=\\"1\\"] .text").innerText');
  assert(!(await otext(p)).includes(reply1.slice(0, 40)), 'the agent reply is shown once, in the conversation, not repeated in the overview');
  assert.equal(await p.count('#ovBody .orow'), 5); assert.equal(await p.count('.notice'), 0, 'a complete turn has no notice');
  ok('an older message selects its turn: the overview answers three questions from that turn, says "viewing history", and does not repeat the reply');
  await shot(p, '02-agent-overview');
  // opening a row opens the drawer, Escape closes it and returns focus, and the selected turn is kept
  await p.mouse(open('memories')); await p.waitFor(drawerOpen);
  assert.match(await p.q('#drawerTitle', 'innerText'), /Relevant memories/); assert(await p.evaluate('document.activeElement === document.querySelector("#drawerTitle")'), 'focus moves into the drawer');
  assert.match(await dtext(p), /does not show the memory caused/); assert(await p.evaluate('document.querySelector("#drawerBody details.tech:not([open])") !== null'), 'diagnostic records are collapsed');
  await shot(p, '03-drawer-open');
  await p.key('Escape'); await p.waitFor(drawerClosed);
  assert(await p.evaluate('document.activeElement && document.activeElement.matches("[data-open]")'), 'focus returns to the control that opened the drawer');
  assert.match(await p.q('#ovTurn', 'innerText'), /Turn 1, viewing history/); ok('a row opens the details drawer; Escape closes it, focus returns, and the selected turn is preserved');
  await p.mouse(open('priorities')); await p.waitFor(drawerOpen); assert.match(await dtext(p), /No separate goal list/); assert.match(await dtext(p), /Configured in code/);
  await p.mouse('#drawerClose'); await p.waitFor(drawerClosed); ok('priorities name their sources, and the Close button closes the drawer');
  await p.mouse(open('signals')); await p.waitFor(drawerOpen); assert.match(await dtext(p), /not feelings/); assert.match(await dtext(p), /0\.6 x the previous value/); await p.mouse('#drawerClose'); await p.waitFor(drawerClosed); ok('signals say they are computed numbers, not feelings, and give the formula in details');
  // what it considered: concise, details on demand
  assert.equal(await p.count('#ovBody .props .rowbtn'), 2, 'the two selected proposals are listed'); assert.match(await otext(p), /3 other proposals were considered and dropped/);
  assert(!(await otext(p)).match(/relevance|score \d/i), 'raw scores are not in the overview');
  await p.mouse('#ovBody .props .rowbtn'); await p.waitFor(drawerOpen); assert.match(await dtext(p), /Score/); assert.match(await dtext(p), /Supplied to the reply step/); await p.mouse('#drawerClose'); await p.waitFor(drawerClosed);
  await p.mouse('#ovBody .linkish'); await p.waitFor(drawerOpen); assert.match(await p.q('#drawerTitle', 'innerText'), /What was selected/); assert.match(await dtext(p), /The rule/); await p.mouse('#drawerClose'); await p.waitFor(drawerClosed);
  ok('proposals: two selected ones in the overview; scores and the selection rule only in the drawer');
  // the incomplete turn: one notice, honest sections, diagnostics behind it
  const degraded = await p.evaluate('[...document.querySelectorAll(".msg.agent .chip.st-partial")].map(e => e.closest(".msg").dataset.turn)');
  assert(degraded.length >= 1); await p.mouse(`.msg.agent[data-turn="${degraded[0]}"]`); await p.waitFor('document.querySelector(".notice")');
  assert.equal(await p.count('.notice'), 1, 'exactly one notice'); assert.match(await p.q('.notice', 'innerText'), /No proposals were recorded: the proposal step was ended by the model provider with a refusal/);
  assert.match(await p.evaluate('document.querySelectorAll("#ovBody .osec")[1].innerText'), /No proposals were recorded\./); assert.match(await p.evaluate('document.querySelectorAll("#ovBody .osec")[2].innerText'), /No memory changes were made, because this turn was incomplete/);
  assert.match(await otext(p), /None\. The reply was written without proposals/); assert.equal(await p.count('#ovBody .props'), 0, 'no invented proposals');
  assert.match(await p.q(`.msg.agent[data-turn="${degraded[0]}"] .who`, 'innerText'), /Incomplete/);
  await p.mouse('.notice [data-open]'); await p.waitFor(drawerOpen); assert.match(await dtext(p), /refusal/); assert.match(await dtext(p), /and 0 output tokens/);
  assert(await p.evaluate('document.querySelector("#drawerBody details.tech:not([open])") !== null')); await shot(p, '04-incomplete-details'); await p.mouse('#drawerClose'); await p.waitFor(drawerClosed);
  await shot(p, '05-agent-incomplete');
  ok('an incomplete turn has one notice that names the actual failure, honest "no proposals" and "no memory changes" sections, and details behind a button');
  // the process diagram is an explicit action
  await p.mouse('.msg.agent[data-turn="1"]'); await p.mouse('#viewDiagram'); await p.waitFor(drawerOpen);
  assert.match(await p.q('#drawerTitle', 'innerText'), /Process diagram/); assert.equal(await p.count('#drawerBody .node'), 8); assert(await p.exists('#drawerBody [data-edge]'));
  await shot(p, '06-diagram');
  await p.mouse('[data-step=start]'); await p.waitFor('document.querySelector("#drawerBody .stepinfo")'); assert.match(await p.q('#drawerBody .stepinfo', 'innerText'), /stage 1 of 6/); assert.match(await p.q('#drawerBody .stepinfo', 'innerText'), /not live activity/); assert(await p.count('#drawerBody .node.later') >= 5);
  await p.mouse('[data-step=next]'); await p.mouse('[data-step=next]'); await p.waitFor('document.querySelector("#drawerBody .stepinfo").innerText.includes("stage 3 of 6")'); assert(await p.exists('#drawerBody [data-node=proposals].current'));
  await p.mouse('[data-step=all]'); await p.waitFor('document.querySelectorAll("#drawerBody .node.later").length === 0');
  await p.mouse('#drawerBody [data-node=reply] .node-main'); await p.waitFor('document.querySelector("#drawerTitle").innerText.includes("What it said")');
  assert(!(await dtext(p)).includes(reply1.slice(0, 40)), 'the reply is not repeated in its own detail'); assert.match(await dtext(p), /The reply itself is in the conversation/);
  assert(await p.visible('#drawerBack')); await p.mouse('#drawerBack'); await p.waitFor('document.querySelector("#drawerTitle").innerText.includes("Process diagram")');
  await p.evaluate('document.querySelector("#drawerBody [data-edge=noticed-reply]").focus()'); await p.key('Enter'); await p.waitFor('document.querySelector("#drawerTitle").innerText.includes("Connection")');
  assert.match(await dtext(p), /does not show that the earlier stage caused/); await p.mouse('#drawerClose'); await p.waitFor(drawerClosed);
  ok('the full process diagram is behind "Process diagram": it steps through recorded stages, a stage opens its record, Back returns to the diagram, a line opens by keyboard');
  await p.mouse('[data-act=leave-example]'); await p.waitFor('!document.querySelector("#banner").innerText.includes("Scripted example")');

  // live conversation with the scripted model
  await p.type('#talkInput', 'hello'); await p.mouse('#talkSend');
  await p.waitFor(`${agentMsgs} === 1`, 10000);
  await p.waitFor('/Waiting for your message/.test(document.querySelector("#sumStatus").innerText)', 4000);
  assert(await p.evaluate(drawerClosed)); assert.equal(await p.count('.notice'), 0); assert.equal(await p.count('#ovBody .osec'), 3);
  assert.match(await p.evaluate('document.querySelectorAll("#ovBody .osec")[2].innerText'), /Nothing was saved or changed after this response\./);
  assert.match(await p.q('#ovTurn', 'innerText'), /Turn 1, latest/); const reply = await p.q('.msg.agent .text'); assert(reply.length < 120, `a greeting gets a short reply, got ${reply.length} chars`);
  assert(!(await otext(p)).includes(reply), 'the live reply is not repeated in the overview'); ok('the send flow completes: a short reply in the conversation, a complete overview with no notice, "Nothing was saved or changed", the drawer still closed');
  await shot(p, '07-agent-live-turn');
  const w = await p.evaluate('(() => { const r = s => document.querySelector(s).getBoundingClientRect().width; return [r(".convo"), r("#overview")]; })()');
  assert(w[0] >= w[1], `the conversation is the wider area: ${w}`); assert(await p.visible('#talkInput') && await p.visible('#talkSend')); ok('desktop layout: a wide readable conversation and a compact overview; the composer stays visible');

  // incomplete live turn
  await sendAndWait(p, '[refuse-think] what do you think?', 2);
  assert(await p.exists('.msg.agent.degraded')); await p.waitFor('document.querySelector(".notice")'); assert.equal(await p.count('.notice'), 1); assert.match(await p.q('.notice', 'innerText'), /refusal/);
  assert.match(await p.q('.msg.agent.degraded .who', 'innerText'), /Incomplete/); ok('a refused proposal step gives one notice, an "Incomplete" marker on the message, and no invented proposals');

  // failed turn
  const before = await p.count('.msg.agent[data-turn]');
  await sendAndWait(p, '[bad-speak] this will fail');
  await p.waitFor('!document.querySelector("#errorBox").hidden');
  assert.match(await p.q('#errorBox', 'innerText'), /reply step failed/i); assert(await p.exists('#errorBox [data-act=retry]'));
  assert.equal(await p.count('.msg.agent[data-turn]'), before, 'a failed turn adds no answer'); assert.match(await p.q('#talkInput', 'value'), /bad-speak/); ok('failed turn: error beside the composer with Retry, message kept, nothing saved');
  await shot(p, '08-agent-failed');
  await p.mouse('#errorBox [data-act=dismiss]'); await p.type('#talkInput', '');

  // cancellation
  await p.type('#talkInput', '[slow] take your time'); await p.mouse('#talkSend');
  await p.waitFor('!document.querySelector("#talkStop").hidden', 3000);
  await p.waitFor('/Generating proposals|Measuring/.test(document.querySelector("#sumStatus").innerText)', 3000);
  await p.waitFor('document.querySelector("#ovBody").innerText.includes("The proposal step is running")', 3000);
  assert.match(await p.q('#ovTurn', 'innerText'), /in progress/); await shot(p, '09-agent-processing');
  await sleep(250); assert((await jobs()).length >= 1, 'the server sees the job running');
  const turnsBeforeStop = await p.count('.msg.agent[data-turn]');
  await p.mouse('#talkStop'); await p.waitFor('!document.querySelector("#errorBox").hidden', 5000);
  assert.match(await p.q('#errorBox', 'innerText'), /Stopped/);
  for (let i = 0; i < 30 && (await jobs()).length; i++) await sleep(100);
  assert.equal((await jobs()).length, 0); assert.equal(await p.count('.msg.agent[data-turn]'), turnsBeforeStop);
  ok('while a turn runs the status and overview show the stage in progress; Stop cancels it, the server stops, nothing is saved');
  await p.mouse('#errorBox [data-act=dismiss]'); await p.type('#talkInput', '');

  // memory control
  await p.click('#memoryOn');
  await sendAndWait(p, 'do you remember anything?'); await p.waitFor(`${agentMsgs} >= 3`);
  assert.match(await p.evaluate('[...document.querySelectorAll(".msg.agent")].at(-1).querySelector(".who").innerText'), /Memory off/);
  assert.match(await otext(p), /Memory was switched off\. Nothing stored was supplied\./); await p.click('#memoryOn');
  ok('memory off is marked on the message and stated in the overview');

  // a saved self-description change, with before and after
  await sendAndWait(p, 'please change how you describe yourself'); await p.waitFor('document.querySelector("#ovBody .diffrow .add")');
  assert.match(await otext(p), /Saved to its memory:/); assert.match(await p.q('#ovBody .diffrow .add', 'innerText'), /added: My memory is text stored outside me/);
  await p.mouse('#ovBody [data-open*=\'"id":"changes"\'].linkish'); await p.waitFor(drawerOpen); assert.match(await dtext(p), /added: My memory is text stored outside me/); await p.mouse('#drawerClose'); await p.waitFor(drawerClosed);
  ok('a saved change is shown as added and removed lines under "What changed afterward", with the saved records in the drawer');

  // turn controls and keyboard
  assert(await p.visible('#replayBar'));
  await p.mouse('#turnPrev'); await p.waitFor('document.querySelector("#ovTurn").className.includes("history")');
  assert.match(await p.q('#banner', 'innerText'), /Viewing history/); assert(!(await p.evaluate('document.querySelector("#turnLatest").disabled')));
  await p.mouse('#turnLatest'); await p.waitFor('!document.querySelector("#ovTurn").className.includes("history")'); ok('previous turn shows "viewing history" in the banner and overview; Back to latest returns');
  await p.evaluate(`document.querySelector('.msg.agent[data-turn="1"]').focus()`); await p.key('Enter');
  await p.waitFor('document.querySelector("#ovTurn").innerText.includes("Turn 1")'); ok('keyboard: Enter on a message selects its turn');
  await p.evaluate(`document.querySelector(${JSON.stringify(open('memories'))}).focus()`); await p.key('Enter'); await p.waitFor(drawerOpen);
  await p.key('Escape'); await p.waitFor(drawerClosed); assert(await p.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(open('memories'))})`)); ok('keyboard: a row opens the drawer with Enter, Escape closes it and focus returns to that row');
  await p.evaluate('document.activeElement.blur(); document.body.focus()');
  const seen = new Set();
  for (let i = 0; i < 16; i++) { await p.key('Tab'); seen.add(await p.evaluate('(() => { const e = document.activeElement; if (e === document.body) return "BODY:ring"; const s = getComputedStyle(e); return e.tagName + "#" + (e.id || e.className) + (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2 ? ":ring" : ":NORING"); })()')); }
  assert([...seen].every(x => !x.endsWith('NORING')), `every focused control shows a visible focus ring: ${[...seen].join(' ')}`); ok('keyboard: Tab reaches the controls and each shows a visible focus ring');
  const unlabeled = await p.evaluate('[...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter(e => !e.labels?.length && !e.getAttribute("aria-label")).map(e => e.id || e.name)');
  assert.deepEqual(unlabeled.filter(x => !['load'].includes(x)), [], `form controls without a label: ${unlabeled}`); ok('every form control has an associated label');

  // switching agents never mixes records
  assert.match(await p.q('#chatLog', 'innerText'), /hello/);
  await p.evaluate('(() => { const s = document.querySelector("#agentPick"); s.value = "B"; s.dispatchEvent(new Event("change")); })()');
  await p.waitFor('document.querySelector("#sumName").innerText.includes("Agent B")'); await p.waitFor('/Nothing here yet/.test(document.querySelector("#chatLog").innerText)', 5000);
  assert.equal(await p.count('.msg.agent[data-turn]'), 0); assert.match(await p.q('#sumAbout', 'innerText'), /analogy/); assert.equal(await p.q('#agentBadge', 'innerText'), 'B'); assert.match(await otext(p), /Nothing selected yet/);
  await sendAndWait(p, 'a question only for B?', 1);
  assert.doesNotMatch(await p.q('#chatLog', 'innerText'), /hello/); assert.doesNotMatch(await otext(p), /please change how you describe|hello/);
  await p.mouse(open('priorities')); await p.waitFor(drawerOpen); assert.match(await dtext(p), /analogy/); assert.doesNotMatch(await dtext(p), /empiricist|simplest rule/); await p.mouse('#drawerClose'); await p.waitFor(drawerClosed);
  await p.evaluate('(() => { const s = document.querySelector("#agentPick"); s.value = "A"; s.dispatchEvent(new Event("change")); })()');
  await p.waitFor('document.querySelector("#sumName").innerText.includes("Agent A")'); await p.waitFor(`${agentMsgs} >= 3`);
  assert.doesNotMatch(await p.q('#chatLog', 'innerText'), /only for B/); assert.doesNotMatch(await otext(p), /only for B/); ok('switching agents swaps the conversation, overview and drawer with no records from the other agent');

  // ================= history =================
  await p.mouse('#viewHistory'); await p.waitFor('!document.querySelector("#historyView").hidden && document.querySelectorAll("#hList .moment").length > 3');
  assert.match(await p.q('#hState', 'innerText'), /State recorded at this moment/);
  const turnMoments = await p.evaluate('[...document.querySelectorAll("#hList .moment[data-moment^=turn-]")].map(e => e.dataset.moment)');
  await p.evaluate(`document.querySelector('[data-moment="${turnMoments.at(-1)}"]').click()`); await p.waitFor('document.querySelector("#hDetail .banner").innerText.includes("Viewing history")');
  assert.equal(await p.count('#hOvBody .osec'), 3); assert.match(await p.q('#hState', 'innerText'), /What cannot be shown/); assert.match(await p.q('#hState', 'innerText'), /note about the person/);
  await shot(p, '10-history'); ok('history lists recorded moments; a past turn shows its exchange, the same three-question overview and the state recorded then, with gaps stated');
  await p.mouse('#hOvBody .rowbtn'); await p.waitFor(drawerOpen); assert(await p.evaluate('document.querySelector("#drawerCtx").innerText.includes("History")')); await p.mouse('#drawerClose'); await p.waitFor(drawerClosed);
  const selectedTurn = turnMoments.at(-1).replace('turn-', '');
  await p.mouse('[data-hist-open]'); await p.waitFor('!document.querySelector("#agentView").hidden');
  await p.waitFor(`document.querySelector("#ovTurn").innerText.includes("Turn ${selectedTurn}")`); assert.match(await p.q('#banner', 'innerText'), /Viewing history/);
  ok('the moment picked in History is the same turn the Agent view shows: conversation, overview and drawer stay in sync');
  await p.mouse('#viewHistory'); await p.mouse('[data-filter=reading]'); await p.mouse('[data-filter=all]');

  // theme
  await p.mouse('#viewAgent'); await p.mouse('#themeBtn'); await p.mouse('#themeBtn');
  const theme = await p.evaluate('document.documentElement.dataset.theme'); assert(['light', 'dark'].includes(theme));
  await p.evaluate('localStorage.setItem("stebula.theme","dark"); location.reload()'); await p.waitFor('document.documentElement.dataset.theme === "dark"');
  await p.waitFor(`${agentMsgs} >= 3`); await p.mouse('.msg.agent[data-turn="1"]'); await shot(p, '11-agent-dark'); await p.mouse(open('memories')); await p.waitFor(drawerOpen); await shot(p, '12-drawer-dark'); await p.mouse('#drawerClose'); ok('dark theme applies from the stored preference');
  await p.evaluate('localStorage.setItem("stebula.theme","light"); location.reload()'); await p.waitFor('document.documentElement.dataset.theme === "light"');

  // ================= lab =================
  await p.waitFor(`${agentMsgs} >= 3`);
  await p.mouse('#viewLab'); await p.waitFor('!document.querySelector("#labView").hidden && document.querySelector("#lessonDesign").innerText.length > 50');
  assert.match(await p.q('#pane-lesson h2'), /stored lesson change the agent's next decision/);
  const how = await p.q('#how-lesson', 'innerText'); for (const q of ['What will happen', 'Which agent answers', 'Who or what evaluates it', 'What changes between comparisons', 'What the result tells us']) assert(how.includes(q), `lesson explains: ${q}`);
  assert.match(await p.q('#labView', 'innerText'), /Repeatable setup/); assert.match(await p.q('#labView', 'innerText'), /What changes in this test\?/);
  await p.waitFor('document.querySelector("#lessonResults").innerText.length > 0'); assert.match(await p.q('#lEstimate', 'innerText'), /48 model calls/); assert.match(await p.q('#lessonResults', 'innerText'), /No runs yet/);
  await shot(p, '13-lab-lesson'); ok('Lab: plain-language intro, the five questions answered, ordinary names for seed and conditions, an exact call estimate (48), and an empty state with one next action');
  await p.type('#lTasks', '6'); await p.evaluate('document.querySelector("#lTasks").dispatchEvent(new Event("change"))');
  assert.match(await p.q('#lEstimate', 'innerText'), /36 model calls/);
  await p.mouse('#lRun'); await p.waitFor('document.querySelector("#lessonResults .card.warn")', 20000, 'lesson results');
  assert.match(await p.q('#lessonResults', 'innerText'), /Scripted double/); assert.match(await p.q('#lessonResults', 'innerText'), /Per condition/); assert.match(await p.q('#lessonResults', 'innerText'), /Compared with no lesson/); ok('scripted lesson run: results appear, labelled as a scripted double that supports or refutes nothing');
  await p.mouse('[data-trial="0"]'); await p.waitFor('document.querySelector("#trialDetail .trial-detail")');
  assert.match(await p.q('#trialDetail', 'innerText'), /recorded before the outcome/); assert.match(await p.q('#trialDetail', 'innerText'), /Scored against ground truth/); ok('a single trial can be replayed: lesson delivered, prediction before the outcome, then the revealed score');
  await p.mouse('[data-lab=isolation]'); await p.waitFor('!document.querySelector("#pane-isolation").hidden');
  await p.waitFor('document.querySelector("#isoResults").innerText.length > 0 && document.querySelector("#iEstimate").innerText.length > 0'); assert.match(await p.q('#iEstimate', 'innerText'), /model calls/); assert.match(await p.q('#how-isolation', 'innerText'), /comparison agent/); ok('isolation test: plain labels, the five questions, estimate and empty state');
  await p.click('input[name=ic][value=social]'); await p.click('input[name=ic][value=mixed]');
  await p.type('#iSteps', '1'); await p.type('#iEvery', '1'); await p.evaluate('document.querySelector("#iSteps").dispatchEvent(new Event("input")); document.querySelector("#iEvery").dispatchEvent(new Event("input"))');
  await p.waitFor('document.querySelector("#iEstimate").innerText.includes("model calls")'); await p.evaluate('document.querySelector("#iBudget").value = ""'); await p.type('#iBudget', '60');
  await p.mouse('#iRun'); await p.waitFor('document.querySelector("#isoResults").innerText.includes("Checkpoints")', 40000, 'isolation results');
  assert.match(await p.q('#isoResults', 'innerText'), /written before the first model call/); assert.match(await p.q('#isoResults', 'innerText'), /snapshot of memory/); ok('an isolation run works from the form and shows checkpoints, protocol hash, usage and the snapshot note');
  await p.mouse('[data-lab=compare]'); await p.waitFor('document.querySelector("#cmpGrid").innerText.length > 10'); ok('compare agents renders');
  await p.mouse('[data-lab=rules]'); await p.mouse('#run'); await p.waitFor('document.querySelector("#status").textContent.includes("Run complete")', 20000); ok('the two-agent hidden-rule run still works (scripted mock)');
  await p.mouse('[data-lab=checks]'); await p.waitFor('document.querySelector("#cResults").innerText.length > 10');
  assert.match(await p.q('#how-checks', 'innerText'), /Which agent answers/);
  await p.type('#cStmt', 'I find uncertainty uncomfortable.'); await p.mouse('#cRun'); await p.waitFor('document.querySelector(".test")', 20000, 'self-check'); ok('self-checks run from the Lab for a chosen agent');
  await p.mouse('[data-lab=findings]'); await p.waitFor('document.querySelector("#fList .finding")');
  assert(!/supported|refuted/i.test(await p.q('#pane-findings', 'innerText')), 'no verdict words'); ok('findings load with pilot-style labels and no "supported" or "refuted" verdicts');
  await p.mouse('[data-lab=methods]'); await p.waitFor('document.querySelector("#methodsBody").innerText.includes("Methods")');
  await p.mouse('[data-lab=limits]'); await p.waitFor('document.querySelector("#limitsBody").innerText.length > 200'); ok('methods and limitations pages load');
  await p.mouse('[data-lab=score]'); await p.waitFor('document.querySelectorAll("#scoreTable tbody tr").length > 5'); assert.match(await p.q('#pane-score', 'innerText'), /not a score/i); ok('architectural indicators load and say they are not a score');
  assert.deepEqual(p.errors, [], `no browser console errors: ${p.errors.join(' | ')}`); ok('no JavaScript errors in the console on desktop');
  await p.close();

  // ================= narrow screen =================
  p = await launch({ width: 390, height: 844, mobile: true });
  await p.goto(`${base}/#agent`);
  await p.waitFor(`${agentMsgs} >= 3`, 10000);
  const overflow = async () => p.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  const wide = () => p.evaluate(`(() => [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width && r.right > document.documentElement.clientWidth + 1 && s.position !== 'fixed' && ![...(function*(n){ while ((n = n.parentElement)) yield n; })(e)].some(a => /(auto|scroll)/.test(getComputedStyle(a).overflowX)); }).slice(0, 6).map(e => e.tagName + '#' + e.id + '.' + String(e.className.baseVal ?? e.className).slice(0, 30)).join(' | '))()`);
  assert((await overflow()) <= 1, `no horizontal page scroll on a phone, got ${await overflow()}px: ${await wide()}`);
  assert(await p.evaluate(drawerClosed)); assert(await p.visible('#talkInput') && await p.visible('#sumName') && await p.visible('#sumStatus'));
  assert(!(await p.visible('#overview')), 'the conversation comes first on a phone');
  await shot(p, '14-mobile-agent'); ok('mobile: agent, status and composer visible, conversation first, drawer closed, no horizontal scroll');
  await p.mouse('[data-pane=overview]'); await p.waitFor('document.querySelector("#ovBody .osec")'); assert(await p.visible('#overview')); assert(!(await p.visible('#talkInput')));
  assert((await overflow()) <= 1, `overview overflows by ${await overflow()}px: ${await wide()}`); await shot(p, '15-mobile-overview'); ok('mobile: the overview fits the screen and is one tap away');
  await p.mouse(open('memories')); await p.waitFor(drawerOpen);
  assert(await p.evaluate('Math.round(document.querySelector("#drawer").getBoundingClientRect().width) === document.documentElement.clientWidth'), 'the drawer is a full-screen sheet'); assert(await p.visible('#drawerClose'));
  await shot(p, '16-mobile-drawer'); await p.evaluate('document.querySelector("#drawerBody [data-pick-node]")?.click()');
  await p.mouse('#drawerClose'); await p.waitFor(drawerClosed);
  assert(await p.visible('#overview'), 'closing returns to the overview'); ok('mobile: details open as a full-screen sheet with a Close button, and closing returns to the overview');
  await p.mouse('#viewDiagram'); await p.waitFor(drawerOpen); await p.mouse('#drawerBody [data-node=proposals] .node-main'); await p.waitFor('document.querySelector("#drawerTitle").innerText.includes("Proposals")'); assert(await p.visible('#drawerBack'));
  await p.mouse('#drawerBack'); await p.waitFor('document.querySelector("#drawerTitle").innerText.includes("Process diagram")'); assert((await overflow()) <= 1, `diagram overflows: ${await wide()}`); await shot(p, '16b-mobile-diagram'); await p.mouse('#drawerClose'); await p.waitFor(drawerClosed);
  ok('mobile: the process diagram fits, and Back leads from a stage to the diagram');
  for (const [view, sel] of [['#viewHistory', '#historyView'], ['#viewLab', '#labView']]) { await p.mouse(view); await p.waitFor(`!document.querySelector("${sel}").hidden`); assert((await overflow()) <= 1, `${sel} overflows horizontally by ${await overflow()}px: ${await wide()}`); await shot(p, `17-mobile-${sel.slice(1, 5)}`); }
  ok('mobile: History and Lab fit the screen');
  assert.deepEqual(p.errors, [], `no console errors on mobile: ${p.errors.join(' | ')}`);
  await p.close();
  // ================= public replay server =================
  const pubPort = port + 1, pub = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(pubPort), STEBULA_DATA: data + '-pub', STEBULA_PUBLIC: '1', ANTHROPIC_API_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
  try {
    await new Promise((res, rej) => { pub.stdout.on('data', b => /STEBULA at/.test(String(b)) && res()); pub.once('exit', c => rej(new Error('public server exited ' + c))); setTimeout(() => rej(new Error('public server did not start')), 8000); });
    p = await launch({ width: 1366, height: 850 });
    await p.goto(`http://localhost:${pubPort}/#agent`);
    await p.waitFor(`${agentMsgs} >= 3`, 10000);
    assert.match(await p.q('#modelChip'), /Public replay/); assert(await p.evaluate('document.querySelector("#talkInput").disabled && document.querySelector("#talkSend").disabled'));
    assert.match(await p.q('#banner', 'innerText'), /Scripted example/); assert(!(await p.exists('[data-act=leave-example]')), 'no way into a live agent on a public server');
    await p.mouse('#viewLab'); await p.waitFor('document.querySelector("#lEstimate").innerText.includes("turned off")'); assert(await p.evaluate('document.querySelector("#lRun").disabled'));
    await shot(p, '18-public-replay'); ok('public replay server: example only, no live controls, runs turned off');
    await p.close(); p = null;
  } finally { pub.send('shutdown'); await new Promise(r => { pub.once('exit', r); setTimeout(() => { pub.kill(); r(); }, 4000); }); await rm(data + '-pub', { recursive: true, force: true }).catch(() => {}); }
  console.log(`\nBrowser checks passed (${step} checks). Screenshots: ${SHOTS}`);
} catch (e) {
  console.error('\nBROWSER CHECK FAILED:', e.message);
  if (p) { try { await shot(p, 'failure'); console.error('Screenshot of the failure:', join(SHOTS, 'failure.png')); console.error('Console errors:', p.errors); } catch { /* ignore */ } await p.close().catch(() => {}); }
  process.exitCode = 1;
} finally {
  server.send('shutdown'); await new Promise(r => { server.once('exit', r); setTimeout(() => { server.kill(); r(); }, 4000); });
  await rm(data, { recursive: true, force: true }).catch(() => {});
}
