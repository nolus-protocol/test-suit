import { NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { customFees } from './utils';

export async function applyLeaserConfig(
  leaserInstance: NolusContracts.Leaser,
  leaserContractAddress: string,
  userWithBalanceWallet: NolusWallet,
  adminWallet: NolusWallet,
  config: NolusContracts.LeaserConfigInfo,
): Promise<void> {
  const cfg: Record<string, unknown> = { ...config };
  cfg.lease_code = undefined;
  cfg.dex = undefined;
  cfg.lpp = undefined;
  cfg.market_price_oracle = undefined;
  cfg.profit = undefined;
  cfg.time_alarms = undefined;
  cfg.reserve = undefined;
  cfg.protocols_registry = undefined;
  cfg.lease_admin = undefined;

  const updateConfigMsg = {
    config_leases: cfg,
  };

  await userWithBalanceWallet.transferAmount(
    adminWallet.address as string,
    customFees.configs.amount,
    customFees.transfer,
  );

  await adminWallet.executeContract(
    leaserContractAddress,
    updateConfigMsg,
    customFees.configs,
  );

  const updatedConfig = await leaserInstance.getLeaserConfig();
  expect(updatedConfig.config).toEqual(config);
}
