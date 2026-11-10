import fs from 'node:fs';
import path from 'node:path';
import { JOBS_DIR } from './config.js';
import type { Brief, JobState } from './schema.js';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';

export function newJob(brief: Brief): JobState {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const id = `${stamp}-${slug(brief.topic)}`;
  const dir = path.join(JOBS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const job: JobState = { id, dir, stage: 'research', brief };
  save(job);
  return job;
}

export function save(job: JobState) {
  fs.writeFileSync(path.join(job.dir, 'state.json'), JSON.stringify(job, null, 2));
}

export function load(dirOrId: string): JobState {
  const dir = fs.existsSync(dirOrId) ? path.resolve(dirOrId) : path.join(JOBS_DIR, dirOrId);
  const job = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) as JobState;
  job.dir = dir; // the folder may have moved
  return job;
}

export function listJobs(): { id: string; stage: string; topic: string }[] {
  if (!fs.existsSync(JOBS_DIR)) return [];
  return fs.readdirSync(JOBS_DIR)
    .filter((d) => fs.existsSync(path.join(JOBS_DIR, d, 'state.json')))
    .sort().reverse()
    .map((d) => {
      const j = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, d, 'state.json'), 'utf8')) as JobState;
      return { id: d, stage: j.stage, topic: j.brief.topic };
    });
}

export const write = (job: JobState, name: string, content: string | Buffer) => {
  const p = path.join(job.dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
};
