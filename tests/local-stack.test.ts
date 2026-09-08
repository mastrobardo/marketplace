import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const COMPOSE = join(root, 'docker-compose.yml');

/** Services that stay up. `objects-init` is excluded on purpose — it provisions and exits. */
const LONG_RUNNING = ['db', 'mail', 'objects'] as const;
const PROVISIONER = 'objects-init';

interface ComposeService {
  image?: string;
  ports?: string[];
  volumes?: string[];
  environment?: Record<string, string>;
  healthcheck?: { test?: unknown };
  depends_on?: Record<string, { condition?: string }>;
}

interface ComposeFile {
  services?: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
}

function compose(): ComposeFile {
  expect(existsSync(COMPOSE), 'docker-compose.yml does not exist').toBe(true);
  return parseYaml(readFileSync(COMPOSE, 'utf8')) as ComposeFile;
}

function services(): Record<string, ComposeService> {
  return compose().services ?? {};
}

describe('AC1 — the stack declares exactly the services the MVP needs', () => {
  it('declares db, mail, objects and one bucket provisioner', () => {
    expect(Object.keys(services()).sort()).toEqual([...LONG_RUNNING, PROVISIONER].sort());
  });
});

describe('AC2 — every image is pinned', () => {
  it('pins every image to an explicit tag', () => {
    const entries = Object.entries(services());
    expect(entries.length, 'no services declared').toBeGreaterThan(0);
    for (const [name, service] of entries) {
      const image = service.image ?? '';
      expect(image, `${name} declares no image`).not.toBe('');
      // Split off any registry host, which may itself contain a `:port`.
      const tag = image.slice(image.lastIndexOf('/') + 1).split(':')[1];
      expect(tag, `${name} is untagged — it would float on :latest`).toBeDefined();
      expect(tag, `${name} floats on a moving tag`).not.toBe('latest');
    }
  });
});

describe('AC3 — nothing is reachable from outside this machine', () => {
  it('binds every published port to the loopback interface', () => {
    const published = Object.entries(services()).flatMap(([name, service]) =>
      (service.ports ?? []).map((port) => [name, port] as const),
    );
    expect(published.length, 'no ports are published').toBeGreaterThan(0);
    for (const [name, port] of published) {
      // The host port may be an override with a literal default — `${VAR:-5432}` — because a
      // developer machine often already has something on the conventional port.
      expect(port, `${name} publishes ${port} on every interface`).toMatch(
        /^127\.0\.0\.1:(?:\d+|\$\{[A-Z_]+:-\d+\}):\d+$/,
      );
    }
  });
});

describe('AC4 — the stack is up only when it is actually usable', () => {
  it('gives every long-running service a healthcheck', () => {
    for (const name of LONG_RUNNING) {
      expect(services()[name]?.healthcheck?.test, `${name} has no healthcheck`).toBeDefined();
    }
  });

  it('makes the bucket provisioner wait for a healthy object store', () => {
    expect(services()[PROVISIONER]?.depends_on?.['objects']?.condition).toBe('service_healthy');
  });
});

describe('AC5 — data survives a restart', () => {
  it('persists database and object data in named volumes', () => {
    const declared = Object.keys(compose().volumes ?? {});
    expect(declared.length, 'no named volumes declared').toBeGreaterThan(0);
    for (const [name, dataDir] of [
      ['db', '/var/lib/postgresql/data'],
      ['objects', '/data'],
    ] as const) {
      const mounts = services()[name]?.volumes ?? [];
      const mount = mounts.find((entry) => entry.split(':')[1] === dataDir);
      expect(mount, `${name} does not persist ${dataDir}`).toBeDefined();
      const source = mount?.split(':')[0] ?? '';
      expect(declared, `${name} persists ${dataDir} outside a named volume`).toContain(source);
    }
  });
});

describe('AC6 — the compose file holds no real credential', () => {
  const SECRET_SHAPES: ReadonlyArray<readonly [string, RegExp]> = [
    ['an AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
    ['a Stripe key', /\bsk_(?:test|live)_[A-Za-z0-9]{16,}\b/],
    ['a JWT', /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
    ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
    ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ];

  it('contains nothing shaped like a real secret', () => {
    const raw = readFileSync(COMPOSE, 'utf8');
    for (const [what, shape] of SECRET_SHAPES) {
      expect(shape.test(raw), `docker-compose.yml contains ${what}`).toBe(false);
    }
  });

  it('uses low-entropy local placeholders for every credential', () => {
    const credentials = Object.entries(services()).flatMap(([name, service]) =>
      Object.entries(service.environment ?? {})
        .filter(([key]) => /PASSWORD|SECRET|TOKEN|_KEY$/.test(key))
        .map(([key, value]) => [`${name}.${key}`, value] as const),
    );
    expect(credentials.length, 'no credentials found to check').toBeGreaterThan(0);
    for (const [where, value] of credentials) {
      // A real secret is long and high-entropy. A local placeholder is neither.
      expect(value, `${where} does not look like a local placeholder`).toMatch(/^[a-z0-9_]{8,32}$/);
    }
  });
});

describe('AC7 — one command up, one command down, one command clean', () => {
  it('exposes stack:up, stack:down, stack:reset and stack:logs at the root', () => {
    const scripts =
      (
        JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
          scripts?: Record<string, string>;
        }
      ).scripts ?? {};
    for (const name of ['stack:up', 'stack:down', 'stack:reset', 'stack:logs']) {
      expect(scripts[name], `root package.json has no ${name} script`).toBeDefined();
    }
    expect(scripts['stack:up'], 'stack:up returns before the stack is usable').toContain('--wait');
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Live criteria. Gated so the default suite needs no Docker daemon — CI (W0-T06) opts in.
 * ------------------------------------------------------------------------------------------- */

const live = process.env['STACK_LIVE'] === '1';

function dc(...args: string[]): string {
  return execFileSync('docker', ['compose', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Where a service's container port landed on the host, honouring any local port override. */
function hostPort(service: string, containerPort: number): string {
  const mapping = dc('port', service, String(containerPort));
  expect(mapping, `${service}:${containerPort} is not published`).toMatch(/:\d+$/);
  return mapping;
}

function psql(sql: string): string {
  return dc('exec', '-T', 'db', 'psql', '-U', 'marketplace', '-d', 'marketplace', '-tAc', sql);
}

/** A deliberately minimal SMTP conversation — proving capture needs no mail library. */
async function smtpSend(subject: string): Promise<void> {
  const port = Number(hostPort('mail', 1025).split(':').pop());
  const script = [
    'EHLO local-stack.test',
    'MAIL FROM:<noreply@marketplace.test>',
    'RCPT TO:<dev@marketplace.test>',
    'DATA',
    `Subject: ${subject}\r\n\r\nW0-T02 acceptance criterion 10.\r\n.`,
    'QUIT',
  ];

  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setEncoding('utf8');
    let buffer = '';
    let step = -1;

    socket.on('error', reject);
    socket.on('close', resolve);
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        // `250-text` is a continuation; only `250 text` ends a reply. DATA answers 354, so an
        // intermediate 3xx advances the conversation exactly like a 2xx does.
        const reply = /^([2345])\d\d (?!-)/.exec(line);
        if (reply === null) continue;
        if (reply[1] === '4' || reply[1] === '5') {
          socket.destroy();
          reject(new Error(`SMTP rejected: ${line}`));
          return;
        }
        step += 1;
        const next = script[step];
        if (next !== undefined) socket.write(`${next}\r\n`);
      }
    });
  });
}

interface MailpitMessage {
  Subject?: string;
}

describe.skipIf(!live)('AC8/AC9 — a real database with real geography', () => {
  it('accepts a connection as the application user', () => {
    expect(psql('select current_user || $$|$$ || current_database()')).toBe(
      'marketplace|marketplace',
    );
  });

  it('exposes PostGIS in the application database', () => {
    expect(psql('select postgis_version()')).toMatch(/^\d+\.\d+/);
  });
});

describe.skipIf(!live)('AC10 — mail is captured, never delivered', () => {
  // The poll budget alone is 5s and this test also shells out to `docker compose`, so it needs
  // more than the default per-test timeout. Vitest 5 takes the budget as an options object.
  it('captures a message submitted over SMTP', { timeout: 30_000 }, async () => {
    const subject = `w0-t02-${Date.now()}`;
    await smtpSend(subject);

    const seen = async (): Promise<boolean> => {
      const response = await fetch(`http://${hostPort('mail', 8025)}/api/v1/messages?limit=50`);
      expect(response.ok, 'the mail API did not respond').toBe(true);
      const body = (await response.json()) as { messages?: MailpitMessage[] };
      return (body.messages ?? []).some((message) => message.Subject === subject);
    };

    let found = false;
    for (let attempt = 0; attempt < 20 && !found; attempt += 1) {
      found = await seen();
      if (!found) await new Promise((r) => setTimeout(r, 250));
    }
    expect(found, `no captured message with subject ${subject}`).toBe(true);
  });
});

describe.skipIf(!live)('AC11 — object storage is live and provisioned', () => {
  it('reports the object store live', async () => {
    const response = await fetch(`http://${hostPort('objects', 9000)}/minio/health/live`);
    expect(response.status).toBe(200);
  });

  it('creates the uploads bucket', () => {
    // Credentials come from the object store's own definition — the names the image mandates.
    const env = services()['objects']?.environment ?? {};
    const listed = dc(
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'sh',
      PROVISIONER,
      '-c',
      `mc alias set live http://objects:9000 "${env['MINIO_ROOT_USER'] ?? ''}" "${env['MINIO_ROOT_PASSWORD'] ?? ''}" >/dev/null && mc ls live`,
    );
    expect(listed).toContain('marketplace-uploads');
  });
});

describe.skipIf(!live)('AC12 — the stack reports itself healthy', () => {
  it('has every long-running service healthy', () => {
    const states = dc('ps', '--format', 'json')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { Service?: string; Health?: string });
    for (const name of LONG_RUNNING) {
      expect(states.find((s) => s.Service === name)?.Health, `${name} is not healthy`).toBe(
        'healthy',
      );
    }
  });
});
