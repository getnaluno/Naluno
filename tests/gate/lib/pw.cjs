/* Finds Playwright: installed next to the gate (npm install in tests/gate),
   or installed globally. */
const { execSync } = require('child_process');
const path = require('path');
let cached = null;
function pw() {
  if (cached) return cached;
  const tries = [];
  try { cached = require('playwright'); return cached; } catch (e) { tries.push(e.message.split('\n')[0]); }
  try { cached = require(path.join(__dirname, '..', 'node_modules', 'playwright')); return cached; } catch (e) { tries.push(e.message.split('\n')[0]); }
  try {
    const g = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    cached = require(path.join(g, 'playwright'));
    return cached;
  } catch (e) { tries.push(e.message.split('\n')[0]); }
  throw new Error('Playwright not found. Run: cd tests/gate && npm install  (' + tries.join(' / ') + ')');
}
module.exports = { pw };
