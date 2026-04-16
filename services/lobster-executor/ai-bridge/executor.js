/**
 * AI Autonomous Executor — runs inside the Docker container.
 *
 * Flow:
 *   1. Read task from /workspace/task.json (injected by host)
 *   2. Call LLM to analyze the task and produce an execution plan
 *   3. Install any missing dependencies (pip, npm, apt)
 *   4. Execute the code
 *   5. Write results to /workspace/artifacts/
 *
 * Environment variables (injected by credential-injector):
 *   AI_API_KEY, AI_BASE_URL, AI_MODEL
 */

const { generate } = require("./index.js");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const TASK_FILE = "/workspace/task.json";
const ARTIFACTS_DIR = "/workspace/artifacts";
const RESULT_FILE = path.join(ARTIFACTS_DIR, "execution-result.json");
const LOG_FILE = path.join(ARTIFACTS_DIR, "execution.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function run(cmd, opts = {}) {
  log(`$ ${cmd}`);
  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: opts.timeout || 120_000,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: opts.cwd || "/workspace",
    });
    if (output.trim()) log(output.trim());
    return { ok: true, output: output.trim() };
  } catch (err) {
    const stderr = err.stderr?.toString().trim() || err.message;
    log(`[ERROR] ${stderr}`);
    return { ok: false, output: stderr };
  }
}

async function main() {
  log("AI Autonomous Executor starting...");

  // 1. Read task
  let task;
  try {
    task = JSON.parse(fs.readFileSync(TASK_FILE, "utf-8"));
  } catch {
    log("No task.json found, reading from TASK_CONTENT env var");
    const content = process.env.TASK_CONTENT;
    if (!content) {
      log("ERROR: No task provided (no task.json and no TASK_CONTENT env)");
      process.exit(1);
    }
    task = { content };
  }

  const taskContent = task.content || task.sourceText || JSON.stringify(task);
  log(`Task: ${taskContent.slice(0, 200)}...`);

  // 2. Ask AI to plan the execution
  log("Asking AI to analyze task and plan execution...");

  let plan;
  try {
    const planResponse = await generate(
      [
        {
          role: "system",
          content: `You are an autonomous code executor running inside a Docker container (Debian-based, with Node.js 20, Python 3, pip, git, curl, wget, jq, build-essential).

Your job: analyze the user's task, figure out what needs to be done, install any missing dependencies, write the code to a file, and execute it.

Respond with a JSON object (no markdown, no explanation):
{
  "setup_commands": ["pip install requests", "npm install axios"],
  "code_filename": "solution.py",
  "code_content": "print('hello')",
  "run_command": "python solution.py",
  "language": "python"
}

Rules:
- setup_commands: shell commands to install dependencies. Empty array if none needed.
- code_filename: the file to write the code to.
- code_content: the complete code to execute.
- run_command: the shell command to run the code.
- language: python, javascript, bash, etc.
- If the task already contains complete code, extract it directly.
- If the task is vague, write the simplest working solution.
- Always produce runnable code. Never output placeholder or pseudo-code.`,
        },
        {
          role: "user",
          content: taskContent,
        },
      ],
      { temperature: 0.1, maxTokens: 4096 }
    );

    plan = JSON.parse(planResponse.content);
    log(
      `AI plan: language=${plan.language}, file=${plan.code_filename}, setup=${plan.setup_commands?.length || 0} commands`
    );
  } catch (err) {
    log(`ERROR: AI planning failed: ${err.message}`);
    // Fallback: try to extract code directly from task
    plan = fallbackPlan(taskContent);
    if (!plan) {
      writeResult({
        success: false,
        error: "AI planning failed and no code could be extracted",
      });
      process.exit(1);
    }
    log(`Using fallback plan: ${plan.language} ${plan.code_filename}`);
  }

  // 3. Install dependencies
  if (plan.setup_commands && plan.setup_commands.length > 0) {
    log("Installing dependencies...");
    for (const cmd of plan.setup_commands) {
      const result = run(cmd, { timeout: 180_000 });
      if (!result.ok) {
        log(`WARNING: Setup command failed: ${cmd}`);
        // Continue anyway — some deps might be optional
      }
    }
  }

  // 4. Write code file
  const codeFile = path.join("/workspace", plan.code_filename);
  fs.writeFileSync(codeFile, plan.code_content, "utf-8");
  log(`Wrote ${plan.code_filename} (${plan.code_content.length} bytes)`);

  // 5. Execute
  log(`Executing: ${plan.run_command}`);
  const execResult = run(plan.run_command, { timeout: 300_000 });

  // 6. Write results
  writeResult({
    success: execResult.ok,
    language: plan.language,
    filename: plan.code_filename,
    command: plan.run_command,
    output: execResult.output,
    error: execResult.ok ? undefined : execResult.output,
  });

  if (execResult.ok) {
    log("Execution completed successfully.");
  } else {
    log(`Execution failed with output: ${execResult.output}`);
    process.exit(1);
  }
}

function fallbackPlan(content) {
  // Try to extract python code block
  const pyMatch = content.match(/```python\s*\n([\s\S]*?)```/i);
  if (pyMatch) {
    // Auto-detect imports and generate pip install commands
    const code = pyMatch[1].trim();
    const imports = [...code.matchAll(/^(?:import|from)\s+(\w+)/gm)].map(
      m => m[1]
    );
    const stdlibs = new Set([
      "os",
      "sys",
      "json",
      "re",
      "math",
      "datetime",
      "collections",
      "itertools",
      "functools",
      "pathlib",
      "typing",
      "io",
      "csv",
      "time",
      "random",
      "hashlib",
      "base64",
      "urllib",
      "http",
      "subprocess",
      "shutil",
      "glob",
      "string",
      "textwrap",
      "copy",
      "pprint",
    ]);
    const thirdParty = imports.filter(m => !stdlibs.has(m));
    const setup =
      thirdParty.length > 0 ? [`pip install ${thirdParty.join(" ")}`] : [];
    return {
      setup_commands: setup,
      code_filename: "solution.py",
      code_content: code,
      run_command: "python solution.py",
      language: "python",
    };
  }

  // Try to extract javascript code block
  const jsMatch = content.match(/```(?:javascript|js)\s*\n([\s\S]*?)```/i);
  if (jsMatch) {
    return {
      setup_commands: [],
      code_filename: "solution.js",
      code_content: jsMatch[1].trim(),
      run_command: "node solution.js",
      language: "javascript",
    };
  }

  // Try to extract bash code block
  const bashMatch = content.match(/```(?:bash|sh|shell)\s*\n([\s\S]*?)```/i);
  if (bashMatch) {
    return {
      setup_commands: [],
      code_filename: "solution.sh",
      code_content: bashMatch[1].trim(),
      run_command: "bash solution.sh",
      language: "bash",
    };
  }

  return null;
}

function writeResult(result) {
  try {
    if (!fs.existsSync(ARTIFACTS_DIR))
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    fs.writeFileSync(
      RESULT_FILE,
      JSON.stringify(result, null, 2) + "\n",
      "utf-8"
    );
  } catch (err) {
    log(`WARNING: Failed to write result: ${err.message}`);
  }
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  writeResult({ success: false, error: err.message });
  process.exit(1);
});
