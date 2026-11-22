import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';

const profile = process.argv[2];
if (!['load', 'stress', 'browser'].includes(profile)) throw Error('Invalid test profile');
const quick = process.env.QUICK_CHECK === 'true';
const base = new URL(process.env.LAB_BASE_URL || 'http://20.212.106.179:8080');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
    base.pathname !== '/' || base.search || base.hash) throw Error('Use the application origin as LAB_BASE_URL');
const output = resolve('results');
await mkdir(output, { recursive: true });
const outcome = {
  profile, quick, target: base.origin, started: new Date().toISOString(),
  testCommit: process.env.GITHUB_SHA || 'local', deployedAppCommit: 'not detected',
  generator: { location: 'GitHub-hosted runner', cpus: cpus().length, memoryBytes: totalmem() },
  stages: [], samples: 0, result: 'failed',
};
const header = 'timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success,failureMessage,bytes,sentBytes,grpThreads,allThreads,URL,Latency,IdleTime,Connect';
const csv = [header];
let activeContainer;
let account;

async function request(path, body) {
  const response = await fetch(base.origin + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(12000),
  });
  if (response.status !== 200) throw Error(`HTTP ${response.status} at ${path}`);
  return response;
}

async function health() {
  await request('/');
  const products = await (await request('/api/products')).json();
  if (!Array.isArray(products) || !products.length) throw Error('Catalog unavailable');
}

async function scriptForTest() {
  const manifest = JSON.parse(await readFile(`tests/${profile === 'browser' ? 'browser' : profile}-test.json`, 'utf8'));
  const wrapper = manifest.spec.template.spec.containers[0].args.join('\n');
  const match = wrapper.match(/<<'K6_SCRIPT'\n([\s\S]*?)\nK6_SCRIPT/);
  if (!match) throw Error('Cannot locate K6_SCRIPT');
  let script = match[1];
  const replace = (before, after) => {
    if (!script.includes(before)) throw Error('Test script changed: cannot instrument it');
    script = script.replace(before, after);
  };
  if (profile === 'browser') {
    replace("const origin = 'http://ecommerce-frontend';", 'const origin = __ENV.LAB_BASE_URL;');
    replace('const iterations = vus === 1 ? 1 : 3;', 'const iterations = 3;');
    replace('  let page;\n', '  const journeyStart = Date.now();\n  let page;\n');
    replace('    passed.add(ok);', `    passed.add(ok);
    console.log('PERF_SAMPLE ' + JSON.stringify({timestamp: journeyStart,
      elapsed: Date.now() - journeyStart, label: String(vus).padStart(2, '0') + ' VU',
      success: ok, code: ok ? 'OK' : 'FAILED', vu: __VU}));`);
  } else {
    replace("const base = 'http://ecommerce-frontend';", 'const base = __ENV.LAB_BASE_URL;');
    if (quick) script = script.replace(/const SCENARIO = [\s\S]*?;\n\nimport http/, 'const SCENARIO = {executor: "per-vu-iterations", vus: 1, iterations: 8, maxDuration: "45s", gracefulStop: "5s"};\n\nimport http');
    replace('  return check(response, {', '  const validResponse = check(response, {');
    replace('  }, { name });\n}', `  }, { name });
  console.log('PERF_SAMPLE ' + JSON.stringify({timestamp: Date.now() - Math.ceil(response.timings.duration),
    elapsed: response.timings.duration, label: name, success: validResponse, code: response.status, vu: __VU}));
  return validResponse;
}`);
    script = script.replace("['/results/' + testid + '-summary.json']", "['/results/k6-summary.json']");
  }
  await writeFile(resolve(output, 'test.js'), script);
}

function record(line, stage) {
  const marker = line.indexOf('PERF_SAMPLE ');
  if (marker === -1) return;
  const start = line.indexOf('{', marker);
  const end = line.lastIndexOf('}');
  // k6 console messages may quote the JSON string and escape its quotation marks.
  let text = line.slice(start, end + 1);
  if (text.includes('\\"')) text = JSON.parse('"' + text + '"');
  const sample = JSON.parse(text);
  if (!Number.isFinite(sample.timestamp) || !Number.isFinite(sample.elapsed) || sample.elapsed < 0 ||
      typeof sample.success !== 'boolean' || !/^[\w -]+$/.test(sample.label)) throw Error('Invalid sample');
  const label = stage.preflight ? `Preflight ${sample.label}` : sample.label;
  csv.push([Math.round(sample.timestamp), Math.round(sample.elapsed), label, sample.code,
    sample.success ? 'Passed' : 'Check failed', `VU-${sample.vu}`, 'text', sample.success,
    sample.success ? '' : 'Scenario validation failed', 0, 0, 0, 0, '', 0, 0, 0].join(','));
  stage.samples++;
  if (!sample.success) stage.failedSamples++;
}

async function runStage(vus, preflight = false) {
  const stage = { vus, preflight, samples: 0, failedSamples: 0, started: new Date().toISOString() };
  outcome.stages.push(stage);
  activeContainer = `coquette-perf-${profile}-${randomBytes(5).toString('hex')}`;
  const args = ['run', '--name', activeContainer, '--cpus=3', '--memory=2g', '--memory-swap=2g', '--shm-size=256m',
    '--user', `${process.getuid()}:${process.getgid()}`, '-v', `${output}:/results`,
    '-e', 'K6_TEST_EMAIL', '-e', 'K6_TEST_PASSWORD', '-e', 'LAB_BASE_URL', '-e', 'POD_NAME',
    '-e', 'K6_NO_USAGE_REPORT=true', '-e', `K6_MODE=${preflight ? 'preflight' : 'main'}`,
    '-e', `K6_BROWSER_VUS=${vus}`, profile === 'browser' ? 'grafana/k6:2.3.0-with-browser' : 'grafana/k6:2.3.0',
    'run', '--quiet', '/results/test.js'];
  console.log(`Starting ${preflight ? 'preflight' : profile} ${vus ? vus + ' VU' : ''}`);
  const child = spawn('docker', args, {
    env: { ...process.env, K6_TEST_EMAIL: account.email, K6_TEST_PASSWORD: account.password,
      LAB_BASE_URL: base.origin, POD_NAME: `actions-${process.env.GITHUB_RUN_ID || 'local'}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  let parseError;
  const consume = stream => {
    const reader = createInterface({ input: stream });
    reader.on('line', line => {
      if (!line.includes('PERF_SAMPLE ')) { lines.push(line); return; }
      try { record(line, stage); } catch (error) { parseError = error; }
    });
  };
  consume(child.stdout);
  consume(child.stderr);
  const timer = setTimeout(() => spawnSync('docker', ['kill', activeContainer]),
    profile === 'load' && !quick && !preflight ? 1950000 : profile === 'stress' && !quick && !preflight ? 960000 : 150000);
  try {
    stage.exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    const inspected = spawnSync('docker', ['inspect', activeContainer, '--format', '{{json .State}}'], { encoding: 'utf8' });
    if (inspected.status !== 0) throw Error('Cannot inspect test container');
    const state = JSON.parse(inspected.stdout);
    stage.oomKilled = state.OOMKilled;
    stage.finished = state.FinishedAt;
    stage.passed = stage.exitCode === 0 && stage.samples > 0 && stage.failedSamples === 0 &&
      (profile !== 'browser' || stage.samples === vus * 3);
    await writeFile(resolve(output, `stage-${preflight ? 'preflight' : vus || profile}.log`), lines.join('\n'));
    if (parseError) throw parseError;
    console.log(`Stage finished: ${stage.samples} samples, exit ${stage.exitCode}, OOM ${stage.oomKilled}`);
    return stage.passed;
  } finally {
    clearTimeout(timer);
    spawnSync('docker', ['rm', '-f', activeContainer], { stdio: 'ignore' });
    activeContainer = undefined;
  }
}

let failed = false;
try {
  await health();
  account = { email: `k6-actions-${randomBytes(10).toString('hex')}@example.test`, password: randomBytes(24).toString('hex') };
  console.log(`::add-mask::${account.password}`);
  const registered = await fetch(base.origin + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...account, name: 'GitHub k6 Tester', phone: '000000', address: 'Performance lab' }),
    signal: AbortSignal.timeout(12000),
  });
  if (![200, 201].includes(registered.status)) throw Error(`Test account registration failed (${registered.status})`);
  const login = await (await request('/api/auth/login', account)).json();
  if (!login.token) throw Error('Test account login failed');
  await scriptForTest();
  if (profile !== 'browser' && !await runStage(0, true)) throw Error('Preflight failed');
  const stages = profile === 'browser' ? Array.from({ length: quick ? 1 : 10 }, (_, i) => i + 1) : [0];
  for (const vus of stages) {
    if (!await runStage(vus)) { failed = true; break; }
  }
  outcome.result = failed ? 'failed' : 'passed';
} catch (error) {
  failed = true;
  outcome.error = error.message;
  console.error(error.message);
} finally {
  if (activeContainer) spawnSync('docker', ['rm', '-f', activeContainer], { stdio: 'ignore' });
  try { await health(); outcome.applicationAfter = 'HTTP 200'; }
  catch { outcome.applicationAfter = 'Health check failed'; failed = true; outcome.result = 'failed'; }
  outcome.finished = new Date().toISOString();
  // Preflight is diagnostic and excluded from the measured workload CSV.
  const measured = csv.filter((row, i) => i === 0 || !row.includes(',Preflight '));
  outcome.samples = measured.length - 1;
  await writeFile(resolve(output, 'samples.csv'), measured.join('\n') + '\n');
  await writeFile(resolve(output, 'run.json'), JSON.stringify(outcome, null, 2));
}
process.exitCode = failed ? 1 : 0;
