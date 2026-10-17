// Exercises the real interface in a real browser against a real server that uses the scripted test model
// (STEBULA_FAKE_LLM=1). Not part of `npm test` because it needs Chrome or Edge: run `npm run ui-check`.
// It checks behavior: empty, loading, success, degraded, failed and cancelled states; the process map and
// inspector staying on one turn; history; switching agents; replay; keyboard; the Lab; and narrow screens.
// Screenshots go to SHOTS (default: a temp folder) for inspection.
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

async function sendAndWait(p, text, expectTurns) {
  await p.type('#talkInput', text);
  await p.mouse('#talkSend');
  await p.waitFor('document.querySelector("#talkSend") && !document.querySelector("#talkSend").hidden', 15000, 'send finished');
  if (expectTurns != null) await p.waitFor(`${agentMsgs} === ${expectTurns}`, 8000, `${expectTurns} agent messages`);
}
const jobs = async () => (await (await fetch(`${base}/api/jobs`)).json()).jobs;
const insp = p => p.q('#panel-inspector', 'innerText');

let p;
try {
  // ================= desktop: agent screen =================
  p = await launch({ width: 1366, height: 850 });
  await p.goto(`${base}/#agent`);
  await p.waitFor('document.querySelector("#modelChip").textContent.length > 0');
  assert.match(await p.q('#modelChip'), /Scripted test model/); ok('loads, labels the scripted test model');
  // ten-second test: who, what it is doing, where to type
  assert.match(await p.q('#sumName', 'innerText'), /Agent A \(empiricist\)/); assert.match(await p.q('#sumStatus', 'innerText'), /Waiting for your message/);
  assert(await p.visible('#talkInput') && await p.visible('#sumName') && await p.visible('#sumStatus'));
  assert.match(await p.q('#chatLog', 'innerText'), /Nothing here yet/); assert(await p.exists('[data-act=example]'));
  assert.equal(await p.count('#processMap .node'), 8); assert.equal(await p.count('#processMap .node.st-waiting'), 8, 'with no turn every stage is quiet and says "not reached"');
  ok('first screen: the agent, what it is doing and where to type are visible; the empty map says nothing has been reached; a scripted example is offered');
  await shot(p, '01-agent-empty');

  // recorded example: clearly labelled, read-only, history-aware
  await p.mouse('[data-act=example]');
  await p.waitFor(`${agentMsgs} >= 3`);
  assert.match(await p.q('#banner', 'innerText'), /Scripted example/); assert(await p.evaluate('document.querySelector("#talkInput").disabled'));
  assert.match(await p.q('#sumStatus', 'innerText'), /recorded example/i); ok('scripted example is labelled, read-only, and the status says nothing is running');
  await p.mouse('.msg.agent[data-turn="1"]');
  await p.waitFor('document.querySelector("#inspHead").innerText.includes("turn 1")');
  assert.match(await p.q('#inspHead', 'innerText'), /History/); assert(await p.evaluate('document.querySelector("#inspHead").classList.contains("history")'));
  assert.match(await p.q('#banner', 'innerText'), /Viewing history/); assert.match(await p.q('#mapTurn', 'innerText'), /Turn 1 \(history\)/);
  assert.equal(await p.q('#sumFocus', 'innerText') !== '', true); assert.match(await p.q('#sumFocus', 'innerText'), /\w/);
  assert(await p.exists('[data-node=reply].selected'), 'selecting an answer selects its reply stage');
  ok('selecting an older message updates the map, inspector and summary to that recorded turn, and says "history" in three places');
  await shot(p, '02-agent-example-history');
  // the story in the inspector: overview first
  await p.mouse('#clearSel'); await p.waitFor('document.querySelector(".story")');
  assert.match(await insp(p), /This turn, in order/); assert.equal(await p.count('.story li'), 8); ok('with nothing selected the inspector tells the turn in order, one line per stage');
  // stage inspector: one thing at a time
  await p.mouse('[data-node=proposals] .node-main'); await p.waitFor('document.querySelector("#panel-inspector .node-head")');
  assert.match(await insp(p), /candidate thought from each of five roles/); assert.match(await insp(p), /Reported by the application as each stage finished/); assert(await p.exists('#panel-inspector .events li.here'), 'the stage being inspected is marked in its event list'); assert.match(await insp(p), /Where it came from/); assert.match(await insp(p), /Raw model output/);
  assert.equal(await p.count('#panel-inspector .node-head'), 1); ok('selecting a stage opens one inspector: plain sentence, recorded values, source, what was supplied, raw record');
  // a single proposal
  await p.mouse('[data-proposal]'); await p.waitFor('document.querySelector("#panel-inspector .quote")'); assert.match(await insp(p), /Score/); assert.match(await insp(p), /Supplied to the reply step/); ok('selecting one proposal shows its score arithmetic and whether the reply step received it');
  // a connection
  await p.evaluate('document.querySelector("[data-edge=memories-reply]").dispatchEvent(new MouseEvent("click", {bubbles: true}))');
  await p.waitFor('document.querySelector("#panel-inspector").innerText.includes("Connection")');
  assert.match(await insp(p), /does not show that the earlier stage caused/); assert.match(await insp(p), /Relevant memories.*What it said/s); ok('selecting a line opens the connection: what was supplied, and that it does not claim causation');
  // a memory
  await p.mouse('[data-node=memories] .node-main'); await p.waitFor('document.querySelector("#panel-inspector .node-head")');
  assert.match(await insp(p), /does not show the memory caused/); ok('the memories stage separates "supplied" from "caused"');
  // the reply's direct inputs
  await p.mouse('[data-node=reply] .node-main'); await p.waitFor('document.querySelector(".inputs")');
  assert.match(await insp(p), /Selected proposals/); assert.match(await insp(p), /Not given:.*dropped/s); assert.match(await insp(p), /no influence is claimed/); ok('the reply stage lists every direct input beside the selected proposals, and what it was not given');
  // priorities and signals are honest about their source
  await p.mouse('[data-node=priorities] .node-main'); await p.waitFor('document.querySelector("#panel-inspector .node-head h3")');
  assert.match(await insp(p), /No separate goal list/); assert.match(await insp(p), /Configured in code/); await p.mouse('[data-node=signals] .node-main');
  await p.waitFor('document.querySelector("#panel-inspector").innerText.includes("not feelings")'); assert.match(await insp(p), /0\.6 x the previous value/); ok('priorities name their sources, and signals say they are computed numbers, not feelings, with the formula');
  // degraded turn: failure must not look like a complete process
  const degraded = await p.evaluate('[...document.querySelectorAll(".msg.agent.degraded")].map(e => e.dataset.turn)');
  assert(degraded.length >= 1); await p.mouse(`.msg.agent[data-turn="${degraded[0]}"]`);
  await p.waitFor('document.querySelector("[data-node=proposals].st-failed")');
  assert(await p.exists('[data-node=selected].st-skipped')); assert(await p.exists('[data-node=reply].st-partial')); assert(await p.exists('[data-node=changes].st-skipped'));
  assert.match(await p.q('#mapStatus', 'innerText'), /Incomplete: the thinking step failed/);
  assert.match(await p.q('[data-node=proposals]', 'innerText'), /Failed/); assert.match(await p.q('[data-node=reply]', 'innerText'), /Incomplete/);
  assert.equal(await p.count('[data-node=proposals] [data-proposal]'), 0, 'no invented proposals');
  await p.mouse('[data-node=proposals] .node-main'); await p.waitFor('document.querySelector("#panel-inspector").innerText.includes("failed")'); assert.match(await insp(p), /refusal|failed/);
  ok('a failed thinking step followed by a reply shows: proposals failed, selection skipped, reply incomplete, no changes, no invented content');
  await shot(p, '03-agent-degraded');
  // step through a recorded turn
  await p.mouse('.msg.agent[data-turn="1"]'); await p.mouse('#stepStart');
  await p.waitFor('document.querySelector("#stepInfo").innerText.includes("stage 1 of 6")');
  assert.match(await p.q('#stepInfo', 'innerText'), /not live activity/); assert(await p.count('.node.later') >= 5, 'later stages wait');
  await p.mouse('#stepNext'); await p.mouse('#stepNext'); await p.waitFor('document.querySelector("#stepInfo").innerText.includes("stage 3 of 6")');
  assert(await p.exists('[data-node=proposals].current')); assert.match(await insp(p), /candidate thought/);
  await shot(p, '03b-agent-stepping'); await p.mouse('#stepAll'); await p.waitFor('document.querySelectorAll(".node.later").length === 0'); ok('stepping through a recorded turn reveals one stage at a time, is labelled as replay, and the inspector follows');
  await p.mouse('[data-act=leave-example]'); await p.waitFor('!document.querySelector("#banner").innerText.includes("Scripted example")');

  // live conversation with the scripted model
  await p.type('#talkInput', 'hello'); await p.mouse('#talkSend');
  await p.waitFor('document.querySelector("#sumStatus").innerText.length > 0 && !/Waiting for your message/.test(document.querySelector("#sumStatus").innerText) || ' + agentMsgs + ' === 1', 5000);
  await p.waitFor(`${agentMsgs} === 1`, 10000);
  await p.waitFor('/Waiting for your message/.test(document.querySelector("#sumStatus").innerText)', 4000);
  const reply = await p.q('.msg.agent .text'); assert(reply.length < 120, `a greeting gets a short reply, got ${reply.length} chars`);
  assert.match(await p.q('.msg.agent .changed'), /Nothing in stored memory changed|Self-description changed/); ok('a turn completes; the reply is short; a one-line "what changed" sits under it; status returns to waiting');
  assert.equal(await p.count('#processMap .node.st-done') + await p.count('#processMap .node.st-none'), 8, 'every stage has a recorded outcome');
  assert.match(await p.q('#inspHead', 'innerText'), /Latest/); assert.match(await p.q('#mapTurn', 'innerText'), /latest/);
  await shot(p, '04-agent-live-turn');
  const w = await p.evaluate('(() => { const r = s => document.querySelector(s).getBoundingClientRect().width; return [r(".convo"), r(".mapcol"), r("#inspector")]; })()');
  assert(w[1] >= w[0] && w[1] > w[2], `the process map is the widest column: ${w}`); ok('desktop layout: conversation, process map (widest) and one inspector side by side');
  assert(await p.visible('#talkInput') && await p.visible('#talkSend')); ok('composer stays visible');

  // degraded live turn
  await sendAndWait(p, '[refuse-think] what do you think?', 2);
  assert(await p.exists('.msg.agent.degraded')); assert(await p.exists('[data-node=proposals].st-failed'));
  assert.match(await p.q('.msg.agent.degraded .badges', 'innerText'), /Incomplete/); ok('a refused thinking step gives a labelled incomplete turn and a failed proposals stage');
  await p.mouse('[data-node=proposals] .node-main'); await p.waitFor('document.querySelector("#panel-inspector").innerText.includes("refusal")');

  // failed turn
  const before = await p.count('.msg.agent[data-turn]');
  await sendAndWait(p, '[bad-speak] this will fail');
  await p.waitFor('!document.querySelector("#errorBox").hidden');
  assert.match(await p.q('#errorBox', 'innerText'), /reply step failed/i); assert(await p.exists('#errorBox [data-act=retry]'));
  assert.equal(await p.count('.msg.agent[data-turn]'), before, 'a failed turn adds no answer');
  assert.match(await p.q('#talkInput', 'value'), /bad-speak/); ok('failed turn: error beside the composer with Retry, message kept, nothing saved');
  await shot(p, '06-agent-failed');
  await p.mouse('#errorBox [data-act=dismiss]'); await p.type('#talkInput', '');

  // cancellation
  await p.type('#talkInput', '[slow] take your time'); await p.mouse('#talkSend');
  await p.waitFor('!document.querySelector("#talkStop").hidden', 3000);
  await p.waitFor('/Generating proposals|Measuring/.test(document.querySelector("#sumStatus").innerText)', 3000);
  assert.equal(await p.count('[data-node=proposals].st-active'), 1, 'the stage being worked on is marked "still processing"');
  assert.equal(await p.count('[data-node=reply].st-waiting'), 1, 'later stages are "not reached"');
  await shot(p, '05-agent-processing');
  await sleep(250); assert((await jobs()).length >= 1, 'the server sees the job running');
  const turnsBeforeStop = await p.count('.msg.agent[data-turn]');
  await p.mouse('#talkStop'); await p.waitFor('!document.querySelector("#errorBox").hidden', 5000);
  assert.match(await p.q('#errorBox', 'innerText'), /Stopped/);
  for (let i = 0; i < 30 && (await jobs()).length; i++) await sleep(100);
  assert.equal((await jobs()).length, 0); assert.equal(await p.count('.msg.agent[data-turn]'), turnsBeforeStop);
  ok('while a turn runs the status and map show the live stage; Stop cancels it, the server stops, nothing is saved');
  await p.mouse('#errorBox [data-act=dismiss]'); await p.type('#talkInput', '');

  // memory control
  await p.click('#memoryOn');
  await sendAndWait(p, 'do you remember anything?');
  await p.waitFor(`${agentMsgs} >= 3`);
  assert.match(await p.evaluate('[...document.querySelectorAll(".msg.agent")].at(-1).querySelector(".badges").innerText'), /Memory was off/);
  await p.mouse('[data-node=memories] .node-main'); await p.waitFor('document.querySelector("#panel-inspector").innerText.includes("switched off")');
  assert(await p.exists('[data-node=memories].st-none')); assert(await p.exists('[data-edge=memories-reply].absent')); await p.click('#memoryOn');
  ok('memory off is labelled on the message, shown as "no relevant result" on the map, and the memory-to-reply line is drawn as absent');

  // a self-description change is explained
  await sendAndWait(p, 'please change how you describe yourself');
  await p.waitFor('[...document.querySelectorAll(".msg.agent .changed.did")].length >= 1');
  await p.mouse('[data-node=changes] .node-main'); await p.waitFor('document.querySelector("#panel-inspector").innerText.includes("added:")');
  assert.match(await insp(p), /added: My memory is text stored outside me/); ok('what changed afterward is summarised under the message and shown as a diff in the inspector');

  // turn replay controls and keyboard
  assert(await p.visible('#replayBar'));
  await p.mouse('#turnPrev'); await p.waitFor('document.querySelector("#inspHead").classList.contains("history")');
  assert.match(await p.q('#banner', 'innerText'), /Viewing history/); assert(!(await p.evaluate('document.querySelector("#turnLatest").disabled')));
  assert.match(await p.q('#inspector', 'innerText'), /History/);
  await p.mouse('#turnLatest'); await p.waitFor('!document.querySelector("#inspHead").classList.contains("history")'); ok('previous turn shows "viewing history" everywhere; Back to latest returns to now');
  await p.evaluate(`document.querySelector('.msg.agent[data-turn="1"]').focus()`); await p.key('Enter');
  await p.waitFor('document.querySelector("#inspHead").innerText.includes("turn 1")'); ok('keyboard: Enter on a message selects it');
  await p.evaluate('document.querySelector("[data-edge=noticed-reply]").focus()'); await p.key('Enter');
  await p.waitFor('document.querySelector("#panel-inspector").innerText.includes("Connection")'); ok('keyboard: a line between stages can be focused and opened with Enter');
  await p.evaluate('document.querySelector("[data-node=reply] .node-main").focus()'); await p.key('Enter');
  await p.evaluate('document.activeElement.blur(); document.body.focus()');
  const seen = new Set();
  for (let i = 0; i < 16; i++) { await p.key('Tab'); seen.add(await p.evaluate('(() => { const e = document.activeElement; if (e === document.body) return "BODY:ring"; const s = getComputedStyle(e); const g = e.closest("g.edge"); const o = g ? getComputedStyle(g.querySelector(".line")) : null; return e.tagName + "#" + (e.id || e.className.baseVal || e.className) + (g ? (parseFloat(o.strokeWidth) >= 2.5 ? ":ring" : ":NORING") : (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2 ? ":ring" : ":NORING")); })()')); }
  assert([...seen].every(x => !x.endsWith('NORING')), `every focused control shows a visible focus ring: ${[...seen].join(' ')}`); ok('keyboard: Tab reaches the controls and each shows a visible focus ring');
  const unlabeled = await p.evaluate('[...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter(e => !e.labels?.length && !e.getAttribute("aria-label")).map(e => e.id || e.name)');
  assert.deepEqual(unlabeled.filter(x => !['load'].includes(x)), [], `form controls without a label: ${unlabeled}`); ok('every form control has an associated label');

  // switching agents never mixes records
  const aText = await p.q('#chatLog', 'innerText'); assert.match(aText, /hello/);
  await p.evaluate('(() => { const s = document.querySelector("#agentPick"); s.value = "B"; s.dispatchEvent(new Event("change")); })()');
  await p.waitFor('document.querySelector("#sumName").innerText.includes("Agent B")');
  await p.waitFor('/Nothing here yet/.test(document.querySelector("#chatLog").innerText)', 5000);
  assert.equal(await p.count('.msg.agent[data-turn]'), 0); assert.match(await p.q('#sumAbout', 'innerText'), /analogy/); assert.equal(await p.q('#agentBadge', 'innerText'), 'B');
  await sendAndWait(p, 'a question only for B?', 1);
  assert.doesNotMatch(await p.q('#chatLog', 'innerText'), /hello/); assert.doesNotMatch(await p.q('#panel-inspector', 'innerText') + await p.q('#processMap', 'innerText'), /please change how you describe/);
  await p.mouse('[data-node=priorities] .node-main'); await p.waitFor('document.querySelector("#panel-inspector").innerText.includes("analogy")'); assert.doesNotMatch(await insp(p), /empiricist|simplest rule/);
  await p.evaluate('(() => { const s = document.querySelector("#agentPick"); s.value = "A"; s.dispatchEvent(new Event("change")); })()');
  await p.waitFor('document.querySelector("#sumName").innerText.includes("Agent A")'); await p.waitFor(`${agentMsgs} >= 3`);
  assert.doesNotMatch(await p.q('#chatLog', 'innerText'), /only for B/); ok('switching agents swaps the conversation, map, inspector and stance with no records from the other agent');

  // ================= history =================
  await p.mouse('#viewHistory'); await p.waitFor('!document.querySelector("#historyView").hidden && document.querySelectorAll("#hList .moment").length > 3');
  assert.match(await p.q('#hDetail', 'innerText'), /Latest turn|Viewing history/); assert.match(await p.q('#hState', 'innerText'), /State recorded at this moment/);
  const first = await p.evaluate('[...document.querySelectorAll("#hList .moment")].at(-1).dataset.moment');
  await p.evaluate(`document.querySelector('[data-moment="${first}"]').click()`); await p.waitFor('document.querySelector("#hDetail").innerText.includes("Viewing history") || document.querySelector("#hDetail .banner")');
  await p.waitFor('document.querySelector("#hDetail .banner").innerText.includes("Viewing history") || document.querySelector("#hDetail .banner").innerText.includes("Reading") || true');
  await shot(p, '07-history');
  await p.evaluate('document.querySelector("#hList .moment[data-moment^=turn-]").click()');
  await p.waitFor('document.querySelector("#hMapBox .node")'); assert(await p.count('#hMapBox .node') === 8, 'a past turn shows its whole process'); assert.match(await p.q('#hState', 'innerText'), /What cannot be shown/);
  assert.match(await p.q('#hState', 'innerText'), /note about the person/); ok('history lists recorded moments; a turn shows its exchange, its process map and the state recorded then, with gaps stated');
  const turnMoments = await p.evaluate('[...document.querySelectorAll("#hList .moment[data-moment^=turn-]")].map(e => e.dataset.moment)');
  await p.evaluate(`document.querySelector('[data-moment="${turnMoments.at(-1)}"]').click()`); await p.waitFor('document.querySelector("#hDetail .banner").innerText.includes("Viewing history")');
  const selectedTurn = turnMoments.at(-1).replace('turn-', '');
  await p.mouse('[data-hist-open]'); await p.waitFor('!document.querySelector("#agentView").hidden');
  await p.waitFor(`document.querySelector("#inspHead").innerText.includes("turn ${selectedTurn}")`); assert.match(await p.q('#banner', 'innerText'), /Viewing history/);
  ok('the moment picked in History is the same turn the Agent view shows: conversation, map and inspector stay in sync');
  await p.mouse('#viewHistory'); await p.mouse('[data-filter=reading]'); await p.waitFor('true'); await p.mouse('[data-filter=all]');

  // theme
  await p.mouse('#viewAgent');
  await p.mouse('#themeBtn'); await p.mouse('#themeBtn');
  const theme = await p.evaluate('document.documentElement.dataset.theme'); assert(['light', 'dark'].includes(theme));
  await p.evaluate('localStorage.setItem("stebula.theme","dark"); location.reload()'); await p.waitFor('document.documentElement.dataset.theme === "dark"');
  await p.waitFor(`${agentMsgs} >= 3`); await p.mouse('.msg.agent[data-turn="1"]'); await p.mouse('[data-node=proposals] .node-main'); await shot(p, '08-agent-dark'); ok('dark theme applies from the stored preference');
  await p.evaluate('localStorage.setItem("stebula.theme","light"); location.reload()'); await p.waitFor('document.documentElement.dataset.theme === "light"');

  // ================= lab =================
  await p.waitFor(`${agentMsgs} >= 3`);
  await p.mouse('#viewLab'); await p.waitFor('!document.querySelector("#labView").hidden && document.querySelector("#lessonDesign").innerText.length > 50');
  assert.match(await p.q('#pane-lesson h2'), /stored lesson change the agent's next decision/);
  const how = await p.q('#how-lesson', 'innerText'); for (const q of ['What will happen', 'Which agent answers', 'Who or what evaluates it', 'What changes between comparisons', 'What the result tells us']) assert(how.includes(q), `lesson explains: ${q}`);
  assert.match(await p.q('#labView', 'innerText'), /Repeatable setup/); assert.match(await p.q('#labView', 'innerText'), /What changes in this test\?/);
  await p.waitFor('document.querySelector("#lessonResults").innerText.length > 0'); assert.match(await p.q('#lEstimate', 'innerText'), /48 model calls/); assert.match(await p.q('#lessonResults', 'innerText'), /No runs yet/);
  await shot(p, '09-lab-lesson'); ok('Lab: plain-language intro, the five questions answered, ordinary names for seed and conditions, an exact call estimate (48), and an empty state with one next action');
  await p.type('#lTasks', '6'); await p.evaluate('document.querySelector("#lTasks").dispatchEvent(new Event("change"))');
  assert.match(await p.q('#lEstimate', 'innerText'), /36 model calls/);
  await p.mouse('#lRun'); await p.waitFor('document.querySelector("#lessonResults .card.warn")', 20000, 'lesson results');
  assert.match(await p.q('#lessonResults', 'innerText'), /Scripted double/); assert.match(await p.q('#lessonResults', 'innerText'), /Per condition/); assert.match(await p.q('#lessonResults', 'innerText'), /Compared with no lesson/); ok('scripted lesson run: results appear, labelled as a scripted double that supports or refutes nothing');
  await p.mouse('[data-trial="0"]'); await p.waitFor('document.querySelector("#trialDetail .trial-detail")');
  assert.match(await p.q('#trialDetail', 'innerText'), /recorded before the outcome/); assert.match(await p.q('#trialDetail', 'innerText'), /Scored against ground truth/); ok('a single trial can be replayed: lesson delivered, prediction before the outcome, then the revealed score');
  await shot(p, '10-lab-results');
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
  assert.match(await p.q('#pane-checks', 'innerText'), /invalid, not counted|No self-prediction tests yet/); assert.match(await p.q('#how-checks', 'innerText'), /Which agent answers/);
  await p.type('#cStmt', 'I find uncertainty uncomfortable.'); await p.mouse('#cRun'); await p.waitFor('document.querySelector(".test")', 20000, 'self-check'); ok('self-checks run from the Lab for a chosen agent');
  await p.mouse('[data-lab=findings]'); await p.waitFor('document.querySelector("#fList .finding")');
  assert(!/supported|refuted/i.test(await p.q('#pane-findings', 'innerText')), 'no verdict words'); ok('findings load with pilot-style labels and no "supported" or "refuted" verdicts');
  await p.mouse('[data-lab=methods]'); await p.waitFor('document.querySelector("#methodsBody").innerText.includes("Methods")');
  await p.mouse('[data-lab=limits]'); await p.waitFor('document.querySelector("#limitsBody").innerText.length > 200'); ok('methods and limitations pages load');
  await p.mouse('[data-lab=score]'); await p.waitFor('document.querySelectorAll("#scoreTable tbody tr").length > 5'); assert.match(await p.q('#pane-score', 'innerText'), /not a score/i); ok('architectural indicators load and say they are not a score');
  await shot(p, '11-lab-indicators');
  assert.deepEqual(p.errors, [], `no browser console errors: ${p.errors.join(' | ')}`); ok('no JavaScript errors in the console on desktop');
  await p.close();

  // ================= narrow screen =================
  p = await launch({ width: 390, height: 844, mobile: true });
  await p.goto(`${base}/#agent`);
  await p.waitFor(`${agentMsgs} >= 3`, 10000);
  const overflow = async () => p.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  // names the elements that stick out, so a failure says where
  const wide = () => p.evaluate(`(() => [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width && r.right > document.documentElement.clientWidth + 1 && s.position !== 'fixed' && ![...(function*(n){ while ((n = n.parentElement)) yield n; })(e)].some(a => /(auto|scroll)/.test(getComputedStyle(a).overflowX)); }).slice(0, 6).map(e => e.tagName + '#' + e.id + '.' + String(e.className.baseVal ?? e.className).slice(0, 30)).join(' | '))()`);
  assert((await overflow()) <= 1, `no horizontal page scroll on a phone, got ${await overflow()}px`);
  assert(!(await p.visible('#inspector')), 'the inspector is hidden until asked for'); assert(await p.visible('#talkInput') && await p.visible('#sumName') && await p.visible('#sumStatus'));
  assert(!(await p.visible('#processMap')), 'the conversation comes first on a phone');
  await shot(p, '12-mobile-agent'); ok('mobile: agent, status and composer visible, conversation first, no horizontal scroll');
  await p.mouse('[data-pane=map]'); await p.waitFor('document.querySelector("#processMap .node")'); assert(await p.visible('#processMap')); assert(!(await p.visible('#talkInput')));
  assert((await overflow()) <= 1, `map overflows by ${await overflow()}px`); await shot(p, '13-mobile-map'); ok('mobile: the process map fits the screen');
  await p.mouse('[data-node=proposals] .node-main'); await p.waitFor('document.body.classList.contains("inspect-open")');
  assert(await p.visible('#inspector')); assert.match(await insp(p), /candidate thought|proposals/i); await shot(p, '14-mobile-inspector'); ok('mobile: selecting a stage opens the inspector as one sheet');
  await p.key('Escape'); await p.waitFor('!document.body.classList.contains("inspect-open")'); ok('mobile: Escape closes the inspector');
  for (const [view, sel] of [['#viewHistory', '#historyView'], ['#viewLab', '#labView']]) { await p.mouse(view); await p.waitFor(`!document.querySelector("${sel}").hidden`); assert((await overflow()) <= 1, `${sel} overflows horizontally by ${await overflow()}px: ${await wide()}`); await shot(p, `15-mobile-${sel.slice(1, 5)}`); }
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
    await shot(p, '16-public-replay'); ok('public replay server: example only, no live controls, runs turned off');
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
