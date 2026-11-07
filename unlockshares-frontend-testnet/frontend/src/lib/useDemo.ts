import { useSyncExternalStore } from 'react'
import { appStore } from '../services/app'

/** État de l'appli (testnet ou démo), relu automatiquement à chaque changement */
export const useDemo = () => useSyncExternalStore(appStore.subscribe, appStore.get)
