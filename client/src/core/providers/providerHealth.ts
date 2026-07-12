import { providerRegistry } from './providerRegistry'
import type { ProviderHealthStatus, ProviderType } from './providerTypes'

export const providerHealth = {
  getOverallHealth(): ProviderHealthStatus {
    const inboxDesc = providerRegistry.getDescriptor('inbox')
    if (inboxDesc && inboxDesc.connectionStatus === 'connected') {
      return 'healthy'
    }
    return 'degraded'
  },

  getProviderHealth(type: ProviderType): ProviderHealthStatus {
    const desc = providerRegistry.getDescriptor(type)
    return desc ? desc.healthStatus : 'unknown'
  },

  getSummary(): {
    connected: number
    planned: number
    total: number
    overallHealth: ProviderHealthStatus
  } {
    const all = providerRegistry.getAllDescriptors()
    const connected = all.filter((d) => d.connectionStatus === 'connected').length
    const planned = all.filter((d) => d.connectionStatus === 'planned').length
    return {
      connected,
      planned,
      total: all.length,
      overallHealth: this.getOverallHealth(),
    }
  },
}
