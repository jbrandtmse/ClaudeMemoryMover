import { CmemmovError } from '../core/error.js';

export async function run(): Promise<void> {
  await Promise.resolve();
  throw new CmemmovError({ code: 'INTERNAL', hint: 'not yet implemented' });
}
