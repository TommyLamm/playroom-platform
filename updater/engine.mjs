import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class UpdateError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function settings(env = process.env) {
  const repository = env.UPDATE_REPOSITORY || '';
  const branch = env.UPDATE_BRANCH || 'main';
  const deployDir = env.DEPLOY_DIR || '';
  const project = env.COMPOSE_PROJECT_NAME || 'playroom';
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(repository))
    throw new Error(
      'UPDATE_REPOSITORY must be a public GitHub HTTPS repository without credentials',
    );
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) ||
    branch.includes('..') ||
    branch.endsWith('/') ||
    branch.includes('//')
  )
    throw new Error('Invalid UPDATE_BRANCH');
  if (!/^\/[A-Za-z0-9_./-]+$/.test(deployDir) || deployDir.includes('/../'))
    throw new Error('DEPLOY_DIR must be an absolute host path');
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('Invalid project name');
  if (!env.UPDATER_TOKEN || env.UPDATER_TOKEN.length < 32)
    throw new Error('UPDATER_TOKEN must contain at least 32 characters');
  return {
    repository,
    branch,
    deployDir,
    project,
    token: env.UPDATER_TOKEN,
    stateDir: env.UPDATE_STATE_DIR || '/state',
  };
}

// No shell interpolation: repositories, commits and deployment paths are server-side configuration.
export function command(binary, args, { cwd, timeout = 120000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const capture = (chunk) => {
      output = (output + chunk.toString()).slice(-24000);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${binary} failed (${code ?? 'timeout'}): ${output.slice(-6000)}`));
    });
  });
}

export class UpdateEngine {
  constructor(config, run = command) {
    this.config = config;
    this.run = run;
    this.state = { jobs: [] };
    this.busy = false;
    this.checking = false;
    this.source = path.join(config.stateDir, 'source');
  }
  async save() {
    const file = path.join(this.config.stateDir, 'status.json');
    await fs.writeFile(file + '.tmp', JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.rename(file + '.tmp', file);
  }
  compose(args) {
    return this.run(
      'docker',
      [
        'compose',
        '--project-name',
        this.config.project,
        '--project-directory',
        this.config.deployDir,
        '--env-file',
        '/deployment/.env',
        '-f',
        '/deployment/compose.yaml',
        '-f',
        '/deployment/compose.ota.yaml',
        '-f',
        path.join(this.config.stateDir, 'active.json'),
        ...args,
      ],
      { timeout: 180000 },
    );
  }
  async init() {
    await fs.mkdir(this.config.stateDir, { recursive: true });
    try {
      this.state = JSON.parse(
        await fs.readFile(path.join(this.config.stateDir, 'status.json'), 'utf8'),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const active = path.join(this.config.stateDir, 'active.json');
    try {
      await fs.access(active);
    } catch {
      await fs.writeFile(active, JSON.stringify({ services: { app: {} } }));
    }
    const pending = this.state.jobs.find((job) => job.status === 'running' || job.recovery);
    if (pending) {
      this.busy = true;
      try {
        if (pending.recovery) await this.rollback(pending);
        pending.status = 'failed';
        pending.error = '更新服務重新啟動，中斷的更新已停止';
        pending.finishedAt = new Date().toISOString();
        await this.save();
      } catch (error) {
        pending.error = `中斷更新回復失敗，需主機管理員介入：${error.message}`;
        await this.save();
        throw error;
      } finally {
        this.busy = false;
      }
    }
  }
  async running() {
    const id = await this.compose(['ps', '-a', '-q', 'app']);
    if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Expected exactly one app container');
    const inspected = JSON.parse(await this.run('docker', ['inspect', id]))[0];
    const data = inspected.Mounts.find((mount) => mount.Destination === '/data');
    const backups = inspected.Mounts.find((mount) => mount.Destination === '/backups');
    if (data?.Type !== 'volume' || !backups)
      throw new Error('Expected a named data volume and backup mount');
    return {
      id,
      image: inspected.Image,
      commit: inspected.Config.Labels?.['org.opencontainers.image.revision'] || 'unknown',
      data,
      backups,
    };
  }
  async status() {
    const running = await this.running();
    return {
      enabled: true,
      current: running.commit,
      repository: this.config.repository,
      branch: this.config.branch,
      latest: this.state.latest,
      checkedAt: this.state.checkedAt,
      checkError: this.state.checkError,
      jobs: this.state.jobs.map(({ recovery, ...publicJob }) => publicJob),
    };
  }
  async check() {
    if (this.busy || this.checking) throw new UpdateError(409, '正在處理更新，請稍後再試');
    this.checking = true;
    try {
      await fs.mkdir(this.source, { recursive: true });
      await this.run('git', ['init', this.source]);
      await this.run('git', [
        '-C',
        this.source,
        'fetch',
        '--depth=1',
        '--no-tags',
        this.config.repository,
        `refs/heads/${this.config.branch}`,
      ]);
      const commit = await this.run('git', [
        '-C',
        this.source,
        'rev-parse',
        '--verify',
        'FETCH_HEAD^{commit}',
      ]);
      if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid fetched commit');
      const metadata = await this.run('git', [
        '-C',
        this.source,
        'show',
        '-s',
        '--format=%cI%n%s',
        commit,
      ]);
      const [date, ...subject] = metadata.split('\n');
      this.state.latest = { commit, date, subject: subject.join('\n').slice(0, 200) };
      this.state.checkedAt = new Date().toISOString();
      delete this.state.checkError;
      await this.save();
      return await this.status();
    } catch (error) {
      this.state.checkError = 'GitHub 檢查失敗，請確認網路、公開 repository 與分支';
      await this.save();
      throw error;
    } finally {
      this.checking = false;
    }
  }
  async start(commit) {
    if (this.busy || this.checking) throw new UpdateError(409, '已有更新正在執行');
    if (this.state.jobs.some((job) => job.recovery))
      throw new UpdateError(409, '上次更新仍需人工回復，暫停新的更新');
    if (!/^[a-f0-9]{40}$/.test(commit) || commit !== this.state.latest?.commit)
      throw new UpdateError(409, '版本已變更，請先重新檢查更新');
    this.busy = true;
    try {
      const current = await this.running();
      if (current.commit === commit) throw new UpdateError(409, '目前已是這個版本');
      const job = {
        id: randomUUID(),
        commit,
        status: 'running',
        phase: 'queued',
        startedAt: new Date().toISOString(),
      };
      this.state.jobs = [job, ...this.state.jobs].slice(0, 30);
      await this.save();
      this.task = this.execute(job, current).finally(() => {
        this.busy = false;
      });
      return { jobId: job.id };
    } catch (error) {
      this.busy = false;
      throw error;
    }
  }
  async phase(job, phase) {
    job.phase = phase;
    await this.save();
  }
  async activate(value) {
    const file = path.join(this.config.stateDir, 'active.json');
    await fs.writeFile(file + '.tmp', JSON.stringify(value, null, 2));
    await fs.rename(file + '.tmp', file);
  }
  async execute(job, previous) {
    try {
      await this.phase(job, 'building');
      await this.run('git', ['-C', this.source, 'checkout', '--detach', '--force', job.commit]);
      const image = `playroom-app:${job.commit}`;
      await this.run(
        'docker',
        ['build', '--build-arg', `APP_COMMIT=${job.commit}`, '-t', image, this.source],
        { timeout: 30 * 60000 },
      );
      const active = JSON.parse(
        await fs.readFile(path.join(this.config.stateDir, 'active.json'), 'utf8'),
      );
      job.recovery = { ...previous, active, backupReady: false };
      job.backup = `ota-${job.id}`;
      await this.phase(job, 'backing-up');
      await this.compose(['stop', '--timeout', '45', 'app']);
      await this.compose([
        'run',
        '--rm',
        '--no-deps',
        '--pull',
        'never',
        'app',
        'npm',
        'run',
        'backup',
        '--',
        `/backups/${job.backup}`,
      ]);
      job.recovery.backupReady = true;
      await this.save();
      await this.phase(job, 'deploying');
      await this.activate({
        ...active,
        services: { ...active.services, app: { ...active.services?.app, image } },
      });
      await this.compose([
        'up',
        '-d',
        '--no-deps',
        '--no-build',
        '--wait',
        '--wait-timeout',
        '120',
        'app',
      ]);
      await this.phase(job, 'verifying');
      const next = await this.running();
      if (next.commit !== job.commit)
        throw new Error('Running commit does not match requested update');
      job.status = 'completed';
      job.phase = 'completed';
      delete job.recovery;
    } catch (error) {
      job.error = `更新失敗：${error.message.slice(-6000)}`;
      try {
        if (job.recovery) await this.rollback(job);
        else job.phase = 'failed';
      } catch (rollbackError) {
        job.error += `\n回復失敗，請主機管理員介入：${rollbackError.message}`;
        job.phase = 'recovery-failed';
      }
      job.status = 'failed';
    }
    job.finishedAt = new Date().toISOString();
    await this.save();
  }
  async rollback(job) {
    const recovery = job.recovery;
    await this.phase(job, 'rolling-back');
    await this.compose(['stop', '--timeout', '45', 'app']);
    let active = recovery.active;
    if (recovery.backupReady) {
      // Restore into a new volume; retain the failed version's volume for forensic recovery.
      const volume = `${this.config.project}-recovery-${randomUUID()}`;
      await this.run('docker', ['volume', 'create', volume]);
      const backupMount =
        recovery.backups.Type === 'volume' ? recovery.backups.Name : recovery.backups.Source;
      await this.run(
        'docker',
        [
          'run',
          '--rm',
          '--network',
          'none',
          '-e',
          'NODE_ENV=development',
          '-e',
          'DATA_DIR=/data',
          '-v',
          `${volume}:/data`,
          '-v',
          `${backupMount}:/backups:ro`,
          recovery.image,
          'npm',
          'run',
          'restore',
          '--',
          `/backups/${job.backup}`,
        ],
        { timeout: 10 * 60000 },
      );
      active = {
        ...active,
        services: {
          ...active.services,
          app: { ...active.services?.app, image: recovery.image, volumes: ['ota_recovered:/data'] },
        },
        volumes: { ...active.volumes, ota_recovered: { external: true, name: volume } },
      };
    }
    await this.activate(active);
    await this.compose([
      'up',
      '-d',
      '--no-deps',
      '--no-build',
      '--wait',
      '--wait-timeout',
      '120',
      'app',
    ]);
    job.phase = 'rolled-back';
    delete job.recovery;
  }
}
