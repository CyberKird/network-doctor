/// <reference types="vite/client" />

import type { NetworkDoctorApi } from '../../preload'

declare global {
  interface Window {
    api: NetworkDoctorApi
  }
}

export {}
