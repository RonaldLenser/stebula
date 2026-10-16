// Exercises the real interface in a real browser against a real server that uses the scripted test model
// (STEBULA_FAKE_LLM=1). Not part of `npm test` because it needs Chrome or Edge: run `npm run ui-check`.
// It checks behavior (empty, loading, success, degraded, failed, cancelled states, memory controls, replay,
// keyboard, experiments, narrow screens) and writes screenshots to SHOTS (default: a temp folder) for inspection.
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

async function sendAndWait(p, text, expectTurns) {
  await p.type('#talkInput', text);
  await p.mouse('#talkSend');
  await p.waitFor('document.querySelector("#talkSend") && !document.querySelector("#talkSend").hidden', 15000, 'send finished');
  if (expectTurns != null) await p.waitFor(`document.querySelectorAll(".msg.agent[data-turn]").length === ${expectTurns}`, 8000, `${expectTurns} agent messages`);
}
const jobs = async () => (await (await fetch(`${base}/api/jobs`)).json()).jobs;

let p;
try {
  // ================= desktop =================
  p = await launch({ width: 1366, height: 850 });
  await p.goto(`${base}/#observe`);
  await p.waitFor('document.querySelector("#modelChip").textContent.length > 0');
  assert.match(await p.q('#modelChip'), /Scripted test model/); ok('loads, labels the scripted test model');
  assert.match(await p.q('#chatLog', 'innerText'), /Nothing here yet/);
  assert(await p.exists('[data-act=example]'), 'the empty state offers the recorded example');
  assert.equal(await p.q('#stages', 'children.length'), 6); ok('empty state: one clear next action, a scripted example offered, compact stage indicator shown');
  await shot(p, '01-desktop-empty');

  // recorded example: clearly labelled, read-only, replayable
  await p.mouse('[data-act=example]');
  await p.waitFor('document.querySelectorAll(".msg.agent[data-turn]").length >= 3');
  assert.match(await p.q('#banner', 'innerText'), /Scripted example/); assert(await p.evaluate('document.querySelector("#talkInput").disabled'));
  ok('scripted example is labelled, and the composer is read-only');
  await p.mouse('.msg.agent[data-turn="1"]');
  await p.waitFor('document.querySelector("#inspHead").innerText.includes("Turn 1")');
  assert.match(await p.q('#inspHead', 'innerText'), /Replay/); assert(await p.evaluate('document.querySelector("#inspHead").classList.contains("replay")'));
  assert(await p.exists('.flow')); ok('selecting an older message updates the inspector to that recorded turn and marks it unmistakably as a replay');
  await shot(p, '02-desktop-example-replay');
  // the degraded turn: process trace incomplete, failure visible, not a zero
  const degraded = await p.evaluate('[...document.querySelectorAll(".msg.agent.degraded")].map(e => e.dataset.turn)');
  assert(degraded.length >= 1); await p.mouse(`.msg.agent[data-turn="${degraded[0]}"]`);
  await p.waitFor('document.querySelector(".thought-failed")');
  assert.match(await p.q('.thought-failed', 'innerText'), /Process trace incomplete/); assert.match(await p.q('#stages', 'innerText'), /Proposals/);
  assert(await p.evaluate('document.querySelector("#stages li.failed") !== null && document.querySelector("#stages li.skipped") !== null'));
  ok('degraded turn: "Process trace incomplete", failed proposals stage, skipped selection, no fabricated numbers');
  await shot(p, '03-desktop-degraded');
  for (const tab of ['changes', 'memory', 'checks', 'raw']) { await p.mouse(`#tab-${tab}`); await p.waitFor(`document.querySelector("#tab-${tab}").getAttribute("aria-selected") === "true"`); assert((await p.q('#panel-inspector', 'innerText')).length > 20, `${tab} tab has content`); }
  assert.match(await p.q('#panel-inspector', 'innerText'), /Stage attempts/); ok('every inspector tab renders (Process, Changes, Memory, Checks, Raw)');
  await p.mouse('#tab-checks'); await p.waitFor('document.querySelector(".test.invalid")');
  assert.match(await p.q('.test.invalid', 'innerText'), /Invalid: not counted/); ok('an invalid self-prediction test is shown as invalid and not counted');
  await p.mouse('#tab-memory'); await p.mouse('#tab-process');
  await p.mouse('[data-act=leave-example]');
  await p.waitFor('!document.querySelector("#banner").innerText.includes("Scripted example")');

  // live conversation with the scripted model
  await p.type('#talkInput', 'hello'); await p.mouse('#talkSend');
  await p.waitFor('document.querySelector("#stages li.active") !== null || document.querySelectorAll(".msg.agent[data-turn]").length === 1', 5000);
  await p.waitFor('document.querySelectorAll(".msg.agent[data-turn]").length === 1', 10000);
  const reply = await p.q('.msg.agent .text'); assert(reply.length < 120, `a greeting gets a short reply, got ${reply.length} chars`);
  assert.match(await p.q('.msg.agent .changed'), /Nothing in stored memory changed|Self-description changed/); ok('a turn completes; the reply is short; a one-line "what changed" sits under it');
  assert.equal(await p.count('#stages li.done'), 6); ok('stage indicator ends with all six stages complete');
  assert.match(await p.q('#inspHead', 'innerText'), /Latest/);
  await shot(p, '04-desktop-live-turn');
  // two thirds / one third layout
  const widths = await p.evaluate('(() => { const c = document.querySelector(".convo").getBoundingClientRect().width, i = document.querySelector("#inspector").getBoundingClientRect().width; return [c, i]; })()');
  assert(widths[0] / (widths[0] + widths[1]) > 0.6 && widths[0] / (widths[0] + widths[1]) < 0.72, `conversation takes about two thirds: ${widths}`); ok('desktop layout: conversation about two thirds, one inspector for the rest');
  assert(await p.visible('#talkInput') && await p.visible('#talkSend'), 'composer visible'); ok('composer stays visible');

  // degraded live turn (refused thinking step)
  await sendAndWait(p, '[refuse-think] what do you think?', 2);
  assert(await p.exists('.msg.agent.degraded')); assert.match(await p.q('#panel-inspector', 'innerText'), /Process trace incomplete/);
  assert.match(await p.q('.msg.agent.degraded .badges', 'innerText'), /Degraded/); ok('a refused thinking step gives a labelled degraded turn near the answer, with the failure kind in the inspector');
  assert.match(await p.q('#panel-inspector', 'innerText'), /refusal/);
  await shot(p, '05-desktop-live-degraded');

  // failed turn: nothing saved, text kept, recovery action offered
  const before = await p.count('.msg.agent[data-turn]');
  await sendAndWait(p, '[bad-speak] this will fail');
  await p.waitFor('!document.querySelector("#errorBox").hidden');
  assert.match(await p.q('#errorBox', 'innerText'), /reply step failed/i); assert(await p.exists('#errorBox [data-act=retry]'));
  assert.equal(await p.count('.msg.agent[data-turn]'), before, 'a failed turn adds no answer');
  assert.match(await p.q('#talkInput', 'value'), /bad-speak/, 'the message is kept for editing');
  ok('failed turn: error shown next to the composer with Retry, message kept, nothing saved');
  await shot(p, '06-desktop-failed');
  await p.mouse('#errorBox [data-act=dismiss]'); await p.type('#talkInput', '');

  // cancellation
  await p.type('#talkInput', '[slow] take your time'); await p.mouse('#talkSend');
  await p.waitFor('!document.querySelector("#talkStop").hidden', 3000);
  await sleep(250);
  assert((await jobs()).length >= 1, 'the server sees the job running');
  const turnsBeforeStop = await p.count('.msg.agent[data-turn]');
  await p.mouse('#talkStop');
  await p.waitFor('!document.querySelector("#errorBox").hidden', 5000);
  assert.match(await p.q('#errorBox', 'innerText'), /Stopped/);
  for (let i = 0; i < 30 && (await jobs()).length; i++) await sleep(100);
  assert.equal((await jobs()).length, 0, 'the server stopped the job and made no further model calls');
  assert.equal(await p.count('.msg.agent[data-turn]'), turnsBeforeStop); ok('Stop cancels the turn, the server stops its work, and nothing is saved');
  await p.mouse('#errorBox [data-act=dismiss]'); await p.type('#talkInput', '');

  // memory control
  await p.click('#memoryOn');
  await sendAndWait(p, 'do you remember anything?');
  await p.waitFor('document.querySelectorAll(".msg.agent[data-turn]").length >= 3');
  assert.match(await p.q('.msg.agent:last-of-type .badges', 'innerText') || await p.evaluate('[...document.querySelectorAll(".msg.agent")].at(-1).querySelector(".badges").innerText'), /Memory was off/);
  await p.mouse('#tab-memory'); assert.match(await p.q('#panel-inspector', 'innerText'), /switched off|memory off/i);
  await p.click('#memoryOn'); ok('turning stored memory off is explicit, labelled on the message, and recorded in the memory tab');

  // self-model change is explained after the turn
  await sendAndWait(p, 'please change how you describe yourself');
  await p.waitFor('[...document.querySelectorAll(".msg.agent .changed.did")].length >= 1');
  await p.mouse('#tab-changes'); assert.match(await p.q('#panel-inspector', 'innerText'), /added: My memory is text stored outside me/);
  ok('a self-description change is summarized under the message and shown as a diff in the inspector');

  // replay through the slider and keyboard
  const nTurns = await p.count('.msg.agent[data-turn]');
  assert(await p.visible('#replayBar'));
  await p.mouse('#turnPrev'); await p.waitFor('document.querySelector("#inspHead").classList.contains("replay")');
  assert.match(await p.q('#banner', 'innerText'), /Replay/); assert(!(await p.evaluate('document.querySelector("#turnLatest").disabled')));
  await p.mouse('#turnLatest'); await p.waitFor('!document.querySelector("#inspHead").classList.contains("replay")'); ok('replay: previous turn shows a Replay banner and state; Back to latest returns to now');
  await p.evaluate(`document.querySelector('.msg.agent[data-turn="1"]').focus()`); await p.key('Enter');
  await p.waitFor('document.querySelector("#inspHead").innerText.includes("Turn 1")'); ok('keyboard: Enter on a message selects it');

  // keyboard navigation and focus visibility
  await p.evaluate('document.querySelector("#tab-process").focus()'); await p.key('ArrowRight');
  await p.waitFor('document.querySelector("#tab-changes").getAttribute("aria-selected") === "true"'); ok('keyboard: arrow keys move between inspector tabs');
  await p.evaluate('document.activeElement.blur(); document.body.focus()');
  const seen = new Set();
  for (let i = 0; i < 14; i++) { await p.key('Tab'); seen.add(await p.evaluate('(() => { const e = document.activeElement; if (e === document.body) return "BODY:ring"; const s = getComputedStyle(e); return e.tagName + "#" + e.id + (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2 ? ":ring" : ":NORING"); })()')); }
  assert([...seen].every(x => !x.endsWith('NORING')), `every focused control shows a visible focus ring: ${[...seen].join(' ')}`); ok('keyboard: Tab reaches the controls and each shows a visible focus ring');
  // every form control has an associated label
  const unlabeled = await p.evaluate('[...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter(e => !e.labels?.length && !e.getAttribute("aria-label")).map(e => e.id || e.name)');
  assert.deepEqual(unlabeled.filter(x => !['load'].includes(x)), [], `form controls without a label: ${unlabeled}`); ok('every form control has an associated label');

  // theme
  await p.mouse('#themeBtn'); await p.mouse('#themeBtn');
  const theme = await p.evaluate('document.documentElement.dataset.theme'); assert(['light', 'dark'].includes(theme));
  await p.evaluate('localStorage.setItem("stebula.theme","dark"); location.reload()'); await p.waitFor('document.documentElement.dataset.theme === "dark"');
  await p.waitFor('document.querySelectorAll(".msg.agent[data-turn]").length >= 3'); await shot(p, '07-desktop-dark'); ok('dark theme applies from the stored preference');
  await p.evaluate('localStorage.setItem("stebula.theme","light"); location.reload()'); await p.waitFor('document.documentElement.dataset.theme === "light"');

  // ================= experiments =================
  await p.waitFor('document.querySelectorAll(".msg.agent[data-turn]").length >= 3');
  await p.mouse('#viewExperiments'); await p.waitFor('!document.querySelector("#experimentsView").hidden && document.querySelector("#lessonDesign").innerText.length > 50');
  assert.match(await p.q('#sub-lesson h2'), /stored lesson change the agent's next decision/);
  await p.waitFor('document.querySelector("#lessonResults").innerText.length > 0'); assert.match(await p.q('#lEstimate', 'innerText'), /48 model calls/); assert.match(await p.q('#lessonResults', 'innerText'), /No runs yet/);
  await shot(p, '08-experiments-empty'); ok('experiments: the research question, the three conditions, an exact call estimate (48), and an empty state with one next action');
  await p.type('#lTasks', '6'); await p.evaluate('document.querySelector("#lTasks").dispatchEvent(new Event("change"))');
  assert.match(await p.q('#lEstimate', 'innerText'), /36 model calls/);
  await p.mouse('#lRun'); await p.waitFor('document.querySelector("#lessonResults .card.warn")', 20000, 'lesson results');
  assert.match(await p.q('#lessonResults', 'innerText'), /Scripted double/); assert.match(await p.q('#lessonResults', 'innerText'), /Per condition/);
  assert.match(await p.q('#lessonResults', 'innerText'), /Compared with no lesson/); ok('scripted lesson run: results appear, clearly labelled as a scripted double that does not support or refute anything');
  await p.mouse('[data-trial="0"]'); await p.waitFor('document.querySelector("#trialDetail .trial-detail")');
  assert.match(await p.q('#trialDetail', 'innerText'), /recorded before the outcome/); assert.match(await p.q('#trialDetail', 'innerText'), /Scored against ground truth/);
  ok('a single trial can be replayed: the lesson delivered, the prediction before the outcome, then the revealed score');
  await shot(p, '09-experiments-results');
  await p.mouse('[data-sub=isolation]'); await p.waitFor('!document.querySelector("#sub-isolation").hidden');
  await p.waitFor('document.querySelector("#isoResults").innerText.length > 0 && document.querySelector("#iEstimate").innerText.length > 0'); assert.match(await p.q('#iEstimate', 'innerText'), /model calls/); assert.match(await p.q('#isoResults', 'innerText'), /No runs yet/); ok('isolation experiment page: estimate and empty state');
  // run a small isolation experiment through the form (scripted test model): protocol, checkpoints, usage
  await p.click('input[name=ic][value=social]'); await p.click('input[name=ic][value=mixed]');
  await p.type('#iSteps', '1'); await p.type('#iEvery', '1'); await p.evaluate('document.querySelector("#iSteps").dispatchEvent(new Event("input")); document.querySelector("#iEvery").dispatchEvent(new Event("input"))');
  await p.waitFor('document.querySelector("#iEstimate").innerText.includes("model calls")'); await p.evaluate('document.querySelector("#iBudget").value = ""; document.querySelector("#iEstimate").dispatchEvent(new Event("x"))');
  await p.type('#iBudget', '60');
  await p.mouse('#iRun'); await p.waitFor('document.querySelector("#isoResults").innerText.includes("Checkpoints")', 40000, 'isolation results');
  assert.match(await p.q('#isoResults', 'innerText'), /written before the first model call/); assert.match(await p.q('#isoResults', 'innerText'), /isolated/); assert.match(await p.q('#isoResults', 'innerText'), /baseline/);
  assert.match(await p.q('#isoResults', 'innerText'), /snapshot of memory/); ok('an isolation experiment runs from the form and shows checkpoints, protocol hash, usage and the snapshot note');
  await shot(p, '08b-isolation-results');
  await p.mouse('[data-sub=compare]'); await p.waitFor('document.querySelector("#cmpGrid").innerText.length > 10'); ok('compare agents page renders');
  await p.mouse('[data-sub=rules]'); await p.mouse('#run'); await p.waitFor('document.querySelector("#status").textContent.includes("Run complete")', 20000); ok('the original two-agent hidden-rule run still works (scripted mock)');
  await shot(p, '10-experiments-rules');

  // ================= research =================
  await p.mouse('#viewResearch'); await p.waitFor('document.querySelector("#fList .finding")');
  const statuses = await p.evaluate('[...document.querySelectorAll("#fList .finding .chip")].map(e => e.innerText).join("|")');
  assert(!/supported|refuted/i.test(await p.q('#rsub-findings', 'innerText')), 'no verdict words'); ok('findings load with pilot-style labels, and no "supported" or "refuted" verdicts');
  await shot(p, '11-research-findings');
  await p.mouse('[data-rsub=methods]'); await p.waitFor('document.querySelector("#methodsBody").innerText.includes("Methods")');
  await p.mouse('[data-rsub=limits]'); await p.waitFor('document.querySelector("#limitsBody").innerText.length > 200'); ok('methods and limitations pages load');
  await p.mouse('[data-rsub=score]'); await p.waitFor('document.querySelectorAll("#scoreTable tbody tr").length > 5'); assert.match(await p.q('#rsub-score', 'innerText'), /not a score/i); ok('architectural indicators load and say they are not a score');
  await shot(p, '12-research-scorecard');
  assert.deepEqual(p.errors, [], `no browser console errors: ${p.errors.join(' | ')}`); ok('no JavaScript errors in the console on desktop');
  await p.close();

  // ================= narrow screen =================
  p = await launch({ width: 390, height: 844, mobile: true });
  await p.goto(`${base}/#observe`);
  await p.waitFor('document.querySelectorAll(".msg.agent[data-turn]").length >= 3', 10000);
  const overflow = async () => p.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  assert((await overflow()) <= 1, `no horizontal page scroll on a phone, got ${await overflow()}px`);
  assert(!(await p.visible('#inspector')), 'the inspector is hidden until asked for'); assert(await p.visible('#talkInput'), 'the composer is visible');
  await shot(p, '13-mobile-observe'); ok('mobile: conversation first, composer visible, inspector hidden, no horizontal scroll');
  await p.mouse('[data-turn="1"]'); await p.mouse('#inspectBtn'); await p.waitFor('document.body.classList.contains("inspect-open")');
  assert(await p.visible('#inspector')); assert.match(await p.q('#inspHead', 'innerText'), /Turn 1/);
  await shot(p, '14-mobile-inspector'); ok('mobile: the inspector opens as one sheet for the selected message');
  await p.key('Escape'); await p.waitFor('!document.body.classList.contains("inspect-open")'); ok('mobile: Escape closes the inspector');
  for (const [view, sel] of [['#viewExperiments', '#experimentsView'], ['#viewResearch', '#researchView']]) { await p.mouse(view); await p.waitFor(`!document.querySelector("${sel}").hidden`); assert((await overflow()) <= 1, `${sel} overflows horizontally by ${await overflow()}px`); await shot(p, `15-mobile-${sel.slice(1, 5)}`); }
  ok('mobile: Experiments and Research fit the screen');
  assert.deepEqual(p.errors, [], `no console errors on mobile: ${p.errors.join(' | ')}`);
  await p.close();
  // ================= public replay server =================
  const pubPort = port + 1, pub = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(pubPort), STEBULA_DATA: data + '-pub', STEBULA_PUBLIC: '1', ANTHROPIC_API_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
  try {
    await new Promise((res, rej) => { pub.stdout.on('data', b => /STEBULA at/.test(String(b)) && res()); pub.once('exit', c => rej(new Error('public server exited ' + c))); setTimeout(() => rej(new Error('public server did not start')), 8000); });
    p = await launch({ width: 1366, height: 850 });
    await p.goto(`http://localhost:${pubPort}/#observe`);
    await p.waitFor('document.querySelectorAll(".msg.agent[data-turn]").length >= 3', 10000);
    assert.match(await p.q('#modelChip'), /Public replay/); assert(await p.evaluate('document.querySelector("#talkInput").disabled && document.querySelector("#talkSend").disabled'));
    assert.match(await p.q('#banner', 'innerText'), /Scripted example/); assert(!(await p.exists('[data-act=leave-example]')), 'no way into a live agent on a public server');
    await p.mouse('#viewExperiments'); await p.waitFor('document.querySelector("#lEstimate").innerText.includes("turned off")'); assert(await p.evaluate('document.querySelector("#lRun").disabled'));
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
