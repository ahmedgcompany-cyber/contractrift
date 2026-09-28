/** Runs the local test-substitute upstreams for demos and E2E: npm run upstreams -w backend */
import { startUpstreams } from './upstreams.js';

const port = Number(process.env.UPSTREAMS_PORT ?? 4010);
const up = await startUpstreams(port);
console.log(`Test upstreams listening on ${up.url}`);
console.log(`  JSON API:        ${up.url}/json`);
console.log(`  OpenAI format:   ${up.url}/openai/v1   (API key: ${up.state.openai.apiKey})`);
console.log(`  Anthropic:       ${up.url}/anthropic   (API key: ${up.state.anthropic.apiKey})`);
console.log(`  MCP modern:      ${up.url}/mcp-modern`);
console.log(`  MCP legacy:      ${up.url}/mcp-legacy`);
console.log(`  Webhook sink:    ${up.url}/hook`);
console.log('Control (for demos): POST /__control with JSON merged into state, e.g. {"json":{"body":{"id":"x"}}}');
