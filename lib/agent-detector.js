const { exec } = require('child_process');
const { promisify } = require('util');
const which = require('which');
const execAsync = promisify(exec);

function detectAgent() {
  if (which.sync('codex', { nothrow: true })) return 'codex';
  if (which.sync('claude', { nothrow: true })) return 'claude';
  throw new Error('Neither Codex CLI nor Claude Code found. Please install one.');
}

async function runAgent(agent, model, prompt, outputFile, isSynthesis = false) {
  let cmd;
  const quotedPrompt = `"${prompt.replace(/"/g, '\\"')}"`;

  if (agent === 'codex') {
    cmd = `codex --model ${model} ${quotedPrompt}`;
  } else {
    // Claude Code: sonnet is default, omit --model if using it
    const modelFlag = model === 'sonnet' ? '' : ` --model ${model}`;
    cmd = `claude${modelFlag} ${quotedPrompt}`;
  }

  // Append redirection
  cmd += ` > ${outputFile}`;

  try {
    await execAsync(cmd, { shell: true, maxBuffer: 1024 * 1024 * 10 });
  } catch (err) {
    if (err.stderr) console.error(err.stderr);
    throw new Error(`Agent execution failed: ${err.message}`);
  }

  // For synthesis, verify output is not empty
  if (isSynthesis) {
    const content = await require('fs').promises.readFile(outputFile, 'utf8');
    if (!content || content.trim().length === 0) {
      throw new Error('Synthesis produced empty output. The agent may have failed.');
    }
  }
}

module.exports = { detectAgent, runAgent };
