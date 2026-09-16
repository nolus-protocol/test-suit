import { loadEnvFile } from './util/env';
import { installNetworkResilience } from './util/retry';

loadEnvFile();
installNetworkResilience();
