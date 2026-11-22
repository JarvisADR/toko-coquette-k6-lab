#!/usr/bin/env bash
set -euo pipefail
node -e 'const r=require("./results/run.json"); if (!r.samples) throw Error("No workload samples to report");'
archive="$RUNNER_TEMP/apache-jmeter-5.6.3.tgz"
source=https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-5.6.3.tgz
curl --fail --location --retry 3 --max-time 180 "$source" --output "$archive"
digest=$(curl --fail --location --retry 3 --max-time 30 "$source.sha512" | grep -Eo '[a-fA-F0-9]{128}' | head -1)
[[ ${#digest} == 128 ]]
printf '%s  %s\n' "$digest" "$archive" | sha512sum --check --status
tar -xzf "$archive" -C "$RUNNER_TEMP"
title=$(node -e 'const r=require("./results/run.json"); console.log(`${r.profile} | FULL TEST | ${r.result} | GitHub runner to Azure VM`);')
"$RUNNER_TEMP/apache-jmeter-5.6.3/bin/jmeter" -g results/samples.csv -o results/jmeter \
  -j "$RUNNER_TEMP/jmeter-report.log" \
  "-Jjmeter.reportgenerator.report_title=$title" \
  '-Jjmeter.reportgenerator.statistic_window=1000000'
node --input-type=module -e '
import fs from "node:fs";
const r=JSON.parse(fs.readFileSync("results/run.json"));
const stats=JSON.parse(fs.readFileSync("results/jmeter/statistics.json"));
if (stats.Total.sampleCount !== r.samples) throw Error("JMeter sample count mismatch");
const file="results/jmeter/index.html";
const note=`<p style="margin:20px">Source: k6 ${r.profile === "browser" ? "browser journeys" : "HTTP requests"}. ${r.samples} samples. Test outcome: ${r.result}. Empty/aborted stages are recorded in run.json. Network byte counts, active thread counts, connection time and latency were not measured. See run.json for scope and generator details.</p>`;
fs.writeFileSync(file,fs.readFileSync(file,"utf8").replace("</body>",note+"</body>"));
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Test **${r.profile}** completed with outcome **${r.result}**. Download the artifact and open **jmeter/index.html**.\n`);
'
