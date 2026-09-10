import * as cfg from 'dotenv';

export const DEFAULT_ENV_FILE = '.env';

export function loadEnvFile(): void {
  const envFile = process.env.TEST_ENV_FILE ?? DEFAULT_ENV_FILE;

  const loaded = cfg.config({ path: envFile, override: true });

  if (loaded.error !== undefined) {
    throw new Error(
      `Could not load the env file '${envFile}': ${loaded.error.message}\n` +
        `Generate one with 'yarn prepare-env' - it writes every variable the suites read, so ` +
        `there is nothing to add by hand.`,
    );
  }
}
