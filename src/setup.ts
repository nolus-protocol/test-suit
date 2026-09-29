import { setDefaultResultOrder } from 'dns';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'net';

import { loadEnvFile } from './util/env';

const CONNECT_ATTEMPT_TIMEOUT_MS = 5000;

setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);

loadEnvFile();
