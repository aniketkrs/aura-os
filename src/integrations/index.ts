/**
 * Register all integrations — import this once at startup
 */
import './slack';
import './telegram';
import './discord';
import './github';

export { registerIntegration, getIntegration, listIntegrations,
  loadIntegrationConfig, saveIntegrationConfig, deleteIntegrationConfig,
  isConnected } from './integration-manager';
export type { AppMessage, SetupField, IntegrationDef } from './integration-manager';
