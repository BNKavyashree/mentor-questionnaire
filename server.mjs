import { createReadStream } from 'node:fs';
import {
  mkdir,
  open,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ANSWER_COUNT = 20;
export const MAX_BODY_BYTES = 1024 * 1024;

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIRECTORY = path.join(MODULE_DIRECTORY, 'public');
const DEFAULT_SUBMISSIONS_DIRECTORY = path.join(
  MODULE_DIRECTORY,
  'data',
  'submissions',
);

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function setCommonHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  );
  response.setHeader(
    'Permissions-Policy',
    'camera=(), geolocation=(), microphone=()',
  );
}

function sendJson(response, status, value, extraHeaders = {}) {
  if (response.headersSent || response.writableEnded) {
    return;
  }

  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  setCommonHeaders(response);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.byteLength,
    ...extraHeaders,
  });
  response.end(body);
}

function sendError(response, error) {
  sendJson(response, error.status, {
    error: {
      code: error.code,
      message: error.message,
    },
  });
}

function notFound(response) {
  sendError(
    response,
    new HttpError(404, 'not_found', 'The requested resource was not found.'),
  );
}

function isWithinDirectory(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function decodeRequestPath(requestUrl) {
  const rawPath = (requestUrl || '/').split('?', 1)[0];

  try {
    return decodeURIComponent(rawPath);
  } catch {
    throw new HttpError(400, 'invalid_url', 'The request URL is malformed.');
  }
}

async function findStaticFile(publicDirectory, requestUrl) {
  const decodedPath = decodeRequestPath(requestUrl);

  if (decodedPath.includes('\0')) {
    throw new HttpError(400, 'invalid_url', 'The request URL is malformed.');
  }

  const segments = decodedPath.split(/[\\/]+/);
  if (segments.includes('..')) {
    throw new HttpError(
      403,
      'forbidden_path',
      'The requested path is outside the public directory.',
    );
  }

  const relativePath = segments
    .filter((segment) => segment !== '' && segment !== '.')
    .join(path.sep);
  const publicRoot = path.resolve(publicDirectory);
  let candidate = path.resolve(publicRoot, relativePath);

  if (!isWithinDirectory(publicRoot, candidate)) {
    throw new HttpError(
      403,
      'forbidden_path',
      'The requested path is outside the public directory.',
    );
  }

  let candidateStat;
  try {
    candidateStat = await stat(candidate);
    if (candidateStat.isDirectory()) {
      candidate = path.join(candidate, 'index.html');
      candidateStat = await stat(candidate);
    }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }

  if (!candidateStat.isFile()) {
    return null;
  }

  // Lexical checks alone do not prevent a symlink inside public from pointing
  // at a private file, so compare the resolved filesystem paths as well.
  let realPublicRoot;
  let realCandidate;
  try {
    [realPublicRoot, realCandidate] = await Promise.all([
      realpath(publicRoot),
      realpath(candidate),
    ]);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }

  if (!isWithinDirectory(realPublicRoot, realCandidate)) {
    throw new HttpError(
      403,
      'forbidden_path',
      'The requested path is outside the public directory.',
    );
  }

  return {
    path: realCandidate,
    size: candidateStat.size,
  };
}

async function serveStatic(request, response, publicDirectory) {
  const file = await findStaticFile(publicDirectory, request.url);
  if (!file) {
    notFound(response);
    return;
  }

  const contentType =
    CONTENT_TYPES.get(path.extname(file.path).toLowerCase()) ||
    'application/octet-stream';
  setCommonHeaders(response);
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': file.size,
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  await pipeline(createReadStream(file.path), response);
}

function contentLength(request) {
  const header = request.headers['content-length'];
  if (header === undefined) {
    return null;
  }

  if (!/^\d+$/.test(header)) {
    throw new HttpError(
      400,
      'invalid_content_length',
      'Content-Length must be a non-negative integer.',
    );
  }

  return Number(header);
}

function readRequestBody(request, maximumBytes) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    let settled = false;

    const removeListeners = () => {
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('aborted', onAborted);
      request.removeListener('error', onError);
    };

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      removeListeners();
      reject(error);
    };

    const onData = (chunk) => {
      size += chunk.length;
      if (size > maximumBytes) {
        chunks = [];
        rejectOnce(
          new HttpError(
            413,
            'payload_too_large',
            `The request body must not exceed ${maximumBytes} bytes.`,
          ),
        );
        // Drain the rest so the connection remains in a usable state.
        request.resume();
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      removeListeners();
      resolve(Buffer.concat(chunks, size));
    };

    const onAborted = () => {
      rejectOnce(
        new HttpError(400, 'request_aborted', 'The request body was aborted.'),
      );
    };

    const onError = () => {
      rejectOnce(
        new HttpError(400, 'request_error', 'The request body could not be read.'),
      );
    };

    request.on('data', onData);
    request.on('end', onEnd);
    request.on('aborted', onAborted);
    request.on('error', onError);
  });
}

function validateMetadata(metadata) {
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    throw new HttpError(
      400,
      'validation_error',
      'metadata must be an object when provided.',
    );
  }

  const entries = Object.entries(metadata);
  if (entries.length > 25) {
    throw new HttpError(
      400,
      'validation_error',
      'metadata must contain no more than 25 fields.',
    );
  }

  for (const [key, value] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) {
      throw new HttpError(
        400,
        'validation_error',
        'metadata field names must be 1-64 letters, numbers, dots, underscores, or hyphens.',
      );
    }

    const isScalar =
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= 2000);
    if (!isScalar) {
      throw new HttpError(
        400,
        'validation_error',
        `metadata.${key} must be null, a boolean, a finite number, or a string of at most 2000 characters.`,
      );
    }
  }
}

function validateSubmission(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(
      400,
      'validation_error',
      'The JSON body must be an object.',
    );
  }

  const allowedFields = new Set(['answers', 'confirmed', 'metadata']);
  const unknownFields = Object.keys(value).filter(
    (field) => !allowedFields.has(field),
  );
  if (unknownFields.length > 0) {
    throw new HttpError(
      400,
      'validation_error',
      `Unknown field${unknownFields.length === 1 ? '' : 's'}: ${unknownFields.join(', ')}.`,
    );
  }

  if (!Array.isArray(value.answers) || value.answers.length !== ANSWER_COUNT) {
    throw new HttpError(
      400,
      'validation_error',
      `answers must be an array containing exactly ${ANSWER_COUNT} items.`,
    );
  }

  for (let index = 0; index < value.answers.length; index += 1) {
    const answer = value.answers[index];
    if (typeof answer !== 'string' || answer.trim() === '') {
      throw new HttpError(
        400,
        'validation_error',
        `answers[${index}] must be a nonblank string.`,
      );
    }
  }

  if (value.confirmed !== true) {
    throw new HttpError(
      400,
      'validation_error',
      'confirmed must be true.',
    );
  }

  if (value.metadata !== undefined) {
    validateMetadata(value.metadata);
  }

  return {
    answers: [...value.answers],
    confirmed: true,
    ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
  };
}

async function parseSubmission(request, maximumBytes) {
  const mediaType = (request.headers['content-type'] || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    request.resume();
    throw new HttpError(
      415,
      'unsupported_media_type',
      'Content-Type must be application/json.',
    );
  }

  const declaredLength = contentLength(request);
  if (declaredLength !== null && declaredLength > maximumBytes) {
    request.resume();
    throw new HttpError(
      413,
      'payload_too_large',
      `The request body must not exceed ${maximumBytes} bytes.`,
    );
  }

  const body = await readRequestBody(request, maximumBytes);
  if (body.length === 0) {
    throw new HttpError(400, 'invalid_json', 'The JSON body must not be empty.');
  }

  let parsed;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON.');
  }

  return validateSubmission(parsed);
}

async function writeSubmission(submissionsDirectory, submission) {
  await mkdir(submissionsDirectory, { recursive: true });

  const id = randomUUID();
  const submittedAt = new Date().toISOString();
  const record = {
    id,
    submittedAt,
    ...submission,
  };
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  const finalPath = path.join(submissionsDirectory, `${id}.json`);
  const temporaryPath = path.join(
    submissionsDirectory,
    `.${id}.${randomUUID()}.tmp`,
  );

  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, finalPath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }

  return { id, submittedAt };
}

/**
 * Creates the questionnaire HTTP server without starting it.
 * Tests and embedders can supply isolated directories through options.
 */
export function createMentorServer(options = {}) {
  const publicDirectory = path.resolve(
    options.publicDirectory || DEFAULT_PUBLIC_DIRECTORY,
  );
  const submissionsDirectory = path.resolve(
    options.submissionsDirectory || DEFAULT_SUBMISSIONS_DIRECTORY,
  );
  const maximumBodyBytes = options.maximumBodyBytes ?? MAX_BODY_BYTES;
  const logger = options.logger || console;

  return createHttpServer((request, response) => {
    const handleRequest = async () => {
      let url;
      try {
        url = new URL(request.url || '/', 'http://localhost');
      } catch {
        throw new HttpError(400, 'invalid_url', 'The request URL is malformed.');
      }

      if (url.pathname === '/api/submissions') {
        if (request.method !== 'POST') {
          request.resume();
          sendJson(
            response,
            405,
            {
              error: {
                code: 'method_not_allowed',
                message: 'Only POST is allowed for this endpoint.',
              },
            },
            { Allow: 'POST' },
          );
          return;
        }

        const submission = await parseSubmission(request, maximumBodyBytes);
        const receipt = await writeSubmission(
          submissionsDirectory,
          submission,
        );
        sendJson(response, 201, {
          id: receipt.id,
          receiptId: receipt.id,
          submittedAt: receipt.submittedAt,
        });
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        request.resume();
        notFound(response);
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        request.resume();
        notFound(response);
        return;
      }

      await serveStatic(request, response, publicDirectory);
    };

    handleRequest().catch((error) => {
      if (response.writableEnded) {
        return;
      }

      if (error instanceof HttpError) {
        sendError(response, error);
        return;
      }

      logger.error?.('Unhandled request error:', error);
      if (!response.headersSent) {
        sendError(
          response,
          new HttpError(
            500,
            'internal_server_error',
            'An unexpected server error occurred.',
          ),
        );
      } else if (!response.destroyed) {
        response.destroy();
      }
    });
  });
}

const isMainModule =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  const portText = process.env.PORT || '3000';
  const port = Number(portText);
  const host = process.env.HOST || '127.0.0.1';

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid PORT value: ${portText}`);
    process.exitCode = 1;
  } else {
    const server = createMentorServer();
    server.on('error', (error) => {
      console.error('Server failed to start:', error);
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      const address = server.address();
      const listeningPort =
        address && typeof address === 'object' ? address.port : port;
      console.log(`Mentor questionnaire listening at http://${host}:${listeningPort}`);
    });
  }
}
