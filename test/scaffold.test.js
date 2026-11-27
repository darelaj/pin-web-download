import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeMajor } from '../src/index.js';
test('Node 24 runtime', () => assert.equal(runtimeMajor, 24));
