import { inboxProvider } from './inboxProvider'
import { scheduleProvider } from './scheduleProvider'
import { fileProvider } from './fileProvider'
import { businessDataProvider } from './businessDataProvider'
import { workflowProvider } from './workflowProvider'
import { notificationProvider } from './notificationProvider'
import type { ProviderDescriptor, ProviderType } from './providerTypes'

const ALL_PROVIDERS = [
  inboxProvider,
  scheduleProvider,
  fileProvider,
  businessDataProvider,
  workflowProvider,
  notificationProvider,
] as const

export const providerRegistry = {
  getAllDescriptors(): ProviderDescriptor[] {
    return ALL_PROVIDERS.map((p) => p.getDescriptor())
  },

  getDescriptor(type: ProviderType): ProviderDescriptor | null {
    const provider = ALL_PROVIDERS.find((p) => p.getDescriptor().providerType === type)
    return provider ? provider.getDescriptor() : null
  },

  getConnectedDescriptors(): ProviderDescriptor[] {
    return this.getAllDescriptors().filter((d) => d.connectionStatus === 'connected')
  },

  getPlannedDescriptors(): ProviderDescriptor[] {
    return this.getAllDescriptors().filter((d) => d.connectionStatus === 'planned')
  },

  async getInboxItems() {
    return inboxProvider.getItems()
  },

  async getScheduleItems() {
    return scheduleProvider.getItems()
  },

  async getFileItems() {
    return fileProvider.getItems()
  },

  async getBusinessMetrics() {
    return businessDataProvider.getItems()
  },
}
