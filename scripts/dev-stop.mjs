import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();

function escapeForPowerShell(value) {
  return value.replace(/'/g, "''");
}

async function stopWindowsProjectProcesses() {
  const escapedRoot = escapeForPowerShell(projectRoot);
  const escapedPid = String(process.pid);
  const command = [
    `$root = '${escapedRoot}'`,
    `$selfPid = ${escapedPid}`,
    `function Test-ProjectProcess([string] $commandLine) {`,
    `  if (-not $commandLine) { return $false }`,
    `  if ($commandLine -like "*$root*") { return $true }`,
    `  if ($commandLine -match 'scripts[\\\\/]dev-all\\.mjs') { return $true }`,
    `  if ($commandLine -match '--import\\s+tsx/esm\\s+server/index\\.ts') { return $true }`,
    `  if ($commandLine -match '--watch-path=server\\s+--watch-path=shared\\s+--import\\s+tsx/esm\\s+server/index\\.ts') { return $true }`,
    `  if ($commandLine -match 'tsx(?:\\.cmd)?\"?\\s+watch.*server/index\\.ts') { return $true }`,
    `  if ($commandLine -match 'services[\\\\/]lobster-executor[\\\\/]src[\\\\/]index\\.ts') { return $true }`,
    `  if ($commandLine -match 'vite(?:\\.cmd)?\"?\\s+--host') { return $true }`,
    `  if ($commandLine -match 'npm(?:\\.cmd)?\"?\\s+run\\s+dev(?::server|:all|:frontend|:advanced)?') { return $true }`,
    `  return $false`,
    `}`,
    `$all = Get-CimInstance Win32_Process | Where-Object {`,
    `  $_.ProcessId -ne $selfPid -and`,
    `  @('node.exe', 'npm.exe', 'cmd.exe') -contains $_.Name`,
    `}`,
    `$matched = $all | Where-Object { Test-ProjectProcess $_.CommandLine }`,
    `$processes = @($matched)`,
    `if (-not $processes) {`,
    `  Write-Output 'No project dev processes found.'`,
    `  exit 0`,
    `}`,
    `$processes | Sort-Object ProcessId -Unique | Sort-Object ProcessId -Descending | ForEach-Object {`,
    `  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue`,
    `  Write-Output ("Stopped PID {0}" -f $_.ProcessId)`,
    `}`,
  ].join("\n");

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Command", command],
    {
      cwd: projectRoot,
    }
  );

  process.stdout.write(stdout);
}

async function stopUnixProjectProcesses() {
  const { stdout } = await execFileAsync("ps", ["-ax", "-o", "pid=,command="], {
    cwd: projectRoot,
  });

  const targets = stdout
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) return null;
      return { pid: Number(match[1]), command: match[2] };
    })
    .filter(
      entry =>
        entry &&
        entry.pid !== process.pid &&
        entry.command.includes(projectRoot) &&
        entry.command.includes("node")
    );

  if (!targets.length) {
    console.log("No project dev processes found.");
    return;
  }

  for (const target of targets) {
    process.kill(target.pid, "SIGTERM");
    console.log(`Stopped PID ${target.pid}`);
  }
}

if (process.platform === "win32") {
  await stopWindowsProjectProcesses();
} else {
  await stopUnixProjectProcesses();
}
