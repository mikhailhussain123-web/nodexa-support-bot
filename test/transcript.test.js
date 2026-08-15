const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('../src/transcript');

test('escapes transcript message content safely', () => {
  assert.equal(escapeHtml('<script>&'), '&lt;script&gt;&amp;');
});
