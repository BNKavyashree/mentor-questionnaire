import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import {
  ANSWER_COUNT,
  MAX_BODY_BYTES,
  createMentorServer,
} from '../server.mjs';

let temporaryDirectory;
let publicDirectory;
let submissionsDirectory;
let server;
let origin;

const answers = Array.from(
  { length: ANSWER_COUNT },
  (_, index) => `Mentor answer ${index + 1}`,
);

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, origin);
    const body = options.body;
    const headers = { ...options.headers };
    if (body !== undefined && headers['Content-Length'] === undefined) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const outgoing = http.request(
      url,
      {
        method: options.method || 'GET',
        headers,
      },
      (incoming) => {
        const chunks = [];
        incoming.on('data', (chunk) => chunks.push(chunk));
        incoming.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: incoming.statusCode,
            headers: incoming.headers,
            text,
            json: () => JSON.parse(text),
          });
        });
      },
    );
    outgoing.on('error', reject);
    if (body !== undefined) outgoing.write(body);
    outgoing.end();
  });
}

function postJson(value) {
  return request('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(value),
  });
}

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'mentor-server-test-'));
  publicDirectory = path.join(temporaryDirectory, 'public');
  submissionsDirectory = path.join(temporaryDirectory, 'submissions');
  await mkdir(publicDirectory, { recursive: true });
  await writeFile(
    path.join(publicDirectory, 'index.html'),
    '<!doctype html><title>Mentor questionnaire</title>',
    'utf8',
  );
  await writeFile(path.join(publicDirectory, 'app.js'), 'export {};\n', 'utf8');
  await writeFile(path.join(temporaryDirectory, 'secret.txt'), 'not public', 'utf8');

  server = createMentorServer({
    publicDirectory,
    submissionsDirectory,
    logger: { error() {} },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server?.listening) {
    // A rejected oversized upload may still be draining on a keep-alive socket.
    // Tests should not leave that client-controlled connection open forever.
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

await test('serves public files for GET and HEAD and returns JSON 404s', async () => {
  const indexResponse = await request('/');
  assert.equal(indexResponse.status, 200);
  assert.match(indexResponse.headers['content-type'], /^text\/html/);
  assert.match(indexResponse.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(indexResponse.headers['x-frame-options'], 'DENY');
  assert.match(indexResponse.text, /Mentor questionnaire/);

  const headResponse = await request('/app.js', { method: 'HEAD' });
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.text, '');
  assert.equal(headResponse.headers['content-length'], '11');

  const missingResponse = await request('/missing.html');
  assert.equal(missingResponse.status, 404);
  assert.equal(missingResponse.json().error.code, 'not_found');
});

await test('blocks encoded path traversal outside the public directory', async () => {
  const response = await request('/..%2Fsecret.txt');
  assert.equal(response.status, 403);
  assert.equal(response.json().error.code, 'forbidden_path');
  assert.doesNotMatch(response.text, /not public/);
});

await test('accepts a valid submission and atomically stores its receipt', async () => {
  const response = await postJson({
    answers,
    confirmed: true,
    metadata: {
      participantId: 'mentor-007',
      elapsedSeconds: 125.5,
    },
  });

  assert.equal(response.status, 201);
  const receipt = response.json();
  assert.match(
    receipt.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(receipt.receiptId, receipt.id);
  assert.equal(new Date(receipt.submittedAt).toISOString(), receipt.submittedAt);

  const files = await readdir(submissionsDirectory);
  assert.deepEqual(files, [`${receipt.id}.json`]);
  const stored = JSON.parse(
    await readFile(path.join(submissionsDirectory, files[0]), 'utf8'),
  );
  assert.equal(stored.id, receipt.id);
  assert.equal(stored.submittedAt, receipt.submittedAt);
  assert.deepEqual(stored.answers, answers);
  assert.equal(stored.confirmed, true);
  assert.equal(stored.metadata.participantId, 'mentor-007');
});

await test('rejects malformed JSON and invalid submission shapes with clear 400s', async () => {
  const cases = [
    {
      name: 'malformed JSON',
      body: '{bad json',
      expectedMessage: /valid JSON/,
    },
    {
      name: 'wrong answer count',
      value: { answers: answers.slice(1), confirmed: true },
      expectedMessage: /exactly 20/,
    },
    {
      name: 'blank answer',
      value: {
        answers: answers.map((answer, index) => (index === 3 ? '  \n ' : answer)),
        confirmed: true,
      },
      expectedMessage: /answers\[3\]/,
    },
    {
      name: 'non-string answer',
      value: {
        answers: answers.map((answer, index) => (index === 5 ? 42 : answer)),
        confirmed: true,
      },
      expectedMessage: /answers\[5\]/,
    },
    {
      name: 'confirmation missing',
      value: { answers },
      expectedMessage: /confirmed must be true/,
    },
    {
      name: 'unknown field',
      value: { answers, confirmed: true, admin: true },
      expectedMessage: /Unknown field/,
    },
    {
      name: 'nested metadata',
      value: {
        answers,
        confirmed: true,
        metadata: { nested: { unsafe: true } },
      },
      expectedMessage: /metadata\.nested/,
    },
  ];

  for (const testCase of cases) {
    const response = await request('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: testCase.body ?? JSON.stringify(testCase.value),
    });
    assert.equal(response.status, 400, testCase.name);
    const error = response.json().error;
    assert.equal(
      error.code,
      testCase.name === 'malformed JSON' ? 'invalid_json' : 'validation_error',
      testCase.name,
    );
    assert.match(error.message, testCase.expectedMessage, testCase.name);
  }
});

await test('enforces JSON content type, body limit, API methods, and API 404s', async () => {
  const wrongType = await request('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  });
  assert.equal(wrongType.status, 415);
  assert.equal(wrongType.json().error.code, 'unsupported_media_type');

  const oversized = await request('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(MAX_BODY_BYTES) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json().error.code, 'payload_too_large');

  const wrongMethod = await request('/api/submissions');
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.allow, 'POST');

  const missingApi = await request('/api/unknown');
  assert.equal(missingApi.status, 404);
  assert.equal(missingApi.json().error.code, 'not_found');
});
